import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { supabase } from '../../../lib/supabase'

export const maxDuration = 300;

const FAL_KEY = process.env.FAL_API_KEY;
if (!FAL_KEY) console.warn('⚠ FAL_API_KEY is not set — NanoBanana frames will fail');
else console.log('FAL_API_KEY loaded:', FAL_KEY.slice(0, 8) + '...');
fal.config({ credentials: FAL_KEY });
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const SCENE_DURATIONS = [5, 5, 5, 5];

async function generateNBFrame(prompt, imageUrls, maxRetries = 3) {
  const validUrls = imageUrls.filter(Boolean);
  console.log('NB input:', { promptLen: prompt?.length, urlCount: validUrls.length, urlPreviews: validUrls.map(u => u?.slice(0, 60)) });
  const enhancedPrompt = `${prompt}, authentic UGC selfie look, natural skin texture with visible pores, amateur iPhone vertical photo, slight overexposure from window light, candid unposed feel, no retouching, no studio lighting, real avatar not model, correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`;
  const endpointId = validUrls.length === 0
    ? 'fal-ai/nano-banana-2'
    : 'fal-ai/nano-banana-2/edit';
  const input = validUrls.length === 0
    ? { prompt: enhancedPrompt, image_size: { width: 720, height: 1280 } }
    : { prompt: enhancedPrompt, image_urls: validUrls, image_size: { width: 720, height: 1280 } };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fal.run(endpointId, { input });
      console.log('NB response:', JSON.stringify(result.data).slice(0, 400));
      const imageUrl = result.data.images?.[0]?.url || result.data.images?.[0] || null;
      console.log('NB image URL:', imageUrl?.slice(0, 100));
      return imageUrl;
    } catch (err) {
      const status = err.status || err.statusCode || 'unknown';
      const body = err.body || err.message || String(err);
      console.error(`NB frame attempt ${attempt}/${maxRetries} failed — status: ${status}, body:`, JSON.stringify(body).slice(0, 500));
      if ((status === 403 || status === 429) && attempt < maxRetries) {
        const delay = attempt * 2000;
        console.log(`NB retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function generateVoice(text, voiceId) {
  if (!ELEVEN_KEY || !text) return null;
  const voice = voiceId || ELEVEN_VOICE;
  try {
    // Use with-timestamps endpoint for word-level alignment data
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_v3', voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true } })
    });
    if (!res.ok) { console.error('ElevenLabs failed:', await res.text()); return null; }
    const json = await res.json();
    const audioBuffer = Buffer.from(json.audio_base64, 'base64');
    const base64 = json.audio_base64;
    const durationSec = (audioBuffer.length * 8) / (128 * 1000);
    console.log(`[Voice] Audio size: ${(audioBuffer.length / 1024).toFixed(0)}KB, est duration: ${durationSec.toFixed(1)}s`);

    // Build word-level timestamps from character alignment
    let wordTimestamps = null;
    if (json.alignment) {
      const { characters, character_start_times_seconds, character_end_times_seconds } = json.alignment;
      wordTimestamps = [];
      let wordStart = null;
      let wordChars = '';
      for (let i = 0; i < characters.length; i++) {
        const ch = characters[i];
        if (ch === ' ' || ch === '\n' || ch === '\t') {
          if (wordChars.trim()) {
            wordTimestamps.push({ word: wordChars.trim(), start: wordStart, end: character_end_times_seconds[i - 1] });
          }
          wordChars = '';
          wordStart = null;
        } else {
          if (wordStart === null) wordStart = character_start_times_seconds[i];
          wordChars += ch;
        }
      }
      if (wordChars.trim()) {
        wordTimestamps.push({ word: wordChars.trim(), start: wordStart, end: character_end_times_seconds[characters.length - 1] });
      }
      console.log(`[Voice] Word timestamps: ${wordTimestamps.length} words, first:`, wordTimestamps[0], 'last:', wordTimestamps[wordTimestamps.length - 1]);
    }

    return { base64, duration: Math.round(durationSec * 100) / 100, wordTimestamps };
  } catch (e) { console.error('Voice error:', e.message); return null; }
}

async function generateScript(productName, productDesc, applicationArea, hook, voiceGender) {
  if (!ANTHROPIC_KEY) return null;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const genderInstruction = voiceGender === 'male'
    ? 'כתוב את הקריינות בלשון זכר'
    : 'כתוב את הקריינות בלשון נקבה';
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 2500,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing scripts in Hebrew. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}

${genderInstruction}

STEP 0 — PRODUCT CATEGORY ANALYSIS (do this silently before writing):
Read the product name and description and classify the product into one of these categories:
- Fashion/clothing (dresses, shirts, pants, shoes, bags)
- Skincare/beauty (creams, serums, makeup, acne treatments)
- Hair products (shampoo, treatments, styling tools)
- Dental/teeth (whitening strips, toothpaste, oral care)
- Jewelry/accessories (watches, bracelets, necklaces)
- Food/restaurant/meal kits/supplements/vitamins
- Tech/gadgets/apps/software
- Fitness/sport/workout/weight loss
- Sleep/pillow/mattress/bedding
- Baby/kids products
- Cleaning/household products
- Home decor/furniture
- Pet products
- Car accessories
- Other (analyze the description to find the closest match)

Then identify the CORE PROBLEM this product solves — the universal pain point that a real person in the target audience feels before discovering this product. This pain must be RELATABLE and UNIVERSAL for anyone in that category, not specific to this brand.

Examples of category-based pain hooks (adapt in natural Hebrew):
- Fashion/clothing → "כל פעם שחיפשתי משהו לאירוע זה היה יקר מדי או לא התאים לי"
- Skincare → "ניסיתי כל קרם בשוק ושום דבר לא עזר לי עם..."
- Food/restaurant → "הייתי כל כך עייפה מלבשל כל יום ולא ידעתי מה לעשות"
- Tech/gadget → "בזבזתי שעות כל יום על משהו שהיה אמור להיות פשוט"
- Fitness → "ניסיתי כל שיטה ופשוט לא ראיתי תוצאות"
- Sleep → "כל לילה הייתי מתהפכת במיטה שעות בלי להצליח להירדם"
- Dental → "הייתי מביכה לחייך בתמונות בגלל השיניים שלי"
- Hair → "שיער שלי היה נושר ונשבר וכלום לא עזר"
- Cleaning → "בזבזתי שעות על ניקיון והבית עדיין נראה לא נקי"
- Baby/kids → "ילדים שלי לא היו מפסיקים להתעצבן ולא ידעתי מה לעשות"

CRITICAL RULES:

1. UGC HOOK FORMULA — THIS IS THE MOST IMPORTANT RULE:
- Scene 1 (Hook — כאב): Start with a UNIVERSAL, RELATABLE PROBLEM for the product's category. NEVER mention the product name, brand name, or even the product type/category name directly. Sound like a real friend telling you about a struggle. The viewer must feel "זה בדיוק אני!"
- Scene 2 (Agitate — החמרה): Make the problem WORSE, build tension. Describe failed attempts, frustration, embarrassment. Still NO product name yet.
- Scene 3 (Solution reveal — פתרון): NOW introduce ${productName} naturally as THE solution. "עד שגיליתי את..." or "ואז מישהי המליצה לי על..." — describe the experience of using it.
- Scene 4 (CTA — קריאה לפעולה): Call to action with urgency. Emotional push to try it now.

⚠️ ABSOLUTE RULES FOR SCENE 1:
- NEVER start scene 1 with the product name "${productName}" or any brand name
- NEVER mention the product or brand in scene 1 AT ALL
- Scene 1 MUST start with a UNIVERSAL pain point for the product's category — a feeling/problem anyone in that audience can relate to
- Scene 1 must sound like a real person talking to a friend, not like an ad
- Be EMOTIONAL and AUTHENTIC — use everyday spoken Hebrew
- Think: "what frustration does the TARGET CUSTOMER feel every day?" and START there

2. HEBREW STYLE — MANDATORY:
- Write conversational Hebrew, like a real person talking to a friend — NOT formal, NOT salesy
- Max 4-5 words per subtitle segment (for on-screen text readability)
- Use everyday spoken Hebrew, not written/literary Hebrew

3. VOICEOVER TIMING — STRICT:
- Scene 1: ~12 Hebrew words (fills 5s naturally — elaborate on the pain)
- Scene 2: ~12 Hebrew words (fills 5s naturally — make the problem worse)
- Scene 3: ~20 Hebrew words (fills 5s naturally — reveal the solution, describe the experience)
- Scene 4: ~12 Hebrew words (fills 5s naturally — strong CTA with urgency and emotion)
- Write at NATURAL SPEAKING PACE — each scene must feel complete.
- voiceover MUST fill the full duration naturally — no silence gaps
- AIM FOR ~20 SECONDS TOTAL of spoken Hebrew

4. HOOK (voiceover_scene1) — PRE-SET, DO NOT CHANGE:
voiceover_scene1 is already set to: "${hook}"
You MUST use this EXACT text as voiceover_scene1. Do NOT modify it.

5. SETTING — HARD RULES, no exceptions:
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

7. SCENE STRUCTURE (follows the hook formula):
- Scene 1 (כאב — Hook): Avatar ALONE showing the specific problem — NO product visible, NO product mentioned
- Scene 2 (החמרה — Agitate): Avatar showing frustration getting WORSE — failed attempts, embarrassment. Still no product.
- Scene 3 (פתרון — Solution): Avatar actively USING the product — product ON the avatar not just held. This is the reveal!
- Scene 4 (תוצאה — CTA): Avatar genuinely happy with the RESULT — product naturally visible, emotional CTA

8. SCENE 3 (פתרון) — product must be ON the avatar:
- Clothing/dress → "avatar WEARING the [exact item], item ON body, admiring the fit"
- Watch/jewelry → "avatar WEARING the watch/jewelry on wrist/neck, holding arm up to admire"
- Teeth/dental → "avatar applying the strip/gel directly ON teeth, dental product ON teeth visible"
- Skincare → "avatar applying cream/serum directly ON face with fingertips, product ON skin"
- Hair → "avatar applying product directly INTO hair, running fingers through hair"
- Supplement → "avatar at kitchen table actually taking/drinking/eating the supplement"

9. END every Kling prompt with exactly this phrase (no more, no less):
"silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference"

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "~12 Hebrew words — UNIVERSAL pain point for this product's category, NEVER the product name, NEVER the brand, sound like a friend venting about a struggle",
  "voiceover_scene2": "~12 Hebrew words — make the problem WORSE, build tension, failed attempts",
  "voiceover_scene3": "~20 Hebrew words — reveal ${productName} as the solution, describe the experience in detail",
  "voiceover_scene4": "~12 Hebrew words — emotional CTA with urgency, tell them to try it now",
  "setting": "one-line description of the setting",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "avatar showing specific problem related to ${productDesc}, frustrated expression, no product visible yet, correct human anatomy, exactly two arms, no extra limbs, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar in [setting] visibly frustrated with [specific problem], no product visible, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "החמרה",
      "nb_prompt": "avatar looking more frustrated, showing failed attempt to solve the problem, disappointed expression, no product visible, correct human anatomy, exactly two arms, no extra limbs, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar in [setting] showing deeper frustration, failed attempt visible, disappointed body language, no product visible, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "פתרון",
      "nb_prompt": "avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, excited expression of discovery, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar excitedly using ${productName} on themselves for the first time — product ON the avatar, hands clearly visible doing the action, expression of pleasant surprise, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference",
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
    const body = await req.json();

    if (!supabase) {
      return Response.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Create a pending job
    const { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({ status: 'pending' })
      .select('id')
      .single();

    if (insertError) {
      console.error('Job insert error:', insertError.message);
      return Response.json({ error: 'Failed to create job' }, { status: 500 });
    }

    // Fire and forget — do NOT await
    runJob(job.id, body).catch(err => console.error('Background job crashed:', err.message));

    return Response.json({ jobId: job.id });
  } catch (e) {
    console.error('Agent error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

async function runJob(jobId, { productName, productDesc, applicationArea, avatarUrl, productImageUrl, voiceId }) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ugc-studi-production.up.railway.app';
    const preparedAvatar = avatarUrl
      ? (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:') ? avatarUrl : `${baseUrl}${avatarUrl}`)
      : null;
    const preparedProduct = productImageUrl
      ? (productImageUrl.startsWith('http') || productImageUrl.startsWith('data:') ? productImageUrl : `${baseUrl}${productImageUrl}`)
      : null;
    console.log(`[Job ${jobId}] Prepared URLs:`, { avatar: preparedAvatar?.slice(0, 80), product: preparedProduct?.slice(0, 80) });

    // Script
    const hook = getHook(productName, productDesc);
    const voiceGender = voiceId === 'nBiC8Jexp2XGyIxATg9S' ? 'male' : 'female';
    const script = await generateScript(productName, productDesc, applicationArea, hook, voiceGender);
    const scenes = script?.scenes || getDefaultScenes(productName, applicationArea, productDesc);
    if (script) {
      script.voiceover_scene1 = hook;
      if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook;
      script.voiceover = `${hook} ${script.voiceover_scene2 || ''} ${script.voiceover_scene3 || ''} ${script.voiceover_scene4 || ''}`.trim();
    }
    if (scenes[0]) scenes[0].subtitle = hook;
    const voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea, hook);

    // Voice + Frames in parallel (voice doesn't depend on frames)
    const generateAllFrames = async () => {
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
          console.error(`[Job ${jobId}] Frame ${i+1} failed:`, e.message);
          frames.push(null);
        }
      }
      return frames;
    };

    const [voiceResult, frames] = await Promise.all([
      generateVoice(voiceover, voiceId),
      generateAllFrames()
    ]);
    const audioBase64 = voiceResult?.base64 || null;
    const wordTimestamps = voiceResult?.wordTimestamps || null;

    // Kling videos — run all 4 in parallel
    console.log(`[Job ${jobId}] Starting all 4 Kling videos in parallel...`);
    const videos = await Promise.all(frames.map(async (frameUrl, i) => {
      if (!frameUrl) return null;
      try {
        console.log(`[Job ${jobId}] Kling scene ${i+1}: starting...`);
        const result = await fal.subscribe('fal-ai/kling-video/v3/pro/image-to-video', {
          input: {
            prompt: scenes[i].kling_prompt,
            image_url: frameUrl,
            duration: '5',
            aspect_ratio: '9:16',
            cfg_scale: 0.45,
            negative_prompt: 'cinematic camera, smooth stabilizer, studio lighting, professional production, advertisement look, CGI, drone shot, dolly zoom, commercial quality, artificial lighting, color grading, lens flare, rack focus'
          },
          pollInterval: 5000
        });
        const videoUrl = result.data.video?.url || null;
        console.log(`[Job ${jobId}] Kling scene ${i+1}:`, videoUrl ? 'OK' : 'no URL');
        return videoUrl || null;
      } catch (e) {
        console.error(`[Job ${jobId}] Kling scene ${i+1} error:`, e.message);
        return null;
      }
    }));

    const result = {
      story: { scenes, hebrew_voice: voiceover },
      frames,
      videos,
      audioBase64,
      wordTimestamps,
      hebrewVoice: voiceover
    };

    await supabase
      .from('jobs')
      .update({ status: 'done', result })
      .eq('id', jobId);

    console.log(`[Job ${jobId}] Completed successfully`);
  } catch (e) {
    console.error(`[Job ${jobId}] Failed:`, e.message);
    await supabase
      .from('jobs')
      .update({ status: 'error', error: e.message })
      .eq('id', jobId);
  }
}

function getHook(productName, productDesc) {
  const desc = ((productDesc || '') + ' ' + (productName || '')).toLowerCase();

  // Fashion / clothing
  if (/שמלה|בגד|חולצה|מכנס|נעל|תיק|אופנה|dress|shirt|clothes|fashion|pants|shoes|bag/.test(desc))
    return 'כל פעם שחיפשתי משהו לאירוע זה היה יקר מדי או לא התאים לי';

  // Dental / teeth
  if (/שינ|דנטל|לבן|משחת|teeth|dental|whiten/.test(desc))
    return 'הייתי מביכה לחייך בתמונות בגלל השיניים שלי והרגשתי נורא';

  // Skincare
  if (/קרם|פנים|אקנה|עור|סרום|skincare|cream|serum|acne|face/.test(desc))
    return 'ניסיתי כל קרם בשוק ושום דבר לא עזר לי עם העור שלי';

  // Hair
  if (/שיער|hair|שמפו/.test(desc))
    return 'השיער שלי היה נושר ונשבר וכלום לא עזר לי באמת';

  // Jewelry / accessories
  if (/שעון|תכשיט|צמיד|שרשרת|watch|jewelry|bracelet|necklace/.test(desc))
    return 'האביזרים שלי תמיד נראו זולים ולא הרגשתי בנוח איתם';

  // Sleep
  if (/שינה|לישון|כרית|מזרון|sleep|pillow|mattress/.test(desc))
    return 'כל לילה הייתי מתהפכת במיטה שעות בלי להצליח להירדם';

  // Food / restaurant / meal kit
  if (/אוכל|מסעדה|ארוחה|מזון|תזונה|food|meal|restaurant|diet/.test(desc))
    return 'הייתי כל כך עייפה מלבשל כל יום ולא ידעתי מה לעשות';

  // Supplement / vitamin
  if (/ויטמין|תוסף|חלבון|supplement|vitamin|protein/.test(desc))
    return 'הרגשתי עייפה כל היום וכלום לא נתן לי באמת אנרגיה';

  // Fitness / workout
  if (/כושר|אימון|ספורט|הרזיה|דיאטה|fitness|workout|gym|weight|exercise/.test(desc))
    return 'ניסיתי כל שיטה בעולם ופשוט לא ראיתי שום תוצאות';

  // Tech / gadget / app
  if (/אפליקציה|גאדג׳ט|טכנולוגיה|מכשיר|app|tech|gadget|device|software/.test(desc))
    return 'בזבזתי שעות כל יום על משהו שהיה אמור להיות פשוט';

  // Cleaning
  if (/ניקוי|ניקיון|כביסה|cleaning|detergent|clean/.test(desc))
    return 'בזבזתי שעות על ניקיון והבית עדיין נראה לא נקי';

  // Baby / kids
  if (/תינוק|ילד|baby|kid|child/.test(desc))
    return 'הילדים שלי לא היו מפסיקים להתעצבן ולא ידעתי מה לעשות';

  // Home / furniture / decor
  if (/בית|ריהוט|עיצוב|home|furniture|decor/.test(desc))
    return 'הבית שלי אף פעם לא הרגיש מסודר למרות שניסיתי הכל';

  // Pet
  if (/כלב|חתול|חיית|pet|dog|cat/.test(desc))
    return 'החיה שלי הייתה אומללה וכל מה שניסיתי פשוט לא עבד';

  // Car accessories
  if (/רכב|אוטו|מכונית|car|vehicle/.test(desc))
    return 'כל נסיעה הייתה מעצבנת אותי והרגשתי שאני מבזבזת זמן';

  // Generic fallback — universal pain, no product name
  return 'ניסיתי המון דברים כדי לפתור את זה ושום דבר פשוט לא עבד לי';
}

function getDefaultVoiceover(productName, applicationArea, hook) {
  const h = hook || getHook(productName, '');
  return `${h}. ניסיתי הכל ושום דבר לא עזר לי באמת. עד שגיליתי את ${productName} ואז הכל השתנה, ${applicationArea} והתוצאות מטורפות. תנסו את ${productName} — יש אחריות מלאה אין מה להפסיד!`;
}

const STABLE = 'silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference';

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
      type: 'החמרה',
      nb_prompt: `avatar looking more frustrated, showing failed attempt to solve problem related to ${productDesc}, disappointed expression, no product visible, correct human anatomy, exactly two arms, no extra limbs, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar showing deeper frustration with ${productDesc} problem, failed attempt visible, disappointed body language, no product visible, ${STABLE}`,
      subtitle: `ניסיתי הכל ושום דבר לא עזר לי באמת.`
    },
    {
      type: 'פתרון',
      nb_prompt: `avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, excited expression, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar excitedly using ${productName} on themselves during ${applicationArea}, product ON the avatar, hands clearly visible, expression of pleasant surprise, ${STABLE}`,
      subtitle: `עד שגיליתי את ${productName} ואז הכל השתנה, ${applicationArea} והתוצאות מטורפות.`
    },
    {
      type: 'תוצאה',
      nb_prompt: `avatar genuinely happy with result of using ${productName}, natural smile showing positive outcome, product naturally visible, correct human anatomy, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar genuinely happy showing positive result after using ${productName}, natural smile, product visible, pointing at camera, ${STABLE}`,
      subtitle: `תנסו את ${productName} — יש אחריות מלאה אין מה להפסיד!`
    }
  ];
}
