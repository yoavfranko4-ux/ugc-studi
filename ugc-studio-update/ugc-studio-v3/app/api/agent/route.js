import { NextResponse } from 'next/server';

const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Poll fal.ai queue until done
async function pollFal(requestId, maxWait = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal.run/fal-ai/nano-banana-2/edit/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`https://queue.fal.run/fal-ai/nano-banana-2/edit/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error('Fal job failed');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout');
}

async function pollKling(requestId, maxWait = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal.run/fal-ai/kling-video/v1.6/pro/image-to-video/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`https://queue.fal.run/fal-ai/kling-video/v1.6/pro/image-to-video/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error('Kling job failed');
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Timeout');
}

// Upload image buffer to fal storage
async function uploadToFal(url) {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const base64 = url.split(',')[1];
    const mime = url.split(';')[0].split(':')[1];
    const buffer = Buffer.from(base64, 'base64');
    const form = new FormData();
    const blob = new Blob([buffer], { type: mime });
    form.append('file', blob, 'image.jpg');
    const res = await fetch('https://fal.run/fal-ai/storage/upload', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}` },
      body: form
    });
    const data = await res.json();
    return data.url;
  }
  return url;
}

// Generate Nano Banana frame
async function generateNBFrame(prompt, imageUrls) {
  const validUrls = imageUrls.filter(Boolean);
  if (validUrls.length === 0) {
    // text-to-image fallback
    const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, image_size: 'portrait_4_3' })
    });
    const { request_id } = await res.json();
    const result = await pollFalText(request_id);
    return result?.images?.[0]?.url || null;
  }
  const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_urls: validUrls })
  });
  const { request_id } = await res.json();
  const result = await pollFal(request_id);
  return result?.images?.[0]?.url || null;
}

async function pollFalText(requestId, maxWait = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(`https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${FAL_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') {
      const result = await fetch(`https://queue.fal.run/fal-ai/nano-banana-2/requests/${requestId}`, {
        headers: { Authorization: `Key ${FAL_KEY}` }
      });
      return await result.json();
    }
    if (data.status === 'FAILED') throw new Error('Failed');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout');
}

// Generate Kling video from image
async function generateKlingVideo(imageUrl, prompt) {
  const res = await fetch('https://queue.fal.run/fal-ai/kling-video/v1.6/pro/image-to-video', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      prompt,
      duration: '5',
      aspect_ratio: '9:16'
    })
  });
  const { request_id } = await res.json();
  const result = await pollKling(request_id);
  return result?.video?.url || null;
}

// Claude writes the full script
async function generateScript(productName, productDesc, applicationArea) {
  if (!ANTHROPIC_KEY) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are a UGC ad expert. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}

Return ONLY valid JSON (no markdown):
{
  "voiceover": "Hebrew monologue 20 seconds natural speaking style mentioning ${productName} specifically",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "woman frustrated overwhelmed in bathroom mirror stressed expression, morning natural light iPhone selfie vertical, do not change person appearance from reference",
      "kling_prompt": "Person sighs looks at mirror frustrated shakes head overwhelmed, slight camera shake handheld iPhone natural light then settles",
      "subtitle": "Hebrew subtitle max 6 words"
    },
    {
      "type": "גילוי",
      "nb_prompt": "same person from reference photo discovers ${productName} holds it label facing camera curious smile, bathroom natural light iPhone vertical, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person picks up product reads label eyes widen holds toward camera, handheld natural light",
      "subtitle": "Hebrew subtitle max 6 words"
    },
    {
      "type": "שימוש",
      "nb_prompt": "same person from reference photo ${applicationArea} showing product application clearly, genuine amazed expression, bathroom natural light, maintain exact facial features from reference",
      "kling_prompt": "Continuing from previous scene same person actively ${applicationArea} showing process close up, genuine reaction, handheld iPhone",
      "subtitle": "Hebrew subtitle max 6 words"
    },
    {
      "type": "CTA",
      "nb_prompt": "same person from reference photo holds ${productName} product confidently points at camera big smile satisfied result, bathroom natural light, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person holds product points directly at camera thumbs up excited authentic energy then settles",
      "subtitle": "Hebrew subtitle max 6 words"
    }
  ]
}`
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch { return null; }
}

export async function POST(req) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const send = async (data) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  const { productName, productDesc, applicationArea, avatarUrl, productImageUrl } = await req.json();

  console.log('Agent started:', { productName, hasAvatar: !!avatarUrl, hasProduct: !!productImageUrl });

  // Run agent in background
  (async () => {
    try {
      // Step 1: Upload images
      await send({ step: 'upload', progress: 5, message: '📤 מעלה תמונות...' });
      const [uploadedAvatar, uploadedProduct] = await Promise.all([
        uploadToFal(avatarUrl).catch(() => null),
        uploadToFal(productImageUrl).catch(() => null)
      ]);
      console.log('Uploads done:', { hasAvatar: !!uploadedAvatar, hasProduct: !!uploadedProduct });

      // Step 2: Generate script
      await send({ step: 'script', progress: 10, message: '✍️ Claude כותב סקריפט...' });
      const script = await generateScript(productName, productDesc, applicationArea);
      const scenes = script?.scenes || getDefaultScenes(productName, applicationArea);
      const voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea);
      await send({ step: 'script_done', progress: 15, message: '✅ סקריפט מוכן!', scenes, voiceover });

      // Step 3: Voiceover FIRST
      await send({ step: 'voice', progress: 18, message: '🎙️ יוצר קריינות עברית V3...' });
      let audioBase64 = null;
      let audioUrl = null;
      try {
        const voiceRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}`, {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVEN_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: voiceover,
            model_id: 'eleven_v3',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
          })
        });
        if (voiceRes.ok) {
          const audioBuffer = await voiceRes.arrayBuffer();
          audioBase64 = Buffer.from(audioBuffer).toString('base64');
          await send({ step: 'voice_done', progress: 22, message: '✅ קריינות מוכנה!', audioBase64 });
          console.log('ElevenLabs V3: success!');
        } else {
          const err = await voiceRes.text();
          console.error('ElevenLabs failed:', err);
          await send({ step: 'voice_fail', progress: 22, message: '⚠️ קריינות נכשלה — ממשיך בלי קול' });
        }
      } catch (e) {
        console.error('Voice error:', e.message);
        await send({ step: 'voice_fail', progress: 22, message: '⚠️ קריינות נכשלה' });
      }

      // Step 4: Generate 4 NB frames sequentially
      const frameUrls = [];
      const frameProgresses = [25, 38, 51, 64];
      let prevFrame = uploadedAvatar;

      for (let i = 0; i < 4; i++) {
        await send({
          step: `nb_${i+1}`,
          progress: frameProgresses[i],
          message: `🎨 Nano Banana — סצנה ${i+1}/4 (${scenes[i].type})...`
        });
        try {
          const imageUrls = [];
          if (uploadedAvatar) imageUrls.push(uploadedAvatar);
          if (prevFrame && prevFrame !== uploadedAvatar) imageUrls.push(prevFrame);
          if (uploadedProduct) imageUrls.push(uploadedProduct);

          const frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls);
          frameUrls.push(frameUrl);
          prevFrame = frameUrl || prevFrame;
          await send({
            step: `nb_${i+1}_done`,
            progress: frameProgresses[i] + 5,
            message: `✅ פריים ${i+1} מוכן!`,
            frameUrl,
            frameIndex: i
          });
          console.log(`NB frame ${i+1}: ${frameUrl ? 'OK' : 'FAIL'}`);
        } catch (e) {
          console.error(`NB frame ${i+1} failed:`, e.message);
          frameUrls.push(null);
          await send({
            step: `nb_${i+1}_fail`,
            progress: frameProgresses[i] + 5,
            message: `❌ פריים ${i+1} נכשל`,
            frameIndex: i
          });
        }
      }

      // Step 5: Generate 4 Kling videos sequentially
      const videoUrls = [];
      const videoProgresses = [70, 78, 86, 93];

      for (let i = 0; i < 4; i++) {
        if (!frameUrls[i]) {
          videoUrls.push(null);
          await send({
            step: `kling_${i+1}_skip`,
            progress: videoProgresses[i],
            message: `⏭️ סצנה ${i+1} — אין פריים, מדלג`
          });
          continue;
        }
        await send({
          step: `kling_${i+1}`,
          progress: videoProgresses[i],
          message: `🎬 Kling — מייצר סרטון ${i+1}/4 (${scenes[i].type})...`
        });
        try {
          const videoUrl = await generateKlingVideo(frameUrls[i], scenes[i].kling_prompt);
          videoUrls.push(videoUrl);
          await send({
            step: `kling_${i+1}_done`,
            progress: videoProgresses[i] + 5,
            message: `✅ סרטון ${i+1} מוכן!`,
            videoUrl,
            videoIndex: i
          });
          console.log(`Kling ${i+1}: ${videoUrl ? 'OK' : 'FAIL'}`);
        } catch (e) {
          console.error(`Kling ${i+1} failed:`, e.message);
          videoUrls.push(null);
          await send({
            step: `kling_${i+1}_fail`,
            progress: videoProgresses[i] + 5,
            message: `❌ סרטון ${i+1} נכשל`
          });
        }
      }

      // Done!
      await send({
        step: 'done',
        progress: 100,
        message: '🎉 הכל מוכן!',
        result: {
          scenes,
          voiceover,
          audioBase64,
          frameUrls,
          videoUrls
        }
      });

    } catch (e) {
      console.error('Agent error:', e.message);
      await send({ step: 'error', message: `שגיאה: ${e.message}` });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

function getDefaultVoiceover(productName, applicationArea) {
  return `אתם לא מאמינים כמה זמן בזבזתי על הבעיה הזאת. ניסיתי הכל ושום דבר לא עבד. עד שמישהו המליץ לי על ${productName}. התחלתי להשתמש, ${applicationArea}, ולא האמנתי לתוצאות. שבוע אחד ואני לגמרי מרוצה. ואם אתם מסתפקים, תדעו גם אתם שייש אחריות מלאה. אין לכם מה להפסיד. פשוט תנסו את ${productName}.`;
}

function getDefaultScenes(productName, applicationArea) {
  return [
    {
      type: 'כאב',
      nb_prompt: 'woman frustrated overwhelmed in bathroom mirror stressed expression hand on forehead, morning natural light iPhone selfie vertical, do not change person appearance from reference',
      kling_prompt: 'Person sighs looks at mirror frustrated shakes head overwhelmed, slight camera shake handheld iPhone natural light then settles',
      subtitle: 'כל כך נמאס לי מהבעיה הזאת'
    },
    {
      type: 'גילוי',
      nb_prompt: `same person from reference photo discovers ${productName} holds it label facing camera curious smile, bathroom natural light iPhone vertical, maintain exact facial features`,
      kling_prompt: `Continuing from previous scene same person picks up ${productName} reads label eyes widen holds toward camera, handheld natural light`,
      subtitle: `מצאתי את ${productName} ולא האמנתי`
    },
    {
      type: 'שימוש',
      nb_prompt: `same person from reference photo ${applicationArea} showing product application clearly, genuine amazed expression, bathroom natural light, maintain exact facial features from reference`,
      kling_prompt: `Continuing from previous scene same person actively ${applicationArea} showing process close up, genuine reaction, handheld iPhone`,
      subtitle: 'שבוע אחד ולא האמנתי לתוצאות'
    },
    {
      type: 'CTA',
      nb_prompt: `same person from reference photo holds ${productName} product confidently points at camera big smile satisfied result, bathroom natural light, maintain exact facial features`,
      kling_prompt: 'Continuing from previous scene same person holds product points directly at camera thumbs up excited authentic energy then settles',
      subtitle: 'תנסו — יש אחריות מלאה!'
    }
  ];
}
