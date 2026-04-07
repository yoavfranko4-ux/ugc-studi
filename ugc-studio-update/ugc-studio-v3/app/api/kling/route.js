const FAL_KEY = process.env.FAL_API_KEY;

// Scenes that use lipsync (1, 2, 4) vs regular motion (3)
const LIPSYNC_SCENES = [0, 1, 3]; // indices

async function pollKling(requestId, maxWait = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`https://queue.fal.run/fal-ai/kling-video/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error('Kling job failed');
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Timeout');
}

// Upload audio buffer to fal storage and get public URL
async function uploadAudioToFal(audioBase64) {
  if (!audioBase64) return null;
  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const res = await fetch('https://fal.run/storage/upload', {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': 'audio/mpeg',
      },
      body: buffer
    });
    const data = await res.json();
    console.log('Audio upload result:', JSON.stringify(data).slice(0, 200));
    return data.url || data.file_url || null;
  } catch (e) {
    console.error('Audio upload failed:', e.message);
    return null;
  }
}

// Kling lipsync - image + audio -> talking video
async function klingLipsync(imageUrl, audioUrl, prompt) {
  const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/pro/lipsync', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      audio_url: audioUrl,
      prompt,
      aspect_ratio: '9:16',
      duration: '5'
    })
  });
  const json = await res.json();
  console.log('Kling lipsync submit:', JSON.stringify(json).slice(0, 200));
  if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));
  const result = await pollKling(json.request_id);
  return result?.video?.url || null;
}

// Kling regular image-to-video
async function klingVideo(imageUrl, prompt) {
  const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      prompt,
      duration: '5',
      aspect_ratio: '9:16'
    })
  });
  const json = await res.json();
  console.log('Kling video submit:', JSON.stringify(json).slice(0, 200));
  if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));
  const result = await pollKling(json.request_id);
  return result?.video?.url || null;
}

export async function POST(req) {
  const { imageUrl, prompt, sceneIndex, audioBase64 } = await req.json();
  console.log(`Kling scene ${sceneIndex}: starting, hasAudio: ${!!audioBase64}, useLipsync: ${LIPSYNC_SCENES.includes(sceneIndex)}`);

  try {
    let videoUrl = null;

    // Scenes 1, 2, 4 → lipsync with voiceover
    if (LIPSYNC_SCENES.includes(sceneIndex) && audioBase64) {
      console.log(`Scene ${sceneIndex}: uploading audio for lipsync...`);
      const audioUrl = await uploadAudioToFal(audioBase64);

      if (audioUrl) {
        console.log(`Scene ${sceneIndex}: starting lipsync with audio URL`);
        // Lipsync prompt - focus on natural mouth movement and head motion
        const lipsyncPrompt = `${prompt} The person is speaking naturally and conversationally to camera, realistic lip sync with natural head movements, authentic UGC style, handheld iPhone vertical 9:16`;
        videoUrl = await klingLipsync(imageUrl, audioUrl, lipsyncPrompt);
      } else {
        console.log(`Scene ${sceneIndex}: audio upload failed, falling back to regular video`);
        videoUrl = await klingVideo(imageUrl, prompt);
      }
    } else {
      // Scene 3 → regular video, no talking, just action
      console.log(`Scene ${sceneIndex}: regular video (no lipsync)`);
      videoUrl = await klingVideo(imageUrl, prompt);
    }

    console.log(`Kling ${sceneIndex}: ${videoUrl ? 'OK' : 'FAIL'}`);
    return Response.json({ videoUrl, sceneIndex });
  } catch (e) {
    console.error(`Kling ${sceneIndex} failed:`, e.message);
    return Response.json({ videoUrl: null, sceneIndex, error: e.message });
  }
}
