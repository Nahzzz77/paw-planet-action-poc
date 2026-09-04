#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ComfyWorkerClient } from '../lib/comfy/worker-client.ts';
import {
  decideAutomaticQaRetry,
  hashBatchManifest,
  markQaFailedBranchesForRetry,
  relativeOutputPath,
  runPetActionBatch,
  type BatchRunSummary,
  type PetActionBatchManifest,
} from '../lib/comfy/worker-pool.ts';
import {
  finalizePetActionBranch,
  finalizePetActionBatch,
  resolveMediaToolchain,
} from '../lib/video/pet-video-finalizer.ts';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

type CliOptions = {
  manifest: string;
  runDirectory?: string;
  retryFailed: boolean;
  allowBusyWorkers: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

function usage() {
  return `Usage:
  npm run pet:batch -- --manifest <batch-manifest.json> [options]

Options:
  --run-dir <directory>     Persistent run record and downloaded outputs
  --retry-failed            Retry only branches with an explicit failed state
  --allow-busy-workers      Do not require empty ComfyUI queues during preflight
  --poll-ms <milliseconds>  History/queue poll interval (default: 15000)
  --timeout-ms <ms>         Per-prompt poll window (default: 1200000)

Required server-only environment variables:
  COMFY_GPU_1_URL ... COMFY_GPU_4_URL
Optional short-lived cookies:
  COMFY_GPU_1_AUTH_COOKIE ... COMFY_GPU_4_AUTH_COOKIE

Cookies are read from the process environment only. They are never written to
the run record. A failed response to POST /prompt is not blindly retried.`;
}

function positiveInteger(value: string, name: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const result: CliOptions = { manifest: '', retryFailed: false, allowBusyWorkers: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--manifest') {
      result.manifest = argv[++index] ?? '';
    } else if (arg === '--run-dir') {
      result.runDirectory = argv[++index];
    } else if (arg === '--retry-failed') {
      result.retryFailed = true;
    } else if (arg === '--allow-busy-workers') {
      result.allowBusyWorkers = true;
    } else if (arg === '--poll-ms') {
      result.pollIntervalMs = positiveInteger(argv[++index] ?? '', '--poll-ms');
    } else if (arg === '--timeout-ms') {
      result.timeoutMs = positiveInteger(argv[++index] ?? '', '--timeout-ms');
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }
  if (!result.manifest) throw new Error(`--manifest is required.\n\n${usage()}`);
  return result;
}

function loadWorkersFromEnvironment() {
  const workers = new Map<string, ComfyWorkerClient>();
  for (let number = 1; number <= 4; number += 1) {
    const slot = `gpu-${number}`;
    const prefix = `COMFY_GPU_${number}`;
    const baseUrl = process.env[`${prefix}_URL`]?.trim();
    if (!baseUrl) throw new Error(`${prefix}_URL is required.`);
    workers.set(slot, new ComfyWorkerClient({
      id: slot,
      baseUrl,
      authCookie: process.env[`${prefix}_AUTH_COOKIE`],
    }));
  }
  return workers;
}

function settledForJson(result: PromiseSettledResult<{ uiKey: string; promptId: string | null }>) {
  if (result.status === 'fulfilled') return result;
  return {
    status: result.status,
    reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(projectRoot, cli.manifest);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as PetActionBatchManifest;
  const manifestSha256 = hashBatchManifest(manifestBytes);
  const defaultRunName = basename(manifestPath, '.json').replace(/[^a-z0-9._-]+/gi, '_');
  const runDirectory = cli.runDirectory
    ? resolve(projectRoot, cli.runDirectory)
    : join(projectRoot, 'workflows', 'runs', defaultRunName);
  // This is intentionally before worker preflight and prompt submission. A
  // machine that cannot compile and QA the raw videos must not spend GPU
  // generation credits first.
  const mediaToolchain = await resolveMediaToolchain(projectRoot);
  const workers = loadWorkersFromEnvironment();
  const finalizationTails: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
  const finalizeSucceededBranch = async (runBranch: BatchRunSummary['branches'][number]) => {
    const branchIndex = manifest.branches.findIndex((branch) => branch.uiKey === runBranch.uiKey);
    const branch = manifest.branches[branchIndex];
    if (!branch) throw new Error(`Manifest has no branch ${runBranch.uiKey}.`);
    const lane = branchIndex % finalizationTails.length;
    const task = finalizationTails[lane].then(async () => {
      const finalized = await finalizePetActionBranch({
        projectRoot,
        runDirectory,
        batchId: `${manifest.petId}-${manifestSha256.slice(0, 12)}`,
        manifest,
        branch,
        runBranch,
        toolchain: mediaToolchain,
      });
      console.log(JSON.stringify({
        event: 'pet_action_branch_finalized',
        uiKey: branch.uiKey,
        state: finalized.state,
        videoUrl: finalized.final?.publicUrl,
      }));
    });
    finalizationTails[lane] = task.catch(() => undefined);
    try {
      await task;
    } catch (error) {
      // A CPU/tooling fault is retried by the final batch pass. Generation has
      // already succeeded, so it must never cause a second paid prompt.
      console.error(`Progressive finalization failed for ${branch.uiKey}:`, error);
    }
  };
  let result: BatchRunSummary | null = null;
  let artifact: Awaited<ReturnType<typeof finalizePetActionBatch>> | null = null;
  let automaticQaRetries = 0;

  for (;;) {
    result = await runPetActionBatch({
      projectRoot,
      manifest,
      manifestSha256,
      runDirectory,
      workers,
      retryFailed: cli.retryFailed,
      allowBusyWorkers: cli.allowBusyWorkers,
      pollIntervalMs: cli.pollIntervalMs,
      timeoutMs: cli.timeoutMs,
      onBranchSucceeded: finalizeSucceededBranch,
    });

    const generationSucceeded = result.settled.every((item) => item.status === 'fulfilled')
      && result.branches.every((branch) => branch.state === 'succeeded');
    if (!generationSucceeded) break;

    artifact = await finalizePetActionBatch({
      projectRoot,
      runDirectory,
      batchId: result.batchId,
      manifest,
      runBranches: result.branches,
      toolchain: mediaToolchain,
    });
    if (artifact.manifest.status === 'published') break;

    const failures = artifact.manifest.branches
      .filter((branch) => branch.state === 'qa_failed')
      .map((branch) => ({
        uiKey: branch.uiKey,
        reason: branch.error ?? 'Unknown QA failure',
      }));
    const retryDecision = decideAutomaticQaRetry(
      failures,
      result.branches,
      manifest.generationRetryPolicy.maxAttemptsPerBranch,
    );
    // Only one isolated stochastic source-seam failure may spend one alternate
    // seed. Two or more simultaneous mismatches trip the batch fuse because a
    // shared contract/input fault is more likely than independent bad luck.
    if (!retryDecision.retry) break;

    await markQaFailedBranchesForRetry({
      runDirectory,
      failures: [retryDecision.retry],
    });
    automaticQaRetries += 1;
  }

  if (!result) throw new Error('Batch runner produced no run summary.');

  const output = {
    batchId: result.batchId,
    mediaToolchain: {
      source: mediaToolchain.source,
      version: mediaToolchain.ffmpegVersion,
    },
    runRecordFile: relativeOutputPath(projectRoot, result.runRecordFile),
    artifactManifestFile: artifact
      ? relativeOutputPath(projectRoot, artifact.manifestFile)
      : null,
    publishStatus: artifact?.manifest.status ?? 'not_finalized',
    automaticQaRetries,
    settled: result.settled.map(settledForJson),
    branches: result.branches.map((branch) => ({
      uiKey: branch.uiKey,
      workerSlot: branch.workerSlot,
      state: branch.state,
      promptId: branch.promptId,
      attempt: branch.attempt,
      error: branch.error,
      outputs: branch.outputs.map((item) => ({
        file: relativeOutputPath(projectRoot, item.localFile),
        sha256: item.sha256,
        bytes: item.bytes,
      })),
    })),
  };
  console.log(JSON.stringify(output, null, 2));
  if (result.settled.some((item) => item.status === 'rejected')
    || result.branches.some((branch) => branch.state !== 'succeeded')
    || artifact?.manifest.status === 'rejected') {
    process.exitCode = 1;
  }
}

await main();
