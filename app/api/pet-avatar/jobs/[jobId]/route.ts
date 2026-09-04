import { getWorkflowHistory } from '@/lib/comfy/client';
import { createPetActionBatch, isCurrentPetActionBatch } from '@/lib/pet-action-branches';
import { getJob, saveJob } from '@/lib/pet-avatar-jobs';

const OUTPUT_NODE = '195';

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job) return Response.json({ status: 'error', message: '任务不存在或已经过期' }, { status: 404 });

  if (job.status === 'ready_for_review' || job.status === 'approved' || job.status === 'rejected') {
    if (job.status === 'approved' && !isCurrentPetActionBatch(job.actionBatch)) {
      job.actionBatch = createPetActionBatch(job.id, job.profileId, job.masterSha256);
      saveJob(job);
    }
    return Response.json({
      status: job.status,
      previewUrl: job.previewUrl,
      petName: job.petName,
      ageOrBirthday: job.ageOrBirthday,
      gender: job.gender,
      actionBatch: job.actionBatch,
    });
  }
  if (job.status === 'failed') {
    return Response.json({ status: 'failed', message: job.message || '生成失败' });
  }
  if (job.status === 'submitting' && !job.promptId) {
    return Response.json({ status: 'submitting', pollAfterMs: 1200 }, { status: 202 });
  }
  if (!job.promptId) {
    job.status = 'failed';
    job.message = '生成任务缺少队列编号';
    saveJob(job);
    return Response.json({ status: 'failed', message: job.message });
  }

  try {
    const history = await getWorkflowHistory(job.promptId);
    const item = history[job.promptId];
    if (!item) {
      job.status = 'generating';
      saveJob(job);
      return Response.json({ status: 'generating' }, { status: 202 });
    }

    const image = item.outputs?.[OUTPUT_NODE]?.images?.[0];
    if (image) {
      job.status = 'ready_for_review';
      job.output = { filename: image.filename, subfolder: image.subfolder, type: image.type };
      job.previewUrl = `/api/pet-avatar/jobs/${encodeURIComponent(job.id)}/image`;
      saveJob(job);
      return Response.json({
        status: job.status,
        previewUrl: job.previewUrl,
        petName: job.petName,
        ageOrBirthday: job.ageOrBirthday,
        gender: job.gender,
      });
    }

    if (item.status?.completed === false || item.status?.status_str === 'error') {
      job.status = 'failed';
      job.message = '模型执行失败，请重新选择照片再试';
      saveJob(job);
      return Response.json({ status: 'failed', message: job.message });
    }

    if (item.status?.completed === true) {
      job.status = 'failed';
      job.message = '模型执行已结束，但没有找到预期的母版输出';
      saveJob(job);
      return Response.json({ status: 'failed', message: job.message });
    }

    job.status = 'generating';
    saveJob(job);
    return Response.json({ status: 'generating' }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法读取生成进度';
    return Response.json({ status: 'error', message }, { status: 503 });
  }
}
