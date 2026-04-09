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

SCENE DURATIONS: Scene 1=5s, Scene 2=5s, Scene 3=10s, Scene 4=5s.

CRITICAL RULES:

1. VOICEOVER TIMING — STRICT:
- Scene 1: MAX 8 Hebrew words (fits 5s)
- Scene 2: MAX 8 Hebrew words (fits 5s)
- Scene 3: MAX 18 Hebrew words (fits 10s)
- Scene 4: MAX 8 Hebrew words (fits 5s)
- Total MUST be under 24 seconds. Short sentences. Natural pace. NEVER exceed word counts.

2. HOOK (voiceover_scene1) — MANDATORY:
- Must name the EXACT visible problem of THIS product
- Teeth whitening → "שיניים צהובות שמביכות אותי בכל תמונה"
- Dress/clothing → "לא מוצאת בגד שמחמיא לדמות שלי"
- Watch → "השעון שלי לא מתאים לסגנון שלי בכלל"
- Acne cream → "כתמים ואקנה שלא נעלמים בכלל"
- Sleep → "שוכבת בלילה ולא יכולה להירדם"
- NEVER say "נמאס לי מהבעיה" — always name the SPECIFIC problem

3. SETTING — choose the LOGICAL setting for this product type:
- Clothing/dress/fashion → bedroom with mirror or closet, trying on clothes
- Watch/jewelry/accessories → getting ready scene, dressing table or mirror
- Teeth/dental → bathroom, close to mirror examining teeth
- Skincare/face cream → bathroom or bedroom vanity, applying to face
- Hair products → bathroom or bedroom, in front of mirror with hair
- Food/supplement → kitchen or dining area
- Tech/gadget → desk, living room, or relevant space
- Sports/fitness → gym or outdoors
- Car accessories → inside car
- ALL scenes must stay in the SAME logical setting

4. PRODUCT PRESERVATION in Kling prompts:
Always add: "preserve exact product appearance from reference — exact colors, exact shape, exact design, product does NOT change or morph"

5. STABLE MOTION in Kling prompts:
Always add: "person holds product steadily, subtle breathing movement, hand remains stable, no sudden position jumps, smooth continuous motion, handheld iPhone wobble, no cinematic exaggeration"

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "MAX 8 Hebrew words — name the SPECIFIC visible problem",
  "voiceover_scene2": "MAX 8 Hebrew words — discovery of ${productName}",
  "voiceover_scene3": "MAX 18 Hebrew words — using product and feeling result",
  "voiceover_scene4": "MAX 8 Hebrew words — CTA",
  "setting": "the logical setting for this product (e.g. bathroom, bedroom with mirror, kitchen, gym)",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "describe person in the LOGICAL SETTING for this product, showing the SPECIFIC PROBLEM — e.g. for teeth: woman in bathroom examining yellow teeth in mirror; for dress: woman in bedroom looking frustrated at clothes; for watch: man checking old watch. Morning natural light, iPhone vertical, single frame photo, do not change person appearance from reference",
      "kling_prompt": "Person in [setting] shows specific problem, preserve exact product appearance from reference exact colors exact shape product does NOT change, person holds product steadily subtle breathing hand remains stable no sudden position jumps smooth continuous motion handheld iPhone wobble no cinematic exaggeration",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "גילוי",
      "nb_prompt": "same person from reference in same [setting], just discovered ${productName} — holding product naturally curious, preserve exact product appearance exact colors exact shape from reference image, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing in same setting same person discovers product curiously, preserve exact product appearance from reference exact colors exact shape product does NOT change or morph, person holds product steadily subtle breathing slight head tilt hand remains stable no sudden jumps smooth continuous motion camera micro-shake no cinematic exaggeration",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "שימוש",
      "nb_prompt": "same person from reference in same [setting] actively performing ${applicationArea} — show the logical action for this product type (applying/wearing/using), hands visible doing action naturally, preserve exact product appearance from reference, single frame photo not collage, genuine focused expression, maintain exact facial features",
      "kling_prompt": "Continuing in same setting same person performs ${applicationArea} naturally, preserve exact product appearance from reference exact colors shape unchanged, hand remains stable no sudden position jumps smooth continuous motion hands clearly visible doing action, no talking, authentic handheld iPhone gentle movement",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "CTA",
      "nb_prompt": "same person from reference in same [setting] showing happy RESULT — show what changed (whiter teeth/wearing the outfit/better skin/etc), product visible naturally preserve exact appearance, single frame photo, maintain exact facial features",
      "kling_prompt": "Continuing in same setting same person shows genuine happy result of using product, preserve exact product appearance from reference unchanged, hand remains stable smooth continuous authentic motion, pointing at camera shifting weight forward handheld wobble no cinematic exaggeration",
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
  return `הבעיה הזאת הציקה לי זמן רב. גיליתי את ${productName} ולא האמנתי. ${applicationArea} והתוצאות הפתיעו אותי לגמרי. תנסו את ${productName} — יש אחריות מלאה!`;
}

const STABLE = 'preserve exact product appearance from reference exact colors exact shape product does NOT change, person holds product steadily subtle breathing hand remains stable no sudden position jumps smooth continuous motion handheld iPhone wobble no cinematic exaggeration';

function getDefaultScenes(productName, applicationArea, productDesc) {
  return [
    { type: 'כאב', nb_prompt: `woman frustrated examining specific problem related to: ${productDesc}, in appropriate setting, morning natural light iPhone vertical, single frame photo, do not change person appearance from reference`, kling_prompt: `Person shows specific problem frustrated, ${STABLE}`, subtitle: 'הבעיה הזאת הציקה לי זמן רב.' },
    { type: 'גילוי', nb_prompt: `same person from reference discovers ${productName} in same setting, holding product naturally curious, preserve exact product appearance from reference, single frame photo, maintain exact facial features`, kling_prompt: `Continuing same person discovers ${productName}, ${STABLE}`, subtitle: `גיליתי את ${productName} ולא האמנתי.` },
    { type: 'שימוש', nb_prompt: `same person from reference performing ${applicationArea} in same setting, hands visible doing action naturally, preserve exact product appearance, single frame photo not collage, genuine focused expression, maintain exact facial features`, kling_prompt: `Continuing same person performs ${applicationArea}, ${STABLE}, hands clearly visible, no talking`, subtitle: `${applicationArea} והתוצאות הפתיעו אותי לגמרי.` },
    { type: 'CTA', nb_prompt: `same person from reference showing happy result in same setting, product naturally visible preserve exact appearance, single frame photo, maintain exact facial features`, kling_prompt: `Continuing same person shows genuine happy result, ${STABLE}, pointing at camera`, subtitle: `תנסו את ${productName} — יש אחריות מלאה!` }
  ];
}
