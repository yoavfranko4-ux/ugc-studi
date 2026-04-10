const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const SCENE_DURATIONS = [5, 5, 5, 5];

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
  const enhancedPrompt = `${prompt}, authentic UGC selfie look, natural skin texture with visible pores, amateur iPhone vertical photo, slight overexposure from window light, candid unposed feel, no retouching, no studio lighting, real avatar not model, correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`;
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
      body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true } })
    });
    if (!res.ok) { console.error('ElevenLabs failed:', await res.text()); return null; }
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (e) { console.error('Voice error:', e.message); return null; }
}

async function generateScript(productName, productDesc, applicationArea, storyDescription) {
  if (!ANTHROPIC_KEY) return null;
  const storyContext = storyDescription ? `\nSTORY OVERRIDE (MANDATORY): ${storyDescription} — You MUST change ALL scenes to match. If story mentions restaurant — nb_prompt must describe restaurant. If story mentions specific action — all prompts must match. This overrides ALL default settings absolutely.` : '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514', max_tokens: 2500,
      messages: [{ role: 'user', content: `You are a UGC ad expert. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}${storyContext}

SCENE DURATIONS = [5, 5, 5, 5] = 20 seconds total. Scene 1: ~8 Hebrew words. Scene 2: ~8 Hebrew words. Scene 3: ~16 Hebrew words. Scene 4: ~8 Hebrew words.

CRITICAL: if a STORY OVERRIDE is provided above, you MUST OVERRIDE all scene settings, nb_prompt descriptions, kling_prompt descriptions, and actions to match the story EXACTLY. Change the "setting" field, every nb_prompt, every kling_prompt, and voiceover lines so they reflect the story the user described. For example if the story says "last scene in a restaurant with a dress" — the setting must be a restaurant, the scenes must show the person in a restaurant, and the product interaction must match. The story takes PRIORITY over the default setting rules below. Only fall back to the default setting rules if NO story is provided.

CRITICAL RULES:

1. VOICEOVER TIMING — STRICT:
- Scene 1: ~8 Hebrew words (fills 5s naturally)
- Scene 2: ~8 Hebrew words (fills 5s naturally)
- Scene 3: ~16 Hebrew words (fills 5s naturally)
- Scene 4: ~8 Hebrew words (fills 5s naturally)
- Write at NATURAL SPEAKING PACE — not too fast, not too slow. Each scene must feel complete.
- voiceover MUST fill the full duration naturally — write enough words to fill each scene, do not leave silence gaps

2. HOOK (voiceover_scene1) — MANDATORY SPECIFIC:
Identify the exact pain from productDesc and write it explicitly:
- Teeth whitening → "שיניים צהובות שמביכות אותי בכל תמונה ולא יכולה לחייך"
- Dress/clothing → "לא מוצאת בגד שמחמיא לדמות שלי ומרגישה לא בטוחה"
- Watch/jewelry → "השעון הישן שלי לא מתאים לסגנון שלי ומוריד ממני"
- Acne/skincare → "כתמים ואקנה שלא נעלמים ומביכים אותי כל יום"
- Hair → "שיער שנשבר ונושר ולא יכולה לעשות כלום איתו"
- Sleep → "שוכבת בלילה שעות ולא יכולה להירדם בכלל"
- NEVER use "נמאס לי" alone — always describe THE SPECIFIC VISIBLE PROBLEM

HOOK RULE (CRITICAL): voiceover_scene1 MUST name the EXACT visible problem of THIS specific product. Examples: teeth whitening → 'שיניים צהובות שמביכות אותי בכל תמונה'; dress → 'לא מוצאת שמלה שמחמיאה לדמות שלי'; face cream → 'כתמים ואקנה שמופיעים כל בוקר'. NEVER say הבעיה הזאת alone.

3. SETTING — HARD RULES, no exceptions:
- Clothing/dress/fashion → ALWAYS: "bedroom with full-length mirror and open closet/wardrobe in background"
- Watch/bracelet/jewelry → ALWAYS: "dressing table with mirror, jewellery and accessories visible"
- Teeth/dental/strips/whitening → ALWAYS: "bathroom, standing close to mirror, sink visible"
- Skincare/face cream/serum/acne → ALWAYS: "bathroom vanity with mirror, skincare products on counter"
- Hair products → ALWAYS: "bathroom with mirror, hair tools visible"
- Food/supplement/vitamin/protein → ALWAYS: "kitchen or dining table"
- Fitness/sport/gym → ALWAYS: "gym with equipment visible or outdoor"
- Tech/gadget/device → ALWAYS: "desk or living room couch"
- Car accessories → ALWAYS: "inside car, steering wheel visible"
- Sleep/pillow/mattress → ALWAYS: "bedroom, bed visible"
- Baby/kids products → ALWAYS: "living room or nursery"
- Cleaning products → ALWAYS: "kitchen or bathroom"
- NEVER put clothing/fashion scenes in a car. NEVER put dental scenes in a bedroom.
- NEVER put ANY product in a car scene UNLESS it is explicitly a car accessory. Cars are ONLY for car accessories.

6. EVERY nb_prompt MUST end with: "correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle"

4. SCENE STRUCTURE:
- Scene 1 (כאב): Avatar ALONE showing the specific problem — NO product visible yet
- Scene 2 (מוצר): Close-up beauty shot of the PRODUCT — no avatar, or hand only. Product is the hero.
- Scene 3 (שימוש): Avatar actively USING the product — product ON the avatar not just held
- Scene 4 (תוצאה): Avatar genuinely happy with the RESULT — product naturally visible

5. SCENE 3 (שימוש) — product must be ON the avatar:
- Clothing/dress → "avatar WEARING the [exact item], item ON body, admiring the fit"
- Watch/jewelry → "avatar WEARING the watch/jewelry on wrist/neck, holding arm up to admire"
- Teeth/dental → "avatar applying the strip/gel directly ON teeth, dental product ON teeth visible"
- Skincare → "avatar applying cream/serum directly ON face with fingertips, product ON skin"
- Hair → "avatar applying product directly INTO hair, running fingers through hair"
- Supplement → "avatar at kitchen table actually taking/drinking/eating the supplement"

5. END every Kling prompt with exactly this phrase (no more, no less):
"natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference"

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "~8 Hebrew words — SPECIFIC visible problem",
  "voiceover_scene2": "~8 Hebrew words — discovery of ${productName}",
  "voiceover_scene3": "~16 Hebrew words — using product ON/IN person and feeling result",
  "voiceover_scene4": "~8 Hebrew words — CTA with urgency",
  "setting": "one-line description of the setting",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "avatar showing specific problem related to ${productDesc}, frustrated expression, no product visible yet, correct human anatomy, exactly two arms, no extra limbs, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar in [setting] visibly frustrated with [specific problem], no product visible, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "מוצר",
      "nb_prompt": "close-up beauty shot of ${productName}, beautiful natural lighting, product is the hero of the shot, clean background, preserve exact product appearance from reference — exact colors exact shape",
      "kling_prompt": "Cinematic close-up of ${productName} rotating slowly or being revealed, beautiful lighting, clean background, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "שימוש",
      "nb_prompt": "avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar actively using ${productName} on themselves — product ON the avatar, hands clearly visible doing the action, no talking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "תוצאה",
      "nb_prompt": "avatar genuinely happy with result of using ${productName}, natural smile showing positive outcome, product naturally visible, correct human anatomy, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar genuinely happy showing positive result after using ${productName}, natural smile, product naturally visible, casual pointing at camera, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference",
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
  return `הבעיה הזאת הציקה לי כבר הרבה זמן ולא ידעתי מה לעשות. גיליתי את ${productName} ולא האמנתי שיעזור לי. התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי לגמרי ממש שינוי אמיתי. תנסו את ${productName} — יש אחריות מלאה אין מה להפסיד!`;
}

const STABLE = 'natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference';

function getDefaultScenes(productName, applicationArea, productDesc) {
  return [
    {
      type: 'כאב',
      nb_prompt: `avatar showing specific problem related to ${productDesc}, frustrated expression, no product visible yet, correct human anatomy, exactly two arms, no extra limbs, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar visibly frustrated with specific problem related to ${productDesc}, no product visible, ${STABLE}`,
      subtitle: 'הבעיה הזאת הציקה לי כבר הרבה זמן ולא ידעתי מה לעשות.'
    },
    {
      type: 'מוצר',
      nb_prompt: `close-up beauty shot of ${productName}, beautiful natural lighting, product is the hero of the shot, clean background, preserve exact product appearance from reference — exact colors exact shape`,
      kling_prompt: `Cinematic close-up of ${productName} rotating slowly or being revealed, beautiful lighting, clean background, ${STABLE}`,
      subtitle: `גיליתי את ${productName} ולא האמנתי שיעזור לי.`
    },
    {
      type: 'שימוש',
      nb_prompt: `avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar actively using ${productName} on themselves during ${applicationArea}, product ON the avatar, hands clearly visible, no talking, ${STABLE}`,
      subtitle: `התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי לגמרי ממש שינוי אמיתי.`
    },
    {
      type: 'תוצאה',
      nb_prompt: `avatar genuinely happy with result of using ${productName}, natural smile showing positive outcome, product naturally visible, correct human anatomy, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar genuinely happy showing positive result after using ${productName}, natural smile, product visible, pointing at camera, ${STABLE}`,
      subtitle: `תנסו את ${productName} — יש אחריות מלאה אין מה להפסיד!`
    }
  ];
}
