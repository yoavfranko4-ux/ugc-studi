import Anthropic from '@anthropic-ai/sdk'

const FAL_KEY = process.env.FAL_API_KEY;
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const SCENE_DURATIONS = [5, 5, 5, 5];

async function generateNBFrame(prompt, imageUrls) {
  const validUrls = imageUrls.filter(Boolean);
  console.log('NB input:', { promptLen: prompt?.length, urlCount: validUrls.length, urlPreviews: validUrls.map(u => u?.slice(0, 60)) });
  const enhancedPrompt = `${prompt}, authentic UGC selfie look, natural skin texture with visible pores, amateur iPhone vertical photo, slight overexposure from window light, candid unposed feel, no retouching, no studio lighting, real avatar not model, correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`;
  const endpoint = validUrls.length === 0
    ? 'https://fal.run/fal-ai/nano-banana-2'
    : 'https://fal.run/fal-ai/nano-banana-2/edit';
  const body = validUrls.length === 0
    ? { prompt: enhancedPrompt, image_size: 'portrait_4_3' }
    : { prompt: enhancedPrompt, image_urls: validUrls };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  console.log('NB response:', JSON.stringify(json).slice(0, 400));
  const imageUrl = json.images?.[0]?.url || json.images?.[0] || null;
  console.log('NB image URL:', imageUrl?.slice(0, 100));
  return imageUrl;
}

async function generateVoice(text) {
  if (!ELEVEN_KEY || !text) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true } })
    });
    if (!res.ok) { console.error('ElevenLabs failed:', await res.text()); return null; }
    const audioBuffer = Buffer.from(await res.arrayBuffer());
    const base64 = audioBuffer.toString('base64');
    // Estimate MP3 duration: fileSize(bytes) * 8 / bitrate(bits/sec)
    const durationSec = (audioBuffer.length * 8) / (128 * 1000);
    return { base64, duration: Math.round(durationSec * 100) / 100 };
  } catch (e) { console.error('Voice error:', e.message); return null; }
}

async function generateScript(productName, productDesc, applicationArea, hook) {
  if (!ANTHROPIC_KEY) return null;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 2500,
    messages: [{ role: 'user', content: `You are a UGC ad expert. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}

SCENE DURATIONS = [5, 5, 5, 5] = 20 seconds total. Scene 1: ~8 Hebrew words. Scene 2: ~8 Hebrew words. Scene 3: ~16 Hebrew words. Scene 4: ~8 Hebrew words.

CRITICAL RULES:

1. VOICEOVER TIMING — STRICT:
- Scene 1: ~8 Hebrew words (fills 5s naturally)
- Scene 2: ~8 Hebrew words (fills 5s naturally)
- Scene 3: ~16 Hebrew words (fills 5s naturally)
- Scene 4: ~8 Hebrew words (fills 5s naturally)
- Write at NATURAL SPEAKING PACE — not too fast, not too slow. Each scene must feel complete.
- voiceover MUST fill the full duration naturally — write enough words to fill each scene, do not leave silence gaps

2. HOOK (voiceover_scene1) — PRE-SET, DO NOT CHANGE:
voiceover_scene1 is already set to: "${hook}"
You MUST use this EXACT text as voiceover_scene1. Do NOT modify it.

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
"silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference"

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
      "kling_prompt": "Avatar in [setting] visibly frustrated with [specific problem], no product visible, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "מוצר",
      "nb_prompt": "close-up beauty shot of ${productName}, beautiful natural lighting, product is the hero of the shot, clean background, preserve exact product appearance from reference — exact colors exact shape",
      "kling_prompt": "Cinematic close-up of ${productName} rotating slowly or being revealed, beautiful lighting, clean background, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "שימוש",
      "nb_prompt": "avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar actively using ${productName} on themselves — product ON the avatar, hands clearly visible doing the action, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "תוצאה",
      "nb_prompt": "avatar genuinely happy with result of using ${productName}, natural smile showing positive outcome, product naturally visible, correct human anatomy, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar genuinely happy showing positive result after using ${productName}, natural smile, product naturally visible, casual pointing at camera, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference",
      "subtitle": "same as voiceover_scene4"
    }
  ]
}` }]
  });
  const text = message.content?.[0]?.text || '';
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
  try {
    const { productName, productDesc, applicationArea, avatarUrl, productImageUrl } = await req.json();

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ugc-studi-production.up.railway.app';
    const preparedAvatar = avatarUrl
      ? (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:') ? avatarUrl : `${baseUrl}${avatarUrl}`)
      : null;
    const preparedProduct = productImageUrl
      ? (productImageUrl.startsWith('http') || productImageUrl.startsWith('data:') ? productImageUrl : `${baseUrl}${productImageUrl}`)
      : null;
    console.log('Prepared URLs:', { avatar: preparedAvatar?.slice(0, 80), product: preparedProduct?.slice(0, 80) });

    // Script
    const hook = getHook(productName, productDesc);
    const script = await generateScript(productName, productDesc, applicationArea, hook);
    const scenes = script?.scenes || getDefaultScenes(productName, applicationArea, productDesc);
    if (script) {
      script.voiceover_scene1 = hook;
      if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook;
      script.voiceover = `${hook} ${script.voiceover_scene2 || ''} ${script.voiceover_scene3 || ''} ${script.voiceover_scene4 || ''}`.trim();
    }
    if (scenes[0]) scenes[0].subtitle = hook;
    const voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea, hook);

    // Voice
    const voiceResult = await generateVoice(voiceover);
    const audioBase64 = voiceResult?.base64 || null;

    // Frames
    const frames = [];
    let prevFrame = null;
    for (let i = 0; i < 4; i++) {
      try {
        const imageUrls = [];
        if (preparedAvatar) imageUrls.push(preparedAvatar);
        if (prevFrame) imageUrls.push(prevFrame);
        if (preparedProduct && (i === 1 || i === 2 || i === 3)) imageUrls.push(preparedProduct);
        const frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls);
        frames.push(frameUrl);
        if (frameUrl) prevFrame = frameUrl;
      } catch (e) {
        console.error(`Frame ${i+1} failed:`, e.message);
        frames.push(null);
      }
    }

    return Response.json({
      story: { scenes, hebrew_voice: voiceover },
      frames,
      videos: [],
      audioBase64,
      hebrewVoice: voiceover
    });
  } catch (e) {
    console.error('Agent error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

function getHook(productName, productDesc) {
  const desc = ((productDesc || '') + ' ' + (productName || '')).toLowerCase();
  if (desc.includes('שמלה') || desc.includes('בגד') || desc.includes('חולצה'))
    return 'לא מוצאת בגד שמחמיא לדמות שלי ומרגישה לא בטוחה בבגדים';
  if (desc.includes('שינ') || desc.includes('דנטל') || desc.includes('לבן'))
    return 'שיניים צהובות שמביכות אותי בכל תמונה ולא יכולה לחייך';
  if (desc.includes('קרם') || desc.includes('פנים') || desc.includes('אקנה') || desc.includes('עור'))
    return 'כתמים ואקנה שמופיעים כל בוקר ולא יודעת מה לעשות';
  if (desc.includes('שיער'))
    return 'שיער שנושר ונשבר ולא יכולה לעשות איתו כלום';
  if (desc.includes('שעון') || desc.includes('תכשיט'))
    return 'האביזרים שלי לא מתאימים לסגנון שלי בכלל';
  if (desc.includes('שינה') || desc.includes('לישון'))
    return 'שוכבת בלילה שעות ולא יכולה להירדם בכלל';
  return `הבעיה עם ${productName} הציקה לי כבר הרבה זמן`;
}

function getDefaultVoiceover(productName, applicationArea, hook) {
  const h = hook || getHook(productName, '');
  return `${h}. גיליתי את ${productName} ולא האמנתי שיעזור לי. התחלתי להשתמש, ${applicationArea}, והתוצאות הפתיעו אותי לגמרי ממש שינוי אמיתי. תנסו את ${productName} — יש אחריות מלאה אין מה להפסיד!`;
}

const STABLE = 'silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference';

function getDefaultScenes(productName, applicationArea, productDesc) {
  const hook = getHook(productName, productDesc);
  return [
    {
      type: 'כאב',
      nb_prompt: `avatar showing specific problem related to ${productDesc}, frustrated expression, no product visible yet, correct human anatomy, exactly two arms, no extra limbs, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar visibly frustrated with specific problem related to ${productDesc}, no product visible, ${STABLE}`,
      subtitle: hook
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
