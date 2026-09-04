import type {
  PetActionBatch,
  PetActionBranch,
  PetActionKey,
} from './pet-action-branches';

export type CoordinatedBranchState = 'queued' | 'generating' | 'succeeded' | 'failed';

export type CoordinatedBranch = {
  action: PetActionKey;
  state: CoordinatedBranchState;
  error?: string;
  outputSha256?: string;
  fps?: number;
  frameCount?: number;
  handoffOutFrame?: number;
};

export type PetActionCoordinatorSnapshot = {
  id: string;
  avatarJobId: string;
  profileId: string;
  masterSha256: string;
  state: 'queued' | 'running' | 'partial_ready' | 'complete' | 'failed';
  billingStarted: boolean;
  branches: CoordinatedBranch[];
  error?: string;
};

export type PetActionCoordinatorConfig = {
  url: string;
  token: string;
};

function configuredUrl(value: string) {
  const url = new URL(value);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('动作调度器必须使用 HTTPS；本机回环地址可以使用 HTTP');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('动作调度器地址不能携带账号、密码、查询参数或片段');
  }
  return new URL(url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`, url.origin);
}

export function petActionCoordinatorConfig(): PetActionCoordinatorConfig | null {
  const url = process.env.PET_ACTION_COORDINATOR_URL?.trim();
  const token = process.env.PET_ACTION_COORDINATOR_TOKEN?.trim();
  if (!url && !token) return null;
  if (!url || !token) throw new Error('动作调度器地址和密钥必须同时配置');
  return { url: configuredUrl(url).toString(), token };
}

async function coordinatorRequest(
  config: PetActionCoordinatorConfig,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(new URL(path.replace(/^\/+/, ''), config.url), {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init?.headers).entries()),
      Authorization: `Bearer ${config.token}`,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message || `动作调度器返回了 ${response.status}`);
  }
  return response;
}

export async function enqueuePetActionBatch(
  config: PetActionCoordinatorConfig,
  input: { avatarJobId: string; profileId: string; masterSha256: string },
) {
  const response = await coordinatorRequest(config, 'v1/action-batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json() as Promise<PetActionCoordinatorSnapshot>;
}

export async function getCoordinatedPetActionBatch(
  config: PetActionCoordinatorConfig,
  coordinatorJobId: string,
) {
  const response = await coordinatorRequest(
    config,
    `v1/action-batches/${encodeURIComponent(coordinatorJobId)}`,
    { cache: 'no-store' },
  );
  return response.json() as Promise<PetActionCoordinatorSnapshot>;
}

export async function fetchCoordinatedPetActionVideo(
  config: PetActionCoordinatorConfig,
  coordinatorJobId: string,
  action: PetActionKey,
) {
  return coordinatorRequest(
    config,
    `v1/action-batches/${encodeURIComponent(coordinatorJobId)}/videos/${action}`,
    { cache: 'no-store' },
  );
}

function mergeBranch(
  branch: PetActionBranch,
  coordinated: CoordinatedBranch,
  coordinatorJobId: string,
): PetActionBranch {
  if (coordinated.state === 'succeeded') {
    if (!coordinated.outputSha256 || coordinated.fps !== 30
      || coordinated.frameCount !== 152 || coordinated.handoffOutFrame !== 150) {
      throw new Error(`动作 ${coordinated.action} 的成片合同不完整`);
    }
    return {
      ...branch,
      capability: 'validated',
      runState: 'succeeded',
      reasonCode: 'READY',
      message: '动作已经生成并通过自动验收',
      videoUrl: `/api/pet-avatar/action-videos/${encodeURIComponent(coordinatorJobId)}/${coordinated.action}`,
      outputSha256: coordinated.outputSha256,
      cacheHit: false,
      issue: undefined,
      fps: coordinated.fps,
      frameCount: coordinated.frameCount,
      handoffOutFrame: coordinated.handoffOutFrame,
      mediaPolicyVersion: 'pet-video-v2',
      qaPolicyVersion: 'pet-video-qa-v2',
      publishState: 'published',
    };
  }
  return {
    ...branch,
    capability: 'prepared',
    runState: coordinated.state === 'generating' ? 'generating' : coordinated.state,
    reasonCode: 'GPU_VALIDATION_REQUIRED',
    message: coordinated.state === 'failed'
      ? '这一条生成失败，其他动作不受影响'
      : coordinated.state === 'generating'
        ? '正在生成和自动验收'
        : '已经进入后台队列',
    videoUrl: undefined,
    outputSha256: undefined,
    cacheHit: false,
    issue: coordinated.error,
    fps: undefined,
    frameCount: undefined,
    handoffOutFrame: undefined,
    mediaPolicyVersion: undefined,
    qaPolicyVersion: undefined,
    publishState: undefined,
  };
}

export function applyCoordinatorSnapshot(
  batch: PetActionBatch,
  snapshot: PetActionCoordinatorSnapshot,
): PetActionBatch {
  if (snapshot.avatarJobId !== batch.avatarJobId
    || snapshot.profileId !== batch.profileId
    || snapshot.masterSha256 !== batch.masterSha256) {
    throw new Error('动作调度结果与当前宠物母版不匹配');
  }
  const coordinatedByAction = new Map(snapshot.branches.map((branch) => [branch.action, branch]));
  if (coordinatedByAction.size !== batch.branches.length) {
    throw new Error('动作调度器没有返回完整的四分支状态');
  }
  return {
    ...batch,
    mode: 'coordinated',
    billingStarted: snapshot.billingStarted,
    coordinatorJobId: snapshot.id,
    updatedAt: Date.now(),
    branches: batch.branches.map((branch) => {
      const coordinated = coordinatedByAction.get(branch.action);
      if (!coordinated) throw new Error(`动作调度器缺少 ${branch.action} 分支`);
      return mergeBranch(branch, coordinated, snapshot.id);
    }),
  };
}
