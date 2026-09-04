import { fetchComfyImage } from '@/lib/comfy/client';
import { getJob } from '@/lib/pet-avatar-jobs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getJob(jobId);
  if (!job?.output) return Response.json({ message: '图片不存在或已经过期' }, { status: 404 });

  try {
    const upstream = await fetchComfyImage({
      filename: job.output.filename,
      subfolder: job.output.subfolder,
      type: job.output.type,
    });
    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('content-type') || 'image/png');
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法读取生成图片';
    return Response.json({ message }, { status: 503 });
  }
}
