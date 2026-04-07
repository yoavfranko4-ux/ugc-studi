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

  // Build better prompt with kinetic/dynamic keywords
  const enhancedPrompt = `${prompt}, kinetic dynamic authentic UGC realism, subtle digital noise, natural softness`;

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

// Generate voiceover for a single scene text
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
1. Voiceover split into 4 parts — scenes 1, 2, 4 have spoken text (~12-14 Hebrew words each). Scene 3 has NO voiceover (person is demonstrating the product silently).
2. Each scene subtitle = exact voiceover text for that scene (scene 3 subtitle = short action description).
3. Scene 3 nb_prompt: ONE single realistic photo, NOT a collage, NOT a grid, NOT split screen.
4. Kling prompts for scenes 1,2,4: person is TALKING to camera — describe natural head movements, micro-expressions, lips moving, breathing. Use: "lifting her head", "shifting weight", "camera wobbles slightly in sync with movement", "realistic lip sync", "no cinematic exaggeration".
5. Kling prompt for scene 3: NO talking — person demonstrates product with hands, focused expression, no mouth movement.
6. STORY INTEGRATION: If story provided, change ALL settings/actions to match it completely.

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "Hebrew ~13 words, frustrated natural tone",
  "voiceover_scene2": "Hebrew ~13 words, mentions ${productName}",
  "voiceover_scene3": null,
  "voiceover_scene4": "Hebrew ~13 words, CTA urgency",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "woman frustrated overwhelmed in bathroom mirror stressed expression, morning natural light iPhone selfie vertical, single frame photo, kinetic dynamic, do not change person appearance from reference",
      "kling_prompt": "Person talking to camera frustrated, lifting her head sighing, shifting weight slightly, camera wobbles in sync with natural movement, realistic lip sync mouth moving naturally, micro-expressions visible, handheld iPhone natural light, no cinematic exaggeration",
      "subtitle": "exact voiceover_scene1 text"
    },
    {
      "type": "גילוי",
      "nb_prompt": "same person from reference photo discovers ${productName} holds it label facing camera curious smile, single frame photo, kinetic dynamic, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person talking to camera excitedly about product, holding it up, eyes wide naturally shifting gaze, head tilting slightly, lips moving conversationally, camera micro-shake authentic, no cinematic exaggeration",
      "subtitle": "exact voiceover_scene2 text"
    },
    {
      "type": "שימוש",
      "nb_prompt": "same person from reference photo actively ${applicationArea}, close up hands and action, single frame photo not collage not grid, genuine focused expression natural light, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person silently demonstrates ${applicationArea} with focused concentration, hands clearly visible performing action step by step, no talking no lip movement, genuine reaction to product texture/feel, authentic handheld iPhone",
      "subtitle": "מדגימה שימוש במוצר"
    },
    {
      "type": "CTA",
      "nb_prompt": "same person from reference photo holds ${productName} product confidently points at camera big smile, single frame photo, kinetic dynamic, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person talking directly to camera pointing with finger, excited natural energy, head nodding slightly as she speaks, authentic lip sync movement, shifting weight forward toward camera with enthusiasm, handheld wobble, no cinematic exaggeration",
      "subtitle": "exact voiceover_scene4 text"
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
    const v4 = parsed.voiceover_scene4 || '';
    parsed.voiceover = `${v1} ${v2} ${v4}`.trim();
    if (parsed.scenes) {
      parsed.scenes[0].subtitle = v1;
      parsed.scenes[1].subtitle = v2;
      // scene 3 keeps its subtitle
      parsed.scenes[3].subtitle = v4;
      // Store per-scene voiceover texts
      parsed.scenes[0].voiceover_text = v1;
      parsed.scenes[1].voiceover_text = v2;
      parsed.scenes[2].voiceover_text = null; // no talking
      parsed.scenes[3].voiceover_text = v4;
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

      // Generate 4 separate voiceovers (scene 3 = null)
      await send({ step: 'voice', progress: 16, message: '🎙️ יוצר קריינות לכל סצנה...' });
      const sceneAudios = [null, null, null, null]; // base64 per scene
      let fullAudioBase64 = null;

      const voiceTexts = scenes.map(s => s.voiceover_text || null);

      // Generate per-scene audio (scenes 1, 2, 4)
      for (let i = 0; i < 4; i++) {
        if (voiceTexts[i]) {
          await send({ progress: 17 + i, message: `🎙️ קריינות סצנה ${i+1}...` });
          sceneAudios[i] = await generateVoice(voiceTexts[i]);
          console.log(`Voice scene ${i+1}: ${sceneAudios[i] ? 'OK' : 'FAIL'}`);
        }
      }

      // Also generate full voiceover for the audio track in editor
      await send({ step: 'voice', progress: 21, message: '🎙️ יוצר קריינות מלאה...' });
      fullAudioBase64 = await generateVoice(voiceover);

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
          if (preparedProduct) imageUrls.push(preparedProduct);
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
        message: '🎬 פריימים מוכנים! מתחיל Kling + Lipsync...',
        frameUrls, scenes, voiceover,
        audioBase64: fullAudioBase64,
        sceneAudios, // per-scene audio for lipsync
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

function getDefaultVoiceover(productName) {
  return `ממש נמאס לי. ניסיתי כל כך הרבה דברים ושום דבר לא עבד. עד שמישהו המליץ לי על ${productName} ולא האמנתי. תנסו את ${productName} — יש אחריות מלאה, אין לכם מה להפסיד!`;
}

function getDefaultScenes(productName, applicationArea) {
  return [
    { type: 'כאב', voiceover_text: `ממש נמאס לי. ניסיתי כל כך הרבה דברים ושום דבר לא עבד.`, nb_prompt: 'woman frustrated overwhelmed in bathroom mirror stressed expression, morning natural light iPhone selfie vertical, single frame photo, kinetic dynamic, do not change person appearance from reference', kling_prompt: 'Person talking to camera frustrated lifting her head sighing, shifting weight slightly, camera wobbles in sync with natural movement, realistic lip sync mouth moving naturally, micro-expressions, handheld iPhone natural light, no cinematic exaggeration', subtitle: `ממש נמאס לי. ניסיתי כל כך הרבה דברים ושום דבר לא עבד.` },
    { type: 'גילוי', voiceover_text: `עד שמישהו המליץ לי על ${productName} ולא האמנתי שזה יעזור.`, nb_prompt: `same person from reference photo discovers ${productName} holds it label facing camera curious smile, single frame photo, kinetic dynamic, maintain exact facial features`, kling_prompt: `Continuing from previous scene same person talking to camera excitedly about ${productName}, holding it up, eyes wide naturally shifting gaze, head tilting slightly, lips moving conversationally, camera micro-shake authentic, no cinematic exaggeration`, subtitle: `עד שמישהו המליץ לי על ${productName} ולא האמנתי שזה יעזור.` },
    { type: 'שימוש', voiceover_text: null, nb_prompt: `same person from reference photo actively ${applicationArea}, close up hands and action, single frame photo not collage not grid, genuine focused expression natural light, maintain exact facial features`, kling_prompt: `Continuing from previous scene same person silently demonstrates ${applicationArea}, hands clearly visible performing action step by step, no talking no lip movement, genuine reaction, authentic handheld iPhone`, subtitle: 'מדגימה שימוש במוצר' },
    { type: 'CTA', voiceover_text: `תנסו את ${productName} — יש אחריות מלאה, אין לכם מה להפסיד!`, nb_prompt: `same person from reference photo holds ${productName} confidently points at camera big smile, single frame photo, kinetic dynamic, maintain exact facial features`, kling_prompt: 'Continuing from previous scene same person talking directly to camera pointing with finger, excited natural energy, head nodding as she speaks, authentic lip sync movement, shifting weight forward toward camera with enthusiasm, handheld wobble, no cinematic exaggeration', subtitle: `תנסו את ${productName} — יש אחריות מלאה, אין לכם מה להפסיד!` }
  ];
}
