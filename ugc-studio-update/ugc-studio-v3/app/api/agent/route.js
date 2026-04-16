import Anthropic from '@anthropic-ai/sdk'
import { fal } from '@fal-ai/client'
import { supabase } from '../../../lib/supabase'
import { cleanHebrewText } from '../../../lib/hebrew-tts.js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, readFile, mkdir, rm } from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
let ffmpegStaticPath = null
try { ffmpegStaticPath = require('ffmpeg-static') } catch {}
const execFileAsync = promisify(execFile)

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
  const anatomyPrefix = 'CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body.';
  const negativeConcepts = 'Negative (avoid): extra arms, extra hands, third hand, disembodied limbs, floating hands, phantom limbs, multiple arms, anatomically incorrect, deformed hands, mutant hands, extra fingers, six fingers, hands from outside frame, partial limbs entering from edges.';
  const singleHandRule = 'If holding a product, hold it with ONE hand only, other hand visible and relaxed at side, never two items at once.';
  const enhancedPrompt = `${anatomyPrefix} ${prompt}, authentic UGC selfie look, natural skin texture with visible pores, amateur iPhone vertical photo, slight overexposure from window light, candid unposed feel, no retouching, no studio lighting, real avatar not model, ${singleHandRule} exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle. ${negativeConcepts}`;
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
  // Hebrew preprocessing — fix nikud + add natural pause commas before
  // sending to ElevenLabs so the TTS doesn't mispronounce common words.
  const cleanedText = cleanHebrewText(text);
  try {
    // Use with-timestamps endpoint for word-level alignment data
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanedText, model_id: 'eleven_v3', voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true } })
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

// Detect feminine markers in text for a male voice, or masculine markers for a female voice.
// Used to flag gender-mismatched scripts from Claude so we can regenerate.
const FEMALE_ONLY_PATTERNS = [
  /\bמביכה\b/, /\bמובכת\b/, /\bבטוחה\b/, /\bחייבת\b/, /\bמחפשת\b/,
  /\bמוכנה\b/, /\bמשתמשת\b/, /\bהייתי מובכת\b/, /\bהייתי מביכה\b/,
  /\bמרוצה\s+אני\b/, /\bעייפה\b/, /\bשמחה\b/, /\bעצובה\b/, /\bכועסת\b/
];
const MALE_ONLY_PATTERNS = [
  /\bמובך\b/, /\bבטוח\b/, /\bחייב\b/, /\bמחפש\b/,
  /\bמוכן\b/, /\bמשתמש\b/, /\bהייתי מובך\b/,
  /\bעייף\b/, /\bשמח\b/, /\bעצוב\b/, /\bכועס\b/
];
function scriptGenderMismatch(text, voiceGender) {
  if (!text) return false;
  if (voiceGender === 'male') return FEMALE_ONLY_PATTERNS.some(re => re.test(text));
  if (voiceGender === 'female') return MALE_ONLY_PATTERNS.some(re => re.test(text));
  return false;
}

// Words that indicate a scene voiceover is a mid-sentence continuation rather
// than a complete, self-contained clause. If scene N starts with one of these
// it grammatically depends on scene N-1, which produces the "לא יכולתי השיניים
// / שלי" broken-subtitle effect.
const MID_SENTENCE_STARTERS = new Set([
  'שלי', 'שלך', 'שלו', 'שלה', 'שלנו', 'שלכם', 'שלהם',
  'ואז', 'אבל', 'כי', 'אז', 'עד', 'וגם', 'גם',
  'ו', 'ב', 'ל', 'מ', 'כ',
  'אותי', 'אותך', 'אותו', 'אותה', 'אותנו', 'אותם',
  'הזה', 'הזו', 'האלה', 'ההוא', 'ההיא'
]);
function scenesHaveBrokenSentences(scenes) {
  if (!Array.isArray(scenes)) return false;
  const chunks = scenes.map(s => (s?.subtitle || s?.voiceover || '').trim()).filter(Boolean);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Scene must end with sentence terminator (. ! ? …)
    const last = c.replace(/["')\]\s]+$/, '').slice(-1);
    if (!/[.!?…]/.test(last)) return true;
    // Scene i+1 should not start with a mid-sentence word
    if (i + 1 < chunks.length) {
      const nextFirstWord = chunks[i + 1].split(/\s+/)[0] || '';
      // Strip leading quotes/punctuation
      const cleaned = nextFirstWord.replace(/^["'(\[]+/, '');
      if (MID_SENTENCE_STARTERS.has(cleaned)) return true;
    }
  }
  return false;
}

async function generateScript(productName, productDesc, applicationArea, hook, voiceGender) {
  if (!ANTHROPIC_KEY) return null;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const genderInstruction = voiceGender === 'male'
    ? `GENDER (CRITICAL — MALE SPEAKER): כתוב את כל הקריינות בלשון זכר בלבד. דוגמאות: 'הייתי מובך' (לא 'מביכה'/'מובכת'), 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוח', 'אני חייב', 'התאכזבתי', 'האמנתי', 'מחפש' (לא 'מחפשת'), 'מרוצה' (זכר), 'מוכן', 'משתמש'. כל פועל, תואר וכינוי חייב להיות בלשון זכר. הדובר הוא גבר. אל תערבב לשון נקבה.`
    : `GENDER (CRITICAL — FEMALE SPEAKER): כתוב את כל הקריינות בלשון נקבה בלבד. דוגמאות: 'הייתי מובכת', 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוחה', 'אני חייבת', 'התאכזבתי', 'האמנתי', 'מחפשת' (לא 'מחפש'), 'מרוצה' (נקבה), 'מוכנה', 'משתמשת'. כל פועל, תואר וכינוי חייב להיות בלשון נקבה. הדוברת היא אישה. אל תערבב לשון זכר.`;
  const callClaude = async (extra = '') => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 2500,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing scripts in Hebrew. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}

NEW SCENE 2 STRUCTURE (IMPORTANT):
Scene 2 is now a PRODUCT BEAUTY SHOT — NO avatar in frame. The voiceover describes the product visually (features, what makes it special) — NO pain, NO person.

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
- Scene 2 (Product beauty shot — מוצר): NO AVATAR, NO PERSON visible. This is a pure product close-up — the product is the hero. Voiceover describes the product visually (what it is, what makes it special, its features). NO pain point, NO person mentioned.
- Scene 3 (Solution reveal — פתרון): NOW the avatar uses ${productName}. "עד שגיליתי את..." or "ואז מישהי המליצה לי על..." — describe the experience of using it.
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
- Scene 2: ~14 Hebrew words (fills 5s naturally — describe the product visually, its features and what makes it special. NO pain, NO person.)
- Scene 3: ~20 Hebrew words (fills 5s naturally — reveal the solution, describe the experience)
- Scene 4: ~12 Hebrew words (fills 5s naturally — strong CTA with urgency and emotion)
- Write at NATURAL SPEAKING PACE — each scene must feel complete.
- voiceover MUST fill the full duration naturally — no silence gaps
- AIM FOR ~20 SECONDS TOTAL of spoken Hebrew

3a. SENTENCE COMPLETENESS (CRITICAL — THE MOST IMPORTANT TIMING RULE):
כל משפט חייב להסתיים בתוך הסצנה שלו. אסור שמשפט ימשיך לסצנה הבאה. כל סצנה = משפט שלם או שניים שלמים.
- Each voiceover_sceneN must be a SELF-CONTAINED complete sentence (or two complete sentences) that ends with a period / question mark / exclamation mark.
- NEVER end a scene mid-phrase (e.g. ending scene 1 with "השיניים" and continuing scene 2 with "שלי" — FORBIDDEN).
- NEVER start a scene with a word that only makes sense as a continuation of the previous scene (e.g. starting scene 2 with "שלי", "אבל", "ואז רציתי שוב" that grammatically needs a previous clause).
- The combined script must flow naturally when read end-to-end, AND each chunk must stand on its own when read in isolation.
- Test: if you deleted any single scene's voiceover, the remaining 3 scenes should still each be grammatically complete Hebrew sentences.

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

6. EVERY nb_prompt MUST start with: "CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body." AND MUST end with: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle". If the avatar holds a product, say "holding the product with ONE hand only, other hand visible and relaxed at side". Avoid describing multiple items held at once or hands doing multiple simultaneous actions.

7. SCENE STRUCTURE (follows the hook formula):
- Scene 1 (כאב — Hook): Avatar ALONE showing the specific problem — NO product visible, NO product mentioned
- Scene 2 (מוצר — Product beauty shot): CLOSE-UP OF THE PRODUCT ONLY. NO avatar, NO person visible. Clean background, beautiful natural lighting. Product is the hero of the shot. Unboxing / reveal style. Product details clearly visible. PRESERVE EXACT PRODUCT APPEARANCE FROM REFERENCE IMAGE.
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
  "voiceover_scene2": "~14 Hebrew words — describe ${productName} visually — its features, texture, what makes it special. NO pain, NO person, pure product focus",
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
      "type": "מוצר",
      "nb_prompt": "Close-up beauty shot of ${productName} resting naturally on a realistic surface — on a wooden table, marble counter, bathroom sink, or being held stably in one hand. Product must have clear physical support and cast a realistic shadow underneath. Clean background, beautiful soft natural lighting, product is the hero of the shot, NO person or avatar visible (other than a steady hand holding it if appropriate), product details clearly visible, preserve exact product appearance from reference image, product shape and colors unchanged from reference. Negative: product NOT floating, NOT levitating, NOT suspended in air, NOT hovering, always has physical contact with a surface or hand, realistic gravity, realistic shadow and reflection.",
      "kling_prompt": "Camera slowly orbits around ${productName} resting on a stable surface, product stays stationary and grounded with clear contact shadow, subtle zoom-in, cinematic product shot, soft natural light, silent, smooth natural motion only, no floating, no levitating, no hovering, product shape and colors unchanged from reference",
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
}${extra}` }]
  });
  const parseResponse = (message) => {
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
  };

  // First attempt
  let parsed = parseResponse(await callClaude());
  // Validate gender — regenerate once if Claude mixed male/female forms
  if (parsed && scriptGenderMismatch(parsed.voiceover, voiceGender)) {
    console.warn(`[generateScript] Gender mismatch (wanted ${voiceGender}), regenerating...`);
    const extraInstruction = `\n\nPREVIOUS ATTEMPT HAD WRONG GENDER. ${genderInstruction}\nREWRITE every verb, adjective, and pronoun to match the speaker's gender (${voiceGender}). Do NOT mix genders. Verify every single word.`;
    const retry = parseResponse(await callClaude(extraInstruction));
    if (retry) parsed = retry;
  }
  // Validate sentence completeness — regenerate once if any scene ends mid-sentence
  if (parsed && scenesHaveBrokenSentences(parsed.scenes)) {
    console.warn('[generateScript] Broken sentences across scenes, regenerating...');
    const extraInstruction = `\n\nPREVIOUS ATTEMPT HAD SENTENCES SPLIT ACROSS SCENES (e.g. scene N ended with "השיניים" and scene N+1 started with "שלי"). REWRITE so each voiceover_sceneN is a SELF-CONTAINED grammatically complete Hebrew sentence ending with . ? or ! — and no scene starts with a word like שלי / שלו / אותי / הזה that depends on the previous scene.`;
    const retry = parseResponse(await callClaude(extraInstruction));
    if (retry) parsed = retry;
  }
  return parsed;
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

// Verify a Kling video URL is valid and non-empty.
// Returns true if HEAD/GET reports an MP4-like response with content-length ≥ 10KB.
async function verifyVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    let head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (head && head.ok) {
      const len = Number(head.headers.get('content-length') || 0);
      if (len >= 10 * 1024) return true;
      // Some CDNs don't return content-length on HEAD — fall through to range GET
    }
    // Range GET to confirm there are real bytes (avoid downloading the whole thing)
    const resp = await fetch(url, { headers: { Range: 'bytes=0-65535' } }).catch(() => null);
    if (!resp || (!resp.ok && resp.status !== 206)) return false;
    const buf = await resp.arrayBuffer();
    return buf.byteLength >= 10 * 1024;
  } catch (e) {
    console.warn('[verifyVideoUrl] failed:', e.message);
    return false;
  }
}

// Fallback: turn a NanoBanana still frame into a 5-second 720x1280 MP4 via FFmpeg,
// then upload to fal.storage so it can flow through the rest of the pipeline like
// any other Kling output (downloadable URL the export route can fetch).
async function frameToStaticVideo(frameUrl, durationSec = 5) {
  if (!frameUrl) return null;
  if (!ffmpegStaticPath || !fs.existsSync(ffmpegStaticPath)) {
    console.warn('[frameToStaticVideo] ffmpeg-static not available — cannot build fallback video');
    return null;
  }
  const tmpDir = path.join('/tmp', `frame2vid-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const inPath = path.join(tmpDir, 'frame.png');
  const outPath = path.join(tmpDir, 'scene2.mp4');
  try {
    // Download the frame
    let frameBuf;
    if (frameUrl.startsWith('data:')) {
      const b64 = frameUrl.split(',')[1] || '';
      frameBuf = Buffer.from(b64, 'base64');
    } else {
      const resp = await fetch(frameUrl);
      if (!resp.ok) throw new Error(`frame fetch HTTP ${resp.status}`);
      frameBuf = Buffer.from(await resp.arrayBuffer());
    }
    await writeFile(inPath, frameBuf);
    console.log(`[frameToStaticVideo] frame.png written: ${frameBuf.length} bytes`);

    // ffmpeg -loop 1 -i frame.png -t 5 -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -r 24 -c:v libx264 -pix_fmt yuv420p scene2.mp4
    const args = [
      '-y', '-loop', '1', '-i', inPath,
      '-t', String(durationSec),
      '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1',
      '-r', '24',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath
    ];
    console.log('[frameToStaticVideo] ffmpeg args:', JSON.stringify(args));
    await execFileAsync(ffmpegStaticPath, args, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
    const stats = fs.statSync(outPath);
    console.log(`[frameToStaticVideo] scene2.mp4 generated: ${stats.size} bytes`);
    if (stats.size < 10 * 1024) throw new Error('generated mp4 too small');

    const mp4Buf = await readFile(outPath);
    // Upload to fal.storage so we get a CDN URL like normal Kling outputs
    let uploadedUrl = null;
    try {
      const blob = new Blob([mp4Buf], { type: 'video/mp4' });
      uploadedUrl = await fal.storage.upload(blob);
      console.log('[frameToStaticVideo] uploaded to fal.storage:', uploadedUrl?.slice(0, 80));
    } catch (upErr) {
      console.warn('[frameToStaticVideo] fal.storage upload failed:', upErr.message);
      // Fallback: return a data URL — clients that fetch() it still work, though it's bigger.
      const b64 = mp4Buf.toString('base64');
      uploadedUrl = `data:video/mp4;base64,${b64}`;
      console.log('[frameToStaticVideo] returning data URL fallback, size:', mp4Buf.length, 'bytes');
    }
    return uploadedUrl;
  } catch (e) {
    console.error('[frameToStaticVideo] failed:', e.message);
    return null;
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runJob(jobId, body) {
  try {
    const {
      videoType = 'ugc',
      productName, productDesc, applicationArea,
      avatarUrl, productImageUrl, voiceId,
      businessName, businessDescription, businessPhotos,
    } = body;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ugc-studi-production.up.railway.app';
    const prepareUrl = (u) => u
      ? (u.startsWith('http') || u.startsWith('data:') ? u : `${baseUrl}${u}`)
      : null;
    const preparedAvatar = prepareUrl(avatarUrl);
    const preparedProduct = prepareUrl(productImageUrl);
    const preparedBusinessPhotos = Array.isArray(businessPhotos)
      ? businessPhotos.map(prepareUrl).filter(Boolean)
      : [];
    console.log(`[Job ${jobId}] videoType=${videoType} Prepared URLs:`, { avatar: preparedAvatar?.slice(0, 80), product: preparedProduct?.slice(0, 80), businessPhotos: preparedBusinessPhotos.length });

    const voiceGender = voiceId === 'nBiC8Jexp2XGyIxATg9S' ? 'male' : 'female';

    // Script — branch by mode
    let script, scenes, voiceover, hook;
    if (videoType === 'business') {
      hook = getBusinessHook(businessDescription || '', businessName || '', voiceGender);
      script = await generateBusinessScript(businessName || '', businessDescription || '', hook, voiceGender);
      scenes = script?.scenes || getBusinessDefaultScenes(businessName || '', businessDescription || '');
      if (script) {
        script.voiceover_scene1 = hook;
        if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook;
        script.voiceover = `${hook} ${script.voiceover_scene2 || ''} ${script.voiceover_scene3 || ''} ${script.voiceover_scene4 || ''}`.trim();
      }
      if (scenes[0]) scenes[0].subtitle = hook;
      voiceover = script?.voiceover || getBusinessDefaultVoiceover(businessName || '', businessDescription || '', hook, voiceGender);
    } else {
      hook = getHook(productName, productDesc, voiceGender);
      script = await generateScript(productName, productDesc, applicationArea, hook, voiceGender);
      scenes = script?.scenes || getDefaultScenes(productName, applicationArea, productDesc);
      if (script) {
        script.voiceover_scene1 = hook;
        if (script.scenes && script.scenes[0]) script.scenes[0].subtitle = hook;
        script.voiceover = `${hook} ${script.voiceover_scene2 || ''} ${script.voiceover_scene3 || ''} ${script.voiceover_scene4 || ''}`.trim();
      }
      if (scenes[0]) scenes[0].subtitle = hook;
      voiceover = script?.voiceover || getDefaultVoiceover(productName, applicationArea, hook, voiceGender);
    }

    // Voice + Frames in parallel (voice doesn't depend on frames)
    const generateAllFrames = async () => {
      const frames = [];
      let prevFrame = null;
      for (let i = 0; i < 4; i++) {
        try {
          const imageUrls = [];
          if (videoType === 'business') {
            // Business mode frame references
            if (i === 1) {
              // Scene 2 — showcase business using the business photos, NO avatar
              preparedBusinessPhotos.slice(0, 3).forEach(u => imageUrls.push(u));
            } else {
              if (preparedAvatar) imageUrls.push(preparedAvatar);
              if (prevFrame) imageUrls.push(prevFrame);
              // Include a business photo for context in solution/CTA scenes
              if (preparedBusinessPhotos.length > 0 && (i === 2 || i === 3)) {
                imageUrls.push(preparedBusinessPhotos[0]);
              }
            }
          } else {
            // UGC mode frame references
            if (i === 1) {
              // Scene 2 — pure product beauty shot, NO avatar, NO prev frame
              if (preparedProduct) imageUrls.push(preparedProduct);
            } else {
              if (preparedAvatar) imageUrls.push(preparedAvatar);
              if (prevFrame) imageUrls.push(prevFrame);
              if (preparedProduct && (i === 2 || i === 3)) imageUrls.push(preparedProduct);
            }
          }
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

        // Validate Kling output is a real, non-empty video. Kling sometimes
        // returns a URL but the file is empty/corrupt — especially for the
        // person-less product shot in scene 2.
        const valid = videoUrl ? await verifyVideoUrl(videoUrl) : false;
        if (!valid) {
          console.warn(`[Job ${jobId}] Kling scene ${i+1} produced empty/invalid video — falling back to static frame video`);
          const staticUrl = await frameToStaticVideo(frameUrl, 5);
          console.log(`[Job ${jobId}] Static fallback for scene ${i+1}:`, staticUrl ? 'OK' : 'failed');
          return staticUrl || null;
        }
        return videoUrl;
      } catch (e) {
        console.error(`[Job ${jobId}] Kling scene ${i+1} error:`, e.message);
        // Last resort: try to build a static video from the NB frame so the export
        // still has 4 valid clips and doesn't crash on "speed=0x" empty input.
        try {
          const staticUrl = await frameToStaticVideo(frameUrl, 5);
          console.log(`[Job ${jobId}] Static fallback after Kling error for scene ${i+1}:`, staticUrl ? 'OK' : 'failed');
          return staticUrl || null;
        } catch {}
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

// Map feminine Hebrew verb/adjective forms → masculine equivalents.
// Used by getHook / getDefaultVoiceover to produce gender-correct fallback text
// when the voice is male (Daniel) and Claude was unavailable.
const FEMININE_TO_MASCULINE = [
  ['חיפשתי', 'חיפשתי'], // same
  ['התאים לי', 'התאים לי'], // same
  ['מביכה', 'מובך'],
  ['מובכת', 'מובך'],
  ['הרגשתי נורא', 'הרגשתי נורא'],
  ['ניסיתי', 'ניסיתי'],
  ['עזר לי', 'עזר לי'],
  ['נראו זולים', 'נראו זולים'],
  ['הרגשתי בנוח', 'הרגשתי בנוח'],
  ['מתהפכת', 'מתהפך'],
  ['מתהפכ', 'מתהפכ'],
  ['הייתי כל כך עייפה', 'הייתי כל כך עייף'],
  ['עייפה', 'עייף'],
  ['ידעתי', 'ידעתי'],
  ['ראיתי', 'ראיתי'],
  ['בזבזתי', 'בזבזתי'],
  ['מבזבזת', 'מבזבז'],
  ['מבזבז זמן', 'מבזבז זמן'],
  ['הייתה אומללה', 'הייתה אומללה'],
  ['לא עבד לי', 'לא עבד לי'],
  ['לא עבד', 'לא עבד']
];
function toMasculine(text) {
  if (!text) return text;
  let out = text;
  for (const [fem, mas] of FEMININE_TO_MASCULINE) {
    if (fem === mas) continue;
    out = out.split(fem).join(mas);
  }
  return out;
}

function getHook(productName, productDesc, voiceGender = 'female') {
  const desc = ((productDesc || '') + ' ' + (productName || '')).toLowerCase();
  let raw = 'ניסיתי המון דברים כדי לפתור את זה ושום דבר פשוט לא עבד לי';

  // Fashion / clothing
  if (/שמלה|בגד|חולצה|מכנס|נעל|תיק|אופנה|dress|shirt|clothes|fashion|pants|shoes|bag/.test(desc))
    raw = 'כל פעם שחיפשתי משהו לאירוע זה היה יקר מדי או לא התאים לי';
  // Dental / teeth
  else if (/שינ|דנטל|לבן|משחת|teeth|dental|whiten/.test(desc))
    raw = 'הייתי מביכה לחייך בתמונות בגלל השיניים שלי והרגשתי נורא';
  // Skincare
  else if (/קרם|פנים|אקנה|עור|סרום|skincare|cream|serum|acne|face/.test(desc))
    raw = 'ניסיתי כל קרם בשוק ושום דבר לא עזר לי עם העור שלי';
  // Hair
  else if (/שיער|hair|שמפו/.test(desc))
    raw = 'השיער שלי היה נושר ונשבר וכלום לא עזר לי באמת';
  // Jewelry / accessories
  else if (/שעון|תכשיט|צמיד|שרשרת|watch|jewelry|bracelet|necklace/.test(desc))
    raw = 'האביזרים שלי תמיד נראו זולים ולא הרגשתי בנוח איתם';
  // Sleep
  else if (/שינה|לישון|כרית|מזרון|sleep|pillow|mattress/.test(desc))
    raw = 'כל לילה הייתי מתהפכת במיטה שעות בלי להצליח להירדם';
  // Food / restaurant / meal kit
  else if (/אוכל|מסעדה|ארוחה|מזון|תזונה|food|meal|restaurant|diet/.test(desc))
    raw = 'הייתי כל כך עייפה מלבשל כל יום ולא ידעתי מה לעשות';
  // Supplement / vitamin
  else if (/ויטמין|תוסף|חלבון|supplement|vitamin|protein/.test(desc))
    raw = 'הרגשתי עייפה כל היום וכלום לא נתן לי באמת אנרגיה';
  // Fitness / workout
  else if (/כושר|אימון|ספורט|הרזיה|דיאטה|fitness|workout|gym|weight|exercise/.test(desc))
    raw = 'ניסיתי כל שיטה בעולם ופשוט לא ראיתי שום תוצאות';
  // Tech / gadget / app
  else if (/אפליקציה|גאדג׳ט|טכנולוגיה|מכשיר|app|tech|gadget|device|software/.test(desc))
    raw = 'בזבזתי שעות כל יום על משהו שהיה אמור להיות פשוט';
  // Cleaning
  else if (/ניקוי|ניקיון|כביסה|cleaning|detergent|clean/.test(desc))
    raw = 'בזבזתי שעות על ניקיון והבית עדיין נראה לא נקי';
  // Baby / kids
  else if (/תינוק|ילד|baby|kid|child/.test(desc))
    raw = 'הילדים שלי לא היו מפסיקים להתעצבן ולא ידעתי מה לעשות';
  // Home / furniture / decor
  else if (/בית|ריהוט|עיצוב|home|furniture|decor/.test(desc))
    raw = 'הבית שלי אף פעם לא הרגיש מסודר למרות שניסיתי הכל';
  // Pet
  else if (/כלב|חתול|חיית|pet|dog|cat/.test(desc))
    raw = 'החיה שלי הייתה אומללה וכל מה שניסיתי פשוט לא עבד';
  // Car accessories
  else if (/רכב|אוטו|מכונית|car|vehicle/.test(desc))
    raw = 'כל נסיעה הייתה מעצבנת אותי והרגשתי שאני מבזבזת זמן';

  return voiceGender === 'male' ? toMasculine(raw) : raw;
}

// Helper: apply masculine conversion if voice gender is male
function applyGender(text, voiceGender) {
  return voiceGender === 'male' ? toMasculine(text) : text;
}

function getDefaultVoiceover(productName, applicationArea, hook, voiceGender = 'female') {
  const h = hook || getHook(productName, '', voiceGender);
  const raw = `${h}. זה ${productName} — פתרון חכם שכולם מדברים עליו. עד שגיליתי את ${productName} ואז הכל השתנה, ${applicationArea} והתוצאות מטורפות. תנסו את ${productName} — יש אחריות מלאה אין מה להפסיד!`;
  return applyGender(raw, voiceGender);
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
      type: 'מוצר',
      nb_prompt: `Close-up beauty shot of ${productName} resting naturally on a realistic surface — on a wooden table, marble counter, bathroom sink, or being held stably in one hand. Product must have clear physical support and cast a realistic shadow underneath. Clean background, beautiful soft natural lighting, product is the hero of the shot, NO person or avatar visible (other than a steady hand holding it if appropriate), product details clearly visible, preserve exact product appearance from reference image, product shape and colors unchanged from reference. Negative: product NOT floating, NOT levitating, NOT suspended in air, NOT hovering, always has physical contact with a surface or hand, realistic gravity, realistic shadow and reflection.`,
      kling_prompt: `Camera slowly orbits around ${productName} resting on a stable surface, product stays stationary and grounded with clear contact shadow, subtle zoom-in, cinematic product shot, soft natural light, silent, smooth natural motion only, no floating, no levitating, no hovering, product shape and colors unchanged from reference`,
      subtitle: `זה ${productName} — ${productDesc}.`
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

// ============ BUSINESS MODE ============

function getBusinessCategory(desc) {
  const d = (desc || '').toLowerCase();
  if (/מסעד|קפה|פיצרי|בר|אוכל|שף|מטבח|restaurant|cafe|bar|food|kitchen|pizza|sushi|burger/.test(d)) return 'restaurant';
  if (/אופנה|בוטיק|בגד|חולצ|שמל|fashion|boutique|clothing|apparel|shop|store/.test(d)) return 'fashion';
  if (/קליניק|מרפא|רופא|טיפול|אסתטי|שיני|קוסמטיק|clinic|dental|doctor|therapy|aesthetic|beauty|spa|massage/.test(d)) return 'clinic';
  if (/מספר|תסרוק|ספר|salon|hair|barber/.test(d)) return 'salon';
  if (/כושר|חדר כושר|אימון|יוגה|פילאטיס|gym|fitness|yoga|pilates|trainer/.test(d)) return 'fitness';
  return 'generic';
}

function getBusinessHook(desc, name, voiceGender = 'female') {
  const cat = getBusinessCategory(desc);
  const hooks = {
    restaurant: 'כל פעם שרציתי לצאת לאכול בחוץ, הייתי מתלבטת ונגמר הערב בפלאפל',
    fashion: 'כל פעם שחיפשתי בגד חדש, בחנויות היה הכל אותו דבר ומשעמם',
    clinic: 'שנים התלוננתי על הבעיה הזאת וכל מי שהלכתי אליו לא באמת עזר',
    salon: 'כל פעם שהלכתי להסתפר יצאתי מאוכזבת ולא כמו שדמיינתי',
    fitness: 'רציתי להתחיל להתאמן כבר שנים אבל שום מקום לא גרם לי להרגיש בנוח',
    generic: 'היה לי צורך בשירות איכותי וכל מה שמצאתי פשוט לא הרגיש נכון',
  };
  // Masculine equivalents for Daniel (male) voice
  const hooksMale = {
    restaurant: 'כל פעם שרציתי לצאת לאכול בחוץ, הייתי מתלבט ונגמר הערב בפלאפל',
    fashion: 'כל פעם שחיפשתי בגד חדש, בחנויות היה הכל אותו דבר ומשעמם',
    clinic: 'שנים התלוננתי על הבעיה הזאת וכל מי שהלכתי אליו לא באמת עזר',
    salon: 'כל פעם שהלכתי להסתפר יצאתי מאוכזב ולא כמו שדמיינתי',
    fitness: 'רציתי להתחיל להתאמן כבר שנים אבל שום מקום לא גרם לי להרגיש בנוח',
    generic: 'היה לי צורך בשירות איכותי וכל מה שמצאתי פשוט לא הרגיש נכון',
  };
  const map = voiceGender === 'male' ? hooksMale : hooks;
  return map[cat] || map.generic;
}

function getBusinessDefaultVoiceover(name, desc, hook, voiceGender = 'female') {
  const h = hook || getBusinessHook(desc, name, voiceGender);
  const raw = `${h}. ואז גיליתי את ${name} — ${desc}. הייתי שם בעצמי וזה פשוט שינה לי את החוויה לגמרי. חייבים לבוא ל${name} — תזמינו עכשיו!`;
  return voiceGender === 'male' ? toMasculine(raw) : raw;
}

function getBusinessDefaultScenes(name, desc) {
  const hook = getBusinessHook(desc, name);
  return [
    {
      type: 'הוק',
      nb_prompt: `avatar showing relatable situation where ${name} solves a need, natural everyday scene, frustrated or searching expression, NO business name visible, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar showing relatable everyday frustration before discovering the business, NO business name visible, ${STABLE}`,
      subtitle: hook
    },
    {
      type: 'עסק',
      nb_prompt: `Beautiful cinematic shot of ${name} business — ${desc}, highlight the space/product/atmosphere, NO person visible, NO avatar, beautiful natural lighting, inviting and warm, preserve exact appearance of business from reference images`,
      kling_prompt: `Cinematic reveal of the ${name} business space/offering, showcase the atmosphere and highlights, NO person visible, beautiful natural lighting, silent, smooth natural motion only, business appearance unchanged from reference`,
      subtitle: `זה ${name} — ${desc}`
    },
    {
      type: 'חוויה',
      nb_prompt: `avatar experiencing ${name}, happily engaged with the business offering, warm and excited expression, business context visible in background, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar genuinely enjoying the experience at ${name}, happy engaged expression, business context visible, ${STABLE}`,
      subtitle: `הייתי ב${name} — ממש חוויה אחרת, ההבדל ניכר מהרגע הראשון.`
    },
    {
      type: 'CTA',
      nb_prompt: `avatar smiling warmly recommending ${name}, genuine happy expression, business context visible, natural smile, correct human anatomy, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar warmly recommending ${name} to camera, genuine smile, inviting gesture, ${STABLE}`,
      subtitle: `חייבים לנסות את ${name} — קבעו עכשיו, אל תפספסו!`
    }
  ];
}

async function generateBusinessScript(name, desc, hook, voiceGender) {
  if (!ANTHROPIC_KEY) return null;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const genderInstruction = voiceGender === 'male'
    ? `GENDER (CRITICAL — MALE SPEAKER): כתוב את כל הקריינות בלשון זכר בלבד. דוגמאות: 'הייתי מובך' (לא 'מביכה'/'מובכת'), 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוח', 'אני חייב', 'התאכזבתי', 'האמנתי', 'מחפש' (לא 'מחפשת'), 'מרוצה' (זכר), 'מוכן', 'משתמש'. כל פועל, תואר וכינוי חייב להיות בלשון זכר. הדובר הוא גבר. אל תערבב לשון נקבה.`
    : `GENDER (CRITICAL — FEMALE SPEAKER): כתוב את כל הקריינות בלשון נקבה בלבד. דוגמאות: 'הייתי מובכת', 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוחה', 'אני חייבת', 'התאכזבתי', 'האמנתי', 'מחפשת' (לא 'מחפש'), 'מרוצה' (נקבה), 'מוכנה', 'משתמשת'. כל פועל, תואר וכינוי חייב להיות בלשון נקבה. הדוברת היא אישה. אל תערבב לשון זכר.`;

  const cat = getBusinessCategory(desc);
  const categoryHints = {
    restaurant: 'Focus on food, atmosphere, special dishes, the experience of eating there. Highlight taste, warmth, family/friend vibes.',
    fashion: 'Focus on style, the collection, the shopping experience, unique pieces, feel good in what you wear.',
    clinic: 'Focus on expertise, results, client experience, trust, professionalism, before/after feeling.',
    salon: 'Focus on the styling experience, the result, how the customer feels after leaving.',
    fitness: 'Focus on the vibe of the place, the trainers, the results, community feel.',
    generic: 'Focus on what makes this business special, the customer experience, the result.',
  };

  const callClaude = async (extra = '') => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 2500,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing scripts in Hebrew for LOCAL BUSINESSES. Create a viral 4-scene ad for this business:

Business name: "${name}"
Business description: ${desc}
Auto-detected category: ${cat}
Category guidance: ${categoryHints[cat]}

${genderInstruction}

This is a BUSINESS VIDEO (not a product ad). Write in casual conversational Hebrew — feels like a real customer recommending the business to a friend.

SCENE STRUCTURE (business mode):
- Scene 1 (Hook): relatable situation where THIS BUSINESS solves a need. NO business name mentioned. Universal pain for this business's category.
- Scene 2 (Show): highlight the business/product using the reference photos. NO avatar, NO person. Just the business space / offering as the hero. Voiceover describes what the business is and what makes it special.
- Scene 3 (Experience): the avatar experiencing the business — happy, engaged, "I was there". Uses business context from the reference photos.
- Scene 4 (CTA): visit/order/contact with urgency. Warm recommendation.

VOICEOVER TIMING — STRICT:
- Scene 1: ~12 Hebrew words
- Scene 2: ~14 Hebrew words (describe the business, its offering, what's special)
- Scene 3: ~18 Hebrew words (experience at the business — what it felt like)
- Scene 4: ~12 Hebrew words (strong CTA — visit, order, contact, with urgency)

SENTENCE COMPLETENESS (CRITICAL):
כל משפט חייב להסתיים בתוך הסצנה שלו. אסור שמשפט ימשיך לסצנה הבאה. כל סצנה = משפט שלם או שניים שלמים.
- Each voiceover_sceneN must be a SELF-CONTAINED complete sentence (or two) ending with . ? or !.
- NEVER end a scene mid-phrase and NEVER start a scene with a word that only makes sense as a continuation of the previous one.
- If you read a single scene's voiceover in isolation, it must be a grammatically complete Hebrew sentence.

HOOK (voiceover_scene1) — PRE-SET:
voiceover_scene1 is already: "${hook}" — use this EXACT text.

EVERY nb_prompt MUST start with: "CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body." AND MUST end with: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle". If the avatar holds something, use only ONE hand, other hand relaxed at side.
(except scene 2 which has no person — the anatomy rule doesn't apply there)

END every Kling prompt with: "silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference"

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "~12 Hebrew words — universal pain for this business's category, NO business name",
  "voiceover_scene2": "~14 Hebrew words — describe ${name} visually, what it is, what makes it special",
  "voiceover_scene3": "~18 Hebrew words — experience at ${name}, what it felt like being there",
  "voiceover_scene4": "~12 Hebrew words — warm CTA with urgency: visit/order/contact ${name} now",
  "setting": "one-line description",
  "scenes": [
    {
      "type": "הוק",
      "nb_prompt": "avatar showing relatable everyday frustration that ${name} solves, natural setting, NO business name visible, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar showing relatable frustration, NO business name visible, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "עסק",
      "nb_prompt": "Beautiful cinematic shot of ${name} — ${desc}, highlight the business space/product/atmosphere, NO person visible, NO avatar, beautiful natural lighting, inviting atmosphere, preserve exact appearance from reference images",
      "kling_prompt": "Cinematic reveal of ${name}, showcase the atmosphere and highlights, NO person visible, beautiful natural lighting, silent, smooth natural motion only, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "חוויה",
      "nb_prompt": "avatar at ${name} enjoying the experience, happy engaged expression, business context visible in background from reference, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar genuinely enjoying the experience at ${name}, business context visible, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "CTA",
      "nb_prompt": "avatar warmly recommending ${name}, genuine smile, business context visible, correct human anatomy, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar warmly recommending ${name} to camera, genuine smile, inviting gesture, silent, no talking, no lip movement, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene4"
    }
  ]
}${extra}` }]
  });
  const parseResponse = (message) => {
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
  };

  let parsed = parseResponse(await callClaude());
  if (parsed && scriptGenderMismatch(parsed.voiceover, voiceGender)) {
    console.warn(`[generateBusinessScript] Gender mismatch (wanted ${voiceGender}), regenerating...`);
    const extraInstruction = `\n\nPREVIOUS ATTEMPT HAD WRONG GENDER. ${genderInstruction}\nREWRITE every verb, adjective, and pronoun to match the speaker's gender (${voiceGender}). Do NOT mix genders. Verify every single word.`;
    const retry = parseResponse(await callClaude(extraInstruction));
    if (retry) parsed = retry;
  }
  if (parsed && scenesHaveBrokenSentences(parsed.scenes)) {
    console.warn('[generateBusinessScript] Broken sentences across scenes, regenerating...');
    const extraInstruction = `\n\nPREVIOUS ATTEMPT HAD SENTENCES SPLIT ACROSS SCENES. REWRITE so each voiceover_sceneN is a SELF-CONTAINED grammatically complete Hebrew sentence ending with . ? or ! — and no scene starts with a word that depends on the previous scene.`;
    const retry = parseResponse(await callClaude(extraInstruction));
    if (retry) parsed = retry;
  }
  return parsed;
}
