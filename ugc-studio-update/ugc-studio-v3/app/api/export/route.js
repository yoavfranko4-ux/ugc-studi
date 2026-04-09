const FAL_KEY = process.env.FAL_API_KEY;

async function pollFal(requestId, endpoint, maxWait = 300000) {
  const base = `https://queue.fal.run/${endpoint}`;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`${base}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`${base}/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error(`fal job failed: ${JSON.stringify(data)}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout waiting for fal.ai FFmpeg');
}

async function falMergeVideos(videoUrls) {
  const endpoint = 'fal-ai/ffmpeg-api/merge-videos';
  console.log('merge-videos:', videoUrls);
  const res = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_urls: videoUrls })
  });
  const json = await res.json();
  if (!json.request_id) throw new Error('merge-videos: no request_id — ' + JSON.stringify(json));
  const result = await pollFal(json.request_id, endpoint);
  const url = result?.video?.url || result?.output?.url || result?.url;
  if (!url) throw new Error('merge-videos: no URL in result — ' + JSON.stringify(result));
  return url;
}

async function falMergeAudioVideo(videoUrl, audioUrl) {
  const endpoint = 'fal-ai/ffmpeg-api/merge-audio-video';
  console.log('merge-audio-video:', { videoUrl, audioUrl });
  const res = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl })
  });
  const json = await res.json();
  if (!json.request_id) throw new Error('merge-audio-video: no request_id — ' + JSON.stringify(json));
  const result = await pollFal(json.request_id, endpoint);
  const url = result?.video?.url || result?.output?.url || result?.url;
  if (!url) throw new Error('merge-audio-video: no URL in result — ' + JSON.stringify(result));
  return url;
}

export async function POST(req) {
  // videoUrls: array of public URLs (subtitles already burned client-side via Canvas API)
  // audioUrl:  public URL of mixed audio (voiceover + music, mixed client-side via Web Audio API)
  const { videoUrls, audioUrl } = await req.json();

  try {
    const validUrls = videoUrls.filter(Boolean);
    if (validUrls.length === 0) return Response.json({ error: 'No videos' }, { status: 400 });

    // 1. Merge all clips into one video
    let finalUrl;
    if (validUrls.length === 1) {
      finalUrl = validUrls[0];
    } else {
      console.log(`Merging ${validUrls.length} videos via fal.ai...`);
      finalUrl = await falMergeVideos(validUrls);
    }

    // 2. Lay audio track over video
    if (audioUrl) {
      console.log('Adding audio via fal.ai...');
      finalUrl = await falMergeAudioVideo(finalUrl, audioUrl);
    }

    console.log('Final video URL:', finalUrl);
    return Response.json({ videoUrl: finalUrl });

  } catch (e) {
    console.error('Export error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
