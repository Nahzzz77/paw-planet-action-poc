import { PET_ACTION_KEYS, type PetActionKey } from '@/lib/pet-action-branches';
import {
  fetchCoordinatedPetActionVideo,
  petActionCoordinatorConfig,
} from '@/lib/pet-action-coordinator';

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string; action: string }> },
) {
  const { batchId, action } = await context.params;
  if (!PET_ACTION_KEYS.includes(action as PetActionKey)) {
    return Response.json({ status: 'error', message: '动作类型不正确' }, { status: 404 });
  }
  try {
    const config = petActionCoordinatorConfig();
    if (!config) throw new Error('动作调度器当前没有连接');
    const upstream = await fetchCoordinatedPetActionVideo(
      config,
      batchId,
      action as PetActionKey,
    );
    const headers = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') || 'video/mp4',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const length = upstream.headers.get('Content-Length');
    if (length) headers.set('Content-Length', length);
    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return Response.json({
      status: 'error',
      message: error instanceof Error ? error.message : '动作视频暂时无法读取',
    }, { status: 502 });
  }
}
