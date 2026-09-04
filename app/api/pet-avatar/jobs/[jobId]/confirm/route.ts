import { getJob, normalizePetDetails, saveJob } from '@/lib/pet-avatar-jobs';
import { createPetActionBatch, isCurrentPetActionBatch } from '@/lib/pet-action-branches';

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) return Response.json({ status: 'error', message: '任务不存在或已经过期' }, { status: 404 });

  const body = await request.json().catch(() => null) as {
    approved?: unknown;
    petName?: unknown;
    ageOrBirthday?: unknown;
    gender?: unknown;
  } | null;
  if (typeof body?.approved !== 'boolean') {
    return Response.json({ status: 'error', message: '确认参数不正确' }, { status: 400 });
  }

  const repeatedSameDecision = (job.status === 'approved' && body.approved)
    || (job.status === 'rejected' && !body.approved);
  if (repeatedSameDecision) {
    if (body.approved && !isCurrentPetActionBatch(job.actionBatch)) {
      job.actionBatch = createPetActionBatch(job.id, job.profileId, job.masterSha256);
      saveJob(job);
    }
    return Response.json({
      status: job.status,
      jobId: job.id,
      previewUrl: job.previewUrl,
      petName: job.petName,
      ageOrBirthday: job.ageOrBirthday,
      gender: job.gender,
      actionBatch: job.actionBatch,
    });
  }
  if (job.status !== 'ready_for_review') {
    return Response.json({ status: 'error', message: '这张母版已经有了不同的确认结果' }, { status: 409 });
  }

  if (body.approved) {
    const petName = typeof body.petName === 'string' ? body.petName.trim() : '';
    if (petName.length > 12) {
      return Response.json({ status: 'error', message: '宠物名字最多填写 12 个字' }, { status: 400 });
    }
    try {
      Object.assign(job, normalizePetDetails(body.ageOrBirthday, body.gender));
      job.petName = petName || '我的宝贝';
    } catch (error) {
      return Response.json({
        status: 'error',
        message: error instanceof Error ? error.message : '宠物资料不正确',
      }, { status: 400 });
    }
  }

  job.status = body.approved ? 'approved' : 'rejected';
  if (body.approved && !isCurrentPetActionBatch(job.actionBatch)) {
    job.actionBatch = createPetActionBatch(job.id, job.profileId, job.masterSha256);
  }
  saveJob(job);
  return Response.json({
    status: job.status,
    jobId: job.id,
    previewUrl: job.previewUrl,
    petName: job.petName,
    ageOrBirthday: job.ageOrBirthday,
    gender: job.gender,
    actionBatch: job.actionBatch,
  });
}
