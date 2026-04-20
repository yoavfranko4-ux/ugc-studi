export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req) {
  console.log('[Memory:proxy]', JSON.stringify(process.memoryUsage()));
  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) return new Response('Missing url', { status: 400 });

  // Forward Range header from client — critical for video seeking / scrubbing.
  const rangeHeader = req.headers.get('range');

  try {
    const upstreamHeaders = {};
    if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

    const res = await fetch(videoUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok && res.status !== 206) {
      return new Response('Failed to fetch video: ' + res.status, { status: 502 });
    }

    // Stream the body through — do NOT buffer with arrayBuffer().
    // Buffering holds 10-30MB per request in RAM and causes OOM on Railway.
    const outHeaders = {
      'Content-Type': res.headers.get('content-type') || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    };

    const contentLength = res.headers.get('content-length');
    if (contentLength) outHeaders['Content-Length'] = contentLength;

    const contentRange = res.headers.get('content-range');
    if (contentRange) outHeaders['Content-Range'] = contentRange;

    return new Response(res.body, {
      status: res.status, // forward 200 or 206 Partial Content
      headers: outHeaders,
    });
  } catch (e) {
    const isTimeout = e?.name === 'TimeoutError' || /timeout/i.test(e?.message || '');
    if (isTimeout) {
      return new Response('Upstream timeout after 30s', { status: 504 });
    }
    return new Response('Error: ' + e.message, { status: 500 });
  }
}
