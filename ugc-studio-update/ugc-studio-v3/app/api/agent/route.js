const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Scene durations: 5, 5, 10, 5 = 25s total, voiceover = 24s
const SCENE_DURATIONS = [5, 5, 10, 5];

async function pollFal(requestId, maxWait = 300000) {
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
    if (data.status === 'FAILED') throw new Error('Fal job failed');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timeout');
}

async function generateNBFrame(prompt, imageUrls) {
  const validUrls = imageUrls.filter(Boolean);
  const enhancedPrompt = `${prompt}, kinetic dynamic authentic UGC realism, subtle digital noise, natural softness`;
  if (validUrls.length === 0) {
    const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2', {
      method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: enhancedPrompt, image_size: 'portrait_4_3' })
    });
    const json = await res.json();
    if (!json.request_id) throw new Error('No request_id');
    const result = await pollFal(json.request_id);
    return result?.images?.[0]?.url || null;
  }
  const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2/edit', {
    method: 'POST', headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: enhancedPrompt, image_urls: validUrls })
  });
  const json = await res.json();
  if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));
  const result = await pollFal(json.request_id);
  return result?.images?.[0]?.url || null;
}

async function generateVoice(text) {
  if (!ELEVEN_KEY || !text) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true } })
    });
    if (!res.ok) { console.error('ElevenLabs failed:', await res.text()); return null; }
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (e) { console.error('Voice error:', e.message); return null; }
}

async function generateScript(productName, productDesc, applicationArea, storyDescription) {
  if (!ANTHROPIC_KEY) return null;
  const storyContext = storyDescription ? `\nStory: ${storyDescription}` : '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 2000,
      messages: [{ role: 'user', content: `You are a UGC ad expert. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}${storyContext}

SCENE DURATIONS: Scene 1=5s, Scene 2=5s, Scene 3=10s, Scene 4=5s. Total=25s, voiceover=24s.

CRITICAL RULES:
1. Voiceover: 4 parts matching scene durations. Scene 1: ~10 Hebrew words (4.5s). Scene 2: ~10 Hebrew words (4.5s). Scene 3: ~20 Hebrew words (9s). Scene 4: ~10 Hebrew words (4.5s). Total voiceover = 24 seconds. Natural conversational tone.
2. Each subtitle = exact voiceover text for that scene.
3. NB prompts: describe person performing action naturally. Product appears naturally in scene — NOT posed commercially, NOT "holding label facing camera like an ad". Show the actual usage action.
4. Kling prompts: ALWAYS include "person holds product steadily, subtle natural breathing movement, slight head tilt, hand remains stable, no sudden position jumps or shape changes to product, smooth continuous authentic motion, handheld iPhone wobble, no cinematic exaggeration"
5. STORY INTEGRATION: If story provided, change ALL settings/actions to match it completely.

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "Hebrew ~10 words describing THE SPECIFIC PROBLEM this product solves — mention the actual pain (e.g. for teeth whitening: yellow teeth, embarrassed to smile; for acne cream: spots and breakouts; for sleep supplement: can't fall asleep). NOT generic 'I tried everything' — say WHAT the problem is.",
  "voiceover_scene2": "Hebrew ~10 words mentions ${productName}",
  "voiceover_scene3": "Hebrew ~20 words describes using product and feeling result",
  "voiceover_scene4": "Hebrew ~10 words CTA urgency",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "woman frustrated in bathroom mirror looking at SPECIFIC PROBLEM related to: ${productDesc}, stressed expression examining the problem area closely, morning natural light iPhone vertical, single frame photo, do not change person appearance from reference",
      "kling_prompt": "Person sighs frustrated looking at mirror, person holds product steadily subtle natural breathing movement slight head tilt hand remains stable no sudden position jumps smooth continuous authentic motion, handheld iPhone wobble no cinematic exaggeration",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "גילוי",
      "nb_prompt": "same person from reference just discovered ${productName}, holding product naturally with genuine curious expression — NOT posed like commercial, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person examines product with curiosity, person holds product steadily subtle natural breathing movement slight head tilt hand remains stable no sudden position jumps or shape changes to product smooth continuous authentic motion, camera micro-shake authentic no cinematic exaggeration",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "שימוש",
      "nb_prompt": "same person from reference actively performing ${applicationArea} — hands doing the PHYSICAL ACTION naturally close up, product integrated into the action NOT as a prop, single frame photo not collage, genuine focused expression, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person performs ${applicationArea} with focused concentration, person holds product steadily hand remains stable no sudden position jumps or shape changes to product smooth continuous motion, hands clearly visible doing action, no talking, authentic handheld iPhone gentle movement",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "CTA",
      "nb_prompt": "same person from reference genuinely happy with result smiling naturally at camera, product naturally visible in scene, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person shows genuine happy result natural smile, person holds product steadily hand remains stable no sudden position jumps smooth continuous authentic motion, pointing casually at camera shifting weight forward, handheld wobble no cinematic exaggeration",
      "subtitle": "same as voiceover_scene4"
    }
  ]
}` }]
    })
  });
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const v1 = parsed.voiceover_scene1 || '';
    const v2 = parsed.voiceover_scene2 || '';
    const v3 = parsed.voiceover_scene3 || '';
    const v4 = parsed.voiceover_scene4 || '';
    parsed.voiceover = `${v1} ${v2} ${v3} ${v4}`.trim();
    if (parsed.scenes) {
      parsed.scenes[0].subtitle = v1;
      parsed.scenes[1].subtitle = v2;
      parsed.scenes[2].subtitle = v3;
      parsed.scenes[3].subtitle = v4;
    }
    return parsed;
  } catch { return null; }
}

export async function POST(req) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const send = async (data) => {
    try { await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
  };

  const { productName, productDesc, applicationArea, storyDescription, avatarUrl, productImageUrl } = await req.json();

  (async () => {
    try {
      await send({ step: 'upload', progress: 5, message: '📤 מכין תמונות...' });
      const preparedAvatar = avatarUrl || null;
      const preparedProduct = productImageUrl || null;
      await send({ step: 'upload_done', progress: 8, message: '✅ מוכן!' });

      await send({ step: 'script', progress: 10, message: '✍️ כותב סקריפט 24s קריינות...' });
      const script = await generateScript(productName, productDesc, applicationArea, storyDescription);
      const scenes = script?.scenes || getDefaultScenes(productName, applicationArea, productDesc);
      const voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea);
      await send({ step: 'script_done', progress: 15, message: '✅ סקריפט מוכן!', scenes, voiceover });

      await send({ step: 'voice', progress: 18, message: '🎙️ יוצר קריינות 28s V3...' });
      const fullAudioBase64 = await generateVoice(voiceover);
      if (fullAudioBase64) {
        await send({ step: 'voice_done', progress: 22, message: '✅ קריינות מוכנה!', audioBase64: fullAudioBase64 });
      } else {
        await send({ step: 'voice_fail', progress: 22, message: '⚠️ קריינות נכשלה' });
      }

      const frameUrls = [];
      const frameProgresses = [25, 38, 51, 64];
      let prevFrame = null;
      for (let i = 0; i < 4; i++) {
        await send({ step: `nb_${i+1}`, progress: frameProgresses[i], message: `🎨 Nano Banana — סצנה ${i+1} (${SCENE_DURATIONS[i]}s)...` });
        try {
          const imageUrls = [];
          if (preparedAvatar) imageUrls.push(preparedAvatar);
          if (prevFrame) imageUrls.push(prevFrame);
          if (preparedProduct && (i === 1 || i === 2 || i === 3)) imageUrls.push(preparedProduct);
          const frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls);
          frameUrls.push(frameUrl);
          if (frameUrl) prevFrame = frameUrl;
          await send({ step: `nb_${i+1}_done`, progress: frameProgresses[i]+5, message: `✅ פריים ${i+1} מוכן!`, frameUrl, frameIndex: i });
        } catch (e) {
          frameUrls.push(null);
          await send({ step: `nb_${i+1}_fail`, progress: frameProgresses[i]+5, message: `❌ פריים ${i+1} נכשל`, frameIndex: i });
        }
      }

      await send({
        step: 'frames_done', progress: 70,
        message: '🎬 מתחיל Kling...',
        frameUrls, scenes, voiceover,
        audioBase64: fullAudioBase64,
        klingPrompts: scenes.map(s => s.kling_prompt)
      });

    } catch (e) {
      await send({ step: 'error', message: `שגיאה: ${e.message}` });
    } finally {
      try { await writer.close(); } catch {}
    }
  })();

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  });
}

function getDefaultVoiceover(productName, applicationArea) {
  return `ממש נמאס לי. ניסיתי הכל ושום דבר לא עבד. עד שמישהו המליץ לי על ${productName} ולא האמנתי שזה יעזור. התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי לגמרי. שבוע אחד ואני לגמרי מרוצה. תנסו את ${productName} יש אחריות מלאה!`;
}

const STABLE_MOTION = 'person holds product steadily, subtle natural breathing movement, slight head tilt, hand remains stable, no sudden position jumps or shape changes to product, smooth continuous authentic motion, handheld iPhone wobble, no cinematic exaggeration';

function getDefaultScenes(productName, applicationArea, productDesc) {
  return [
    { type: 'כאב', nb_prompt: `woman frustrated in bathroom mirror looking at specific problem: ${productDesc}, stressed expression examining problem area, morning natural light iPhone vertical, single frame photo, do not change person appearance from reference`, kling_prompt: `Person examines specific problem in mirror frustrated, ${STABLE_MOTION}`, subtitle: `שיניים צהובות ולא יכולה לחייך בתמונות.` },
    { type: 'גילוי', nb_prompt: `same person from reference just discovered ${productName}, holding product naturally genuine curious expression NOT posed like commercial, single frame photo, maintain exact facial features`, kling_prompt: `Continuing from previous scene same person examines ${productName} with curiosity, ${STABLE_MOTION}`, subtitle: `עד שמישהו המליץ לי על ${productName} ולא האמנתי שזה יעזור.` },
    { type: 'שימוש', nb_prompt: `same person from reference performing ${applicationArea} — hands doing PHYSICAL ACTION naturally, product integrated into action NOT as prop, single frame photo not collage, genuine focused expression, maintain exact facial features`, kling_prompt: `Continuing from previous scene same person performs ${applicationArea}, ${STABLE_MOTION}, hands clearly visible, no talking`, subtitle: `התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי.` },
    { type: 'CTA', nb_prompt: `same person from reference genuinely happy smiling naturally at camera, product naturally visible, single frame photo, maintain exact facial features`, kling_prompt: `Continuing from previous scene same person shows genuine happy result natural smile, ${STABLE_MOTION}, pointing casually at camera`, subtitle: `תנסו את ${productName} — יש אחריות מלאה!` }
  ];
}
