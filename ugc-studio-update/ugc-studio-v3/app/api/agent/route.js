const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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
  console.log(`NB: ${validUrls.length} images`);
  const enhancedPrompt = `${prompt}, kinetic dynamic authentic UGC realism, subtle digital noise, natural softness, imperfect slightly overexposed like real phone footage`;

  if (validUrls.length === 0) {
    const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2', {
      method: 'POST',
      headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: enhancedPrompt, image_size: 'portrait_4_3' })
    });
    const json = await res.json();
    if (!json.request_id) throw new Error('No request_id: ' + JSON.stringify(json));
    const result = await pollFal(json.request_id);
    return result?.images?.[0]?.url || null;
  }
  const res = await fetch('https://queue.fal.run/fal-ai/nano-banana-2/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: enhancedPrompt, image_urls: validUrls })
  });
  const json = await res.json();
  console.log('NB submit:', JSON.stringify(json).slice(0, 150));
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
      body: JSON.stringify({
        text,
        model_id: 'eleven_v3',
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true }
      })
    });
    if (!res.ok) { console.error('ElevenLabs failed:', await res.text()); return null; }
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (e) { console.error('Voice error:', e.message); return null; }
}

async function generateScript(productName, productDesc, applicationArea, storyDescription) {
  if (!ANTHROPIC_KEY) return null;
  const storyContext = storyDescription ? `\nStory/events the client wants: ${storyDescription}` : '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 2000,
      messages: [{ role: 'user', content: `You are a UGC ad expert. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}${storyContext}

CRITICAL RULES:
1. Voiceover: 4 parts ~13 Hebrew words each, natural conversational tone.
2. Each scene subtitle = exact voiceover text.
3. Scene 3 nb_prompt: ONE single photo, NOT collage/grid/split screen. Show the person DOING the action naturally — not holding the product box/packaging. Describe the physical action with hands (e.g. "applying strip to teeth with fingers" not "holding box").
4. For scenes 2 and 4 nb_prompt: person interacts naturally with the product IN USE — not posing with packaging. The product should appear naturally in the scene, not "held label facing camera like a commercial". Think authentic UGC.
5. Kling prompts: natural head movements, micro-expressions, "lifting her head", "shifting weight", "camera wobbles slightly", "no cinematic exaggeration".
6. STORY INTEGRATION: If story provided, change ALL settings/actions to match it completely.

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "Hebrew ~13 words frustrated natural tone",
  "voiceover_scene2": "Hebrew ~13 words mentions ${productName}",
  "voiceover_scene3": "Hebrew ~13 words describes the action/feeling",
  "voiceover_scene4": "Hebrew ~13 words CTA urgency",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "woman frustrated overwhelmed in bathroom mirror stressed expression hand on forehead, morning natural light iPhone selfie vertical, single frame photo, kinetic dynamic, do not change person appearance from reference",
      "kling_prompt": "Person lifting her head sighing frustrated looking at mirror, shifting weight slightly forward, camera wobbles slightly in sync with movement, micro-expressions visible, handheld iPhone natural light, then settles — no cinematic exaggeration",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "גילוי",
      "nb_prompt": "same person from reference photo in bathroom, just discovered ${productName}, holding the product naturally in hand with genuine curious expression — product appears naturally NOT posed like commercial, single frame photo, kinetic dynamic, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person picks up product curiously, turning it over in hands naturally, eyes wide with interest, shifting weight, head tilting slightly, camera micro-shake authentic, no cinematic exaggeration",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "שימוש",
      "nb_prompt": "same person from reference photo actively performing ${applicationArea} — show hands doing the PHYSICAL ACTION naturally close up, product integrated into the action naturally NOT as a prop, single frame photo not collage not grid, genuine focused expression natural light, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person performs ${applicationArea} with focused concentration, hands clearly visible doing the action step by step, genuine tactile reaction to feel/texture, no talking, authentic handheld iPhone slight movement",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "CTA",
      "nb_prompt": "same person from reference photo in bathroom, genuinely happy smiling result — person pointing to camera or smiling naturally at result, product naturally visible in scene NOT posed commercially, single frame photo, kinetic dynamic, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person shows genuine happy result, natural smile, pointing casually at camera or showing result area, shifting weight forward enthusiastically, head nodding naturally, handheld wobble, no cinematic exaggeration",
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
  console.log('Agent started:', { productName, hasAvatar: !!avatarUrl, hasProduct: !!productImageUrl });

  (async () => {
    try {
      await send({ step: 'upload', progress: 5, message: '📤 מכין תמונות...' });
      const preparedAvatar = avatarUrl || null;
      const preparedProduct = productImageUrl || null;
      await send({ step: 'upload_done', progress: 8, message: '✅ תמונות מוכנות!' });

      await send({ step: 'script', progress: 10, message: '✍️ Claude כותב סקריפט...' });
      const script = await generateScript(productName, productDesc, applicationArea, storyDescription);
      const scenes = script?.scenes || getDefaultScenes(productName, applicationArea);
      const voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea);
      await send({ step: 'script_done', progress: 15, message: '✅ סקריפט מוכן!', scenes, voiceover });

      // Generate full voiceover only
      await send({ step: 'voice', progress: 18, message: '🎙️ יוצר קריינות V3...' });
      const fullAudioBase64 = await generateVoice(voiceover);
      if (fullAudioBase64) {
        await send({ step: 'voice_done', progress: 22, message: '✅ קריינות מוכנה!', audioBase64: fullAudioBase64 });
      } else {
        await send({ step: 'voice_fail', progress: 22, message: '⚠️ קריינות נכשלה' });
      }

      // NB frames
      const frameUrls = [];
      const frameProgresses = [25, 38, 51, 64];
      let prevFrame = null;
      for (let i = 0; i < 4; i++) {
        await send({ step: `nb_${i+1}`, progress: frameProgresses[i], message: `🎨 Nano Banana — סצנה ${i+1}/4 (${scenes[i].type})...` });
        try {
          const imageUrls = [];
          if (preparedAvatar) imageUrls.push(preparedAvatar);
          if (prevFrame) imageUrls.push(prevFrame);
          // Only add product image for scenes 2 and 3 (discovery + usage)
          if (preparedProduct && (i === 1 || i === 2)) imageUrls.push(preparedProduct);
          const frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls);
          frameUrls.push(frameUrl);
          if (frameUrl) prevFrame = frameUrl;
          await send({ step: `nb_${i+1}_done`, progress: frameProgresses[i]+5, message: `✅ פריים ${i+1} מוכן!`, frameUrl, frameIndex: i });
          console.log(`NB frame ${i+1}: ${frameUrl ? 'OK' : 'FAIL'}`);
        } catch (e) {
          console.error(`NB frame ${i+1} failed:`, e.message);
          frameUrls.push(null);
          await send({ step: `nb_${i+1}_fail`, progress: frameProgresses[i]+5, message: `❌ פריים ${i+1} נכשל: ${e.message}`, frameIndex: i });
        }
      }

      await send({
        step: 'frames_done', progress: 70,
        message: '🎬 פריימים מוכנים! מתחיל Kling...',
        frameUrls, scenes, voiceover,
        audioBase64: fullAudioBase64,
        sceneAudios: [null, null, null, null],
        klingPrompts: scenes.map(s => s.kling_prompt)
      });

    } catch (e) {
      console.error('Agent error:', e.message);
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
  return `ממש נמאס לי. ניסיתי כל כך הרבה דברים ושום דבר לא עבד. עד שמישהו המליץ לי על ${productName} ולא האמנתי. ${applicationArea} — והתוצאות הפתיעו אותי. תנסו את ${productName} יש אחריות מלאה!`;
}

function getDefaultScenes(productName, applicationArea) {
  return [
    {
      type: 'כאב',
      nb_prompt: 'woman frustrated overwhelmed in bathroom mirror stressed expression hand on forehead, morning natural light iPhone selfie vertical, single frame photo, kinetic dynamic, do not change person appearance from reference',
      kling_prompt: 'Person lifting her head sighing frustrated looking at mirror, shifting weight slightly forward, camera wobbles slightly in sync with movement, micro-expressions visible, handheld iPhone natural light, then settles — no cinematic exaggeration',
      subtitle: 'ממש נמאס לי. ניסיתי הכל ושום דבר לא עבד.'
    },
    {
      type: 'גילוי',
      nb_prompt: `same person from reference photo in bathroom, just discovered ${productName}, holding the product naturally with genuine curious expression — product appears naturally NOT posed like commercial, single frame photo, kinetic dynamic, maintain exact facial features`,
      kling_prompt: `Continuing from previous scene same person picks up ${productName} curiously, turning it over in hands naturally, eyes wide with interest, shifting weight, head tilting slightly, camera micro-shake authentic, no cinematic exaggeration`,
      subtitle: `עד שמישהו המליץ לי על ${productName} ולא האמנתי שזה יעזור.`
    },
    {
      type: 'שימוש',
      nb_prompt: `same person from reference photo performing ${applicationArea} — hands doing the PHYSICAL ACTION naturally close up, product integrated naturally NOT as a prop, single frame photo not collage not grid, genuine focused expression, maintain exact facial features`,
      kling_prompt: `Continuing from previous scene same person performs ${applicationArea} with focused concentration, hands clearly visible doing the action, genuine tactile reaction, no talking, authentic handheld iPhone slight movement`,
      subtitle: `${applicationArea} — והתוצאות הפתיעו אותי.`
    },
    {
      type: 'CTA',
      nb_prompt: `same person from reference photo genuinely happy smiling at result in bathroom mirror, product naturally visible in scene, pointing casually at camera, single frame photo, kinetic dynamic, maintain exact facial features`,
      kling_prompt: 'Continuing from previous scene same person shows genuine happy satisfied result, natural smile, pointing casually at camera, shifting weight forward enthusiastically, head nodding naturally, handheld wobble, no cinematic exaggeration',
      subtitle: `תנסו את ${productName} — יש אחריות מלאה!`
    }
  ];
}
