export const maxDuration = 300; // 5 minutes

const FAL_KEY = process.env.FAL_API_KEY;

async function pollSeedance(requestId, maxWait = 280000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal.run/bytedance/seedance-2.0/fast/image-to-video/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`https://queue.fal.run/bytedance/seedance-2.0/fast/image-to-video/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error('Seedance job failed: ' + JSON.stringify(data));
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Timeout');
}

export async function POST(req) {
  const { imageUrl, prompt, sceneIndex, duration } = await req.json();
  const seedanceDuration = duration === '10' ? '10' : '5';
  console.log(`Seedance scene ${sceneIndex}: starting, duration=${seedanceDuration}s`);
  try {
    const res = await fetch('https://queue.fal.run/bytedance/seedance-2.0/fast/image-to-video', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt,
        duration: seedanceDuration,
        aspect_ratio: '9:16'
      })
    });
    const json = await res.json();
    console.log(`Seedance ${sceneIndex} response (status=${res.status}):`, JSON.stringify(json));
    if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));
    const result = await pollSeedance(json.request_id);
    console.log(`Seedance ${sceneIndex} poll result:`, JSON.stringify(result).slice(0, 500));
    const videoUrl = result?.video?.url || null;
    console.log(`Seedance ${sceneIndex}: ${videoUrl ? 'OK' : 'FAIL'}`);
    return Response.json({ videoUrl, sceneIndex });
  } catch (e) {
    console.error(`Seedance ${sceneIndex} failed:`, e.message);
    return Response.json({ videoUrl: null, sceneIndex, error: e.message });
  }
}
