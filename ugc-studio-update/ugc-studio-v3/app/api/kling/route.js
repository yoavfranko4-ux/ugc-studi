const FAL_KEY = process.env.FAL_API_KEY;

async function pollKling(requestId, maxWait = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal-ai/kling-video/v3/pro/image-to-video/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`https://queue.fal-ai/kling-video/v3/pro/image-to-video/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error('Kling job failed');
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Timeout');
}

export async function POST(req) {
  const { imageUrl, prompt, sceneIndex } = await req.json();
  console.log(`Kling scene ${sceneIndex}: starting`);

  try {
    const res = await fetch('https://queue.fal-ai/kling-video/v3/pro/image-to-video', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, prompt, duration: '5', aspect_ratio: '9:16' })
    });
    const json = await res.json();
    console.log(`Kling ${sceneIndex} submit:`, JSON.stringify(json).slice(0, 150));
    if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));

    const result = await pollKling(json.request_id);
    const videoUrl = result?.video?.url || null;
    console.log(`Kling ${sceneIndex}: ${videoUrl ? 'OK' : 'FAIL'}`);
    return Response.json({ videoUrl, sceneIndex });
  } catch (e) {
    console.error(`Kling ${sceneIndex} failed:`, e.message);
    return Response.json({ videoUrl: null, sceneIndex, error: e.message });
  }
}
