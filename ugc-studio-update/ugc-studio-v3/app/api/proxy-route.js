export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get('url');
  
  if (!videoUrl) return new Response('Missing url', { status: 400 });
  
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) return new Response('Failed to fetch video', { status: 502 });
    
    const contentType = res.headers.get('content-type') || 'video/mp4';
    const buffer = await res.arrayBuffer();
    
    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      }
    });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}
