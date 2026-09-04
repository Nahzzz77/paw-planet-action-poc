import type { ComfyApiWorkflow, ComfyImageOutput, ComfyPromptResult, ComfyUploadResult } from './types';

function getBaseUrl() {
  const value = process.env.COMFY_BASE_URL?.trim();
  if (!value) throw new Error('真实 AI 生成服务还没有连接');
  return value.endsWith('/') ? value : `${value}/`;
}

async function comfyFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const cookie = process.env.COMFY_AUTH_COOKIE?.trim();
  if (cookie) headers.set('Cookie', cookie);

  const response = await fetch(new URL(path.replace(/^\//, ''), getBaseUrl()), {
    ...init,
    headers,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: { message?: string } | string; message?: string };
      detail = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? '';
    } catch {
      detail = '';
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('AI 生成服务授权已失效，请重新连接 OneThingAI');
    }
    throw new Error(detail || `AI 生成服务返回了 ${response.status}`);
  }
  return response;
}

export async function uploadPetPhoto(file: File, subfolder: string, overwrite = false) {
  const form = new FormData();
  form.append('image', file, file.name);
  form.append('type', 'input');
  form.append('subfolder', subfolder);
  form.append('overwrite', overwrite ? 'true' : 'false');
  const response = await comfyFetch('/upload/image', { method: 'POST', body: form });
  return response.json() as Promise<ComfyUploadResult>;
}

export async function submitWorkflow(workflow: ComfyApiWorkflow) {
  const response = await comfyFetch('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
  });
  const result = await response.json() as ComfyPromptResult;
  if (!result.prompt_id) {
    throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'AI 任务没有成功进入队列');
  }
  return result.prompt_id;
}

export async function getWorkflowHistory(promptId: string) {
  const response = await comfyFetch(`/history/${encodeURIComponent(promptId)}`);
  return response.json() as Promise<Record<string, {
    outputs?: Record<string, { images?: ComfyImageOutput[] }>;
    status?: { completed?: boolean; status_str?: string; messages?: unknown[] };
  }>>;
}

export async function fetchComfyImage(image: ComfyImageOutput) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  return comfyFetch(`/view?${params.toString()}`);
}
