import { fal } from '@fal-ai/client'

export const maxDuration = 300; // 5 minutes

fal.config({ credentials: process.env.FAL_API_KEY });

export async function POST(req) {
  console.log('[Memory:kling]', JSON.stringify(process.memoryUsage()));
  const { imageUrl, prompt, sceneIndex, duration } = await req.json();
  const klingDuration = duration === '10' ? '10' : '5';
  console.log(`Kling scene ${sceneIndex}: starting, duration=${klingDuration}s`);
  console.log(`[Kling Scene ${sceneIndex}] FINAL prompt length: ${prompt?.length ?? 0}`);
  if ((prompt?.length ?? 0) > 2500) {
    console.error(`[Kling Scene ${sceneIndex}] ⚠️ STILL TOO LONG: ${prompt.length}`);
  }
  try {
    const result = await fal.subscribe('fal-ai/kling-video/v3/pro/image-to-video', {
      input: {
        image_url: imageUrl,
        prompt,
        duration: klingDuration,
        aspect_ratio: '9:16',
        // Lower cfg_scale → freer, more organic motion (less mechanical following of prompt)
        cfg_scale: 0.45,
        // Prevent cinematic/ad look — force amateur handheld feel
        negative_prompt: 'cinematic camera, smooth stabilizer, studio lighting, professional production, advertisement look, CGI, drone shot, dolly zoom, commercial quality, artificial lighting, color grading, lens flare, rack focus'
      },
      pollInterval: 5000
    });
    const videoUrl = result.data.video?.url || null;
    console.log(`Kling ${sceneIndex}: ${videoUrl ? 'OK' : 'FAIL'}`);
    return Response.json({ videoUrl, sceneIndex });
  } catch (e) {
    console.error(`Kling ${sceneIndex} failed:`, e.message);
    return Response.json({ videoUrl: null, sceneIndex, error: e.message });
  }
}
