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

async function generateNBFrame(prompt, imageUrls, maxRetries = 3, opts = {}) {
  const validUrls = imageUrls.filter(Boolean);
  const productOnly = opts.productOnly === true;
  console.log('NB input:', { promptLen: prompt?.length, urlCount: validUrls.length, productOnly, urlPreviews: validUrls.map(u => u?.slice(0, 60)) });

  let enhancedPrompt;
  if (productOnly) {
    // Scene 2 — strict product-only composition. Do NOT include anatomy/person
    // language that could make NanoBanana insert a model. Push very loudly that
    // the frame must contain zero humans.
    const productOnlyRule = 'PRODUCT ONLY SHOT — absolutely no person, no human, no hands holding the product, no face, no body parts, no avatar, no model. The frame contains ONLY the product resting on a surface. Pure product photography, studio-style, no humans in frame whatsoever.';
    const productNegatives = 'Negative (STRICT): person, human, woman, man, hands, face, body, avatar, model, people, arms, fingers, holding, selfie, skin, hair, limbs, silhouette.';
    enhancedPrompt = `${productOnlyRule} ${prompt}, realistic product photography, product clearly resting on a physical surface with contact shadow, soft natural lighting, clean uncluttered background, photorealistic. ${productNegatives}`;
  } else {
    const anatomyPrefix = 'CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body.';
    const negativeConcepts = 'Negative (avoid): extra arms, extra hands, third hand, disembodied limbs, floating hands, phantom limbs, multiple arms, anatomically incorrect, deformed hands, mutant hands, extra fingers, six fingers, hands from outside frame, partial limbs entering from edges.';
    const singleHandRule = 'If holding a product, hold it with ONE hand only, other hand visible and relaxed at side, never two items at once.';
    enhancedPrompt = `${anatomyPrefix} ${prompt}, authentic UGC selfie look, natural skin texture with visible pores, amateur iPhone vertical photo, slight overexposure from window light, candid unposed feel, no retouching, no studio lighting, real avatar not model, ${singleHandRule} exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle. ${negativeConcepts}`;
  }

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

// Join 4 scene voiceovers into ONE continuous paragraph for ElevenLabs.
// We strip trailing sentence terminators on all-but-last chunks and glue with
// a single space, so ElevenLabs reads the entire script as one flowing
// paragraph rather than inserting long pauses at each scene boundary.
function joinVoiceoverChunks(chunks) {
  const cleaned = chunks
    .map(c => (c || '').trim())
    .filter(Boolean);
  if (cleaned.length === 0) return '';
  const last = cleaned.length - 1;
  const stripped = cleaned.map((c, i) => {
    if (i === last) return c;
    // Strip trailing . ! ? … and whitespace so the next chunk flows on naturally.
    return c.replace(/[.!?…\s]+$/u, '');
  });
  let joined = stripped.join(' ').replace(/\s+/g, ' ').trim();
  // Guarantee exactly one terminal period.
  joined = joined.replace(/[.!?…\s]+$/u, '');
  if (joined) joined += '.';
  return joined;
}

async function generateVoice(text, voiceId) {
  if (!ELEVEN_KEY || !text) return null;
  const voice = voiceId || ELEVEN_VOICE;
  // Hebrew preprocessing — fix nikud + add natural pause commas before
  // sending to ElevenLabs so the TTS doesn't mispronounce common words.
  const cleanedText = cleanHebrewText(text);
  try {
    // Use with-timestamps endpoint for word-level alignment data.
    // stability 0.5 / similarity 0.75 favours a smoother, more continuous
    // delivery vs the jittery scene-boundary pauses we saw with higher values.
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanedText, model_id: 'eleven_v3', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true } })
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
// Detect a weak, ad-speak scene-1 opener: a bare action verb (ניסיתי / חיפשתי /
// רציתי) as the FIRST word with no emotional or situational framing. Also flags
// the specific generic phrase we used to fall back to when no category matched.
// We allow those verbs anywhere else — the restriction is only "first word".
const BAD_SCENE1_FIRST_WORDS = new Set(['ניסיתי', 'חיפשתי', 'רציתי']);
function sceneOneIsWeakOpener(sceneOneText) {
  if (!sceneOneText) return false;
  const trimmed = sceneOneText.trim().replace(/^["'״'(\[]+/, '');
  const firstWord = trimmed.split(/\s+/)[0] || '';
  if (BAD_SCENE1_FIRST_WORDS.has(firstWord)) return true;
  // The generic legacy hook phrase — reject outright if Claude echoed it.
  if (/ניסיתי המון דברים/.test(trimmed)) return true;
  return false;
}

// Detect borrowed/transliterated English words that sound robotic in Hebrew TTS
// and that the Claude prompt explicitly forbids. Any match forces a regen.
const FOREIGN_BORROWED_WORDS = [
  /\bסטיילית\b/u, /\bסטיילי\b/u,
  /\bטרנדי\b/u, /\bטרנדית\b/u,
  /\bקולית\b/u, /\bקולי\b/u,
  /\bסאפר\b/u,
  /\bאאוטפיט\b/u,
];
function scriptHasForeignWords(fullText) {
  if (!fullText) return false;
  return FOREIGN_BORROWED_WORDS.some(re => re.test(fullText));
}

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

1a. HOOK MUST HINT AT THE SPECIFIC CATEGORY (critical):
ההוק חייב לרמוז באופן ברור על קטגוריית הבעיה — לא רק "ניסיתי הכל". הצופה חייב להבין מהמילה הראשונה על איזה תחום אנחנו מדברים (שיער, עור, בגדים, שיניים, כיסוי ראש וכו').
- BAD (too generic): "ניסיתי המון דברים ושום דבר לא עבד" — viewer has NO idea what problem is being solved.
- GOOD (category is clear from the first sentence):
  * Kipah/head covering: "כל כיפה שקניתי הייתה לא נוחה או לא התאימה לראש שלי"
  * Teeth whitening: "כל פעם שחייכתי בתמונות הרגשתי לא בנוח עם השיניים שלי"
  * Skincare: "העור שלי היה יבש ומודלק וכלום לא עזר לי"
  * Fashion: "כל פעם שהייתי צריכה שמלה לאירוע זה היה יקר מדי"
- The hook must name the BODY PART, GARMENT, or DOMAIN that's affected — without naming the product/brand itself. The viewer should read it and instantly know "this is about X".

1b. EMOTIONAL, NON-ACTION-VERB OPENING (critical):
Scene 1 voiceover should open with an emotional state, a recurring situation, or a concrete scene — NOT with a bare action verb.
- BAD openings (never start a scene with these as the first word, without emotional context): "ניסיתי", "חיפשתי", "רציתי" standing alone. These feel disconnected and ad-like.
- GOOD openings (lead with feeling / recurring situation):
  * "כל פעם ש..." (every time that...)
  * "הייתי מרגישה ש..." (I used to feel that...)
  * "הרגשתי ש..." (I felt that...)
  * "תמיד היה לי ש..." (I always had that...)
  * "כל ... היה ..." (every X was Y)
- The opening must feel like a real person sharing a relatable story, not an ad intro.

1c. AUTHENTIC HEBREW — AVOID BORROWED FOREIGN WORDS (critical):
השתמש במילים עבריות אותנטיות. הימנע מלועזית מתורגמת ישירות (סטיילית, טרנדי, קולית). השתמש ב'עם סטייל', 'אלגנטית', 'מעוצבת' במקום.
- AVOID: "סטיילית", "טרנדי", "קולית", "סאפר", "אאוטפיט" — these sound robotic in TTS and feel like ad-speak.
- USE instead (native Hebrew alternatives):
  * Instead of "סטיילית" → "עם סטייל", "אלגנטית", "מעוצבת"
  * Instead of "טרנדי" → "עכשווי", "באופנה"
  * Instead of "קולית" → "מגניבה"
  * Instead of "אאוטפיט" → "לוק", "בגדים"
- This rule applies to ALL 4 scenes, not just the hook.

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
      "nb_prompt": "PRODUCT ONLY SHOT — absolutely no person, no human, no hands, no face, no body parts, no avatar, no model. Close-up beauty shot of ${productName} resting naturally on a realistic surface — on a wooden table, marble counter, or bathroom sink. Product must have clear physical support and cast a realistic contact shadow underneath. Clean background, beautiful soft natural lighting, product is the hero of the shot and the ONLY subject in frame, product details clearly visible, preserve exact product appearance from reference image, product shape and colors unchanged from reference. Negative: person, human, woman, man, hands, face, body, arms, fingers, holding, selfie, hair, skin, limbs, silhouette. Also: product NOT floating, NOT levitating, NOT suspended in air, NOT hovering.",
      "kling_prompt": "Camera slowly orbits around ${productName} resting on a stable surface, product stays stationary and grounded with clear contact shadow, subtle zoom-in, cinematic product shot, soft natural light, no person in frame, no hands, silent, smooth natural motion only, no floating, no levitating, no hovering, product shape and colors unchanged from reference",
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
      parsed.voiceover = joinVoiceoverChunks([v1, v2, v3, v4]);
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
  // Validate scene-1 opener quality — if Claude dropped the pre-set hook and
  // fell back to a bare "ניסיתי ..." style opener, force a regen with an
  // explicit rule about emotional framing.
  if (parsed && sceneOneIsWeakOpener(parsed.voiceover_scene1)) {
    console.warn('[generateScript] Weak scene-1 opener, regenerating...', parsed.voiceover_scene1?.slice(0, 40));
    const extraInstruction = `\n\nPREVIOUS ATTEMPT OPENED SCENE 1 WITH A BARE ACTION VERB (e.g. "ניסיתי ..."/"חיפשתי ..." as the first word). REWRITE voiceover_scene1 to open with an EMOTIONAL STATE or RECURRING SITUATION, using "כל פעם ש..." / "הייתי מרגישה ש..." / "הרגשתי ש..." / "תמיד היה לי ש...". The first word must NOT be ניסיתי/חיפשתי/רציתי. Keep the exact pre-set hook "${hook}" as the voiceover_scene1 text.`;
    const retry = parseResponse(await callClaude(extraInstruction));
    if (retry) parsed = retry;
  }
  // Validate authentic Hebrew — if Claude used borrowed/transliterated words
  // (סטיילית / טרנדי / קולית / סאפר / אאוטפיט), regen with the explicit
  // substitution rule.
  if (parsed && scriptHasForeignWords(parsed.voiceover)) {
    console.warn('[generateScript] Foreign borrowed words detected, regenerating...');
    const extraInstruction = `\n\nPREVIOUS ATTEMPT USED LOUSY TRANSLITERATED ENGLISH WORDS (סטיילית / טרנדי / קולית / סאפר / אאוטפיט). REWRITE using authentic Hebrew: "סטיילית" → "עם סטייל" / "אלגנטית" / "מעוצבת"; "טרנדי" → "עכשווי" / "באופנה"; "קולית" → "מגניבה"; "אאוטפיט" → "לוק" / "בגדים". These banned words must appear ZERO times in any voiceover scene.`;
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
        script.voiceover = joinVoiceoverChunks([hook, script.voiceover_scene2, script.voiceover_scene3, script.voiceover_scene4]);
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
        script.voiceover = joinVoiceoverChunks([hook, script.voiceover_scene2, script.voiceover_scene3, script.voiceover_scene4]);
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
          // Scene 2 is "product only" in both modes — strictly NO avatar reference.
          const isScene2 = i === 1;
          const productOnly = isScene2 && videoType !== 'business';
          if (videoType === 'business') {
            // Business mode frame references
            if (isScene2) {
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
            if (isScene2) {
              // Scene 2 — PURE product beauty shot. ONLY the product image; NO
              // avatar, NO prev frame, nothing that could leak a person into the
              // frame.
              if (preparedProduct) imageUrls.push(preparedProduct);
            } else {
              if (preparedAvatar) imageUrls.push(preparedAvatar);
              if (prevFrame) imageUrls.push(prevFrame);
              if (preparedProduct && (i === 2 || i === 3)) imageUrls.push(preparedProduct);
            }
          }
          const frameUrl = await generateNBFrame(scenes[i].nb_prompt, imageUrls, 3, { productOnly });
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

    // Kling videos — run all 4 in parallel with per-scene retry + static fallback
    console.log(`[Job ${jobId}] Starting all 4 Kling videos in parallel...`);
    const videoMeta = new Array(4).fill('none'); // 'kling' | 'static' | 'none'
    const runKlingOnce = async (i, frameUrl) => {
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
      const valid = videoUrl ? await verifyVideoUrl(videoUrl) : false;
      return { videoUrl, valid };
    };

    const videos = await Promise.all(frames.map(async (frameUrl, i) => {
      if (!frameUrl) { videoMeta[i] = 'none'; return null; }
      // Try Kling up to 3 times with 3s delay between retries. Log the full
      // error response (status + body) each time so we can debug why scene N
      // keeps producing empty videos.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[Job ${jobId}] Kling scene ${i+1}: attempt ${attempt}/3...`);
          const { videoUrl, valid } = await runKlingOnce(i, frameUrl);
          if (videoUrl && valid) {
            console.log(`[Job ${jobId}] Kling scene ${i+1}: OK on attempt ${attempt}`);
            videoMeta[i] = 'kling';
            return videoUrl;
          }
          console.warn(`[Job ${jobId}] Kling scene ${i+1} attempt ${attempt}: ${videoUrl ? 'empty/invalid video' : 'no URL returned'}`);
        } catch (e) {
          const status = e.status || e.statusCode || 'unknown';
          const body = e.body || e.message || String(e);
          console.error(`[Job ${jobId}] Kling scene ${i+1} attempt ${attempt} error — status: ${status}, body:`, JSON.stringify(body).slice(0, 600));
        }
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      // All 3 Kling attempts failed → static video fallback from NB frame.
      console.warn(`[Job ${jobId}] Kling scene ${i+1} failed after 3 attempts — falling back to static frame video`);
      try {
        const staticUrl = await frameToStaticVideo(frameUrl, 5);
        console.log(`[Job ${jobId}] Static fallback for scene ${i+1}:`, staticUrl ? 'OK' : 'failed');
        if (staticUrl) { videoMeta[i] = 'static'; return staticUrl; }
      } catch (e) {
        console.error(`[Job ${jobId}] Static fallback scene ${i+1} crashed:`, e.message);
      }
      videoMeta[i] = 'none';
      return null;
    }));

    console.log(`[Job ${jobId}] Video sources:`, videoMeta.map((m, i) => `scene${i+1}=${m}`).join(', '));

    const result = {
      story: { scenes, hebrew_voice: voiceover },
      frames,
      videos,
      audioBase64,
      wordTimestamps,
      hebrewVoice: voiceover,
      // Expose the voiceId the job ran with so the client can re-record
      // using the SAME voice and avoid gender drift on re-record.
      voiceId: voiceId || ELEVEN_VOICE
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
  // Default fallback — emotional + specific shape. Still generic when no
  // category matches, but opens with feeling rather than a bare action verb.
  let raw = 'הרגשתי שאני מנסה כל פתרון אפשרי וכלום פשוט לא התאים לי באמת';

  // Head covering / kipah / yarmulke (explicit category — hook hints the domain)
  if (/כיפה|כיפות|יארמולקה|כיסוי ראש|מטפחת|kipah|yarmulke|head cover/.test(desc))
    raw = 'כל כיפה שקניתי הייתה לא נוחה או לא התאימה לראש שלי';
  // Fashion / clothing
  else if (/שמלה|בגד|חולצה|מכנס|נעל|תיק|אופנה|dress|shirt|clothes|fashion|pants|shoes|bag/.test(desc))
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
      nb_prompt: `PRODUCT ONLY SHOT — absolutely no person, no human, no hands, no face, no body parts, no avatar, no model. Close-up beauty shot of ${productName} resting naturally on a realistic surface — on a wooden table, marble counter, or bathroom sink. Product must have clear physical support and cast a realistic contact shadow underneath. Clean background, beautiful soft natural lighting, product is the hero of the shot and the ONLY subject in frame, product details clearly visible, preserve exact product appearance from reference image, product shape and colors unchanged from reference. Negative: person, human, woman, man, hands, face, body, arms, fingers, holding, selfie, hair, skin, limbs, silhouette. Also: product NOT floating, NOT levitating, NOT suspended in air, NOT hovering.`,
      kling_prompt: `Camera slowly orbits around ${productName} resting on a stable surface, product stays stationary and grounded with clear contact shadow, subtle zoom-in, cinematic product shot, soft natural light, no person in frame, no hands, silent, smooth natural motion only, no floating, no levitating, no hovering, product shape and colors unchanged from reference`,
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

// Category-driven wardrobe / close-up action / scene-3 activity / venue.
// The avatar plays the SILENT employee or owner of the business — never talks.
function getCategoryUniform(cat) {
  switch (cat) {
    case 'restaurant': return 'chef coat or clean apron over a casual work shirt';
    case 'salon': return 'stylist apron over a stylish casual outfit';
    case 'clinic': return 'white medical coat over professional attire';
    case 'fitness': return 'activewear and professional trainer outfit';
    case 'fashion': return 'on-brand stylish outfit matching a modern boutique';
    default: return 'professional business attire appropriate for the venue';
  }
}
function getCategoryCloseUp(cat) {
  switch (cat) {
    case 'restaurant': return 'hands cutting fresh ingredients, plating food, garnishing a dish, steam rising from the pan';
    case 'salon': return 'scissors trimming hair in motion, blow-dryer airflow, brush shaping strands, color application';
    case 'clinic': return 'gloved hands applying product, professional device in use, close-up of treatment technique on skin';
    case 'fitness': return 'weights moving, hands gripping equipment, resistance band under tension, feet driving through a rep';
    case 'fashion': return 'hands sliding clothes on a rack, fabric texture detail, hanger in motion, folding a garment';
    default: return 'hands performing the core service action of the business';
  }
}
function getCategoryScene3Action(cat) {
  switch (cat) {
    case 'restaurant': return 'plating a finished dish at the pass, stirring a pot, focused on the food, adjusting garnish';
    case 'salon': return 'styling a client whose back is to the camera, holding scissors mid-cut, finishing a blowout';
    case 'clinic': return 'performing a treatment on a reclined client, holding a professional device, focused on technique';
    case 'fitness': return 'demonstrating an exercise, spotting a trainee, setting up equipment with focus';
    case 'fashion': return 'arranging clothes on a display, greeting a customer at the rack, folding a garment with care';
    default: return 'performing the core service of the business with focused professional expression';
  }
}
function getCategoryVenue(cat) {
  switch (cat) {
    case 'restaurant': return 'restaurant kitchen and dining area';
    case 'salon': return 'hair salon with chairs, mirrors and styling stations';
    case 'clinic': return 'modern clean clinic treatment room';
    case 'fitness': return 'modern gym or training studio';
    case 'fashion': return 'stylish boutique interior with clothing racks and display';
    default: return 'professional business interior';
  }
}

// New business hook — third-person / customer-perspective narration.
// The avatar is the SILENT employee; the voiceover describes the business
// from an outside narrator's POV (never "היי אני" from the avatar).
function getBusinessHook(desc, name, voiceGender = 'female') {
  const cat = getBusinessCategory(desc);
  const hooks = {
    restaurant: `${name || 'המסעדה הזאת'} — המקום שכולם מדברים עליו`,
    fashion: `${name || 'הבוטיק הזה'} — מוצאים כאן חתיכות שלא תמצאו בשום מקום`,
    clinic: `${name || 'הקליניקה הזאת'} — כאן מקבלים יחס אמיתי ותוצאות`,
    salon: `${name || 'המספרה הזאת'} — יוצאים מכאן אחרים`,
    fitness: `${name || 'הסטודיו הזה'} — מתאמנים כאן אחרת`,
    generic: `${name || 'העסק הזה'} — זה לא סתם עוד עסק בשכונה`,
  };
  // Third-person narration works for any gender; keep consistent.
  return hooks[cat] || hooks.generic;
}

function getBusinessDefaultVoiceover(name, desc, hook, voiceGender = 'female') {
  const h = hook || getBusinessHook(desc, name, voiceGender);
  // Third-person / customer perspective — avatar does NOT talk.
  return `${h}. הסוד? כל פרט נעשה בידיים, טרי, מהרגע הראשון. ב${name} מרגישים את ההבדל מיד — ${desc || 'חוויה אמיתית'}, וזה מה שגורם ללקוחות לחזור. בואו ל${name} — אתם חייבים לנסות את זה.`;
}

function getBusinessDefaultScenes(name, desc) {
  const hook = getBusinessHook(desc, name);
  const cat = getBusinessCategory(desc);
  const uniform = getCategoryUniform(cat);
  const closeUp = getCategoryCloseUp(cat);
  const scene3Action = getCategoryScene3Action(cat);
  const venue = getCategoryVenue(cat);
  const silentRule = 'silent, NOT speaking, NOT looking like talking, mouth closed or natural relaxed smile, no open-mouth expression, no lip movement implied';
  return [
    {
      type: 'הכנסה',
      nb_prompt: `avatar wearing ${uniform} inside a ${venue}, starting their workday with calm confident posture, ${silentRule}, iPhone handheld documentary style, natural daylight, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar adjusts apron or uniform and looks around the workspace with calm confidence, subtle natural body motion, ${STABLE}`,
      subtitle: hook
    },
    {
      type: 'פעולה',
      nb_prompt: `extreme close-up of ${closeUp}, NO face visible, NO full person, only hands and tools, cinematic shallow depth of field, warm natural lighting, professional documentary close-up, preserve atmosphere and colors from reference images`,
      kling_prompt: `Slow cinematic motion of ${closeUp}, hands working smoothly with clear purpose, NO person visible, silent, smooth natural motion only, business appearance unchanged from reference`,
      subtitle: `כל פרט נעשה בידיים`
    },
    {
      type: 'בפעולה',
      nb_prompt: `avatar wearing ${uniform} ${scene3Action}, inside the ${venue}, focused professional expression with mouth closed, authentic documentary moment, warm interior lighting, ${silentRule}, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar ${scene3Action}, natural working motion, hands moving with purpose, focused expression, ${STABLE}`,
      subtitle: `ב${name} עושים את זה ברמה אחרת`
    },
    {
      type: 'הזמנה',
      nb_prompt: `avatar wearing ${uniform} standing at the entrance of ${name} near the sign, open welcoming gesture with hands, warm relaxed smile with mouth closed, business signage visible in background, golden hour warm lighting, inviting atmosphere, ${silentRule}, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar stands near ${name} sign, gentle welcoming gesture with open hands, slight head nod, mouth-closed warm smile, ${STABLE}`,
      subtitle: `בואו ל${name} — אתם חייבים לנסות`
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
  const uniform = getCategoryUniform(cat);
  const closeUp = getCategoryCloseUp(cat);
  const scene3Action = getCategoryScene3Action(cat);
  const venue = getCategoryVenue(cat);
  const categoryHints = {
    restaurant: 'Focus on the craft of the food, freshness, the kitchen energy, what customers taste and feel.',
    fashion: 'Focus on the boutique vibe, the pieces, the feel of the fabric, the personal touch.',
    clinic: 'Focus on expertise, care, results, the calm professionalism of the treatment room.',
    salon: 'Focus on the styling craft, the finish, the confidence customers leave with.',
    fitness: 'Focus on the energy of the space, the trainers, how members feel leaving a session.',
    generic: 'Focus on what the owner does uniquely well and why customers keep coming back.',
  };

  const callClaude = async (extra = '') => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 2500,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing Hebrew scripts for LOCAL BUSINESSES. Redesigned business-video format:

Business name: "${name}"
Business description: ${desc}
Auto-detected category: ${cat}
Venue: ${venue}
Uniform: ${uniform}
Close-up action: ${closeUp}
Scene-3 activity: ${scene3Action}
Category guidance: ${categoryHints[cat]}

${genderInstruction}

CRITICAL ROLE RULES — THE AVATAR PLAYS THE SILENT EMPLOYEE/OWNER:
- The avatar represents the employee or owner of "${name}" — NOT a customer.
- The avatar NEVER talks, NEVER appears to talk, NEVER opens the mouth wide.
- The avatar's mouth must be closed or a natural relaxed smile in every scene with the avatar.
- Voiceover plays OVER the 4 scenes as background narration — it is NOT spoken by the avatar.

NARRATION STYLE (CRITICAL — NOT FIRST PERSON FROM THE AVATAR):
- The voiceover is third-person or customer-perspective narration ABOUT "${name}".
- NEVER write "היי אני ..." or anything that sounds like the avatar speaking.
- Natural Israeli narration like: "במסעדה הזאת כל מנה מוכנה טריה", "אם אתם מחפשים ...", "הסוד של ${name} זה ...", "כל מי שמגיע ל${name} מבין מיד ...".

NEW 4-SCENE STRUCTURE:
- Scene 1 (👋 הכנסה): avatar wearing ${uniform}, inside the ${venue}, starting their workday — putting on apron / standing behind the counter / arriving at the workspace. Mouth closed. Voiceover HOOK.
- Scene 2 (✨ פעולה): EXTREME CLOSE-UP of ${closeUp}. NO face, NO full person — only hands and tools/products. Uses business/product reference photos for authenticity. Voiceover describes the craft.
- Scene 3 (🏪 בפעולה): avatar ${scene3Action} inside the ${venue}. Mouth closed, focused professional expression. Voiceover describes the story / unique value of ${name}.
- Scene 4 (🚀 הזמנה): avatar at entrance of ${name}, near the sign/logo or behind the counter. Open welcoming gesture, warm relaxed mouth-closed smile. Voiceover CTA.

VOICEOVER TIMING — STRICT:
- Scene 1: ~10 Hebrew words — hook about ${name}, third-person narration.
- Scene 2: ~12 Hebrew words — describe the craft/action shown in the close-up.
- Scene 3: ~16 Hebrew words — unique value / story of ${name}, what customers get.
- Scene 4: ~10 Hebrew words — direct CTA: "בואו ל${name}", "תזמינו עכשיו", "אתם חייבים לנסות".

SENTENCE COMPLETENESS (CRITICAL):
כל משפט חייב להסתיים בתוך הסצנה שלו. כל סצנה = משפט שלם או שניים שלמים.
- Each voiceover_sceneN must be a SELF-CONTAINED Hebrew sentence ending with . ? or !.
- NEVER end a scene mid-phrase; NEVER start a scene with a word that depends on the previous one.

HOOK (voiceover_scene1) — PRE-SET:
voiceover_scene1 is already: "${hook}" — use this EXACT text.

EVERY nb_prompt for scenes 1, 3, 4 MUST start with: "CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body." AND MUST end with: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle". Scene 2 (hands-only close-up) must explicitly say "NO face visible, NO full person, only hands and tools".

EVERY nb_prompt for scenes with the avatar MUST include: "silent, NOT speaking, NOT looking like talking, mouth closed or natural relaxed smile, no open-mouth expression, no lip movement implied".

END every Kling prompt with: "silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference"

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "~10 Hebrew words — third-person hook about ${name}",
  "voiceover_scene2": "~12 Hebrew words — describe the craft/action shown in the hands-only close-up",
  "voiceover_scene3": "~16 Hebrew words — unique value / story of ${name}, what customers experience",
  "voiceover_scene4": "~10 Hebrew words — direct CTA to visit ${name}",
  "setting": "one-line description of the ${venue}",
  "scenes": [
    {
      "type": "הכנסה",
      "nb_prompt": "avatar wearing ${uniform} inside a ${venue}, starting their workday with calm confident posture, mouth closed with natural relaxed expression, silent NOT speaking, iPhone handheld documentary style, natural daylight, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar adjusts apron or uniform and looks around the workspace with calm confidence, subtle natural body motion, silent no talking no lip movement mouth closed or naturally relaxed, smooth natural motion only, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "פעולה",
      "nb_prompt": "extreme close-up of ${closeUp}, NO face visible, NO full person, only hands and tools, cinematic shallow depth of field, warm natural lighting, professional documentary close-up, preserve exact appearance from reference images",
      "kling_prompt": "Slow cinematic motion of ${closeUp}, hands working smoothly with clear purpose, NO person visible, silent smooth natural motion only, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "בפעולה",
      "nb_prompt": "avatar wearing ${uniform} ${scene3Action}, inside the ${venue}, focused professional expression with mouth closed, silent NOT speaking, authentic documentary moment, warm interior lighting, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar ${scene3Action}, natural working motion hands moving with purpose focused expression, silent no talking no lip movement mouth closed or naturally relaxed, smooth natural motion only, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "הזמנה",
      "nb_prompt": "avatar wearing ${uniform} standing at the entrance of ${name} near the sign, open welcoming gesture with hands, warm relaxed smile with mouth closed, business signage visible in background, golden hour warm lighting, inviting atmosphere, silent NOT speaking, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar stands near ${name} sign, gentle welcoming gesture with open hands slight head nod, mouth-closed warm smile, silent no talking no lip movement, smooth natural motion only, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference",
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
      parsed.voiceover = joinVoiceoverChunks([v1, v2, v3, v4]);
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
