const FAL_KEY = process.env.FAL_API_KEY;

// Parse JSON safely — log raw text so we can debug empty/HTML responses
async function parseJson(res, label) {
  const text = await res.text();
  if (!text || !text.trim()) throw new Error(`${label}: empty response (HTTP ${res.status})`);
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}: non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`); }
}

async function pollFal(requestId, endpoint, maxWait = 300000) {
  const base = `https://queue.fal.run/${endpoint}`;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const statusRes = await fetch(`${base}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await parseJson(statusRes, `${endpoint} status`);
    if (data.status === 'COMPLETED') {
      const resultRes = await fetch(`${base}/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await parseJson(resultRes, `${endpoint} result`);
    }
    if (data.status === 'FAILED') throw new Error(`${endpoint} job failed: ${JSON.stringify(data)}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error(`Timeout waiting for ${endpoint}`);
}

async function falMergeVideos(videoUrls) {
  const endpoint = 'fal-ai/ffmpeg-api/merge-videos';
  console.log('merge-videos submit, urls:', videoUrls.length);
  const res = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_urls: videoUrls })
  });
  const json = await parseJson(res, 'merge-videos submit');
  console.log('merge-videos submit response:', JSON.stringify(json).slice(0, 200));

  // Some fal.ai endpoints respond synchronously (no queue)
  const directUrl = json.video?.url || json.output?.url || json.url;
  if (directUrl) { console.log('merge-videos: synchronous result', directUrl); return directUrl; }

  if (!json.request_id) throw new Error('merge-videos: no request_id and no direct url — ' + JSON.stringify(json));
  const result = await pollFal(json.request_id, endpoint);
  const url = result?.video?.url || result?.output?.url || result?.url;
  if (!url) throw new Error('merge-videos: no URL in poll result — ' + JSON.stringify(result));
  return url;
}

async function falMergeAudioVideo(videoUrl, audioUrl) {
  const endpoint = 'fal-ai/ffmpeg-api/merge-audio-video';
  console.log('merge-audio-video submit');
  const res = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl })
  });
  const json = await parseJson(res, 'merge-audio-video submit');
  console.log('merge-audio-video submit response:', JSON.stringify(json).slice(0, 200));

  const directUrl = json.video?.url || json.output?.url || json.url;
  if (directUrl) { console.log('merge-audio-video: synchronous result', directUrl); return directUrl; }

  if (!json.request_id) throw new Error('merge-audio-video: no request_id and no direct url — ' + JSON.stringify(json));
  const result = await pollFal(json.request_id, endpoint);
  const url = result?.video?.url || result?.output?.url || result?.url;
  if (!url) throw new Error('merge-audio-video: no URL in poll result — ' + JSON.stringify(result));
  return url;
}

export async function POST(req) {
  const { videoUrls, audioUrl } = await req.json();

  try {
    const validUrls = videoUrls.filter(Boolean);
    if (validUrls.length === 0) return Response.json({ error: 'No videos' }, { status: 400 });

    // 1. Merge all clips
    let finalUrl;
    if (validUrls.length === 1) {
      finalUrl = validUrls[0];
    } else {
      console.log(`Merging ${validUrls.length} videos via fal.ai...`);
      finalUrl = await falMergeVideos(validUrls);
    }

    // 2. Lay audio over video
    if (audioUrl) {
      console.log('Adding audio via fal.ai...');
      finalUrl = await falMergeAudioVideo(finalUrl, audioUrl);
    }

    console.log('Export done. Final URL:', finalUrl);
    return Response.json({ videoUrl: finalUrl });

  } catch (e) {
    console.error('Export error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
