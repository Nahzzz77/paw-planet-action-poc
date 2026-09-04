import {
  createPetActionBatch,
  isCurrentPetActionBatch,
  ORANGE_ACTION_MASTER_SHA256,
  ORANGE_LONGHAIR_PROFILE_ID,
  playableBranchCount,
} from '@/lib/pet-action-branches';
import {
  applyCoordinatorSnapshot,
  enqueuePetActionBatch,
  getCoordinatedPetActionBatch,
  petActionCoordinatorConfig,
} from '@/lib/pet-action-coordinator';
import { getJob, saveJob } from '@/lib/pet-avatar-jobs';

const responseBody = (job: NonNullable<ReturnType<typeof getJob>>) => {
  const playable = playableBranchCount(job.actionBatch);
  const generating = job.actionBatch?.branches.some((branch) => (
    branch.runState === 'queued' || branch.runState === 'generating'
  )) ?? false;
  const failed = job.actionBatch?.branches.some((branch) => branch.runState === 'failed') ?? false;
  const status = playable === 4
    ? 'complete'
    : playable > 0
      ? 'partial_ready'
      : generating
        ? 'generating'
        : failed
          ? 'failed'
          : 'planned';
  return {
    status,
    playable,
    total: 4,
    pollAfterMs: generating ? 1500 : undefined,
    executionMode: job.actionBatch?.mode ?? 'plan_only',
    billingStarted: job.actionBatch?.billingStarted ?? false,
    actionBatch: job.actionBatch,
  };
};

const wantsKnownProfileRegeneration = (job: NonNullable<ReturnType<typeof getJob>>) => (
  process.env.PET_ACTION_USE_KNOWN_CACHE === 'false'
  && job.profileId === ORANGE_LONGHAIR_PROFILE_ID
  && job.masterSha256 === ORANGE_ACTION_MASTER_SHA256
);

async function refreshCoordinatedBatch(job: NonNullable<ReturnType<typeof getJob>>) {
  const batch = job.actionBatch;
  const coordinatorJobId = batch?.coordinatorJobId;
  if (!coordinatorJobId) return;
  const config = petActionCoordinatorConfig();
  if (!config) throw new Error('这个动作任务需要后台调度器，但调度器当前没有连接');
  const snapshot = await getCoordinatedPetActionBatch(config, coordinatorJobId);
  job.actionBatch = applyCoordinatorSnapshot(batch, snapshot);
  saveJob(job);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) {
    return Response.json({ status: 'error', message: '任务不存在或已经过期' }, { status: 404 });
  }
  if (job.status !== 'approved') {
    return Response.json({ status: 'error', message: '只有用户确认过的母版才能建立动作分支' }, { status: 409 });
  }
  try {
    await refreshCoordinatedBatch(job);
  } catch (error) {
    return Response.json({
      status: 'error',
      message: error instanceof Error ? error.message : '动作调度器暂时无法读取',
    }, { status: 502 });
  }
  if (job.actionBatch && !isCurrentPetActionBatch(job.actionBatch)) {
    job.actionBatch = createPetActionBatch(job.id, job.profileId, job.masterSha256);
    saveJob(job);
  }
  if (!job.actionBatch) {
    return Response.json({ status: 'not_prepared', billingStarted: false }, { status: 404 });
  }
  return Response.json(responseBody(job));
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) {
    return Response.json({ status: 'error', message: '任务不存在或已经过期' }, { status: 404 });
  }
  if (job.status !== 'approved') {
    return Response.json({ status: 'error', message: '只有用户确认过的母版才能建立动作分支' }, { status: 409 });
  }
  if (wantsKnownProfileRegeneration(job)
    && job.actionBatch?.mode !== 'coordinated') {
    job.actionBatch = createPetActionBatch(job.id, job.profileId, job.masterSha256, { useKnownCache: false });
    saveJob(job);
  }
  if (!isCurrentPetActionBatch(job.actionBatch)) {
    job.actionBatch = createPetActionBatch(job.id, job.profileId, job.masterSha256);
    saveJob(job);
  }
  try {
    if (job.actionBatch?.coordinatorJobId) {
      await refreshCoordinatedBatch(job);
    } else if (job.actionBatch?.branches.some((branch) => branch.dispatchAllowed && branch.runState === 'not_started')) {
      const config = petActionCoordinatorConfig();
      if (config && job.profileId && job.masterSha256) {
        const snapshot = await enqueuePetActionBatch(config, {
          avatarJobId: job.id,
          profileId: job.profileId,
          masterSha256: job.masterSha256,
        });
        job.actionBatch = applyCoordinatorSnapshot(job.actionBatch, snapshot);
        saveJob(job);
      }
    }
  } catch (error) {
    return Response.json({
      status: 'error',
      message: error instanceof Error ? error.message : '动作调度器暂时无法提交',
    }, { status: 502 });
  }
  return Response.json(responseBody(job));
}
