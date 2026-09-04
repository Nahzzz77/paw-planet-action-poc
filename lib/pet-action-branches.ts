export const PET_ACTION_KEYS = ['idle', 'lick', 'feed', 'pet'] as const;

export type PetActionKey = typeof PET_ACTION_KEYS[number];
export type PetActionCapability =
  | 'validated'
  | 'poc'
  | 'prepared'
  | 'blocked';
export type PetActionRunState =
  | 'not_started'
  | 'queued'
  | 'generating'
  | 'succeeded'
  | 'failed';
export type PetActionReasonCode =
  | 'READY'
  | 'TAIL_AMPLITUDE_TOO_LARGE'
  | 'GPU_VALIDATION_REQUIRED'
  | 'BOWL_DRIVER_REQUIRED'
  | 'IDENTITY_PROFILE_REQUIRED'
  | 'MASTER_HASH_MISMATCH'
  | 'POC_SOURCE_GATE_BYPASSED';

export type PetActionBranch = {
  action: PetActionKey;
  label: string;
  workerSlot: 'gpu-1' | 'gpu-2' | 'gpu-3' | 'gpu-4';
  templateVersion: string | null;
  capability: PetActionCapability;
  runState: PetActionRunState;
  dispatchAllowed: boolean;
  reasonCode: PetActionReasonCode;
  message: string;
  videoUrl?: string;
  outputSha256?: string;
  cacheHit?: boolean;
  issue?: string;
  fps?: number;
  frameCount?: number;
  handoffOutFrame?: number;
  mediaPolicyVersion?: 'pet-video-v1' | 'pet-video-v2';
  qaPolicyVersion?: 'pet-video-qa-v2';
  publishState?: 'published' | 'poc_salvage';
};

export type PetActionBatch = {
  id: string;
  avatarJobId: string;
  profileId: string | null;
  masterSha256: string | null;
  registryVersion: typeof PET_ACTION_REGISTRY_VERSION;
  mode: 'plan_only' | 'coordinated';
  billingStarted: boolean;
  coordinatorJobId?: string;
  createdAt: number;
  updatedAt: number;
  branches: PetActionBranch[];
};

export const PET_ACTION_REGISTRY_VERSION = 'pet-actions-v3' as const;
export const GRAY_CAT_PROFILE_ID = 'gray_cat_demo_v1';
export const GRAY_ACTION_MASTER_SHA256 = 'a0ca62eaf7ef19b99ad213ce2ace01fa1f13dbb1efe5fa43b6d9e2d022011ea6';
export const ORANGE_LONGHAIR_PROFILE_ID = 'orange_longhair_test_v1';
export const ORANGE_ACTION_MASTER_SHA256 = '7aa1e9dcb9b3db7e2c83f5bbca6068185a68ec3fc9feb91d0c9ba1e1668e11db';

type PetAvatarDemoCache = {
  previewUrl: string;
  profileId: string;
  masterSha256: string;
};

const PET_AVATAR_DEMO_CACHE: Record<string, PetAvatarDemoCache> = {
  [GRAY_ACTION_MASTER_SHA256]: {
    previewUrl: '/assets/gray-cat-idle.png',
    profileId: GRAY_CAT_PROFILE_ID,
    masterSha256: GRAY_ACTION_MASTER_SHA256,
  },
  a78c038573c5cac4dcc66975687abe3add76d2b258b7ce497900493efd86ad37: {
    previewUrl: '/assets/generated/pet-avatar-orange-longhair-motion-safe-v3.png',
    profileId: ORANGE_LONGHAIR_PROFILE_ID,
    masterSha256: ORANGE_ACTION_MASTER_SHA256,
  },
};

export const getPetAvatarDemoCache = (photoSha256: string) => (
  PET_AVATAR_DEMO_CACHE[photoSha256] ?? null
);

export const isSha256 = (value?: string | null): value is string => Boolean(
  value && /^[a-f0-9]{64}$/.test(value),
);

const hasFixedPlaybackContract = (branch?: PetActionBranch) => Boolean(
  branch?.videoUrl
  && isSha256(branch.outputSha256)
  && branch.fps === 30
  && branch.frameCount === 152
  && branch.handoffOutFrame === 150,
);

export const isValidatedPlayableBranch = (branch?: PetActionBranch) => Boolean(
  branch
  && branch.capability === 'validated'
  && branch.runState === 'succeeded'
  && branch.publishState === 'published'
  && branch.mediaPolicyVersion === 'pet-video-v2'
  && branch.qaPolicyVersion === 'pet-video-qa-v2'
  && hasFixedPlaybackContract(branch),
);

export const isExplicitPocPlayableBranch = (branch?: PetActionBranch) => Boolean(
  branch
  && branch.capability === 'poc'
  && branch.runState === 'succeeded'
  && branch.publishState === 'poc_salvage'
  && branch.reasonCode === 'POC_SOURCE_GATE_BYPASSED'
  && branch.mediaPolicyVersion === 'pet-video-v1'
  && hasFixedPlaybackContract(branch),
);

export const isPlayablePetActionBranch = (branch?: PetActionBranch) => (
  isValidatedPlayableBranch(branch) || isExplicitPocPlayableBranch(branch)
);

export function isAtomicPlayablePetActionBatch(batch?: PetActionBatch | null) {
  if (!batch || !isSha256(batch.masterSha256) || batch.branches.length !== PET_ACTION_KEYS.length) return false;
  if (new Set(batch.branches.map((branch) => branch.action)).size !== PET_ACTION_KEYS.length) return false;
  const branches = PET_ACTION_KEYS.map((action) => batch.branches.find((branch) => branch.action === action));
  return branches.every(isValidatedPlayableBranch) || branches.every(isExplicitPocPlayableBranch);
}

const branch = (
  action: PetActionKey,
  label: string,
  workerSlot: PetActionBranch['workerSlot'],
  templateVersion: string | null,
  capability: PetActionCapability,
  runState: PetActionRunState,
  dispatchAllowed: boolean,
  reasonCode: PetActionReasonCode,
  message: string,
  extra: Pick<
    PetActionBranch,
    | 'videoUrl'
    | 'outputSha256'
    | 'cacheHit'
    | 'issue'
    | 'fps'
    | 'frameCount'
    | 'handoffOutFrame'
    | 'mediaPolicyVersion'
    | 'qaPolicyVersion'
    | 'publishState'
  > = {},
): PetActionBranch => ({
  action,
  label,
  workerSlot,
  templateVersion,
  capability,
  runState,
  dispatchAllowed,
  reasonCode,
  message,
  ...extra,
});

function createOrangeLonghairBranches(): PetActionBranch[] {
  return [
    branch(
      'idle',
      '待机',
      'gpu-1',
      'cat_idle_v1',
      'poc',
      'succeeded',
      true,
      'POC_SOURCE_GATE_BYPASSED',
      '已统一为 30fps 并锚定首尾；旧原片未通过正式源接缝门禁',
      {
        videoUrl: '/assets/generated/cat-idle-orange-longhair-anchor30-poc-v2.mp4',
        outputSha256: '15174470935ccfa15efa2d446ef0d254b6faa4f8883a5b529e8cdb754733f975',
        cacheHit: true,
        issue: '尾巴中段摆动幅度过大，且原片源接缝未达正式发布门槛。',
        fps: 30,
        frameCount: 152,
        handoffOutFrame: 150,
        mediaPolicyVersion: 'pet-video-v1',
        publishState: 'poc_salvage',
      },
    ),
    branch(
      'lick',
      '舔爪',
      'gpu-2',
      'cat_lick_paw_v1',
      'poc',
      'succeeded',
      true,
      'POC_SOURCE_GATE_BYPASSED',
      '已统一为 30fps 并锚定首尾；旧原片未通过正式源接缝门禁',
      {
        videoUrl: '/assets/generated/cat-lick-paw-orange-longhair-anchor30-poc-v2.mp4',
        outputSha256: '17a0efef7a18de81973f8426dc605b01d3624bddd83ff7f0f615fbeaf7f78827',
        cacheHit: true,
        fps: 30,
        frameCount: 152,
        handoffOutFrame: 150,
        mediaPolicyVersion: 'pet-video-v1',
        publishState: 'poc_salvage',
      },
    ),
    branch(
      'feed',
      '猫碗吃粮',
      'gpu-3',
      'cat_feed_v1',
      'poc',
      'succeeded',
      true,
      'POC_SOURCE_GATE_BYPASSED',
      '已统一为 30fps 并锚定首尾；旧原片未通过正式源接缝门禁',
      {
        videoUrl: '/assets/generated/cat-feed-orange-longhair-anchor30-poc-v2.mp4',
        outputSha256: 'bd296b4fe3340d53e37cb298453c0b2cf068fa45d2d718045f842fbbb2b27ba5',
        cacheHit: true,
        fps: 30,
        frameCount: 152,
        handoffOutFrame: 150,
        mediaPolicyVersion: 'pet-video-v1',
        publishState: 'poc_salvage',
      },
    ),
    branch(
      'pet',
      '摸头',
      'gpu-4',
      'cat_head_pet_v1',
      'poc',
      'succeeded',
      true,
      'POC_SOURCE_GATE_BYPASSED',
      '已统一为 30fps 并锚定首尾；旧原片未通过正式源接缝门禁',
      {
        videoUrl: '/assets/generated/cat-head-pet-orange-longhair-anchor30-poc-v2.mp4',
        outputSha256: '81374e89fbda2d61931dc2d774e59d67c445ac09f83bd81e14f7fed42b742329',
        cacheHit: true,
        fps: 30,
        frameCount: 152,
        handoffOutFrame: 150,
        mediaPolicyVersion: 'pet-video-v1',
        publishState: 'poc_salvage',
      },
    ),
  ];
}

function createGrayCatBranches(): PetActionBranch[] {
  const common = {
    cacheHit: true,
    fps: 30,
    frameCount: 152,
    handoffOutFrame: 150,
    mediaPolicyVersion: 'pet-video-v1' as const,
    publishState: 'poc_salvage' as const,
  };
  return [
    branch('idle', '待机', 'gpu-1', 'cat_idle_v1', 'poc', 'succeeded', true, 'POC_SOURCE_GATE_BYPASSED', '小灰演示缓存', {
      ...common,
      videoUrl: '/assets/generated/cat-idle-scail2-poc-smooth30-v1.mp4',
      outputSha256: '16a13bb7de2259668211d6e0f8863c68f49501f44e953593df152c5ed10bd1f1',
    }),
    branch('lick', '舔爪', 'gpu-2', 'cat_lick_paw_v1', 'poc', 'succeeded', true, 'POC_SOURCE_GATE_BYPASSED', '小灰演示缓存', {
      ...common,
      videoUrl: '/assets/generated/cat-lick-paw-scail2-complete-poc-smooth30-seam-v3.mp4',
      outputSha256: 'beaff4d8dcbb11d721967c0d3e2c9fded47a278a6cad25cd6f3505d1277280c5',
    }),
    branch('feed', '猫碗吃粮', 'gpu-3', 'cat_feed_v1', 'poc', 'succeeded', true, 'POC_SOURCE_GATE_BYPASSED', '小灰演示缓存', {
      ...common,
      videoUrl: '/assets/generated/cat-eat-scail2-poc-smooth30-seam-v3.mp4',
      outputSha256: 'ae142029f5d58ce34abe805e94f6bd9fbce17984276714223337307c818fe3d9',
    }),
    branch('pet', '摸头', 'gpu-4', 'cat_head_pet_v1', 'poc', 'succeeded', true, 'POC_SOURCE_GATE_BYPASSED', '小灰演示缓存', {
      ...common,
      videoUrl: '/assets/generated/cat-head-pet-scail2-poc-smooth30-seam-v4.mp4',
      outputSha256: 'e54fbd28d57b70fc8a2c8e662aca44d25b655d08dace6a62ad9b0254589128c9',
    }),
  ];
}

function createOrangeLonghairPreparedBranches(): PetActionBranch[] {
  const message = '动作模板已经准备好，等待后台调度';
  return [
    branch('idle', '待机', 'gpu-1', 'cat_idle_v1', 'prepared', 'not_started', true, 'GPU_VALIDATION_REQUIRED', message),
    branch('lick', '舔爪', 'gpu-2', 'cat_lick_paw_v1', 'prepared', 'not_started', true, 'GPU_VALIDATION_REQUIRED', message),
    branch('feed', '猫碗吃粮', 'gpu-3', 'cat_feed_v1', 'prepared', 'not_started', true, 'GPU_VALIDATION_REQUIRED', message),
    branch('pet', '摸头', 'gpu-4', 'cat_head_pet_v1', 'prepared', 'not_started', true, 'GPU_VALIDATION_REQUIRED', message),
  ];
}

function createUnprofiledBranches(masterMismatch: boolean): PetActionBranch[] {
  const reasonCode = masterMismatch ? 'MASTER_HASH_MISMATCH' : 'IDENTITY_PROFILE_REQUIRED';
  const profileMessage = masterMismatch
    ? '已知宠物档案与用户确认的母版哈希不一致'
    : '等待从用户照片提取并固化宠物身份档案';
  return [
    branch('idle', '待机', 'gpu-1', 'cat_idle_v1', 'blocked', 'not_started', false, reasonCode, profileMessage),
    branch('lick', '舔爪', 'gpu-2', 'cat_lick_paw_v1', 'blocked', 'not_started', false, reasonCode, profileMessage),
    branch(
      'feed',
      '猫碗吃粮',
      'gpu-3',
      'cat_feed_v1',
      'blocked',
      'not_started',
      false,
      reasonCode,
      profileMessage,
    ),
    branch('pet', '摸头', 'gpu-4', 'cat_head_pet_v1', 'blocked', 'not_started', false, reasonCode, profileMessage),
  ];
}

export function createPetActionBatch(
  avatarJobId: string,
  profileId?: string,
  masterSha256?: string,
  options: { useKnownCache?: boolean } = {},
): PetActionBatch {
  const now = Date.now();
  const matchesGrayActionMaster = profileId === GRAY_CAT_PROFILE_ID
    && masterSha256 === GRAY_ACTION_MASTER_SHA256;
  const matchesOrangeActionMaster = profileId === ORANGE_LONGHAIR_PROFILE_ID
    && masterSha256 === ORANGE_ACTION_MASTER_SHA256;
  const masterMismatch = (profileId === GRAY_CAT_PROFILE_ID && masterSha256 !== GRAY_ACTION_MASTER_SHA256)
    || (profileId === ORANGE_LONGHAIR_PROFILE_ID && masterSha256 !== ORANGE_ACTION_MASTER_SHA256);
  return {
    id: crypto.randomUUID(),
    avatarJobId,
    profileId: profileId ?? null,
    masterSha256: masterSha256 ?? null,
    registryVersion: PET_ACTION_REGISTRY_VERSION,
    mode: 'plan_only',
    billingStarted: false,
    createdAt: now,
    updatedAt: now,
    branches: matchesGrayActionMaster
      ? createGrayCatBranches()
      : matchesOrangeActionMaster
        ? options.useKnownCache === false
          ? createOrangeLonghairPreparedBranches()
          : createOrangeLonghairBranches()
        : createUnprofiledBranches(masterMismatch),
  };
}

export function isCurrentPetActionBatch(batch?: PetActionBatch) {
  return batch?.registryVersion === PET_ACTION_REGISTRY_VERSION;
}

export function playableBranchCount(batch?: PetActionBatch) {
  if (!batch || !isSha256(batch.masterSha256) || batch.branches.length !== PET_ACTION_KEYS.length) return 0;
  if (new Set(batch.branches.map((branch) => branch.action)).size !== PET_ACTION_KEYS.length) return 0;
  return PET_ACTION_KEYS.filter((action) => (
    isPlayablePetActionBranch(batch.branches.find((branch) => branch.action === action))
  )).length;
}
