import { uploadPetPhoto, submitWorkflow } from '@/lib/comfy/client';
import { createPetAvatarWorkflow } from '@/lib/comfy/workflow';
import {
  getJobByRequestKey,
  normalizePetDetails,
  saveJob,
  saveRequestKey,
  type PetAvatarJob,
} from '@/lib/pet-avatar-jobs';
import { validatePetPhoto } from '@/lib/pet-photo-server';
import {
  getPetAvatarDemoCache,
} from '@/lib/pet-action-branches';

const JOB_TTL = 60 * 60 * 1000;
const MAX_REQUEST_SIZE = 14 * 1024 * 1024;
const DEMO_CACHE_ONLY = true;

const errorResponse = (message: string, status = 400) =>
  Response.json({ status: 'error', message }, { status });

function existingJobResponse(job: PetAvatarJob) {
  const body = {
    status: job.status,
    jobId: job.id,
    previewUrl: job.previewUrl,
    pollAfterMs: 1600,
    cached: job.promptId === null && Boolean(job.previewUrl),
    message: job.message,
    petName: job.petName,
    ageOrBirthday: job.ageOrBirthday,
    gender: job.gender,
  };
  if (job.status === 'submitting' || job.status === 'queued' || job.status === 'generating') {
    return Response.json(body, { status: 202 });
  }
  if (job.status === 'failed') return Response.json(body, { status: 409 });
  return Response.json(body);
}

const toComfyPath = (upload: { name: string; subfolder: string }) =>
  upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;

export async function POST(request: Request) {
  const contentLengthHeader = request.headers.get('content-length');
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
  if (contentLength !== null && (!Number.isFinite(contentLength) || contentLength < 0)) {
    return errorResponse('上传请求大小不正确');
  }
  if (contentLength !== null && contentLength > MAX_REQUEST_SIZE) {
    return errorResponse('上传内容过大', 413);
  }

  const requestKey = request.headers.get('Idempotency-Key')?.trim() || null;
  if (requestKey && !/^[a-zA-Z0-9_-]{16,128}$/.test(requestKey)) {
    return errorResponse('生成请求标识不正确');
  }
  if (requestKey) {
    const existing = getJobByRequestKey(requestKey);
    if (existing) return existingJobResponse(existing);
  }

  let reservedJob: PetAvatarJob | null = null;

  try {
    const form = await request.formData();
    const photo = form.get('photo');
    const petKind = form.get('petKind');
    const petName = String(form.get('petName') || '我的宝贝').trim().slice(0, 12) || '我的宝贝';
    const petDetails = normalizePetDetails(form.get('ageOrBirthday'), form.get('gender'));

    if (!(photo instanceof File)) return errorResponse('请选择一张宠物照片');
    if (petKind !== 'cat') return errorResponse('狗狗固定风格模板还没有验收，当前 POC 先支持猫咪', 422);

    const validated = await validatePetPhoto(photo);
    const id = crypto.randomUUID();
    const now = Date.now();

    const cachedAvatar = getPetAvatarDemoCache(validated.sha256);
    if (cachedAvatar) {
      const cachedJob = saveJob({
        id,
        promptId: null,
        status: 'ready_for_review',
        petName,
        ...petDetails,
        createdAt: now,
        expiresAt: now + JOB_TTL,
        profileId: cachedAvatar.profileId,
        masterSha256: cachedAvatar.masterSha256,
        previewUrl: cachedAvatar.previewUrl,
      });
      if (requestKey) saveRequestKey(requestKey, cachedJob.id);
      return Response.json({
        status: 'ready_for_review',
        jobId: id,
        previewUrl: cachedAvatar.previewUrl,
        cached: true,
      });
    }

    // ponytail: This POC is deliberately fail-closed; remove the gate when the paid GPU service is ready.
    if (DEMO_CACHE_ONLY) {
      return errorResponse('当前演示仅支持小灰和小橘两张测试照片；不会启动 GPU，也不会产生费用', 422);
    }

    const hostname = new URL(request.url).hostname;
    const isLocalPoc = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
    if (!isLocalPoc) {
      return errorResponse('公开 AI 生成尚未开放：需要先接入登录、限频和每用户额度', 503);
    }

    reservedJob = saveJob({
      id,
      promptId: null,
      status: 'submitting',
      petName,
      ...petDetails,
      createdAt: now,
      expiresAt: now + JOB_TTL,
    });
    if (requestKey) saveRequestKey(requestKey, reservedJob.id);

    const safeName = `pet-${id}.${validated.extension}`;
    const uploadBytes = new Uint8Array(validated.bytes.length);
    uploadBytes.set(validated.bytes);
    const safeFile = new File([uploadBytes.buffer], safeName, { type: validated.mimeType });
    const styleResponse = await fetch(new URL('/assets/gray-cat-idle.png', request.url));
    if (!styleResponse.ok) throw new Error('固定卡通风格参考图读取失败');
    const styleFile = new File(
      [await styleResponse.arrayBuffer()],
      'gray-cat-idle-style-v1.png',
      { type: 'image/png' },
    );
    const [styleUpload, userUpload] = await Promise.all([
      uploadPetPhoto(styleFile, 'pet-avatar/styles', true),
      uploadPetPhoto(safeFile, `pet-avatar/${id}`),
    ]);
    const workflow = createPetAvatarWorkflow(id, toComfyPath(styleUpload), toComfyPath(userUpload));
    const promptId = await submitWorkflow(workflow);

    reservedJob.promptId = promptId;
    reservedJob.status = 'queued';
    saveJob(reservedJob);

    return Response.json({ status: 'queued', jobId: id, pollAfterMs: 2000 }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '卡通母版生成失败，请稍后重试';
    const serviceError = message.includes('服务') || message.includes('OneThingAI') || message.includes('授权');
    if (reservedJob) {
      reservedJob.status = 'failed';
      reservedJob.message = message;
      saveJob(reservedJob);
      return Response.json(
        { status: 'failed', jobId: reservedJob.id, message },
        { status: serviceError ? 503 : 400 },
      );
    }
    return errorResponse(message, serviceError ? 503 : 400);
  }
}
