const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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
      model: 'claude-sonnet-4-20250514', max_tokens: 2500,
      messages: [{ role: 'user', content: `You are a UGC ad expert. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}${storyContext}

SCENE DURATIONS: Scene 1=5s, Scene 2=5s, Scene 3=10s, Scene 4=5s. Total=25s, voiceover=24s.

CRITICAL RULES:
1. Voiceover: Scene 1: ~10 Hebrew words. Scene 2: ~10 words. Scene 3: ~20 words. Scene 4: ~10 words. Total = 24s.
2. HOOK (voiceover_scene1): Must describe THE SPECIFIC VISIBLE PROBLEM of this product. Look at productDesc and identify: is it teeth? skin? hair? sleep? weight? clothing fit? Watch style? Then write the SPECIFIC pain. Example: teeth whitening → "שיניים צהובות שמביכות אותי בכל תמונה"; dress → "לא מוצאת שמלה שמתאימה לדמות שלי"; watch → "השעון הישן שלי לא מתאים לסטייל שלי". NEVER use generic text.
3. PRODUCT TYPE — identify the product type and adapt ALL scenes accordingly:
   - Wearable (dress/watch/jewelry/shoes): person tries it on, looks in mirror, admires it
   - Skincare/cosmetic: person applies to face/body, sees transformation
   - Food/supplement: person takes/eats it, feels energy/satisfaction
   - Dental: person uses on teeth, smiles at result
   - Hair: person applies to hair, sees shine/volume
   - Tech gadget: person uses the device, reacts to features
4. NB prompts: product must look EXACTLY like the uploaded product image. Add: "preserve exact product appearance, exact colors, exact shape, exact packaging/design from reference image, do not alter product in any way"
5. Kling prompts: "preserve exact product appearance from reference, product shape and colors unchanged, person holds product steadily, subtle natural breathing movement, slight head tilt, hand remains stable, no sudden position jumps or shape changes to product, smooth continuous authentic motion, handheld iPhone wobble, no cinematic exaggeration"
6. STORY INTEGRATION: If story provided, override ALL settings/actions.

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "Hebrew ~10 words — SPECIFIC pain point of THIS product",
  "voiceover_scene2": "Hebrew ~10 words mentions ${productName}",
  "voiceover_scene3": "Hebrew ~20 words describes using and feeling result",
  "voiceover_scene4": "Hebrew ~10 words CTA urgency",
  "product_type": "one of: wearable/skincare/dental/hair/food/tech/other",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "woman frustrated examining SPECIFIC PROBLEM of ${productDesc} — describe the exact visible pain point (yellow teeth/bad skin/wrong outfit/etc), morning natural light iPhone vertical, single frame photo, do not change person appearance from reference",
      "kling_prompt": "Person examines specific problem frustrated, preserve exact product appearance from reference product shape colors unchanged, person holds product steadily subtle natural breathing slight head tilt hand remains stable no sudden position jumps smooth continuous authentic motion handheld iPhone wobble no cinematic exaggeration",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "גילוי",
      "nb_prompt": "same person from reference just discovered ${productName}, interacting with product naturally based on product type — preserve exact product appearance exact colors exact shape from reference image, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person discovers product with curiosity, preserve exact product appearance from reference product shape and colors unchanged, person holds product steadily subtle natural breathing slight head tilt hand remains stable no sudden position jumps smooth continuous authentic motion camera micro-shake authentic no cinematic exaggeration",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "שימוש",
      "nb_prompt": "same person from reference actively using ${productName} — ${applicationArea} — adapt to product type: wearable=wearing it looking in mirror; skincare=applying to skin; dental=applying to teeth; show hands doing action naturally, preserve exact product appearance from reference image, single frame photo not collage, genuine focused expression, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person uses product naturally adapted to product type, preserve exact product appearance from reference product shape colors packaging unchanged, hand remains stable no sudden position jumps or shape changes to product smooth continuous motion hands clearly visible, no talking authentic handheld iPhone gentle movement",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "CTA",
      "nb_prompt": "same person from reference genuinely happy with result — show the RESULT of using product (whiter smile/better skin/wearing the item/etc), product naturally visible preserve exact appearance from reference, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing from previous scene same person shows genuine happy result of product, preserve exact product appearance from reference product unchanged, hand remains stable smooth continuous authentic motion, pointing casually at camera shifting weight forward handheld wobble no cinematic exaggeration",
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

      await send({ step: 'script', progress: 10, message: '✍️ כותב סקריפט...' });
      const script = await generateScript(productName, productDesc, applicationArea, storyDescription);
      const scenes = script?.scenes || getDefaultScenes(productName, applicationArea, productDesc);
      const voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea);
      await send({ step: 'script_done', progress: 15, message: '✅ סקריפט מוכן!', scenes, voiceover });

      await send({ step: 'voice', progress: 18, message: '🎙️ יוצר קריינות V3...' });
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
        await send({ step: `nb_${i+1}`, progress: frameProgresses[i], message: `🎨 Nano Banana — סצנה ${i+1}...` });
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
  return `נמאס לי מהבעיה הזאת ולא ידעתי מה לעשות. עד שמישהו המליץ לי על ${productName} ולא האמנתי. התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי לגמרי. תנסו את ${productName} — יש אחריות מלאה!`;
}

const STABLE_MOTION = 'preserve exact product appearance from reference product shape colors packaging unchanged, person holds product steadily subtle natural breathing movement slight head tilt hand remains stable no sudden position jumps or shape changes to product smooth continuous authentic motion handheld iPhone wobble no cinematic exaggeration';

function getDefaultScenes(productName, applicationArea, productDesc) {
  return [
    {
      type: 'כאב',
      nb_prompt: `woman frustrated examining specific problem: ${productDesc}, stressed expression looking at the problem area closely, morning natural light iPhone vertical, single frame photo, do not change person appearance from reference`,
      kling_prompt: `Person examines specific problem frustrated, ${STABLE_MOTION}`,
      subtitle: `נמאס לי מהבעיה הזאת ולא ידעתי מה לעשות.`
    },
    {
      type: 'גילוי',
      nb_prompt: `same person from reference just discovered ${productName}, holding product naturally with genuine curious expression, preserve exact product appearance exact colors exact shape from reference image, single frame photo, maintain exact facial features`,
      kling_prompt: `Continuing from previous scene same person discovers ${productName} with curiosity, ${STABLE_MOTION}`,
      subtitle: `עד שמישהו המליץ לי על ${productName} ולא האמנתי.`
    },
    {
      type: 'שימוש',
      nb_prompt: `same person from reference actively performing ${applicationArea}, hands doing physical action naturally, preserve exact product appearance from reference image, single frame photo not collage, genuine focused expression, maintain exact facial features`,
      kling_prompt: `Continuing from previous scene same person performs ${applicationArea}, ${STABLE_MOTION}, hands clearly visible, no talking`,
      subtitle: `התחלתי להשתמש והתוצאות הפתיעו אותי לגמרי.`
    },
    {
      type: 'CTA',
      nb_prompt: `same person from reference genuinely happy with result smiling naturally, product naturally visible preserve exact appearance from reference, single frame photo, maintain exact facial features`,
      kling_prompt: `Continuing from previous scene same person shows genuine happy result, ${STABLE_MOTION}, pointing casually at camera`,
      subtitle: `תנסו את ${productName} — יש אחריות מלאה!`
    }
  ];
}
