import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import type { ComfyApiWorkflow } from './types.ts';
import {
  collectSaveVideoOutputs,
  ComfyWorkerClient,
  getHistoryExecutionError,
  PromptSubmissionError,
  queueContainsPrompt,
  queuedPromptIds,
  type ComfyMediaOutput,
} from './worker-client.ts';

export type PetActionBatchBranch = {
  action: string;
  uiKey: string;
  workerSlot: string;
  compileStatus: string;
  dispatchAllowed: boolean;
  workflowFile: string;
  workflowSha256?: string | null;
  driverFile: string;
  driverSha256?: string | null;
  retrySeeds: [number, number];
  expectedOutput: {
    nodeId: '202';
    slot: 'videos';
    index: 0;
  };
};

export type PetActionBatchManifest = {
  schemaVersion: number;
  petId: string;
  masterFile: string;
  masterSha256: string;
  generationRetryPolicy: {
    maxAttemptsPerBranch: 2;
  };
  postprocessPolicyVersion: 'pet-video-v2';
  outputContract: {
    width: 576;
    height: 768;
    fps: 30;
    frames: 152;
    codec: 'h264';
    codecProfile: 'Main';
    codecLevel: 31;
    maxBFrames: 0;
    keyframeInterval: 30;
    maxBitrateBitsPerSecond: 8000000;
    vbvBufferBits: 8000000;
    pixfmt: 'yuv420p';
    audio: false;
  };
  seamPolicy: {
    canonical: 'master';
    anchorHoldFrames: 2;
    bridgeFrames: 10;
    handoffOutFrame: 150;
  };
  qaPolicyVersion: 'pet-video-qa-v2';
  branches: PetActionBatchBranch[];
};

export type BatchOutputRecord = ComfyMediaOutput & {
  localFile: string;
  sha256: string;
  bytes: number;
};

export type BatchBranchState =
  | 'pending'
  | 'uploading'
  | 'submitting'
  | 'submission_unknown'
  | 'submitted'
  | 'downloading'
  | 'succeeded'
  | 'failed';

export type BatchRunBranch = {
  action: string;
  uiKey: string;
  workerSlot: string;
  state: BatchBranchState;
  attempt: number;
  seed: number | null;
  clientId: string | null;
  promptId: string | null;
  previousPromptIds: string[];
  startedAt: string | null;
  submittedAt: string | null;
  finishedAt: string | null;
  lastPollAt: string | null;
  error: string | null;
  outputs: BatchOutputRecord[];
  outputHistory: Array<{
    attempt: number;
    promptId: string | null;
    archivedAt: string;
    reason: string;
    outputs: BatchOutputRecord[];
  }>;
  qaFailures: Array<{
    attempt: number;
    markedAt: string;
    reason: string;
    outputSha256s: string[];
  }>;
};

export type BatchRunRecord = {
  schemaVersion: 1;
  batchId: string;
  manifestSha256: string;
  petId: string;
  createdAt: string;
  updatedAt: string;
  workerBindings: Array<{
    workerSlot: string;
    workerId: string;
    endpointSha256: string;
  }>;
  branches: BatchRunBranch[];
};

export type BatchRunOptions = {
  projectRoot: string;
  manifest: PetActionBatchManifest;
  manifestSha256: string;
  runDirectory: string;
  workers: Map<string, ComfyWorkerClient>;
  retryFailed?: boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  allowBusyWorkers?: boolean;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  onBranchSucceeded?: (branch: BatchRunBranch) => Promise<void> | void;
};

export type BatchRunSummary = {
  batchId: string;
  runRecordFile: string;
  settled: PromiseSettledResult<{ uiKey: string; promptId: string | null }>[];
  branches: BatchRunBranch[];
};

export type QaFailedBranch = {
  uiKey: string;
  reason: string;
};

export type AutomaticQaRetryDecision = {
  retry: QaFailedBranch | null;
  reason: 'single_source_seam_mismatch' | 'none' | 'batch_fuse' | 'ineligible';
};

export type MarkQaFailedBranchesOptions = {
  runDirectory: string;
  failures: QaFailedBranch[];
  now?: () => Date;
};

export class BatchContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchContractError';
  }
}

export class PromptPollingTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptPollingTimeoutError';
  }
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const toIso = (now: () => Date) => now().toISOString();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertSafeId(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(value)) {
    throw new BatchContractError(`${label} must be a safe identifier.`);
  }
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function resolveInside(root: string, path: string) {
  if (isAbsolute(path)) throw new BatchContractError(`Absolute input path is forbidden: ${path}`);
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, path);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) {
    throw new BatchContractError(`Input path escapes the project root: ${path}`);
  }
  return candidate;
}

function resolveMasterFile(projectRoot: string, masterFile: string) {
  if (masterFile.includes('/') || masterFile.includes('\\')) {
    return resolveInside(projectRoot, masterFile);
  }
  return resolveInside(projectRoot, join('public', 'assets', 'generated', masterFile));
}

async function verifyFileHash(path: string, expected: string | null | undefined, label: string) {
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (expected && actual !== expected) {
    throw new BatchContractError(`${label} SHA-256 mismatch: expected ${expected}, got ${actual}.`);
  }
  return { bytes, sha256: actual };
}

function uploadedInputPath(result: { name: string; subfolder: string }) {
  const folder = result.subfolder.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  return folder ? posix.join(folder, result.name) : result.name;
}

function bindUploadedInputs(
  workflow: ComfyApiWorkflow,
  uploadedMaster: { name: string; subfolder: string },
  uploadedDriver: { name: string; subfolder: string },
  retrySeed: number,
) {
  const bound = structuredClone(workflow);
  const image = bound['30'];
  const driver = bound['155'];
  const sampler = bound['213:19'];
  if (!image || image.class_type !== 'LoadImage' || !driver || driver.class_type !== 'LoadVideo') {
    throw new BatchContractError('Compiled action workflow input nodes 30/155 no longer match LoadImage/LoadVideo.');
  }
  if (!sampler || sampler.class_type !== 'SamplerCustom' || !('noise_seed' in sampler.inputs)) {
    throw new BatchContractError('Compiled action workflow node 213:19 no longer matches SamplerCustom/noise_seed.');
  }
  image.inputs.image = uploadedInputPath(uploadedMaster);
  driver.inputs.file = uploadedInputPath(uploadedDriver);
  sampler.inputs.noise_seed = retrySeed;
  return bound;
}

function sanitizeOutputPart(value: string) {
  const cleaned = value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^\.+/, '');
  return cleaned || 'output';
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withRunLock<T>(runDirectory: string, operation: () => Promise<T>) {
  await mkdir(runDirectory, { recursive: true });
  const lockPath = join(runDirectory, '.pet-batch-run.lock');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new BatchContractError(
        `Another batch runner owns ${lockPath}. Confirm it has stopped before removing a stale lock.`,
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    return await operation();
  } finally {
    await handle.close();
    try {
      await unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

class BatchRunStore {
  readonly file: string;
  #record: BatchRunRecord;
  #writeTail: Promise<void> = Promise.resolve();

  private constructor(file: string, record: BatchRunRecord) {
    this.file = file;
    this.#record = record;
  }

  static async open(
    file: string,
    initial: BatchRunRecord,
  ) {
    let record = initial;
    if (await fileExists(file)) {
      record = JSON.parse(await readFile(file, 'utf8')) as BatchRunRecord;
      if (record.schemaVersion !== 1 || record.manifestSha256 !== initial.manifestSha256) {
        throw new BatchContractError('Existing run record belongs to a different manifest. Use another run directory.');
      }
      const expectedBindings = JSON.stringify(initial.workerBindings);
      if (JSON.stringify(record.workerBindings) !== expectedBindings) {
        throw new BatchContractError('Existing run record belongs to different worker endpoints.');
      }
    }
    const store = new BatchRunStore(file, record);
    if (!(await fileExists(file))) await store.#persist();
    return store;
  }

  snapshot() {
    return structuredClone(this.#record);
  }

  branch(uiKey: string) {
    const branch = this.#record.branches.find((item) => item.uiKey === uiKey);
    if (!branch) throw new BatchContractError(`Run record has no branch ${uiKey}.`);
    return structuredClone(branch);
  }

  async updateBranch(uiKey: string, update: (branch: BatchRunBranch) => void, now: () => Date) {
    this.#writeTail = this.#writeTail.then(async () => {
      const branch = this.#record.branches.find((item) => item.uiKey === uiKey);
      if (!branch) throw new BatchContractError(`Run record has no branch ${uiKey}.`);
      update(branch);
      this.#record.updatedAt = toIso(now);
      await this.#persist();
    });
    await this.#writeTail;
    return this.branch(uiKey);
  }

  async #persist() {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.#record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

export async function markQaFailedBranchesForRetry(
  options: MarkQaFailedBranchesOptions,
): Promise<BatchRunRecord> {
  if (!Array.isArray(options.failures) || options.failures.length === 0) {
    throw new BatchContractError('At least one QA-failed branch is required.');
  }
  const uiKeys = new Set<string>();
  for (const failure of options.failures) {
    assertSafeId(failure.uiKey, 'QA-failed branch uiKey');
    if (uiKeys.has(failure.uiKey)) {
      throw new BatchContractError(`QA-failed branch ${failure.uiKey} was specified more than once.`);
    }
    if (typeof failure.reason !== 'string' || !failure.reason.trim() || failure.reason.length > 1000) {
      throw new BatchContractError(`QA-failed branch ${failure.uiKey} requires a concise reason.`);
    }
    uiKeys.add(failure.uiKey);
  }

  const now = options.now ?? (() => new Date());
  return withRunLock(options.runDirectory, async () => {
    const runRecordFile = join(options.runDirectory, 'run-record.json');
    if (!(await fileExists(runRecordFile))) {
      throw new BatchContractError(`Run record does not exist: ${runRecordFile}`);
    }
    const record = JSON.parse(await readFile(runRecordFile, 'utf8')) as BatchRunRecord;
    if (record.schemaVersion !== 1 || !Array.isArray(record.branches)) {
      throw new BatchContractError('Run record is not a schemaVersion=1 pet action batch.');
    }

    const selected = options.failures.map((failure) => {
      const branch = record.branches.find((candidate) => candidate.uiKey === failure.uiKey);
      if (!branch) throw new BatchContractError(`Run record has no branch ${failure.uiKey}.`);
      if (branch.state !== 'succeeded') {
        throw new BatchContractError(`Branch ${failure.uiKey} must be succeeded before QA can reject it.`);
      }
      if (!Array.isArray(branch.outputs) || branch.outputs.length === 0) {
        throw new BatchContractError(`Branch ${failure.uiKey} has no generated outputs for QA rejection.`);
      }
      return { branch, failure };
    });

    const markedAt = toIso(now);
    for (const { branch, failure } of selected) {
      branch.previousPromptIds ??= [];
      branch.outputHistory ??= [];
      branch.qaFailures ??= [];
      if (branch.promptId && !branch.previousPromptIds.includes(branch.promptId)) {
        branch.previousPromptIds.push(branch.promptId);
      }
      const archivedOutputs = structuredClone(branch.outputs);
      branch.outputHistory.push({
        attempt: branch.attempt,
        promptId: branch.promptId,
        archivedAt: markedAt,
        reason: `QA failed: ${failure.reason.trim()}`,
        outputs: archivedOutputs,
      });
      branch.qaFailures.push({
        attempt: branch.attempt,
        markedAt,
        reason: failure.reason.trim(),
        outputSha256s: archivedOutputs.map((output) => output.sha256),
      });
      branch.state = 'failed';
      branch.error = `QA failed: ${failure.reason.trim()}`;
      branch.finishedAt = markedAt;
      branch.outputs = [];
    }
    record.updatedAt = markedAt;
    const temporary = `${runRecordFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, runRecordFile);
    return structuredClone(record);
  });
}

function isSourceSeamMismatch(reason: string) {
  return reason.includes('SOURCE_SEAM_MISMATCH');
}

/**
 * Automatic generation retry is deliberately a single-branch exception. If
 * two or more outputs miss the source seam together, the likely fault is the
 * shared master/driver/policy rather than random seed variance, so the batch
 * fuse prevents another paid four-GPU wave.
 */
export function decideAutomaticQaRetry(
  failures: QaFailedBranch[],
  branches: BatchRunBranch[],
  maxAttemptsPerBranch = 2,
): AutomaticQaRetryDecision {
  if (failures.length === 0) return { retry: null, reason: 'none' };
  const sourceFailures = failures.filter((failure) => isSourceSeamMismatch(failure.reason));
  if (sourceFailures.length >= 2) return { retry: null, reason: 'batch_fuse' };
  if (failures.length !== 1 || sourceFailures.length !== 1) {
    return { retry: null, reason: 'ineligible' };
  }
  const failure = sourceFailures[0];
  const branch = branches.find((candidate) => candidate.uiKey === failure.uiKey);
  if (!branch || branch.state !== 'succeeded' || branch.attempt >= maxAttemptsPerBranch) {
    return { retry: null, reason: 'ineligible' };
  }
  return { retry: failure, reason: 'single_source_seam_mismatch' };
}

/** Reads only persisted state; callers do not need an in-memory retry flag. */
export function persistedAutomaticQaRetryUiKey(
  branches: BatchRunBranch[],
  maxAttemptsPerBranch = 2,
) {
  const candidates = branches.filter((branch) => {
    const latest = branch.qaFailures?.at(-1);
    return branch.state === 'failed'
      && branch.outputs.length === 0
      && branch.attempt < maxAttemptsPerBranch
      && Boolean(latest)
      && latest?.attempt === branch.attempt
      && isSourceSeamMismatch(latest.reason);
  });
  if (candidates.length !== 1) return null;
  const [candidate] = candidates;
  if (branches.some((branch) => branch.uiKey !== candidate.uiKey && branch.state !== 'succeeded')) return null;
  return candidate.uiKey;
}

/** A promise chain per worker is the concurrency=1 semaphore. */
export class ComfyWorkerPool {
  readonly #workers: Map<string, ComfyWorkerClient>;
  readonly #tails = new Map<string, Promise<void>>();

  constructor(workers: Map<string, ComfyWorkerClient>) {
    this.#workers = workers;
  }

  worker(slot: string) {
    const worker = this.#workers.get(slot);
    if (!worker) throw new BatchContractError(`No ComfyUI worker is configured for ${slot}.`);
    return worker;
  }

  run<T>(slot: string, operation: (worker: ComfyWorkerClient) => Promise<T>) {
    const prior = this.#tails.get(slot) ?? Promise.resolve();
    const result = prior.catch(() => undefined).then(() => operation(this.worker(slot)));
    this.#tails.set(slot, result.then(() => undefined, () => undefined));
    return result;
  }
}

function validateManifest(manifest: PetActionBatchManifest, workers: Map<string, ComfyWorkerClient>) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.branches) || manifest.branches.length !== 4) {
    throw new BatchContractError('A four-branch schemaVersion=1 batch manifest is required.');
  }
  if (!manifest.generationRetryPolicy || manifest.generationRetryPolicy.maxAttemptsPerBranch !== 2) {
    throw new BatchContractError('Batch manifest requires generationRetryPolicy.maxAttemptsPerBranch=2.');
  }
  if (!isSha256(manifest.masterSha256)) {
    throw new BatchContractError('Batch manifest masterSha256 must be a required 64-character lowercase SHA-256.');
  }
  if (manifest.postprocessPolicyVersion !== 'pet-video-v2') {
    throw new BatchContractError('Batch manifest requires postprocessPolicyVersion=pet-video-v2.');
  }
  const output = manifest.outputContract;
  if (!output
    || output.width !== 576
    || output.height !== 768
    || output.fps !== 30
    || output.frames !== 152
    || output.codec !== 'h264'
    || output.codecProfile !== 'Main'
    || output.codecLevel !== 31
    || output.maxBFrames !== 0
    || output.keyframeInterval !== 30
    || output.maxBitrateBitsPerSecond !== 8000000
    || output.vbvBufferBits !== 8000000
    || output.pixfmt !== 'yuv420p'
    || output.audio !== false) {
    throw new BatchContractError(
      'Batch manifest outputContract must be 576x768, 30fps, 152 frames, H.264 Main@3.1/yuv420p, '
        + 'zero B-frames, GOP<=30, 8Mbps VBV, without audio.',
    );
  }
  const seam = manifest.seamPolicy;
  if (!seam
    || seam.canonical !== 'master'
    || seam.anchorHoldFrames !== 2
    || seam.bridgeFrames !== 10
    || seam.handoffOutFrame !== 150) {
    throw new BatchContractError(
      'Batch manifest seamPolicy must use the canonical master with 2 anchor, 10 bridge, and handoff frame 150.',
    );
  }
  if (manifest.qaPolicyVersion !== 'pet-video-qa-v2') {
    throw new BatchContractError('Batch manifest requires qaPolicyVersion=pet-video-qa-v2.');
  }
  assertSafeId(manifest.petId, 'petId');
  const slots = manifest.branches.map((branch) => branch.workerSlot);
  if (new Set(slots).size !== 4 || new Set(manifest.branches.map((branch) => branch.uiKey)).size !== 4) {
    throw new BatchContractError('The four branches must have unique uiKey and workerSlot values.');
  }
  for (const branch of manifest.branches) {
    assertSafeId(branch.uiKey, 'branch uiKey');
    if (!Array.isArray(branch.retrySeeds)
      || branch.retrySeeds.length !== manifest.generationRetryPolicy.maxAttemptsPerBranch
      || branch.retrySeeds.some((seed) => !Number.isSafeInteger(seed) || seed < 0)
      || new Set(branch.retrySeeds).size !== branch.retrySeeds.length) {
      throw new BatchContractError(
        `Branch ${branch.uiKey} retrySeeds must contain two different non-negative safe integers.`,
      );
    }
    if (!branch.expectedOutput
      || branch.expectedOutput.nodeId !== '202'
      || branch.expectedOutput.slot !== 'videos'
      || branch.expectedOutput.index !== 0) {
      throw new BatchContractError(
        `Branch ${branch.uiKey} expectedOutput must be node 202, videos slot, index 0.`,
      );
    }
    if (!branch.dispatchAllowed || branch.compileStatus !== 'compiled') {
      throw new BatchContractError(`Branch ${branch.uiKey} is not compiled and dispatchable.`);
    }
    if (!workers.has(branch.workerSlot)) {
      throw new BatchContractError(`No worker endpoint is configured for ${branch.workerSlot}.`);
    }
  }
  const endpointIdentities = [...workers.values()].map((worker) => worker.endpointIdentity);
  if (endpointIdentities.length !== 4 || new Set(endpointIdentities).size !== 4) {
    throw new BatchContractError('Exactly four different ComfyUI worker endpoints are required.');
  }
}

function initialRunRecord(
  manifest: PetActionBatchManifest,
  manifestSha256: string,
  workers: Map<string, ComfyWorkerClient>,
  now: () => Date,
) {
  const timestamp = toIso(now);
  const batchId = `${manifest.petId}-${manifestSha256.slice(0, 12)}`;
  return {
    schemaVersion: 1 as const,
    batchId,
    manifestSha256,
    petId: manifest.petId,
    createdAt: timestamp,
    updatedAt: timestamp,
    workerBindings: manifest.branches.map((branch) => {
      const worker = workers.get(branch.workerSlot);
      if (!worker) throw new BatchContractError(`Missing worker ${branch.workerSlot}.`);
      return {
        workerSlot: branch.workerSlot,
        workerId: worker.id,
        endpointSha256: sha256(worker.endpointIdentity),
      };
    }),
    branches: manifest.branches.map((branch) => ({
      action: branch.action,
      uiKey: branch.uiKey,
      workerSlot: branch.workerSlot,
      state: 'pending' as const,
      attempt: 0,
      seed: null,
      clientId: null,
      promptId: null,
      previousPromptIds: [],
      startedAt: null,
      submittedAt: null,
      finishedAt: null,
      lastPollAt: null,
      error: null,
      outputs: [],
      outputHistory: [],
      qaFailures: [],
    })),
  };
}

async function saveDownloadedOutput(
  worker: ComfyWorkerClient,
  output: ComfyMediaOutput,
  uiKey: string,
  outputDirectory: string,
) {
  const bytes = await worker.downloadOutput(output);
  const digest = sha256(bytes);
  const remoteName = sanitizeOutputPart(basename(output.filename));
  const filename = [
    sanitizeOutputPart(uiKey),
    sanitizeOutputPart(output.nodeId),
    sanitizeOutputPart(output.slot),
    output.index,
    digest.slice(0, 12),
    remoteName,
  ].join('--');
  const destination = join(outputDirectory, filename);
  await mkdir(outputDirectory, { recursive: true });
  if (await fileExists(destination)) {
    const existing = await readFile(destination);
    if (sha256(existing) !== digest) {
      throw new Error(`Refusing to overwrite mismatched output ${destination}.`);
    }
  } else {
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  return {
    ...output,
    localFile: destination,
    sha256: digest,
    bytes: bytes.byteLength,
  };
}

async function waitForCompletedPrompt(
  worker: ComfyWorkerClient,
  promptId: string,
  workflow: ComfyApiWorkflow,
  options: {
    pollIntervalMs: number;
    timeoutMs: number;
    now: () => Date;
    sleep: (milliseconds: number) => Promise<void>;
    onPoll: () => Promise<void>;
  },
) {
  const started = options.now().getTime();
  while (options.now().getTime() - started <= options.timeoutMs) {
    const entry = await worker.getHistory(promptId);
    if (entry) {
      const executionError = getHistoryExecutionError(entry);
      if (executionError) throw new Error(executionError);
      if (entry.status?.completed) {
        const outputs = collectSaveVideoOutputs(entry, workflow);
        if (outputs.length === 0) {
          throw new Error(`Prompt ${promptId} completed without a SaveVideo output.`);
        }
        return outputs;
      }
    }
    const queue = await worker.getQueue();
    // Absence is not grounds for resubmission: history can lag behind the queue.
    void queueContainsPrompt(queue, promptId);
    await options.onPoll();
    await options.sleep(options.pollIntervalMs);
  }
  throw new PromptPollingTimeoutError(
    `Prompt ${promptId} is still unresolved after ${options.timeoutMs}ms; keep its prompt id and resume later.`,
  );
}

async function executeBranch(
  branch: PetActionBatchBranch,
  worker: ComfyWorkerClient,
  store: BatchRunStore,
  options: Required<Pick<BatchRunOptions, 'projectRoot' | 'pollIntervalMs' | 'timeoutMs' | 'now' | 'sleep'>> & {
    retryFailed: boolean;
    runDirectory: string;
    batchId: string;
    masterPath: string;
    masterBytes: Uint8Array;
    onBranchSucceeded?: BatchRunOptions['onBranchSucceeded'];
  },
) {
  let runBranch = store.branch(branch.uiKey);
  if (runBranch.state === 'succeeded') {
    return { uiKey: branch.uiKey, promptId: runBranch.promptId };
  }
  if (runBranch.state === 'submitting' || runBranch.state === 'submission_unknown') {
    throw new Error(
      `Branch ${branch.uiKey} has an ambiguous prompt submission. Reconcile it manually; automatic retry is forbidden.`,
    );
  }
  if (runBranch.state === 'failed' && !options.retryFailed) {
    throw new Error(`Branch ${branch.uiKey} failed earlier; pass --retry-failed to run only failed branches.`);
  }
  if (['pending', 'uploading', 'failed'].includes(runBranch.state)
    && runBranch.attempt >= branch.retrySeeds.length) {
    throw new BatchContractError(
      `Branch ${branch.uiKey} exhausted its ${branch.retrySeeds.length} generation attempts.`,
    );
  }

  const workflowPath = resolveInside(options.projectRoot, branch.workflowFile);
  const driverPath = resolveInside(options.projectRoot, branch.driverFile);
  const [workflowFile, driver] = await Promise.all([
    verifyFileHash(workflowPath, branch.workflowSha256, `${branch.uiKey} workflow`),
    verifyFileHash(driverPath, branch.driverSha256, `${branch.uiKey} driver`),
  ]);
  const workflow = JSON.parse(Buffer.from(workflowFile.bytes).toString('utf8')) as ComfyApiWorkflow;
  const expectedOutputNode = workflow[branch.expectedOutput.nodeId];
  if (!expectedOutputNode || expectedOutputNode.class_type !== 'SaveVideo') {
    throw new BatchContractError(
      `Branch ${branch.uiKey} expected output node ${branch.expectedOutput.nodeId} is not SaveVideo.`,
    );
  }
  const sampler = workflow['213:19'];
  if (!sampler
    || sampler.class_type !== 'SamplerCustom'
    || sampler.inputs.noise_seed !== branch.retrySeeds[0]) {
    throw new BatchContractError(
      `Branch ${branch.uiKey} SamplerCustom 213:19 must contain its first retry seed as noise_seed.`,
    );
  }

  if (runBranch.state === 'pending' || runBranch.state === 'uploading' || runBranch.state === 'failed') {
    runBranch = await store.updateBranch(branch.uiKey, (item) => {
      item.previousPromptIds ??= [];
      item.outputHistory ??= [];
      item.qaFailures ??= [];
      if (item.promptId && !item.previousPromptIds.includes(item.promptId)) {
        item.previousPromptIds.push(item.promptId);
      }
      if (item.outputs.length > 0) {
        item.outputHistory.push({
          attempt: item.attempt,
          promptId: item.promptId,
          archivedAt: toIso(options.now),
          reason: item.error ?? 'Branch retried.',
          outputs: structuredClone(item.outputs),
        });
      }
      item.state = 'uploading';
      item.clientId = null;
      item.promptId = null;
      item.startedAt = toIso(options.now);
      item.submittedAt = null;
      item.finishedAt = null;
      item.lastPollAt = null;
      item.error = null;
      item.outputs = [];
    }, options.now);

    const uploadSubfolder = posix.join('pet_batch', options.batchId, branch.workerSlot);
    let uploadedMaster;
    let uploadedDriver;
    try {
      [uploadedMaster, uploadedDriver] = await Promise.all([
        worker.uploadInput(options.masterBytes, basename(options.masterPath), uploadSubfolder, true),
        worker.uploadInput(driver.bytes, basename(driverPath), uploadSubfolder, true),
      ]);
    } catch (error) {
      await store.updateBranch(branch.uiKey, (item) => {
        item.state = 'failed';
        item.error = `Upload failed before prompt submission: ${errorMessage(error)}`;
        item.finishedAt = toIso(options.now);
      }, options.now);
      throw error;
    }

    // Uploads are free preparation. A generation attempt is consumed only
    // immediately before POST /prompt enters the ambiguous submission window.
    const nextAttempt = runBranch.attempt + 1;
    const retrySeed = branch.retrySeeds[nextAttempt - 1];
    if (retrySeed === undefined) {
      throw new BatchContractError(`Branch ${branch.uiKey} has no seed for attempt ${nextAttempt}.`);
    }
    const boundWorkflow = bindUploadedInputs(workflow, uploadedMaster, uploadedDriver, retrySeed);
    const clientId = `${options.batchId}:${branch.uiKey}:${nextAttempt}:${randomUUID()}`;
    runBranch = await store.updateBranch(branch.uiKey, (item) => {
      item.state = 'submitting';
      item.attempt = nextAttempt;
      item.seed = retrySeed;
      item.clientId = clientId;
    }, options.now);

    try {
      const submitted = await worker.submitPrompt(boundWorkflow, clientId);
      runBranch = await store.updateBranch(branch.uiKey, (item) => {
        item.state = 'submitted';
        item.promptId = submitted.promptId;
        item.submittedAt = toIso(options.now);
        item.error = null;
      }, options.now);
    } catch (error) {
      const retrySafe = error instanceof PromptSubmissionError && error.retrySafe;
      await store.updateBranch(branch.uiKey, (item) => {
        item.state = retrySafe ? 'failed' : 'submission_unknown';
        item.error = errorMessage(error);
        item.finishedAt = retrySafe ? toIso(options.now) : null;
        if (retrySafe) {
          // ComfyUI explicitly rejected the prompt before queueing it. Restore
          // the prior paid-attempt count so this seed remains available.
          item.attempt = Math.max(0, item.attempt - 1);
          item.seed = item.attempt > 0 ? branch.retrySeeds[item.attempt - 1] : null;
          item.clientId = null;
        }
      }, options.now);
      throw error;
    }
  }

  runBranch = store.branch(branch.uiKey);
  if (!runBranch.promptId) {
    throw new Error(`Branch ${branch.uiKey} cannot resume without a prompt id.`);
  }

  let remoteOutputs: ComfyMediaOutput[];
  try {
    remoteOutputs = await waitForCompletedPrompt(worker, runBranch.promptId, workflow, {
      pollIntervalMs: options.pollIntervalMs,
      timeoutMs: options.timeoutMs,
      now: options.now,
      sleep: options.sleep,
      onPoll: async () => {
        await store.updateBranch(branch.uiKey, (item) => {
          item.lastPollAt = toIso(options.now);
        }, options.now);
      },
    });
    if (!remoteOutputs.some((output) => output.nodeId === branch.expectedOutput.nodeId
      && output.slot === branch.expectedOutput.slot
      && output.index === branch.expectedOutput.index)) {
      throw new Error(
        `Prompt ${runBranch.promptId} completed without expected output ${branch.expectedOutput.nodeId}/${branch.expectedOutput.slot}/${branch.expectedOutput.index}.`,
      );
    }
  } catch (error) {
    if (error instanceof PromptPollingTimeoutError) {
      await store.updateBranch(branch.uiKey, (item) => {
        item.state = 'submitted';
        item.error = error.message;
        item.lastPollAt = toIso(options.now);
      }, options.now);
    } else {
      await store.updateBranch(branch.uiKey, (item) => {
        item.state = 'failed';
        item.error = `Execution failed: ${errorMessage(error)}`;
        item.finishedAt = toIso(options.now);
      }, options.now);
    }
    throw error;
  }

  await store.updateBranch(branch.uiKey, (item) => {
    item.state = 'downloading';
    item.error = null;
  }, options.now);
  const outputDirectory = join(options.runDirectory, 'outputs');
  const outputs: BatchOutputRecord[] = [];
  try {
    for (const output of remoteOutputs) {
      outputs.push(await saveDownloadedOutput(worker, output, branch.uiKey, outputDirectory));
    }
  } catch (error) {
    await store.updateBranch(branch.uiKey, (item) => {
      // Keep the prompt id and downloading state: a later invocation can fetch
      // the completed remote output without paying for another generation.
      item.state = 'downloading';
      item.error = `Download failed: ${errorMessage(error)}`;
    }, options.now);
    throw error;
  }
  const succeededBranch = await store.updateBranch(branch.uiKey, (item) => {
    item.state = 'succeeded';
    item.outputs = outputs;
    item.error = null;
    item.finishedAt = toIso(options.now);
  }, options.now);
  await options.onBranchSucceeded?.(succeededBranch);
  return { uiKey: branch.uiKey, promptId: runBranch.promptId };
}

export async function runPetActionBatch(options: BatchRunOptions): Promise<BatchRunSummary> {
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  }));
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  if (pollIntervalMs < 0 || timeoutMs < 1) throw new BatchContractError('Polling intervals must be positive.');
  validateManifest(options.manifest, options.workers);
  return withRunLock(options.runDirectory, async () => {
    const masterPath = resolveMasterFile(options.projectRoot, options.manifest.masterFile);
    const master = await verifyFileHash(masterPath, options.manifest.masterSha256, 'master image');
    const initial = initialRunRecord(options.manifest, options.manifestSha256, options.workers, now);
    const runRecordFile = join(options.runDirectory, 'run-record.json');
    const store = await BatchRunStore.open(runRecordFile, initial);

    const preflight = await Promise.all([...options.workers.entries()].map(async ([slot, worker]) => ({
      slot,
      ...await worker.preflight(),
    })));
    if (!options.allowBusyWorkers) {
      const snapshot = store.snapshot();
      const busy = preflight.filter((worker) => {
        const resumablePromptIds = new Set(snapshot.branches
          .filter((branch) => branch.workerSlot === worker.slot
            && ['submitted', 'downloading'].includes(branch.state)
            && branch.promptId)
          .map((branch) => branch.promptId as string));
        const queuedIds = queuedPromptIds(worker.queue);
        const unknownQueueItems = worker.running + worker.pending - queuedIds.length;
        return unknownQueueItems > 0 || queuedIds.some((promptId) => !resumablePromptIds.has(promptId));
      });
      if (busy.length > 0) {
        throw new BatchContractError(`Workers are not empty: ${busy.map((item) => item.workerId).join(', ')}.`);
      }
    }

    const automaticQaRetryUiKey = persistedAutomaticQaRetryUiKey(
      store.snapshot().branches,
      options.manifest.generationRetryPolicy.maxAttemptsPerBranch,
    );
    const targetBranches = options.manifest.branches.filter((branch) => {
      const state = store.branch(branch.uiKey).state;
      if (state === 'succeeded') return false;
      if (state === 'failed') return Boolean(options.retryFailed) || branch.uiKey === automaticQaRetryUiKey;
      return true;
    });
    const pool = new ComfyWorkerPool(options.workers);
    const settled = await Promise.allSettled(targetBranches.map((branch) => pool.run(
      branch.workerSlot,
      (worker) => executeBranch(branch, worker, store, {
        projectRoot: options.projectRoot,
        runDirectory: options.runDirectory,
        retryFailed: Boolean(options.retryFailed) || branch.uiKey === automaticQaRetryUiKey,
        pollIntervalMs,
        timeoutMs,
        now,
        sleep,
        batchId: initial.batchId,
        masterPath,
        masterBytes: master.bytes,
        onBranchSucceeded: options.onBranchSucceeded,
      }),
    )));

    return {
      batchId: initial.batchId,
      runRecordFile,
      settled,
      branches: store.snapshot().branches,
    };
  });
}

export function hashBatchManifest(bytes: Uint8Array) {
  return sha256(bytes);
}

export function relativeOutputPath(projectRoot: string, path: string) {
  const value = relative(projectRoot, path);
  return value.startsWith('..') ? path : value;
}
