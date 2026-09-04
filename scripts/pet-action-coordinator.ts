import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { PET_ACTION_KEYS, type PetActionKey } from '../lib/pet-action-branches.ts';
import type {
  PetActionCoordinatorSnapshot,
  CoordinatedBranch,
} from '../lib/pet-action-coordinator.ts';
import type {
  BatchRunRecord,
  PetActionBatchManifest,
} from '../lib/comfy/worker-pool.ts';
import {
  petActionBranchArtifactFile,
  type PetActionArtifactManifest,
  type PetActionBranchArtifactRecord,
} from '../lib/video/pet-video-finalizer.ts';

export type CoordinatorRegistryEntry = {
  profileId: string;
  masterSha256: string;
  manifestFile: string;
};

type StoredCoordinatorJob = {
  schemaVersion: 1;
  id: string;
  avatarJobId: string;
  profileId: string;
  masterSha256: string;
  manifestFile: string;
  runDirectory: string;
  state: 'queued' | 'running' | 'complete' | 'failed';
  billingStarted: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

type RunBatch = (input: {
  projectRoot: string;
  manifestFile: string;
  runDirectory: string;
}) => Promise<void>;

const DEFAULT_REGISTRY: CoordinatorRegistryEntry[] = [{
  profileId: 'orange_longhair_test_v1',
  masterSha256: '7aa1e9dcb9b3db7e2c83f5bbca6068185a68ec3fc9feb91d0c9ba1e1668e11db',
  manifestFile: 'workflows/compiled/batches/orange-longhair-all-actions-v4/orange_longhair_test_v1-pet-actions-batch-v1.json',
}];

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

function assertSafeId(value: string, label: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/i.test(value)) throw new Error(`${label} 不正确`);
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

function defaultRunBatch(input: Parameters<RunBatch>[0]) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      join(input.projectRoot, 'scripts', 'run-pet-action-batch.ts'),
      '--manifest', input.manifestFile,
      '--run-dir', input.runDirectory,
    ], {
      cwd: input.projectRoot,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`四卡运行器退出：${signal ?? code ?? 'unknown'}`));
    });
  });
}

function actionKey(value: string): PetActionKey {
  if (!PET_ACTION_KEYS.includes(value as PetActionKey)) throw new Error(`未知动作分支：${value}`);
  return value as PetActionKey;
}

function queuedBranches(manifest: PetActionBatchManifest): CoordinatedBranch[] {
  return manifest.branches.map((branch) => ({ action: actionKey(branch.uiKey), state: 'queued' }));
}

function branchesFromRunRecord(
  manifest: PetActionBatchManifest,
  record: BatchRunRecord,
  jobFailed: boolean,
): CoordinatedBranch[] {
  return manifest.branches.map((branch) => {
    const run = record.branches.find((candidate) => candidate.uiKey === branch.uiKey);
    if (!run) return { action: actionKey(branch.uiKey), state: 'failed', error: '运行记录缺少这个动作' };
    if (run.state === 'failed' || run.state === 'submission_unknown') {
      return { action: actionKey(branch.uiKey), state: 'failed', error: run.error ?? '动作生成失败' };
    }
    if (jobFailed && run.state === 'succeeded') {
      return { action: actionKey(branch.uiKey), state: 'failed', error: '整批尚未通过自动验收' };
    }
    return {
      action: actionKey(branch.uiKey),
      state: run.state === 'pending' ? 'queued' : 'generating',
    };
  });
}

function branchesFromArtifact(
  manifest: PetActionBatchManifest,
  artifact: PetActionArtifactManifest,
): CoordinatedBranch[] {
  return manifest.branches.map((branch) => {
    const item = artifact.branches.find((candidate) => candidate.uiKey === branch.uiKey);
    if (!item) return { action: actionKey(branch.uiKey), state: 'failed', error: '成片清单缺少这个动作' };
    if (item.state !== 'published' || !item.final) {
      return { action: actionKey(branch.uiKey), state: 'failed', error: item.error ?? '动作没有通过自动验收' };
    }
    return {
      action: actionKey(branch.uiKey),
      state: 'succeeded',
      outputSha256: item.final.sha256,
      fps: item.final.fps,
      frameCount: item.final.frames,
      handoffOutFrame: item.final.handoffOutFrame,
    };
  });
}

function coordinatedFromBranchArtifact(
  action: PetActionKey,
  item: PetActionArtifactManifest['branches'][number],
): CoordinatedBranch {
  if (item.state !== 'published' || !item.final) {
    return { action, state: 'failed', error: item.error ?? '动作没有通过自动验收' };
  }
  return {
    action,
    state: 'succeeded',
    outputSha256: item.final.sha256,
    fps: item.final.fps,
    frameCount: item.final.frames,
    handoffOutFrame: item.final.handoffOutFrame,
  };
}

export class PetActionCoordinator {
  readonly #projectRoot: string;
  readonly #dataDirectory: string;
  readonly #registry: CoordinatorRegistryEntry[];
  readonly #runBatch: RunBatch;
  readonly #running = new Map<string, Promise<void>>();

  constructor(options: {
    projectRoot: string;
    dataDirectory?: string;
    registry?: CoordinatorRegistryEntry[];
    runBatch?: RunBatch;
  }) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#dataDirectory = resolve(options.dataDirectory ?? join(this.#projectRoot, 'workflows', 'coordinator'));
    this.#registry = options.registry ?? DEFAULT_REGISTRY;
    this.#runBatch = options.runBatch ?? defaultRunBatch;
  }

  #jobFile(id: string) {
    assertSafeId(id, '调度任务号');
    return join(this.#dataDirectory, 'jobs', `${id}.json`);
  }

  async #readJob(id: string) {
    const job = await readJson<StoredCoordinatorJob>(this.#jobFile(id));
    if (job.schemaVersion !== 1 || job.id !== id) throw new Error('动作调度任务记录已损坏');
    return job;
  }

  async #saveJob(job: StoredCoordinatorJob) {
    job.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.#jobFile(job.id), job);
  }

  async enqueue(input: { avatarJobId: string; profileId: string; masterSha256: string }) {
    assertSafeId(input.avatarJobId, '宠物任务号');
    assertSafeId(input.profileId, '宠物档案号');
    if (!isSha256(input.masterSha256)) throw new Error('宠物母版哈希不正确');
    const registry = this.#registry.find((entry) => (
      entry.profileId === input.profileId && entry.masterSha256 === input.masterSha256
    ));
    if (!registry) throw new Error('这张宠物母版还没有编译好的四动作合同');
    const id = `actions-${createHash('sha256')
      .update(`${input.avatarJobId}:${input.profileId}:${input.masterSha256}`)
      .digest('hex').slice(0, 24)}`;
    const file = this.#jobFile(id);
    if (!(await exists(file))) {
      const now = new Date().toISOString();
      const job: StoredCoordinatorJob = {
        schemaVersion: 1,
        id,
        avatarJobId: input.avatarJobId,
        profileId: input.profileId,
        masterSha256: input.masterSha256,
        manifestFile: registry.manifestFile,
        runDirectory: join('workflows', 'runs', id),
        state: 'queued',
        billingStarted: false,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, `${JSON.stringify(job, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    void this.#ensureRunning(id);
    return this.get(id);
  }

  async #ensureRunning(id: string) {
    const active = this.#running.get(id);
    if (active) return active;
    const task = this.#execute(id).finally(() => this.#running.delete(id));
    this.#running.set(id, task);
    return task;
  }

  async #execute(id: string) {
    const job = await this.#readJob(id);
    if (job.state === 'complete' || job.state === 'failed') return;
    job.state = 'running';
    job.error = undefined;
    await this.#saveJob(job);
    try {
      await this.#runBatch({
        projectRoot: this.#projectRoot,
        manifestFile: job.manifestFile,
        runDirectory: job.runDirectory,
      });
      const snapshot = await this.get(id);
      job.state = snapshot.state === 'complete' ? 'complete' : 'failed';
      job.billingStarted = snapshot.billingStarted;
      job.error = snapshot.state === 'complete' ? undefined : '整批没有通过自动验收';
    } catch (error) {
      job.state = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
    }
    await this.#saveJob(job);
  }

  async get(id: string): Promise<PetActionCoordinatorSnapshot> {
    const job = await this.#readJob(id);
    const manifestBytes = await readFile(join(this.#projectRoot, job.manifestFile));
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as PetActionBatchManifest;
    const expectedBatchId = `${manifest.petId}-${createHash('sha256').update(manifestBytes).digest('hex').slice(0, 12)}`;
    if (manifest.masterSha256 !== job.masterSha256 || manifest.petId !== job.profileId) {
      throw new Error('调度任务与四动作清单不匹配');
    }
    const artifactFile = join(this.#projectRoot, job.runDirectory, 'artifact-manifest.json');
    const runRecordFile = join(this.#projectRoot, job.runDirectory, 'run-record.json');
    let branches = queuedBranches(manifest);
    let runRecord: BatchRunRecord | null = null;
    if (await exists(runRecordFile)) runRecord = await readJson<BatchRunRecord>(runRecordFile);
    if (await exists(artifactFile)) {
      branches = branchesFromArtifact(manifest, await readJson<PetActionArtifactManifest>(artifactFile));
    } else if (runRecord) {
      branches = branchesFromRunRecord(
        manifest,
        runRecord,
        job.state === 'failed',
      );
    }
    branches = await Promise.all(manifest.branches.map(async (manifestBranch) => {
      const action = actionKey(manifestBranch.uiKey);
      const recordFile = petActionBranchArtifactFile(
        join(this.#projectRoot, job.runDirectory),
        manifestBranch.uiKey,
      );
      if (!(await exists(recordFile))) {
        return branches.find((branch) => branch.action === action)
          ?? { action, state: 'failed', error: '动作状态缺失' };
      }
      const record = await readJson<PetActionBranchArtifactRecord>(recordFile);
      if (record.schemaVersion !== 1
        || record.batchId !== expectedBatchId
        || record.petId !== job.profileId
        || record.masterSha256 !== job.masterSha256
        || record.branch.uiKey !== manifestBranch.uiKey) {
        throw new Error(`动作 ${manifestBranch.uiKey} 的单分支清单与当前任务不匹配`);
      }
      const runBranch = runRecord?.branches.find((candidate) => candidate.uiKey === manifestBranch.uiKey);
      const matchesCurrentRaw = runBranch?.state === 'succeeded'
        && runBranch.outputs.some((output) => output.sha256 === record.branch.raw.sha256);
      if (!matchesCurrentRaw && record.branch.state === 'qa_failed') {
        return branches.find((branch) => branch.action === action)
          ?? { action, state: 'failed', error: '动作状态缺失' };
      }
      return coordinatedFromBranchArtifact(action, record.branch);
    }));
    const succeeded = branches.filter((branch) => branch.state === 'succeeded').length;
    const failed = branches.some((branch) => branch.state === 'failed');
    const state = succeeded === 4
      ? 'complete'
      : succeeded > 0
        ? 'partial_ready'
        : failed || job.state === 'failed'
          ? 'failed'
          : job.state === 'queued'
            ? 'queued'
            : 'running';
    return {
      id: job.id,
      avatarJobId: job.avatarJobId,
      profileId: job.profileId,
      masterSha256: job.masterSha256,
      state,
      billingStarted: job.billingStarted || Boolean(runRecord?.branches.some((branch) => branch.attempt > 0)),
      branches,
      error: job.error,
    };
  }

  async videoFile(id: string, action: PetActionKey) {
    const job = await this.#readJob(id);
    const branchRecordFile = petActionBranchArtifactFile(join(this.#projectRoot, job.runDirectory), action);
    let branch: PetActionArtifactManifest['branches'][number] | undefined;
    if (await exists(branchRecordFile)) {
      const record = await readJson<PetActionBranchArtifactRecord>(branchRecordFile);
      const manifestBytes = await readFile(join(this.#projectRoot, job.manifestFile));
      const expectedBatchId = `${job.profileId}-${createHash('sha256').update(manifestBytes).digest('hex').slice(0, 12)}`;
      if (record.batchId !== expectedBatchId
        || record.petId !== job.profileId
        || record.masterSha256 !== job.masterSha256) {
        throw new Error('动作视频与当前宠物母版不匹配');
      }
      branch = record.branch;
    } else {
      const artifact = await readJson<PetActionArtifactManifest>(
        join(this.#projectRoot, job.runDirectory, 'artifact-manifest.json'),
      );
      branch = artifact.branches.find((candidate) => candidate.uiKey === action);
    }
    if (branch?.state !== 'published' || !branch.final) {
      throw new Error('这个动作视频还没有通过自动验收');
    }
    const file = resolve(this.#projectRoot, branch.final.file);
    const publicRoot = join(this.#projectRoot, 'public');
    if (file !== publicRoot && !file.startsWith(`${publicRoot}${sep}`)) {
      throw new Error('动作视频路径越出了公开成片目录');
    }
    await access(file);
    return file;
  }

  async resume() {
    const directory = join(this.#dataDirectory, 'jobs');
    if (!(await exists(directory))) return;
    const files = await readdir(directory);
    await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
      const job = await readJson<StoredCoordinatorJob>(join(directory, file));
      if (job.state === 'queued' || job.state === 'running') void this.#ensureRunning(job.id);
    }));
  }

  async waitForIdle() {
    await Promise.all([...this.#running.values()]);
  }
}
