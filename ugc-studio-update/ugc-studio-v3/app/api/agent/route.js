import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../../../lib/supabase'
import { remainingVideos } from '../../../lib/subscription-limits.js'
import { prepareHebrewForTTS, remapWordTimestamps } from '../../../lib/hebrew-tts.js'
import { execFile, execSync } from 'child_process'
import { promisify } from 'util'
import { writeFile, readFile, mkdir, rm } from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import sharp from 'sharp'
import { prewarmVideos } from '../../../lib/video-cache.js'
import { buildKlingPrompt, SCENE_DURATIONS as SHARED_SCENE_DURATIONS, STABLE as SHARED_STABLE, PRODUCT_LOCK as SHARED_PRODUCT_LOCK, BUSINESS_CRAFT_LOCK as SHARED_BUSINESS_CRAFT_LOCK } from '../../../lib/agent-pipeline.js'
import { generateVideo as higgsfieldGenerateVideo, generateFullVideo as higgsfieldGenerateFullVideo, isHiggsfieldConfigured, uploadToHiggsfield } from '../../../lib/higgsfield-client.js'
import { generateMarketingStudioVideo, isMarketingStudioConfigured } from '../../../lib/marketing-studio-client.js'
import { getUserFromRequest } from '../../../lib/auth-server.js'
import { canCreateVideo, insertVideoJob, incrementVideoCount, updateVideoJobStatus } from '../../../lib/quota.js'
import { SETTINGS } from '../../../lib/settings-prompts.js'

const require = createRequire(import.meta.url)
let ffmpegStaticPath = null
try { ffmpegStaticPath = require('ffmpeg-static') } catch {}
const execFileAsync = promisify(execFile)

// Resolve the system ffprobe binary (sibling to ffmpeg on Railway/nixpacks).
// Used to decode-test Kling outputs before handing them to the editor.
function resolveFfprobePath() {
  try {
    const w = execSync('which ffprobe', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (w && fs.existsSync(w)) return w
  } catch {}
  for (const p of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/run/current-system/sw/bin/ffprobe', '/root/.nix-profile/bin/ffprobe']) {
    if (fs.existsSync(p)) return p
  }
  try {
    const found = execSync("find /nix/store -maxdepth 4 -type f -name ffprobe 2>/dev/null | head -1", { encoding: 'utf8', shell: '/bin/sh' }).trim()
    if (found && fs.existsSync(found)) return found
  } catch {}
  return null
}
const ffprobePath = resolveFfprobePath()
console.log('[Agent] ffprobe binary:', ffprobePath || '(none — Kling output validation will skip ffprobe step)')

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

if (!process.env.HIGGSFIELD_TOKEN) {
  console.warn('⚠ HIGGSFIELD_TOKEN is not set — Higgsfield video generation will fail; only static fallback will produce output');
} else {
  console.log('HIGGSFIELD_TOKEN loaded:', process.env.HIGGSFIELD_TOKEN.slice(0, 8) + '...');
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('⚠ ANTHROPIC_API_KEY is not set — Higgsfield generation requires it (used as the MCP client)');
}
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const SCENE_DURATIONS = SHARED_SCENE_DURATIONS;

// Pipeline constants live in lib/agent-pipeline.js so the regenerate-scene
// endpoint can reuse them without duplication.

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
  // Hebrew preprocessing — produce TWO versions of the text:
  //   ttsText: Latin-transliterated form sent to ElevenLabs (so stubborn
  //     words like כיפה come out pronounced correctly as "kipa").
  //   subtitleText: original Hebrew form, used for subtitles and for the
  //     `word` field of the returned wordTimestamps.
  const { ttsText, subtitleText } = prepareHebrewForTTS(text);
  try {
    // Use with-timestamps endpoint for word-level alignment data.
    // stability 0.7 / style 0.0 — higher stability gives more consistent
    // Hebrew consonant pronunciation; style 0 removes the expressive drift
    // that was softening hard פ/כ/ב consonants (e.g. "כִּיפָּה" read as "kifa").
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ttsText, model_id: 'eleven_v3', voice_settings: { stability: 0.7, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true } })
    });
    if (!res.ok) { console.error('ElevenLabs failed:', await res.text()); return null; }
    const json = await res.json();
    const audioBuffer = Buffer.from(json.audio_base64, 'base64');
    const base64 = json.audio_base64;
    const durationSec = (audioBuffer.length * 8) / (128 * 1000);
    console.log(`[Voice] Audio size: ${(audioBuffer.length / 1024).toFixed(0)}KB, est duration: ${durationSec.toFixed(1)}s`);

    // Build word-level timestamps from character alignment. The `word`
    // values built here come from the TTS text (so they may contain Latin
    // like "kipa"); we remap them back to the Hebrew subtitle form below.
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
      // Remap the Latin TTS tokens back to the original Hebrew subtitle
      // words (1:1 by index — prepareHebrewForTTS guarantees the same
      // whitespace-token count between the two forms).
      wordTimestamps = remapWordTimestamps(wordTimestamps, subtitleText);
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

// Enforce the strict 4-beat UGC structure and return ALL violations found, so
// the regeneration step can show Claude the complete list of what to fix.
//
// PRODUCT mode templates (canonical 4-beat):
// - Beat 1: "ניסיתי כבר מלא {Hebrew plural} ו{negative outcome}"
// - Beat 2: "עד שגיליתי את {productName} שפשוט שינה/שינתה (לי) הכל"
// - Beat 3: 2-3 concrete benefits tied to the Beat-1 pain
// - Beat 4: "תקנו/תזמינו/תיכנסו/תנסו את {productName}" + trust phrase
//
// BUSINESS mode templates:
// - Beat 1: opens with one of "הלכתי / הייתי / ניסיתי / אכלתי / התאמנתי",
//   never names the business
// - Beat 2: opens with "עד שהגעתי ל..." / "עד שגיליתי את..." / "ואז הגעתי ל...",
//   names the business
// - Beat 4: contains "תקבעו תור" / "תבואו" / "תיכנסו" + business name
const BEAT_1_GENERIC_PHRASES = [
  'משהו חסר',
  'משהו קטן',
  'הבדל גדול',
  'פתרון חכם',
  'פתרון מושלם',
  'כלום לא עבד',
  'שום פתרון',
];
// PRODUCT-mode Beat-1 fixed opener.
const BEAT_1_PRODUCT_REQUIRED_PHRASE = 'ניסיתי כבר מלא';
// BUSINESS-mode Beat-1 verb whitelist (one must appear).
const BEAT_1_BUSINESS_REQUIRED_VERBS = ['הלכתי', 'הייתי', 'ניסיתי', 'אכלתי', 'התאמנתי'];

// Beat 2 — required openers (must start with one of these).
const BEAT_2_PRODUCT_OPENER = 'עד שגיליתי את';
const BEAT_2_PRODUCT_TAIL_PHRASES = [
  'שפשוט שינה הכל',
  'שפשוט שינתה הכל',
  'שפשוט שינה לי הכל',
  'שפשוט שינתה לי הכל',
];
const BEAT_2_BUSINESS_OPENERS = ['עד שהגעתי ל', 'עד שגיליתי את', 'ואז הגעתי ל'];

// Beat 3 — discovery openers belong to Beat 2 only; ad-clichés banned.
const BEAT_3_FORBIDDEN_PHRASES = [
  'עד שגיליתי',
  'ואז גיליתי',
  'פתרון חכם',
  'פתרון מושלם',
  'התוצאות מטורפות',
];

// Beat 4 — CTA verb + trust phrase.
const BEAT_4_PRODUCT_CTA_VERBS = ['תקנו', 'תזמינו', 'תיכנסו', 'תנסו'];
const BEAT_4_PRODUCT_TRUST_PHRASES = ['תסמכו עליי', 'תסמכו עלי', 'אני מבטיח', 'לא תתחרטו'];
const BEAT_4_BUSINESS_CTA_VERBS = ['תקבעו תור', 'תבואו', 'תיכנסו'];

// Normalize a Beat-1 line for equality comparison: collapse whitespace and
// trim trailing punctuation so a stray period from Claude doesn't trigger
// a regen against the pre-set hook.
function normalizeBeat1(s) {
  return (s || '').replace(/[.!?…״"'()[\]\s]+/gu, ' ').trim();
}

function beatStructureViolations(scenes, identityName, opts = {}) {
  const mode = opts.mode === 'business' ? 'business' : 'product';
  const expectedHook = opts.expectedHook || null;
  const violations = [];
  if (!Array.isArray(scenes) || scenes.length < 4) return violations;
  const v1 = (scenes[0]?.subtitle || scenes[0]?.voiceover || '').trim();
  const v2 = (scenes[1]?.subtitle || scenes[1]?.voiceover || '').trim();
  const v3 = (scenes[2]?.subtitle || scenes[2]?.voiceover || '').trim();
  const v4 = (scenes[3]?.subtitle || scenes[3]?.voiceover || '').trim();
  const idLower = identityName ? identityName.toLowerCase() : '';

  // BEAT 1 (shared) — no generic ad-cliché phrases.
  for (const phrase of BEAT_1_GENERIC_PHRASES) {
    if (v1.includes(phrase)) {
      violations.push(`Beat 1 contains generic ad-cliché "${phrase}" — replace with a concrete category-specific pain.`);
    }
  }
  // BEAT 1 — must not name the product/business.
  if (identityName && v1 && v1.toLowerCase().includes(idLower)) {
    const which = mode === 'business' ? 'business' : 'product';
    violations.push(`Beat 1 contains the ${which} name "${identityName}" — ${which} name belongs in Beat 2 only.`);
  }

  if (mode === 'product') {
    // BEAT 1 — must match the pre-set hook verbatim. The hook is generated
    // server-side by getHook() (category-specific pain pattern) and pinned
    // into the Claude prompt; any divergence means Claude paraphrased and
    // we trigger a regen. Falls back to the legacy "ניסיתי כבר מלא"
    // contains-check only when no expectedHook was passed (callers should
    // always pass it).
    if (expectedHook) {
      if (normalizeBeat1(v1) !== normalizeBeat1(expectedHook)) {
        violations.push(`Beat 1 must use the pre-set hook verbatim. Expected: "${expectedHook}". Got: "${v1.slice(0, 100)}"`);
      }
    } else if (!v1.includes(BEAT_1_PRODUCT_REQUIRED_PHRASE)) {
      violations.push(`Beat 1 must contain the template phrase "${BEAT_1_PRODUCT_REQUIRED_PHRASE} {Hebrew plural} ו{negative outcome}". Got: "${v1.slice(0, 80)}"`);
    }
    // BEAT 2 — must START with "עד שגיליתי את" + name the product + end with one of the tail phrases.
    if (!v2.startsWith(BEAT_2_PRODUCT_OPENER)) {
      violations.push(`Beat 2 must START with "${BEAT_2_PRODUCT_OPENER} ${identityName} ...". Got: "${v2.slice(0, 80)}"`);
    }
    if (identityName && !v2.toLowerCase().includes(idLower)) {
      violations.push(`Beat 2 must explicitly name the product "${identityName}". Got: "${v2.slice(0, 80)}"`);
    }
    const v2Stripped = v2.replace(/[.!?…\s"')\]]+$/u, '');
    const hasValidTail = BEAT_2_PRODUCT_TAIL_PHRASES.some(p => v2Stripped.endsWith(p));
    if (!hasValidTail) {
      violations.push(`Beat 2 must end with one of: ${BEAT_2_PRODUCT_TAIL_PHRASES.map(p => `"${p}"`).join(' / ')}. Got: "${v2.slice(-80)}"`);
    }
    // BEAT 3 — no discovery / ad-cliché phrases anywhere.
    for (const phrase of BEAT_3_FORBIDDEN_PHRASES) {
      if (v3.includes(phrase)) {
        violations.push(`Beat 3 contains forbidden phrase "${phrase}" — that belongs in Beat 2 only, or it's an ad-cliché. Beat 3 should list concrete benefits that resolve the Beat-1 pain.`);
      }
    }
    // BEAT 4 — CTA verb + product name + trust phrase.
    if (!BEAT_4_PRODUCT_CTA_VERBS.some(verb => v4.includes(verb))) {
      violations.push(`Beat 4 must contain a direct CTA verb — one of: ${BEAT_4_PRODUCT_CTA_VERBS.map(v => `"${v}"`).join(' / ')}. Got: "${v4.slice(0, 80)}"`);
    }
    if (identityName && !v4.toLowerCase().includes(idLower)) {
      violations.push(`Beat 4 must reference the product "${identityName}" by name. Got: "${v4.slice(0, 80)}"`);
    }
    if (!BEAT_4_PRODUCT_TRUST_PHRASES.some(p => v4.includes(p))) {
      violations.push(`Beat 4 must include a trust phrase — one of: ${BEAT_4_PRODUCT_TRUST_PHRASES.map(p => `"${p}"`).join(' / ')}. Got: "${v4.slice(0, 80)}"`);
    }
  } else {
    // BUSINESS mode.
    if (!BEAT_1_BUSINESS_REQUIRED_VERBS.some(verb => v1.includes(verb))) {
      violations.push(`Beat 1 must contain one of: ${BEAT_1_BUSINESS_REQUIRED_VERBS.map(v => `"${v}"`).join(' / ')} (recounting a previous bad customer experience). Got: "${v1.slice(0, 80)}"`);
    }
    // BEAT 2 — must start with one of the discovery openers + name the business.
    const v2HasOpener = BEAT_2_BUSINESS_OPENERS.some(o => v2.startsWith(o));
    if (!v2HasOpener) {
      violations.push(`Beat 2 must START with one of: ${BEAT_2_BUSINESS_OPENERS.map(o => `"${o}..."`).join(' / ')}. Got: "${v2.slice(0, 80)}"`);
    }
    if (identityName && !v2.toLowerCase().includes(idLower)) {
      violations.push(`Beat 2 must name the business "${identityName}". Got: "${v2.slice(0, 80)}"`);
    }
    // BEAT 3 — same forbidden cliché list.
    for (const phrase of BEAT_3_FORBIDDEN_PHRASES) {
      if (v3.includes(phrase)) {
        violations.push(`Beat 3 contains forbidden phrase "${phrase}" — Beat 3 should describe what makes the business special.`);
      }
    }
    // BEAT 4 — CTA verb + business name.
    if (!BEAT_4_BUSINESS_CTA_VERBS.some(verb => v4.includes(verb))) {
      violations.push(`Beat 4 must contain one of: ${BEAT_4_BUSINESS_CTA_VERBS.map(v => `"${v}"`).join(' / ')}. Got: "${v4.slice(0, 80)}"`);
    }
    if (identityName && !v4.toLowerCase().includes(idLower)) {
      violations.push(`Beat 4 must reference the business "${identityName}" by name. Got: "${v4.slice(0, 80)}"`);
    }
  }

  return violations;
}

function scenesHaveBrokenSentences(scenes) {
  if (!Array.isArray(scenes)) return false;
  const chunks = scenes.map(s => (s?.subtitle || s?.voiceover || '').trim()).filter(Boolean);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Scene must end with sentence terminator (. ! ? …)
    const last = c.replace(/["')\]\s]+$/, '').slice(-1);
    if (!/[.!?…]/.test(last)) return true;
    // Scene i+1 should not start with a mid-sentence word.
    // EXCEPTION: scene 2 (index 1) is the 4-beat DISCOVERY bridge, which MUST
    // start with "עד ש..." / "ואז גיליתי..." — don't flag it as a broken
    // continuation of scene 1.
    if (i + 1 < chunks.length && i + 1 !== 1) {
      const nextFirstWord = chunks[i + 1].split(/\s+/)[0] || '';
      // Strip leading quotes/punctuation
      const cleaned = nextFirstWord.replace(/^["'(\[]+/, '');
      if (MID_SENTENCE_STARTERS.has(cleaned)) return true;
    }
  }
  return false;
}

// Soft sanity check on Rule 12 (KLING/NB scene consistency). Logs the
// percentage of 5+ char tokens shared between nb_prompt and kling_prompt for
// each scene; <15% means Claude likely skipped Rule 12 and Seedance will
// invent a different environment than the still frame. Non-blocking — pure
// telemetry so we can spot drift in production logs.
function logNbKlingOverlap(scenes, label = '') {
  if (!Array.isArray(scenes)) return;
  scenes.forEach((scene, i) => {
    const nbWords = new Set(((scene?.nb_prompt) || '').toLowerCase().match(/\b\w{5,}\b/g) || []);
    const klingWords = new Set(((scene?.kling_prompt) || '').toLowerCase().match(/\b\w{5,}\b/g) || []);
    if (!nbWords.size || !klingWords.size) return;
    const overlap = [...nbWords].filter(w => klingWords.has(w)).length;
    const ratio = overlap / Math.max(nbWords.size, 1);
    const pct = (ratio * 100).toFixed(0);
    const tag = label ? ` ${label}` : '';
    if (ratio < 0.15) {
      console.warn(`[Scene ${i + 1}]${tag} ⚠️ LOW NB/KLING overlap (${pct}%) — Claude may have skipped Rule 12`);
    } else {
      console.log(`[Scene ${i + 1}]${tag} NB/KLING overlap: ${pct}%`);
    }
  });
}

async function generateScript(productName, productDesc, applicationArea, hook, voiceGender) {
  if (!ANTHROPIC_KEY) {
    console.error('[generateScript] FAILED — ANTHROPIC_API_KEY is not set in env, falling back to defaults');
    return null;
  }
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const { category: detectedCategory, plural: detectedPlural } = detectProductCategory(productName, productDesc);
  console.log(`[generateScript] auto-detected category=${detectedCategory} plural=${detectedPlural} for "${productName}"`);
  const genderInstruction = voiceGender === 'male'
    ? `GENDER (CRITICAL — MALE SPEAKER): כתוב את כל הקריינות בלשון זכר בלבד. דוגמאות: 'הייתי מובך' (לא 'מביכה'/'מובכת'), 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוח', 'אני חייב', 'התאכזבתי', 'האמנתי', 'מחפש' (לא 'מחפשת'), 'מרוצה' (זכר), 'מוכן', 'משתמש'. כל פועל, תואר וכינוי חייב להיות בלשון זכר. הדובר הוא גבר. אל תערבב לשון נקבה.`
    : `GENDER (CRITICAL — FEMALE SPEAKER): כתוב את כל הקריינות בלשון נקבה בלבד. דוגמאות: 'הייתי מובכת', 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוחה', 'אני חייבת', 'התאכזבתי', 'האמנתי', 'מחפשת' (לא 'מחפש'), 'מרוצה' (נקבה), 'מוכנה', 'משתמשת'. כל פועל, תואר וכינוי חייב להיות בלשון נקבה. הדוברת היא אישה. אל תערבב לשון זכר.`;
  const callClaude = async (extra = '') => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 8192,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing scripts in Hebrew. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}
mode: product
auto_detected_category: ${detectedCategory}
auto_detected_hebrew_plural: ${detectedPlural}

CRITICAL OUTPUT CONSTRAINTS:
- Output VALID JSON only — no markdown fences (no \`\`\`json), no preamble, no commentary
- Each kling_prompt: 400-800 chars maximum
- Each nb_prompt: 200-400 chars maximum
- Total response under 6000 chars
- Start response with { and end with }

STYLE DIRECTION (apply within all kling_prompts):
- Aim for Marketing Studio Director quality — rich visual cinematography
- Specify lighting source and direction (warm window light from left, golden hour from behind, soft overhead diffused)
- Specify environment textures (fabric throws, wooden surfaces, natural clutter that suggests lived-in space)
- Specify wardrobe materials (cream knit sweater, oversized cotton tee, worn denim — texture matters)
- Specify product interactions with sensory detail (fingers tracing texture, light catching the surface, weight of the object)
- Specify micro-expressions (eyebrows lifting, eyes lighting up, small content nods, closed-mouth smile)
- Background should be softly out of focus (shallow depth of field)
- Mood: intimate, authentic, like she's showing this to a close friend
- These descriptors enrich Rule 11 gestures, they don't replace them

STEP 0 — CATEGORY DETECTION (REQUIRED OUTPUT FIELD):
Before writing the script, classify the product into EXACTLY ONE of these categories:
  - "accessory"          — כיפה, שרשרת, צמיד, שעון, משקפיים, טבעת, תיק, חגורה, כובע, צעיף, עניבה
  - "beauty"             — קרם רגיל, בושם, איפור, סרום, מסכה, שמפו, מרכך, ליפסטיק, לק, מייבש שיער
  - "health"             — אבקת הלבנה, ויטמינים, משחת שיניים, דאודורנט, מי פה
  - "fashion"            — חולצה, מכנסיים, נעליים, שמלה, ז'קט, חליפה, פיג'מה, גרביים
  - "home"               — סיר, מטבח, מזרון, כרית, שמיכה, מנורה, מארגן
  - "food"               — חטיף, אוכל ארוז
  - "energy"             — משקאות אנרגיה, BLAZE, Red Bull, Monster, סוכר/קפאין מוגבר
  - "coffee"             — קפה, אספרסו, MOKA, KetoCoffee, bulletproof, cold brew
  - "fitness_supplement" — pre-workout, אבקת חלבון, קריאטין, BCAA, mass gainer, PowerPump
  - "skincare_aging"     — anti-aging, רטינול, נגד קמטים, ALMA, hyaluron, firming
  - "cleaning"           — מנקה, מסיר כתמים, חיטוי, רצפה, אמבטיה, sanitiz

Pick the closest one — DO NOT invent a new category. Return the chosen value in a top-level "category" JSON field. Default to the auto-detected one above unless you're confident it's wrong.

⚡ STRICT 4-BEAT TEMPLATE — PRODUCT MODE — DO NOT DEVIATE ⚡

Each beat is one voiceover_sceneN. DO NOT reorder, merge, or skip beats. Benefits NEVER appear before the product is introduced.

BEAT 1 — CATEGORY-ANCHORED PAIN HOOK (voiceover_scene1, ~6–14 Hebrew words):
  The Beat-1 line is generated server-side from the product category and pinned in rule 4 below. You MUST use that EXACT line verbatim — do not paraphrase, extend, shorten, or add a closing thought. Do not change punctuation. Do not translate. The line is already gender-correct for this script.
  Two pattern families exist (informational only — your job is just to echo whichever one the server picked):
    • Legacy template: "ניסיתי כבר מלא {Hebrew plural} {negative outcome}" — used for accessory/beauty/health/fashion/home/food
    • Dynamic moment-anchored hooks — used for energy / coffee / fitness_supplement / skincare_aging / cleaning. Examples of the SHAPE (not literal copies): "השעה 3 אחה״צ והקפה השלישי לא עוזר", "20 דקות באימון ואת כבר נגמרת", "כל בוקר את רואה את הקווים האלה", "הכתם הזה כבר חודש על השטיח". These open with a time/situation/observation, not with "ניסיתי".
  HARD REQUIREMENTS for Beat 1:
    - MUST EXACTLY equal the pre-set Beat-1 line provided in rule 4 (verbatim, including punctuation and word order)
    - MUST NOT contain the specific product name "${productName}" (the category noun is allowed; the brand/model name is not)
    - MUST NOT contain ANY of: "משהו חסר" / "משהו קטן" / "הבדל גדול" / "פתרון חכם" / "פתרון מושלם" / "כלום לא עבד" / "שום פתרון"
  Final reminder — the EXACT pre-set Beat-1 line you'll be given in rule 4 below is the ONLY allowed Beat 1 voiceover. Use it verbatim.

BEAT 2 — PRODUCT DISCOVERY TEMPLATE (voiceover_scene2, ~5–7 Hebrew words):
  TEMPLATE — copy this structure exactly: "עד שגיליתי את ${productName} {tail}"
  Where {tail} is one of (match grammatical gender to "${productName}"):
    - "שפשוט שינה הכל"        (masculine product)
    - "שפשוט שינתה הכל"        (feminine product)
    - "שפשוט שינה לי הכל"     (masculine, "for me")
    - "שפשוט שינתה לי הכל"     (feminine, "for me")
  HARD REQUIREMENTS for Beat 2:
    - MUST START with "עד שגיליתי את"
    - MUST contain the exact product name "${productName}"
    - MUST END with one of the four tail phrases above (no other tail is allowed)
    - Do NOT list benefits here — Beat 2 is the discovery bridge only

BEAT 3 — BENEFITS THAT SOLVE THE BEAT-1 PAIN (voiceover_scene3, ~16–22 Hebrew words):
  - One sentence (or two short ones) listing 2–3 SPECIFIC benefits drawn from the product description above
  - Each benefit must connect back to the Beat-1 pain (cause → mechanism → relief)
  - Benefits must be concrete (size, comfort, effect, ingredient, time-to-result, build quality) — NOT vague claims
  HARD REQUIREMENTS for Beat 3:
    - MUST NOT START with "עד שגיליתי" / "ואז גיליתי" — those belong to Beat 2 ONLY
    - MUST NOT contain the phrases "פתרון חכם" / "פתרון מושלם" / "התוצאות מטורפות" anywhere

BEAT 4 — CTA TEMPLATE (voiceover_scene4, ~7–10 Hebrew words):
  TEMPLATE — pick one of these structures:
    - "תקנו את ${productName}, תסמכו עליי - {short promise}"
    - "תזמינו את ${productName} עכשיו, לא תתחרטו"
    - "תיכנסו עכשיו ותקנו את ${productName}, אני מבטיח/ה לכם"
    - "תנסו את ${productName} {short promise}, תסמכו עליי"
  HARD REQUIREMENTS for Beat 4:
    - MUST contain one of: "תקנו" / "תזמינו" / "תיכנסו" / "תנסו"
    - MUST contain the exact product name "${productName}"
    - MUST contain one of these trust phrases: "תסמכו עליי" / "אני מבטיח" / "לא תתחרטו"

SANITY CHECK before returning:
  1. Beat 1 EXACTLY equals the pre-set hook from rule 4 (verbatim) and does NOT mention "${productName}".
  2. Beat 2 STARTS with "עד שגיליתי את ${productName}" and ENDS with "שפשוט שינה הכל" / "שפשוט שינתה הכל" / "שפשוט שינה לי הכל" / "שפשוט שינתה לי הכל".
  3. Beat 3 does NOT contain "עד שגיליתי" / "ואז גיליתי" / "פתרון חכם" / "פתרון מושלם" / "התוצאות מטורפות".
  4. Beat 4 contains one of "תקנו" / "תזמינו" / "תיכנסו" / "תנסו" + "${productName}" + one of "תסמכו עליי" / "אני מבטיח" / "לא תתחרטו".
If any of these fail, rewrite before returning.

SCENE 2 VISUAL NOTE:
Scene 2's IMAGE is a product-only beauty shot (no avatar, no person). The voiceover plays over this clean product reveal — the discovery line ("עד שגיליתי את ${productName}") lands right as the product appears on screen. This is intentional.

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

1. UGC HOOK FORMULA — MIRRORS THE 4-BEAT STRUCTURE ABOVE:
- Scene 1 (BEAT 1 — כאב / specific pain): Start with a SPECIFIC, CATEGORY-ANCHORED pain. NEVER mention the product name, brand name, or list any benefit. The viewer must know what domain this is from word one ("זה בדיוק אני!").
- Scene 2 (BEAT 2 — גילוי / discovery): Voiceover is SHORT (4-6 words) and MUST open with "עד ש" or "ואז גיליתי" and name ${productName}. Visually, scene 2 is a clean product-only beauty shot — NO avatar, NO person in frame. NO benefits spoken yet.
- Scene 3 (BEAT 3 — יתרונות / benefits + emotional payoff): Avatar uses ${productName}. Voiceover states 2-3 concrete benefits and closes with an emotional line that resolves the pain from scene 1. DO NOT open scene 3 with "עד שגיליתי" — the discovery already happened in scene 2.
- Scene 4 (BEAT 4 — CTA / קריאה לפעולה): Direct call to action WITH a personal testimonial close ("זה שינה לי את היום" / "זה שווה כל שקל" / "אי אפשר להתחרט"). Never a bare "תנסו".

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

1b2. TTS-FRIENDLY WORD CHOICE (critical for voiceover quality):
The output will be read by ElevenLabs V3 Hebrew TTS. Prefer everyday high-frequency Hebrew words over literary / archaic synonyms — the TTS pronounces common words correctly and trips on rare ones. Favour SHORT sentences (7–12 words) with a comma or period giving the TTS a clear pause point every 5–8 words. Long unbroken sentences cause the TTS to drop nikud and guess vowels.
- Prefer: "זה פשוט ולא עובד", "ניסיתי הכל וזה לא עזר לי".
- Avoid uncommon literary synonyms when a simple word will do.
- Each voiceover_sceneN should contain at least ONE internal comma to give the TTS a breath point, unless the scene is a single short clause under 8 words.

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

3. VOICEOVER TIMING — STRICT (matches the 4-BEAT word budgets):
- Scene 1 / BEAT 1 (pain): ~12-15 Hebrew words, ~5 sec — SPECIFIC category pain
- Scene 2 / BEAT 2 (discovery): ~4-6 Hebrew words, ~2-3 sec — MUST start with "עד ש" or "ואז גיליתי" + ${productName}. DELIBERATELY SHORT — do not pad with benefits.
- Scene 3 / BEAT 3 (benefits + emotional payoff): ~18-22 Hebrew words, ~7-8 sec — 2-3 benefits + line resolving the pain
- Scene 4 / BEAT 4 (CTA + testimonial): ~8-10 Hebrew words, ~3-4 sec — emotional CTA with testimonial close
- Write at NATURAL SPEAKING PACE — each scene must feel complete for its beat.
- The 4 beats join into one flowing paragraph for TTS — silence between beats is fine, but the TOTAL should be ~17-20 seconds.

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
- THE SETTING MAP ABOVE APPLIES TO SCENES 1, 2, 3 ONLY. Scene 4 follows the simpler continuity rule in 5a.

5a. SCENE 4 — CONTINUATION, NOT A NEW SCENE (OVERRIDES rule 5 for scene 4):
Scene 4 should feel like the SAME person in the SAME place, just LATER — one continuous moment, not a fresh aspirational location. Inventing a new scene (sunset restaurant, beach, fancy dinner) reads as AI-generated; staying put reads as a real lived moment.

Scene-4 setting rules:
- DEFAULT: same indoor location as scene 1 (home / kitchen / bathroom / bedroom / office — wherever the pain happened). Same lighting, same room, same casual everyday vibe. The avatar simply has a satisfied expression now.
- CAR PRODUCTS ONLY: if ${productName} is a car product (רכב / אוטו / car accessory), scene 4 may show the avatar sitting in the driver's seat with natural in-car lighting through the windshield. This is the ONE category-specific override.
- DO NOT invent restaurants, beaches, golden-hour terraces, Shabbat dinners, parties, or other "lifestyle" locations the avatar wasn't already in.
- The product is still naturally visible on/with the avatar (worn / held / used) OR its EFFECT is visible (confident smile for whitening, styled outfit for fashion, glowing skin for skincare).
- Lighting matches scene 1 — same window daylight + warm room practical. No candlelight, no golden hour, no restaurant warmth UNLESS scene 1 was already in that lighting.

Scene-4 TONE: satisfied, quietly confident, content in the moment — NOT a frozen posed grin. A closed-lip warm smile in the same room reads more authentic than a big forced smile in a fancy new location.

6. EVERY nb_prompt for scenes 1/3 MUST start with: "CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body." AND MUST end with: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle". SCENE 4 follows the same anatomy rule BUT its ending must OMIT "NEVER in a car, NEVER in a vehicle" — scene 4 may legitimately show the car for car-accessory products (see rule 5a). The no-phone rule stays for scene 4. If the avatar holds a product, say "holding the product with ONE hand only, other hand visible and relaxed at side". Avoid describing multiple items held at once or hands doing multiple simultaneous actions.

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

9a. PRODUCT LOCK — CRITICAL (MANDATORY FOR SCENES 2, 3, 4):
Kling has a known "object drift" failure mode where the product slowly morphs into a different object over the 5–8s video (a branded kippah becomes a generic baseball cap; a labelled serum becomes a blank bottle; a unique mug turns into a travel cup). EVERY kling_prompt for scenes 2, 3, 4 (the product-containing scenes) MUST include an explicit product-lock block, BEFORE the rule-9 ending phrase.

(i) POSITIVE LOCK — include verbatim in every product-containing kling_prompt:
"The product maintains EXACT same appearance throughout the entire video — same shape, same color, same logo, same text, same material, same position. It is a rigid physical object that does not morph. Every frame of the video shows the identical product from the reference frame — the product at second 5 is visually identical to the product at second 0."

(ii) NEGATIVE LOCK — include verbatim:
"no product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no product becoming a different object, no product identity drift, no gradual transformation into a similar-but-different item, product does not turn into a generic version of itself"

(iii) FORM-SPECIFIC LOCK — pick ONE based on how the product is used in the scene (determined by STEP 0 category):
- WEARABLE (kippah, hat, tzitzit, tallit, jewellery, watch, dress, shirt, shoes, glasses, earrings, bracelet, necklace): "Product stays firmly in place on the head/body/wrist throughout the shot. It does not rotate, slide, translate, or change position. Fabric texture, weave, stitching, and any embroidery or printed design remain consistent frame-to-frame."
- HELD / HANDHELD (bottle, jar, tube, box, device, tool, gadget, card, phone-case-like items): "Product stays firmly held in the same hand with the same grip. Fingers wrap around it with consistent contact points across every frame. Product dimensions, label, branding, and cap/closure remain identical throughout the shot — no label rewriting, no cap changing, no container reshaping."
- APPLIED / CONSUMED (cream, serum, lotion, supplement pill, food item, drink): "The product container remains identical frame-to-frame with its exact label and branding intact. The small amount dispensed onto skin / into hand / into mouth stays consistent in color and texture and does not morph mid-motion."
- ENVIRONMENTAL (home decor, candle, pillow, mattress, small appliance sitting in a room): "Product remains in the same position in the scene, with identical shape, color, and surface details. Surrounding lighting may shift naturally but the product itself is rigid and unchanging."

(iv) For SCENE 2 (product-only beauty shot), where the camera moves but the product is stationary, add: "the product is the anchor of the shot — if anything in frame changes, it is the camera, the light, or the dust in the air, but NEVER the product itself."

Do NOT skip this block. It is the single most common Kling failure for Yotzr, and the voiceover-level resolve (scene 3/4) dies instantly if the product has morphed by the time the CTA plays.

10. SELFIE REALISM — EVERY nb_prompt with a person (scenes 1/3/4) MUST include these markers to avoid the polished AI-generated aesthetic:
- Frame the image as a VIDEO STILL, not a photo: open with "unedited still frame pulled from a handheld iPhone selfie video, not a photograph" — this fights the model's tendency toward clean portrait defaults.
- Skin cues (pick 3-4, AVOID skin-condition language): "visible pores across cheeks and forehead", "subtle uneven skin tone", "faint pink flush on cheeks and nose tip", "subtle darker half-moons under the eyes", "slight natural oil sheen on nose and forehead", "tiny flyaway hairs catching the light", "eyebrow hairs not perfectly groomed", "natural facial asymmetry". Do NOT use the words "blemish", "acne", "pimple", "breakout", "spot", or "redness" — they read as skin conditions and bias the model toward unhealthy skin, which is the opposite of what we want.
- iPhone front-camera character: "iPhone 15 Pro front camera in selfie mode", "native wide lens around 26mm", "autofocus hunts gently, focus pulsing in and out", "deep focus but softly rendered, no artificial shallow DOF", "subtle barrel distortion and lens fall-off at corners", "faint luminance grain and occasional chromatic fringe on high-contrast edges", "faint rolling-shutter skew on quick motion", "flat washed-out color, uncolor-graded, low saturation, no LUT".
- Natural lighting: "soft window daylight mixed with a warm room practical", "uneven jaw-line shadow", "one side of the face slightly in shadow", "mild color-temperature mismatch between window and lamp", "no studio softbox, no ring light, no beauty dish, no rim light".
- Capture-moment cue: "captured between expressions — eyelid mid-close or mouth in the middle of forming a word, never a finished pose" — this is the single strongest anti-AI framing signal; always include it.
- Motion + framing: "handheld one-hand micro-shake", "subtle motion blur on hair strands", "soft focus across the whole frame, nothing tack sharp", "framing slightly off-center and tilted a few degrees", "head not dead-level".
- Hard negatives (always append): "no airbrushing, no beauty filter, no skin smoothing, no glossy cinematic bokeh, no catalog-model pose, no perfectly clean render, no 8k, no award-winning look, no LUT, no color grading, no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays, looks like a real person on their front camera not a render".
For scene 2 (product-only), use the iPhone BACK-camera equivalent: "shot on iPhone back camera in a real home, soft window daylight plus ambient room light, slight handheld angle not dead-on tripod, real surface with tiny dust or fingerprint smudge, organic wood grain or authentic marble veining, mild warm white balance, flat washed-out color, product firmly grounded with a visible contact shadow, NOT floating, NOT levitating, NOT hovering, clean product edges no melted geometry, no studio softbox, no seamless backdrop, no catalog look".

11. NATURAL GESTURE LIBRARY + KLING PHYSICS — EVERY kling_prompt with a person (scenes 1/3/4) MUST:
(a) Pick ONE eye-gesture, ONE head/body gesture, and ONE closed-lip micro-expression from this library, matched to the scene's emotional beat. These sell authenticity without violating "mouth closed, no lip movement" (rule 9):
- Eye-gestures: "briefly breaks eye contact, glances down then back to camera" / "eyes drift sideways then refocus on lens" / "slow natural blink mid-beat" / "brief off-screen look then returns to camera" / "looks at the product in their hand then back to camera" (scene 3/4 only)
- Head/body gestures: "subtle head tilt to one side" / "small reactive nod as if processing an internal thought" / "chin lifts slightly then relaxes" / "weight shift from one leg to the other" / "small shoulder shrug" / "slight lean toward camera then pulls back" / "adjusts grip on the product with fingertips" (scene 3/4) / "turns the product slightly to show another angle" (scene 3 only) / "fidgets with hair or touches face briefly"
- Closed-lip micro-expressions: "authentic closed-lip half-smile forming gradually" / "genuine eyebrow raise of quiet surprise" / "brief brow furrow of concentration" / "eye squint of mild skepticism" / "softening around the eyes of quiet relief" / "caught mid-thought, slight hesitation"
NEVER describe smiles, laughs, or reactions that open the mouth.
(b) Describe the PHYSICS of each motion, not just the action — Kling treats prompts as a physics engine. Instead of "turns her head", write "turns her head slowly to the side, hair follows just behind the motion and catches the light, slight tension visible in the neck". Instead of "holds the product", write "fingers wrap firmly around the product with natural fingertip contact, visible grip tension". Instead of "leans toward camera", write "leans forward from the hips, hair sways with the motion, weight transfers to the front foot".
(c) For scenes 3 and 4 (product present), ANCHOR hands to the product — "fingers firmly wrapped around the product", "natural fingertip contact", "visible grip tension" — this prevents Kling's hand-morphing failure mode where fingers melt into or through the object.
(d) Scene-to-gesture mapping: scene 1 (pain) leans on brow furrow + weight shift + eye drift + mid-thought hesitation; scene 3 (solution) leans on eyebrow raise + chin lift + glance down to product + grip adjustment; scene 4 (result) leans on eye-softening + subtle nod + closed-lip half-smile + brief off-screen glance.
(e) END every kling_prompt with the phrase from rule 9 AND append: "no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays" — Kling sometimes bakes captions into output if not explicitly excluded.

12. KLING/NB SCENE CONSISTENCY (CRITICAL):
The kling_prompt describes the SAME PHYSICAL SCENE as the nb_prompt. Both must lock identical environment, surface, lighting, furniture, props, and aesthetic — only the camera/motion language differs (NB = still frame composition, Kling = motion physics).

Required overlap between nb_prompt and kling_prompt:
- Same surface / floor / furniture (e.g. "wooden table with marble veining, slight dust, no seamless backdrop")
- Same lighting source and direction (e.g. "warm window daylight from left, mixed with cool overhead")
- Same environmental clutter (e.g. "unmade bed, shopping bags scattered, water glass on nightstand")
- Same aesthetic anchors (e.g. "no studio softbox, no catalog look, no seamless white, no professional set dressing")

For Scene 2 (PRODUCT ONLY):
The kling_prompt MUST explicitly include the same surface description, the same "no seamless backdrop, no catalog look, no studio softbox, no sky background" anti-patterns that nb_prompt has. This prevents Seedance from inventing a poster-like sky background.

For Scene 3 (using product on self):
The kling_prompt MUST forbid the same things nb_prompt forbids — especially "no mirror, no reflection, no glass surface, no reflective screen, no second figure". Repeat the anti-mirror language verbatim.

For Scenes 1 and 4 (avatar in home):
The kling_prompt MUST repeat the same room details — the bed/couch, the wall color, the window direction, the specific clutter mentioned in nb_prompt.

Test: A viewer who sees the NB still and the Kling video side-by-side should recognize them as the SAME location, SAME lighting, SAME aesthetic. Not "related but different" — SAME.

14. SCENE 3 TOOL/INSTRUMENT GUARD (CRITICAL):
When the product description mentions tools or instruments that are NOT shown in the product reference image (like toothbrush, applicator, sponge, brush, q-tip, scoop, spatula), DO NOT mention them in the kling_prompt.

Seedance only has the product reference — it cannot visualize tools accurately, and forcing them creates artifacts (finger instead of toothbrush, hand morphing, product changing shape).

Instead, translate the action to be product-only:

❌ "uses toothbrush dipped in powder, brushes teeth"
✅ "carefully applies the powder directly with gentle finger motions to the teeth surface"

❌ "scoops cream with spatula, applies to face"
✅ "dips fingertip into the cream, smooths it onto skin"

❌ "uses applicator brush to spread serum"
✅ "drops serum onto fingertips, dabs onto skin"

The narration in the voiceover_scene3 CAN still mention the tool ("מרטיבים מברשת שיניים, טובלים באבקה") because that's audio only — but the kling_prompt visual MUST focus on what Seedance can actually render with the references it has (avatar + product only).

ACTION DESCRIPTION RULES:

1. תיאור פעולה כרצף של מיקרו-תנועות — לא פוזה סטטית.
   ✅ נכון: 'מטה את הבקבוק לכיוון המצלמה, לוקח לגימה, גבות עולות קלות, מניח על השולחן עם נהמת הסכמה קלה'
   ❌ שגוי: 'מחזיק את המוצר ומחייך'

2. רגשות = מיקרו-ביטוי פיזי, לא הצהרה.
   ✅ נכון: 'עיניים נפתחות, פינת פה מתרוממת'
   ❌ שגוי: 'נראית מרוצה'

3. תיאור פעולה = כוונה + תוצאה, לא ביו-מכניקה.
   ✅ נכון: 'מסובב את הפקק, מניח את הבקבוק'
   ❌ שגוי: 'יד ימין מסובבת פקק נגד כיוון השעון'

4. רק מה שרואים — לא מטא-תיאורים.
   ❌ אסור: 'המוצר ריחני' / 'מרגישה נינוחה'
   ✅ מותר: 'אגלי מים על הבקבוק, התווית מבריקה'

המטרה: 3-5 מיקרו-פעולות בכל סצנה, רצף טבעי, לא פוזה.

Return ONLY valid JSON (no markdown):
{
  "category": "one of: accessory / beauty / health / fashion / home / food / energy / coffee / fitness_supplement / skincare_aging / cleaning (the value you chose in STEP 0)",
  "mode": "product",
  "voiceover_scene1": "BEAT 1 — MUST EXACTLY equal the pre-set hook from rule 4 (verbatim). The server picks one of two pattern families for you: legacy 'ניסיתי כבר מלא {Hebrew_plural} {category-specific tail}' (for accessory/beauty/health/fashion/home/food) OR a moment-anchored hook (for energy/coffee/fitness_supplement/skincare_aging/cleaning). Your job is to echo the exact line you're given. Must NOT contain '${productName}'. Must NOT contain 'משהו חסר' / 'משהו קטן' / 'הבדל גדול' / 'פתרון חכם' / 'פתרון מושלם' / 'כלום לא עבד' / 'שום פתרון'.",
  "voiceover_scene2": "BEAT 2 — TEMPLATE 'עד שגיליתי את ${productName} שפשוט שינה/שינתה (לי) הכל'. Must START with 'עד שגיליתי את' + the product name. Must END with 'שפשוט שינה הכל' / 'שפשוט שינתה הכל' / 'שפשוט שינה לי הכל' / 'שפשוט שינתה לי הכל' (match grammatical gender to the product).",
  "voiceover_scene3": "BEAT 3 — 2-3 concrete benefits of ${productName} that solve the Beat-1 pain. ~16-22 Hebrew words. Must NOT contain 'עד שגיליתי' / 'ואז גיליתי' / 'פתרון חכם' / 'פתרון מושלם' / 'התוצאות מטורפות'.",
  "voiceover_scene4": "BEAT 4 — CTA template 'תקנו את ${productName}, תסמכו עליי - {short promise}' (or use 'תזמינו' / 'תיכנסו' / 'תנסו'). Must contain '${productName}' + a CTA verb + a trust phrase ('תסמכו עליי' / 'אני מבטיח' / 'לא תתחרטו').",
  "setting": "one-line description of the setting",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "Unedited still frame pulled from a handheld iPhone selfie video, not a photograph. STORY-TIME SETTING: avatar sitting on a bed or couch in a cozy Israeli home bedroom or living room — NOT outdoors, NOT a mall. Around them, scattered on the floor and bed/couch: generic plain shopping bags scattered around — solid color paper bags and plastic bags with NO logos, NO brand names, NO text, NO printed graphics. Bags are simple white, beige, brown, and black, completely unbranded. Some bags are crumpled, some half-open with clothing edges visible inside (sweaters, fabric). NEVER show any real-world brand logos, NEVER show readable text on bags, NEVER show recognizable retail brand names. Authentic real-life Israeli home ambiance, lived-in feel, throw pillows, slightly messy. Avatar speaking to camera in story-time selfie style — NOT looking directly at the lens, gaze drifts off-camera (looking away to the side, slightly down, or up as if recalling a memory). Tired, frustrated, or disappointed expression — like venting to a friend about a frustrating shopping day. No product visible yet. Casual handheld iPhone selfie, slight natural shake, vertical 9:16 framing. Shot on iPhone 15 Pro front camera, native wide lens around 26mm, autofocus hunts gently with focus pulsing, real unretouched skin with visible pores across cheeks and forehead, subtle uneven skin tone, subtle darker half-moons under the eyes, slight natural oil sheen on nose and forehead, faint pink flush on cheeks, natural facial asymmetry, tiny flyaway hairs catching the light, warm indoor home lighting mixed with natural window light, uneven jaw shadow, one side of face slightly in shadow, subtle barrel distortion at corners, auto white balance, faint luminance grain, faint rolling-shutter skew, flat washed-out color, uncolor-graded, low saturation, handheld one-hand micro-shake with subtle motion blur on hair, soft focus across the whole frame, framing slightly off-center and tilted a few degrees, head not dead-level, no airbrushing, no beauty filter, no studio lighting, no 8k, no LUT, real human texture, candid not posed, looks like a real person on their front camera not a render, not AI-generated feel, correct human anatomy, exactly two arms, no extra limbs, no burned-in subtitles or captions or on-screen text or graphic overlays, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar sitting on a bed or couch in a cozy Israeli home, generic plain unbranded shopping bags (no logos, no text, no brand names — solid white/beige/brown/black paper and plastic bags only) scattered around them on the bed and floor, story-time selfie venting about a frustrating shopping day, no product visible. Physics of motion: gaze drifts off-camera to the side then up as if recalling the memory, brow furrows gradually with quiet frustration, shoulders sag with a closed-lip sigh and chest expands subtly, weight shifts on the bed/couch and a single shopping bag rustles slightly with the movement, hair follows the head turn with a small lag and catches the warm indoor light, one slow natural blink mid-beat, small hesitation like a caught mid-thought. Handheld iPhone front-camera feel with mild one-hand wobble, autofocus pulses gently, warm window daylight + ambient room practical, lived-in Israeli home ambiance, silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "מוצר",
      "nb_prompt": "PRODUCT ONLY SHOT — absolutely no person, no human, no hands, no face, no body parts, no avatar, no model. Close-up beauty shot of ${productName} resting naturally on a realistic home surface — on a wooden table, marble counter, or bathroom sink with authentic veining/grain. Product must have clear physical support and cast a realistic contact shadow underneath. Shot on iPhone back camera in a real home, soft window daylight mixed with ambient room light, slight handheld angle not dead-on tripod, mild warm white balance, subtle lens softness at corners, faint grain, surface shows tiny real-world imperfections like a small dust speck or faint fingerprint smudge, no seamless white backdrop, no studio softbox, no catalog look, looks like a real phone photo not a render. Product is the hero of the shot and the ONLY subject in frame, product details clearly visible, preserve exact product appearance from reference image, product shape and colors unchanged from reference. Negative: person, human, woman, man, hands, face, body, arms, fingers, holding, selfie, hair, skin, limbs, silhouette. Also: product NOT floating, NOT levitating, NOT suspended in air, NOT hovering.",
      "kling_prompt": "Handheld iPhone back-camera style shot of ${productName} resting on a stable real-home surface, subtle handheld micro-shake as if a real hand is filming, camera drifts slightly closer with a gentle parallax rather than a perfect mechanical orbit, soft focus breathing as the camera shifts, product stays stationary and grounded with clear contact shadow, ambient dust motes drift through the window light, soft natural window light with ambient room spill, flat washed-out color and low saturation, authentic surface texture visible, no person in frame, no hands. PRODUCT LOCK: The product maintains EXACT same appearance throughout the entire video — same shape, same color, same logo, same text, same material, same position. It is a rigid physical object that does not morph. Every frame shows the identical product from the reference frame. The product is the anchor of the shot — if anything in frame changes, it is the camera, the light, or the dust in the air, but NEVER the product itself. no product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no product becoming a different object, no product identity drift. Silent, smooth natural motion only, no floating, no levitating, no hovering, no perfect mechanical camera move, no studio softbox look, no catalog look, looks like a real phone clip not a render, product edges render cleanly with no melted geometry, product shape and colors unchanged from reference, no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "פתרון",
      "nb_prompt": "Unedited still frame pulled from a handheld iPhone selfie video, not a photograph. Avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, fingers firmly wrapped around the product with natural fingertip contact and visible grip tension, anatomically correct hand with five fingers. Closed-lip expression of pleasant surprise with genuine eyebrow raise, chin slightly lifted, caught mid-blink or eyes in mid-pulse of autofocus. Shot on iPhone 15 Pro front camera, native wide lens around 26mm, autofocus hunts gently with focus pulsing, real unretouched skin with visible pores across cheeks and forehead, subtle uneven skin tone, slight natural oil sheen on nose and forehead, faint pink flush on cheeks, natural facial asymmetry, tiny flyaway hairs catching the light, soft window daylight mixed with warm room practical, uneven jaw shadow, subtle barrel distortion at corners, auto white balance, faint luminance grain, faint rolling-shutter skew, flat washed-out color, uncolor-graded, low saturation, handheld one-hand micro-shake with subtle motion blur on hair strands, soft focus across the whole frame with nothing tack sharp, one eye marginally more in focus, framing slightly off-center and tilted a few degrees, head not dead-level, no airbrushing, no beauty filter, no studio lighting, no 8k, no LUT, looks like a real person on their front camera not a render, correct human anatomy, exactly two arms, no burned-in subtitles or captions or on-screen text or graphic overlays, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar using ${productName} on themselves for the first time — product ON the avatar. Physics of motion: fingers firmly wrap around the product with natural fingertip contact and visible grip tension, hand anchored to the product throughout (no morphing, no melted fingers), the action of applying/wearing/using unfolds with realistic hand-object interaction, hair follows the head movement and catches the light, eyebrows lift in genuine quiet surprise, chin rises slightly then relaxes, eyes glance down at the product then refocus on the camera, small satisfied nod, closed-lip hint of a smile with mouth relaxed, avatar may turn the product slightly to show another angle, adjusts grip with fingertips. PRODUCT LOCK: The product maintains EXACT same appearance throughout the entire video — same shape, same color, same logo, same text, same material, same position. It is a rigid physical object that does not morph. Every frame shows the identical product from the reference frame — the product at second 5 is visually identical to the product at second 0. [FORM-SPECIFIC LOCK — pick based on product type, wearable OR held OR applied: (WEARABLE) product stays firmly in place on the head/body/wrist throughout, does not rotate, slide or translate, fabric texture, weave, stitching and any embroidery or printed design remain consistent frame-to-frame / (HELD) product stays firmly held in the same hand with the same grip, fingers wrap around it with consistent contact points across every frame, product dimensions, label, branding, and cap/closure remain identical, no label rewriting, no cap changing, no container reshaping / (APPLIED) product container remains identical frame-to-frame with its exact label and branding intact, the small amount dispensed stays consistent in color and texture]. no product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no product becoming a different object, no product identity drift, no gradual transformation into a similar-but-different item. Handheld iPhone front-camera feel with mild one-hand wobble, autofocus pulses gently, silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference, no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "תוצאה",
      "nb_prompt": "Unedited still frame pulled from a handheld iPhone selfie video, not a photograph. SAME LOCATION AS SCENE 1 — the avatar is in the same indoor everyday setting (home / kitchen / bathroom / bedroom / office, whichever scene 1 used) with the same casual home atmosphere. This is one continuous moment, not a new scene. Avatar wears a natural closed-lip warm smile (mouth stays closed, corners of mouth lifted, eyes soften and crinkle at the outer corners), caught between expressions not a finished pose, satisfied and quietly confident. Product is naturally visible — either still worn/held/used from scene 3, or its EFFECT is visible (confident smile for whitening, styled outfit on body, glowing skin). Same window daylight + warm room practical lighting as scene 1 — NO candlelight, NO golden hour, NO restaurant warmth, NO new fancy location (UNLESS ${productName} is a car product, in which case the avatar may be sitting in the driver's seat with natural in-car lighting through the windshield). Shot on iPhone 15 Pro front camera, native wide lens around 26mm, autofocus hunts gently with focus pulsing, real unretouched skin with visible pores, subtle uneven skin tone, slight natural oil sheen on nose and forehead, faint pink flush on cheeks, subtle darker half-moons under the eyes, tiny flyaway hairs catching the light, natural facial asymmetry, subtle barrel distortion at corners, auto white balance, faint luminance grain, faint rolling-shutter skew, flat washed-out color, uncolor-graded, low saturation, handheld one-hand micro-shake with subtle motion blur on hair strands, soft focus across the whole frame, framing slightly off-center and tilted a few degrees, head not dead-level, no airbrushing, no beauty filter, no 8k, no LUT, looks like a real person on their front camera not a render, correct human anatomy, no burned-in subtitles or captions or on-screen text or graphic overlays, NEVER show a phone or mobile device in any scene",
      "kling_prompt": "Avatar in the SAME indoor location as scene 1 (or the driver's seat of their car if ${productName} is a car product), satisfied and quietly confident moment. Physics of motion: closed-lip warm smile forms gradually with corners of mouth lifting and skin softening around the outer eyes in genuine quiet confidence, small subtle nod with hair following the head movement and catching the light, eyes briefly break contact with the lens then refocus on the camera, optional small hand-on-heart gesture or relaxed gesture toward camera. Same room ambience as scene 1 — soft window daylight, warm room practical, occasional ambient micro-motion in the home setting. Product naturally visible in frame; if held, fingers remain firmly anchored with visible grip tension (no hand morphing, no melted fingers). PRODUCT LOCK: The product maintains EXACT same appearance throughout the entire video — same shape, same color, same logo, same text, same material, same position. It is a rigid physical object that does not morph. Every frame shows the identical product from the reference frame. [FORM-SPECIFIC LOCK — pick based on product type: (WEARABLE) product stays firmly in place on the head/body/wrist throughout, does not rotate, slide, or translate, fabric texture and any printed/embroidered design stay identical / (HELD) product stays firmly held with consistent grip, label, branding, and dimensions identical across every frame / (APPLIED / CONSUMED) product container and any dispensed amount stay identical, no label rewriting / (ENVIRONMENTAL) product remains in exactly the same position in the scene with identical shape, color, and surface details, only the light or surrounding motion may change]. no product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no product becoming a different object, no product identity drift, no gradual transformation into a similar-but-different item. Handheld iPhone front-camera feel with mild one-hand wobble, autofocus pulses gently. Silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, product shape and colors unchanged from reference, no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays",
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
    } catch (parseErr) {
      console.error('[generateScript] JSON parse FAILED:', {
        message: parseErr?.message,
        textPreview: text.slice(0, 400),
        textLength: text.length,
      });
      return null;
    }
  };

  try {
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
  // Validate the strict 4-beat structure (PRODUCT mode). Collect ALL
  // violations so the regen instruction shows Claude every issue at once.
  // Regenerate up to 2 times before giving up and returning whatever Claude
  // last produced (the spec calls this "log warning and pass through").
  if (parsed) {
    const MAX_BEAT_REGEN = 2;
    let lastViolations = [];
    for (let attempt = 0; attempt <= MAX_BEAT_REGEN; attempt++) {
      const violations = beatStructureViolations(parsed.scenes, productName, { mode: 'product', expectedHook: hook });
      lastViolations = violations;
      if (violations.length === 0) break;
      if (attempt === MAX_BEAT_REGEN) break;
      console.warn(`[generateScript] 4-beat structure violations (regen ${attempt + 1}/${MAX_BEAT_REGEN}):`, violations);
      const bullets = violations.map((v, i) => `  ${i + 1}. ${v}`).join('\n');
      const extraInstruction = `\n\nPREVIOUS ATTEMPT VIOLATED THE STRICT 4-BEAT STRUCTURE. Fix ALL of these specific issues and return a corrected script:\n${bullets}\n\nReminder of the rules:\n- voiceover_scene1 = BEAT 1 — must EXACTLY equal the pre-set hook ("${hook}"), verbatim, and never names "${productName}".\n- voiceover_scene2 = BEAT 2 — must START with "עד שגיליתי את ${productName}" and END with "שפשוט שינה הכל" / "שפשוט שינתה הכל" / "שפשוט שינה לי הכל" / "שפשוט שינתה לי הכל".\n- voiceover_scene3 = BEAT 3 — 2-3 concrete benefits resolving the Beat-1 pain. NEVER contains "עד שגיליתי" / "ואז גיליתי" / "פתרון חכם" / "פתרון מושלם" / "התוצאות מטורפות".\n- voiceover_scene4 = BEAT 4 — CTA verb ("תקנו" / "תזמינו" / "תיכנסו" / "תנסו") + product name + trust phrase ("תסמכו עליי" / "אני מבטיח" / "לא תתחרטו").`;
      const retry = parseResponse(await callClaude(extraInstruction));
      if (retry) parsed = retry;
      else break;
    }
    if (lastViolations.length > 0) {
      console.warn(`[generateScript] 4-beat structure still violated after ${MAX_BEAT_REGEN} regens — passing through with violations:`, lastViolations);
    }
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
  if (parsed?.scenes) logNbKlingOverlap(parsed.scenes, '[generateScript]');
  return parsed;
  } catch (error) {
    console.error('[generateScript] FAILED — falling back to defaults:', {
      message: error?.message,
      status: error?.status,
      name: error?.name,
      type: error?.type,
      errorType: error?.error?.type,
      errorMessage: error?.error?.message,
      stack: error?.stack?.slice(0, 500),
    });
    return null;
  }
}

export async function POST(req) {
  console.log('[Memory:agent]', JSON.stringify(process.memoryUsage()));
  try {
    const body = await req.json();

    if (!supabase) {
      return Response.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Auth — JWT-based, replaces the legacy soft check on users.subscription_tier.
    // Required: every POST must carry an Authorization: Bearer <supabase-jwt> header.
    const { user, error: authError } = await getUserFromRequest(req);
    if (!user) {
      return Response.json({ error: authError || 'unauthorized' }, { status: 401 });
    }
    body.userId = user.id; // Trust the JWT; ignore client-supplied userId.

    // Quota gate — fail-closed. Blocks on no_subscription / quota_exceeded /
    // quota_exceeded_topup_available. Caller can branch on `reason` to show
    // an upgrade modal vs a topup CTA.
    const gate = await canCreateVideo(user.id);
    if (!gate.allowed) {
      return Response.json({
        error: gate.reason,
        plan: gate.plan,
        used: gate.used,
        limit: gate.limit,
        canTopup: gate.canTopup,
      }, { status: 403 });
    }

    // Create a pending job. Persist the generation inputs alongside it so
    // the regenerate-scene route can recover them later — even when the
    // client has lost lastGenPayload (e.g. an old saved_edit reopened from
    // the dashboard). Falls back gracefully if the `inputs` column doesn't
    // exist yet (column added in 20260425_add_jobs_inputs.sql).
    const jobInputs = {
      videoType: body?.videoType || 'ugc',
      avatarUrl: body?.avatarUrl || null,
      productImageUrl: body?.productImageUrl || null,
      businessPhotos: Array.isArray(body?.businessPhotos) ? body.businessPhotos : [],
    };
    let { data: job, error: insertError } = await supabase
      .from('jobs')
      .insert({ status: 'pending', inputs: jobInputs })
      .select('id')
      .single();
    if (insertError && /inputs/i.test(insertError.message || '')) {
      console.warn('[Agent] jobs.inputs column missing — inserting without it. Run the migration in supabase/migrations/ to enable jobId auto-recovery.');
      const retry = await supabase
        .from('jobs')
        .insert({ status: 'pending' })
        .select('id')
        .single();
      job = retry.data;
      insertError = retry.error;
    }

    if (insertError) {
      console.error('Job insert error:', insertError.message);
      return Response.json({ error: 'Failed to create job' }, { status: 500 });
    }

    // Quota tracking row — separate from the legacy `jobs` table. Inserted
    // with status='pending' here; flipped to 'completed'/'failed' inside runJob.
    await insertVideoJob({
      userId: user.id,
      jobId: job.id,
      productName: body?.productName || body?.businessName || '',
      videoType: body?.videoType || 'ugc',
      isTopup: false,
    });

    // Fire and forget — do NOT await
    runJob(job.id, body).catch(err => console.error('Background job crashed:', err.message));

    return Response.json({ jobId: job.id });
  } catch (e) {
    console.error('Agent error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// Validate a Kling video URL end-to-end before we hand it to the editor.
// Previous "verifyVideoUrl" only checked the first 64KB for MP4 magic — that
// missed cases where fal.ai returns a mostly-intact MP4 that the browser
// can't actually decode (readyState stays at 0, videoWidth=0). This version
// adds an ffprobe decode test, which is what actually catches broken outputs.
//
// Returns { valid: boolean, reason?: string, width?, height?, duration? }.
async function validateKlingVideo(url) {
  if (!url || typeof url !== 'string') return { valid: false, reason: 'no url' };
  try {
    // --- Stage 1: Range GET first 64KB, check MP4 magic bytes ---------------
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-65535' },
      signal: AbortSignal.timeout(10000),
    }).catch(err => ({ _fetchErr: err }));

    if (res?._fetchErr) {
      return { valid: false, reason: `fetch error: ${res._fetchErr.message}` };
    }
    if (!res.ok && res.status !== 206) {
      return { valid: false, reason: `status ${res.status}` };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 12) {
      return { valid: false, reason: `file too small (${buffer.length}B)` };
    }
    const ftyp = buffer.slice(4, 8).toString('ascii');
    if (ftyp !== 'ftyp') {
      const preview = buffer.slice(0, 200).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
      console.error('[Kling] Not valid MP4 — first 200 bytes:', preview);
      return { valid: false, reason: `not MP4 (got "${ftyp}")` };
    }

    // Confirm total content size. Kling 5s clips are always > 500KB; anything
    // smaller is a truncated/broken output.
    const contentRange = res.headers.get('content-range') || '';
    const totalFromRange = Number((contentRange.match(/\/(\d+)$/) || [])[1] || 0);
    let totalSize = totalFromRange;
    if (!totalSize) {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).catch(() => null);
      totalSize = Number(head?.headers?.get?.('content-length') || 0);
    }
    if (totalSize > 0 && totalSize < 500 * 1024) {
      return { valid: false, reason: `size too small (${totalSize}B, < 500KB)` };
    }

    // --- Stage 2: ffprobe decode test ---------------------------------------
    // ffprobe can read HTTP URLs directly — no need to download the whole file.
    // If it can't find a video stream with valid dimensions, the browser's
    // decoder won't be able to either.
    if (!ffprobePath) {
      // Missing ffprobe on this environment — fall back to the magic-byte
      // check we just passed. Better than rejecting every video.
      return { valid: true, reason: 'magic-bytes only (no ffprobe)', size: totalSize };
    }
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name,width,height,duration:format=duration',
        '-of', 'json',
        url,
      ], { timeout: 15000, maxBuffer: 1024 * 1024 });
      const data = JSON.parse(stdout);
      const videoStream = data.streams?.find(s => s.codec_type === 'video');
      if (!videoStream) return { valid: false, reason: 'no video stream' };
      const w = Number(videoStream.width || 0);
      const h = Number(videoStream.height || 0);
      if (w < 100 || h < 100) return { valid: false, reason: `invalid dimensions ${w}x${h}` };
      const dur = Number(videoStream.duration || data.format?.duration || 0);
      if (dur > 0 && dur < 1) return { valid: false, reason: `duration too short (${dur}s)` };
      return { valid: true, width: w, height: h, duration: dur, codec: videoStream.codec_name, size: totalSize };
    } catch (e) {
      const stderr = e.stderr ? String(e.stderr).slice(-300) : '';
      return { valid: false, reason: `ffprobe failed: ${e.message} ${stderr}` };
    }
  } catch (e) {
    return { valid: false, reason: `validator crashed: ${e.message}` };
  }
}

// Static fallback for when BytePlus Seedance fails. Takes a single image
// (avatar for scenes 1/3/4 + business scene 2; product for UGC scene 2),
// uses sharp to cover-fit it to 720x1280, then ffmpeg to loop it into a
// 5-second MP4 returned as a data: URL. The data: URL flows through the
// rest of the pipeline (Supabase row, client fetch, export) without needing
// any external object storage.
async function buildStaticFallbackVideo(imageUrl, durationSec = 5) {
  if (!imageUrl) return null;
  if (!ffmpegStaticPath || !fs.existsSync(ffmpegStaticPath)) {
    console.warn('[staticFallback] ffmpeg-static not available — cannot build fallback video');
    return null;
  }
  const tmpDir = path.join('/tmp', `static-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const inPath = path.join(tmpDir, 'frame.png');
  const outPath = path.join(tmpDir, 'static.mp4');
  try {
    // Resolve image input — data URL, http(s) URL, or relative path served
    // from public/ (e.g. /avatars/avatar-1.jpg).
    let imgBuf;
    if (imageUrl.startsWith('data:')) {
      const m = imageUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) throw new Error('malformed data URL');
      imgBuf = Buffer.from(m[1], 'base64');
    } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`fetch HTTP ${resp.status}`);
      imgBuf = Buffer.from(await resp.arrayBuffer());
    } else if (imageUrl.startsWith('/')) {
      const localPath = path.join(process.cwd(), 'public', imageUrl.replace(/^\/+/, ''));
      imgBuf = await readFile(localPath);
    } else {
      throw new Error(`unsupported image URL prefix: ${imageUrl.slice(0, 60)}`);
    }

    // sharp: cover-fit to 720x1280 portrait. force PNG output so ffmpeg's
    // -loop input is a clean still.
    const framedBuf = await sharp(imgBuf)
      .resize(720, 1280, { fit: 'cover' })
      .png()
      .toBuffer();
    await writeFile(inPath, framedBuf);
    console.log(`[staticFallback] frame.png written: ${framedBuf.length} bytes (cover-fit 720x1280)`);

    const args = [
      '-y', '-loop', '1', '-i', inPath,
      '-t', String(durationSec),
      '-r', '24',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath
    ];
    console.log('[staticFallback] ffmpeg args:', JSON.stringify(args));
    await execFileAsync(ffmpegStaticPath, args, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 });
    const stats = fs.statSync(outPath);
    console.log(`[staticFallback] static.mp4 generated: ${stats.size} bytes`);
    if (stats.size < 10 * 1024) throw new Error('generated mp4 too small');

    const mp4Buf = await readFile(outPath);
    const dataUrl = `data:video/mp4;base64,${mp4Buf.toString('base64')}`;
    console.log(`[staticFallback] returning data URL, ${mp4Buf.length} bytes raw`);
    return dataUrl;
  } catch (e) {
    console.error('[staticFallback] failed:', e.message);
    return null;
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Image-URL resolution for video reference frames now lives in
// lib/higgsfield-client.js (uploadToHiggsfield). Pass through http(s) URLs,
// resolve relative paths to https, and accept data: URIs inline.

async function runJob(jobId, body) {
  try {
    const {
      videoType = 'ugc',
      productName, productDesc, applicationArea,
      avatarUrl, productImageUrl, voiceId,
      businessName, businessDescription, businessPhotos,
      setting: requestedSetting,
      hookType: requestedHookType,
    } = body;
    const hookType = requestedHookType && HOOK_DNA[requestedHookType] ? requestedHookType : 'finally';
    // Resolve setting → promptText. 'auto' (or missing/unknown) → empty string (AI decides)
    const settingKey = requestedSetting && SETTINGS[requestedSetting] ? requestedSetting : 'auto';
    const settingPromptText = SETTINGS[settingKey]?.promptText || '';
    console.log(`[Job ${jobId}] Setting selected: ${settingKey}${settingPromptText ? ' (injected)' : ' (auto — empty)'}`);
    console.log(`[Job ${jobId}] Hook selected: ${hookType} (${HOOK_DNA[hookType].label})`);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ugc-studi-production.up.railway.app';
    const prepareUrl = (u) => u
      ? (u.startsWith('http') || u.startsWith('data:')
          ? u
          : `${baseUrl}${u.startsWith('/') ? '' : '/'}${u}`)
      : null;
    const preparedAvatar = prepareUrl(avatarUrl);
    const preparedProduct = prepareUrl(productImageUrl);
    const preparedBusinessPhotos = Array.isArray(businessPhotos)
      ? businessPhotos.map(prepareUrl).filter(Boolean)
      : [];
    console.log(`[Job ${jobId}] videoType=${videoType} Prepared URLs:`, { avatar: preparedAvatar?.slice(0, 80), product: preparedProduct?.slice(0, 80), businessPhotos: preparedBusinessPhotos.length });

    // Higgsfield's MCP media_upload accepts http(s) URLs and inline data
    // URIs. Resolve each image upfront once (relative paths → absolute https)
    // and reuse for all scenes — saves four redundant resolutions across the
    // per-scene loop.
    const [refAvatarUrl, refProductUrl, refBusinessPhotos] = await Promise.all([
      preparedAvatar ? uploadToHiggsfield(preparedAvatar) : null,
      preparedProduct ? uploadToHiggsfield(preparedProduct) : null,
      Promise.all(preparedBusinessPhotos.map(u => uploadToHiggsfield(u))).then(arr => arr.filter(Boolean))
    ]);

    console.log(`[Job ${jobId}] Post-upload refs:`, {
      refAvatarUrl: refAvatarUrl ? (refAvatarUrl.startsWith('data:') ? '❌ STILL data URL!' : refAvatarUrl.substring(0, 100)) : 'null',
      refProductUrl: refProductUrl ? (refProductUrl.startsWith('data:') ? '❌ STILL data URL!' : refProductUrl.substring(0, 100)) : 'null',
      refBusinessPhotosCount: refBusinessPhotos?.length || 0
    });

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

    // DEBUG — dump exactly what scenes the pipeline is about to feed into NB
    // and Seedance. If scene 1 carries a product-only kling_prompt, the
    // mismatch is visible here BEFORE we burn any inference time.
    console.log(`[Job ${jobId}] [DEBUG] scenes source: ${script ? 'Claude' : 'defaults-fallback'}`);
    (scenes || []).forEach((s, i) => {
      console.log(`  Scene ${i+1} type="${s?.type || ''}":`);
      console.log(`    nb_prompt    (first 150): ${(s?.nb_prompt || '').slice(0, 150)}`);
      console.log(`    kling_prompt (first 150): ${(s?.kling_prompt || '').slice(0, 150)}`);
    });

    // Higgsfield-only video flow. Each scene tries Higgsfield (Seedance 2.0
    // via MCP); on failure we build a 5-second static MP4 from a single
    // scene-relevant reference image (avatar for 1/3/4, product for UGC scene
    // 2). No fal.ai, no NanoBanana — fal credits are exhausted and BytePlus
    // was rejecting our Seedream-generated avatars under its content filter.
    console.log(`[Job ${jobId}] Starting Higgsfield single-shot 15s generation (sharp static as fallback)...`);
    const higgsfieldReady = isHiggsfieldConfigured();
    if (!higgsfieldReady) {
      console.warn(`[Job ${jobId}] Higgsfield not configured (missing HIGGSFIELD_TOKEN/ANTHROPIC_API_KEY) — full video will use the static fallback`);
    }
    // 3-tier fallback status for the one full video. Values:
    //   'marketing_studio' — Tier 1: Higgsfield Marketing Studio (UGC preset)
    //   'seedance'         — Tier 2: Higgsfield Seedance 2.0
    //   'static'           — Tier 3: ffmpeg-built static MP4 from a single image
    //   'none'             — all three tiers failed
    let videoSource = 'none';
    // Token usage from the Anthropic API calls. Accumulates across tiers so
    // the cost summary reflects total spend even if Tier 1 burned tokens
    // before falling back to Tier 2.
    let fullVideoUsage = null;
    const accumulateUsage = (tierUsage) => {
      if (!tierUsage) return;
      if (!fullVideoUsage) {
        fullVideoUsage = { ...tierUsage };
        return;
      }
      fullVideoUsage = {
        input_tokens: (fullVideoUsage.input_tokens || 0) + (tierUsage.input_tokens || 0),
        output_tokens: (fullVideoUsage.output_tokens || 0) + (tierUsage.output_tokens || 0),
        cache_read_input_tokens: (fullVideoUsage.cache_read_input_tokens || 0) + (tierUsage.cache_read_input_tokens || 0),
        cache_creation_input_tokens: (fullVideoUsage.cache_creation_input_tokens || 0) + (tierUsage.cache_creation_input_tokens || 0),
        cost_usd: (fullVideoUsage.cost_usd || 0) + (tierUsage.cost_usd || 0),
        elapsed_s: (fullVideoUsage.elapsed_s || 0) + (tierUsage.elapsed_s || 0)
      };
    };

    // Per-scene reference list — same logic as before, but now collected
    // upfront so we can build ONE unified beat-marked prompt + ONE merged
    // reference-image list for the single 15s call.
    const computeSceneRefs = (i) => {
      const klingIsBusinessCraft = videoType === 'business';
      const avatarFalUrl = refAvatarUrl;
      const productFalUrl = refProductUrl;
      if (klingIsBusinessCraft) {
        if (i === 1) return refBusinessPhotos.slice(0, 3);
        if (i === 0) return [avatarFalUrl].filter(Boolean);
        return [avatarFalUrl, refBusinessPhotos[0]].filter(Boolean);
      }
      switch (i + 1) {
        case 1: return [avatarFalUrl].filter(Boolean);
        case 2: return [productFalUrl].filter(Boolean);
        case 3:
        case 4: return [avatarFalUrl, productFalUrl].filter(Boolean);
        default: return [];
      }
    };

    // Trim a per-scene kling_prompt down to its visual core. The skill
    // produces verbose, layered prompts (~600-800 chars each) optimized for
    // a per-scene 5s call where every wrapper helps. In the merged 15s
    // prompt those wrappers would repeat 3× and inflate the prompt past 5K
    // chars — that's exactly what tripped the moderation flag in the
    // 4-call layout. We keep just the user-facing visual description.
    const trimKlingForBeat = (raw, maxChars) => {
      if (!raw) return '';
      let s = String(raw).trim();
      // Drop the leading UGC_MODE_TRIGGER / NEGATIVES wrappers if a caller
      // somehow handed us an already-wrapped prompt.
      s = s.replace(/^Photorealistic UGC[^.]*\.\s*/i, '');
      s = s.replace(/NEGATIVES:[\s\S]*$/i, '').trim();
      // Collapse whitespace for compactness.
      s = s.replace(/\s+/g, ' ');
      if (s.length <= maxChars) return s;
      // Truncate at the last sentence boundary that fits.
      const cut = s.slice(0, maxChars);
      const lastDot = cut.lastIndexOf('. ');
      return (lastDot > maxChars * 0.6 ? cut.slice(0, lastDot + 1) : cut).trim();
    };

    // Build the merged 3-beat 15-second prompt. Beat layout:
    //   Beat 1 (0-4s)  PAIN     — uses scenes[0].kling_prompt (avatar only)
    //   Beat 2 (4-7s)  PRODUCT  — uses scenes[1].kling_prompt (product only)
    //   Beat 3 (7-15s) WIN      — merges scenes[2] + scenes[3] (avatar + product)
    // The lip-lock rule and negatives appear ONCE at the top so the prompt
    // does not repeat itself (which is what triggered the
    // "copyright restrictions" rejection on the 4-call layout).
    const buildMergedFullPrompt = () => {
      const isBusiness = videoType === 'business';
      const beat1Raw = trimKlingForBeat(scenes[0]?.kling_prompt, 400);
      const beat2Raw = trimKlingForBeat(scenes[1]?.kling_prompt, 400);
      const beat3Raw = trimKlingForBeat(scenes[2]?.kling_prompt, 400);
      const beat4Raw = trimKlingForBeat(scenes[3]?.kling_prompt, 400);

      // HOOK_DNA injection (Meta Ads 2026 viral hook templates). Each
      // directive is prepended to its beat — the WIN_SCENE_RULES line below
      // still wraps beat4 with the category-specific outcome guidance.
      const hookDna = HOOK_DNA[hookType] || HOOK_DNA.finally;
      const beat1 = `${hookDna.beat1_directive} ${beat1Raw}`;
      const beat2 = `${hookDna.beat2_directive} ${beat2Raw}`;
      const beat3 = `${hookDna.beat3_directive} ${beat3Raw}`;
      const beat4 = `${hookDna.beat4_directive} ${beat4Raw}`;

      // Pick the WIN-scene guidance for Beat 4 based on product category.
      // Whitening products are classified as `health` by detectProductCategory
      // but need the dedicated "white-teeth-at-a-social-event" framing — we
      // detect them inline (rather than touching detectProductCategory) so
      // the category function stays a pure detector.
      const winText = `${productName || ''} ${productDesc || ''}`;
      const isWhitening = WHITENING_RX.test(winText);
      const { category: winCat } = detectProductCategory(productName, productDesc);
      const winKey = isWhitening ? 'whitening' : winCat;
      const winRule = WIN_SCENE_RULES[winKey] || WIN_SCENE_RULES.beauty;

      if (isBusiness) {
        const businessLabel = businessName || 'the location';

        const lines = [
          ...(settingPromptText ? [settingPromptText, ``] : []),
          `Vertical 9:16 selfie-style UGC location moment, shot on iPhone front camera, natural daylight at the location, handheld authentic energy, "showing my favorite spot" vibe, real skin tones with subtle imperfections, no filters, lived-in real-world environment.`,
          ``,
          `The woman from Image 2 — same face, same hair, same warm presence throughout — visiting or working at ${businessLabel} (Image 1). The location stays identical to the reference image — same storefront, same signage, same atmosphere, no alterations.`,
          ``,
          `Action sequence: ${beat1}`,
          ``,
          `Then, ${beat2}`,
          ``,
          `Next, ${beat3}`,
          ``,
          `Finally, ${beat4} — WIN SCENE: avatar enjoying the location outcome (relaxed, satisfied, in real use of the place) in a different moment/setting than Beat 1. Not a generic "smiling at the camera" shot.`,
          ``,
          `CRITICAL RULE: She never opens her mouth throughout. Lips stay completely closed. No talking, no lip movement, no sound. All emotion through eyes, eyebrows, and closed-mouth micro-expressions. Voiceover added externally — the visual must be silent.`
        ];
        return lines.join('\n');
      }

      const productLabel = productName || 'the product';

      const lines = [
        ...(settingPromptText ? [settingPromptText, ``] : []),
        `Vertical 9:16 selfie-style UGC product moment, shot on iPhone front camera, natural daylight, handheld authentic energy, warm natural light, real skin tones with subtle imperfections, no filters, lived-in real-world environment.`,
        ``,
        `The woman from Image 2 — same face, same hair, same warm presence throughout. She holds ${productLabel} (Image 1) — keep the product identical to the reference image, same colors, same shape, same branding details, no alterations.`,
        ``,
        `Action sequence: ${beat1} — NO product visible in this beat (empty hands or hands on head, product NEVER appears yet).`,
        ``,
        `Then, ${beat2}`,
        ``,
        `Next, ${beat3}`,
        ``,
        `Finally, ${beat4} — WIN SCENE: ${winRule} Product, when shown, is firmly held in one hand OR resting on a clear stable surface, NEVER floating in air.`,
        ``,
        `CRITICAL RULE: She never opens her mouth throughout. Lips stay completely closed. No talking, no lip movement, no sound. All emotion through eyes, eyebrows, and closed-mouth micro-expressions. Voiceover added externally — the visual must be silent.`
      ];
      return lines.join('\n');
    };

    // Merged reference image list — avatar + product (or business photo)
    // covers all three beats. The MCP uploads each one once and Claude
    // hands them to generate_video as reference frames.
    const mergedReferenceImages = (() => {
      if (videoType === 'business') {
        const avatar = refAvatarUrl;
        const businessHero = refBusinessPhotos[0] || null;
        return [businessHero, avatar].filter(Boolean);
      }
      return [refProductUrl, refAvatarUrl].filter(Boolean);
    })();

    // 3-tier fallback for the full 15s video.
    //
    //   Tier 1 — Marketing Studio (Higgsfield `marketing_studio_video`, UGC
    //            preset). Higher-quality UGC look. Requires both avatar and
    //            product reference URLs, so it's UGC-mode only — business
    //            mode skips straight to Tier 2.
    //   Tier 2 — Seedance 2.0 (existing higgsfield-client `generateFullVideo`).
    //            Reference-driven, identity-strong. Handles both UGC and
    //            business modes via the existing `mergedReferenceImages`.
    //   Tier 3 — Static MP4 built locally with sharp + ffmpeg from a single
    //            reference image. Placeholder so the user can see the script
    //            + voiceover and re-run; not a real ad.

    const tryMarketingStudio = async () => {
      // Marketing Studio's UGC preset is built around exactly two references:
      // the avatar (subject) and the product. Business mode has no product
      // image, so we skip Tier 1 and let Seedance handle it.
      if (videoType === 'business') {
        console.log(`[Job ${jobId}] Tier 1 skipped: business mode has no product reference (Marketing Studio is UGC-only)`);
        return null;
      }
      if (!isMarketingStudioConfigured()) {
        console.log(`[Job ${jobId}] Tier 1 skipped: Marketing Studio not configured (missing ANTHROPIC_API_KEY/HIGGSFIELD_TOKEN)`);
        return null;
      }
      if (!refAvatarUrl || !refProductUrl) {
        console.log(`[Job ${jobId}] Tier 1 skipped: missing avatar (${!!refAvatarUrl}) or product (${!!refProductUrl}) reference URL`);
        return null;
      }
      try {
        console.log(`[Job ${jobId}] Tier 1: Trying Marketing Studio UGC...`);
        const mergedPrompt = buildMergedFullPrompt();
        console.log(`[MarketingStudio] Full 15s video: 2 refs, prompt length=${mergedPrompt.length}`);
        const { videoUrl, usage } = await generateMarketingStudioVideo({
          avatarUrl: refAvatarUrl,
          productUrl: refProductUrl,
          prompt: mergedPrompt,
          duration: 15
        });
        accumulateUsage(usage);
        if (!videoUrl) {
          console.warn(`[Job ${jobId}] Tier 1 returned no url — falling back to Tier 2`);
          return null;
        }
        const v = await validateKlingVideo(videoUrl);
        if (!v.valid) {
          console.warn(`[Job ${jobId}] Tier 1 failed validation: ${v.reason} — falling back to Tier 2`);
          return null;
        }
        console.log(`[Job ${jobId}] Tier 1 succeeded! → ${v.width}x${v.height}, codec=${v.codec}, duration=${v.duration}s, ${videoUrl.slice(0, 100)}`);
        videoSource = 'marketing_studio';
        return { frame: null, video: videoUrl };
      } catch (e) {
        console.error(`[Job ${jobId}] Tier 1 failed: ${e?.message} — falling back to Tier 2`);
        return null;
      }
    };

    const trySeedance = async () => {
      if (!higgsfieldReady) {
        console.log(`[Job ${jobId}] Tier 2 skipped: Higgsfield not configured`);
        return null;
      }
      try {
        console.log(`[Job ${jobId}] Tier 2: Trying Seedance...`);
        const mergedPrompt = buildMergedFullPrompt();
        console.log(`[Higgsfield] Full 15s video: ${mergedReferenceImages.length} refs, prompt length=${mergedPrompt.length}`);
        const { videoUrl, usage } = await higgsfieldGenerateFullVideo({
          prompt: mergedPrompt,
          imageUrls: mergedReferenceImages,
          duration: 15
        });
        accumulateUsage(usage);
        if (!videoUrl) {
          console.warn(`[Job ${jobId}] Tier 2 returned no url — falling back to Tier 3`);
          return null;
        }
        const v = await validateKlingVideo(videoUrl);
        if (!v.valid) {
          console.warn(`[Job ${jobId}] Tier 2 failed validation: ${v.reason} — falling back to Tier 3`);
          return null;
        }
        console.log(`[Job ${jobId}] Tier 2 succeeded! → ${v.width}x${v.height}, codec=${v.codec}, duration=${v.duration}s, ${videoUrl.slice(0, 100)}`);
        videoSource = 'seedance';
        return { frame: null, video: videoUrl };
      } catch (e) {
        console.error(`[Job ${jobId}] Tier 2 failed: ${e?.message} — falling back to Tier 3`);
        return null;
      }
    };

    const tryFullVideo = async () => {
      // Tier 1: Marketing Studio
      const t1 = await tryMarketingStudio();
      if (t1) return t1;

      // Tier 2: Seedance
      const t2 = await trySeedance();
      if (t2) return t2;

      // Tier 3: Static fallback — single 15s MP4 from the avatar (or first
      // business photo for business mode). Placeholder so the user can see
      // the script + voiceover and re-run.
      console.log(`[Job ${jobId}] Tier 3: Static fallback...`);
      const fallbackImage = (videoType === 'business')
        ? (preparedBusinessPhotos[0] || preparedAvatar)
        : preparedAvatar;

      if (fallbackImage) {
        try {
          const staticUrl = await buildStaticFallbackVideo(fallbackImage, 15);
          if (staticUrl) {
            console.log(`[Job ${jobId}] Tier 3 succeeded (${staticUrl.length} chars data URL)`);
            videoSource = 'static';
            return { frame: fallbackImage, video: staticUrl };
          }
        } catch (e) {
          console.error(`[Job ${jobId}] Tier 3 crashed: ${e.message}`);
        }
      } else {
        console.error(`[Job ${jobId}] Tier 3: no fallback image available (avatar=${!!preparedAvatar}, business=${preparedBusinessPhotos.length})`);
      }

      videoSource = 'none';
      return { frame: null, video: null };
    };

    // tryFullVideo runs the 3-tier fallback (Marketing Studio → Seedance →
    // static) sequentially, each tier with its own internal cooldown if any.
    // generateVoice is ElevenLabs (not Anthropic) and is safe to run in
    // parallel with the video pipeline.
    const [voiceResult, fullResult] = await Promise.all([
      generateVoice(voiceover, voiceId),
      tryFullVideo()
    ]);
    const audioBase64 = voiceResult?.base64 || null;
    const wordTimestamps = voiceResult?.wordTimestamps || null;
    // Frames/videos arrays kept at length 4 so existing job-result consumers
    // (studio editor, regenerate-scene, jobs lookup) don't break. The full
    // 15s clip lives in slot 0; the rest stay null. The studio editor
    // detects this layout via fullVideoUrl and renders one player.
    const fullVideoUrl = fullResult.video;
    const frames = [fullResult.frame, null, null, null];
    const videos = [fullVideoUrl, null, null, null];

    console.log(`[Job ${jobId}] Full video source: ${videoSource}`);

    // Anthropic API cost summary for the single full-video call. Higgsfield's
    // MCP doesn't bill us — Anthropic does, since Claude is the MCP client.
    // Warn loudly if a single video burns more than $5 in tokens; that
    // usually means a prompt blew up (e.g., reference URL re-sent multiple
    // times in a retry loop) and is worth investigating.
    if (fullVideoUsage) {
      const totalCost = fullVideoUsage.cost_usd || 0;
      const totalIn = fullVideoUsage.input_tokens || 0;
      const totalOut = fullVideoUsage.output_tokens || 0;
      const totalElapsed = fullVideoUsage.elapsed_s || 0;
      console.log(`[Job ${jobId}] Anthropic cost summary: 1 full video, in=${totalIn} out=${totalOut} elapsed=${totalElapsed.toFixed(1)}s ≈ $${totalCost.toFixed(4)}`);
      if (totalCost > 5) {
        console.warn(`[Job ${jobId}] ⚠️  COST ALERT: Anthropic spend exceeded $5 ($${totalCost.toFixed(2)}) for this single video. Investigate prompt size or retry loops.`);
      }
    }

    const result = {
      story: { scenes, hebrew_voice: voiceover },
      frames,
      videos,
      // New single-shot 15s field — studio editor uses this when present
      // to render one player instead of the legacy 4-clip stack. Older job
      // records (without this field) keep working through the videos array.
      fullVideoUrl,
      fullVideoDuration: fullVideoUrl ? 15 : null,
      // Which tier of the 3-tier fallback produced the video. Useful for
      // analytics ("what % of jobs hit Marketing Studio vs Seedance vs
      // static") and for the editor to badge the video source.
      videoSource,
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

    // Quota: count this video against the user's plan and mark video_jobs row done.
    // All errors swallowed inside helpers — quota drift > failing a finished job.
    if (body?.userId) {
      await incrementVideoCount(body.userId, false);
    }
    await updateVideoJobStatus(jobId, 'completed', fullVideoUrl);

    // Fire-and-forget: pre-warm the Railway video cache so the editor opens
    // with all clips already resident in memory. data: URLs (the static
    // fallback path) are skipped automatically by prewarmVideos.
    try {
      prewarmVideos(videos.filter(Boolean));
    } catch (e) {
      console.warn(`[Job ${jobId}] prewarm invocation failed:`, e.message);
    }
  } catch (e) {
    console.error(`[Job ${jobId}] Failed:`, e.message);
    await supabase
      .from('jobs')
      .update({ status: 'error', error: e.message })
      .eq('id', jobId);
    // Mark video_jobs row failed too. Quota counter is NOT incremented —
    // failed generations don't count against the user's plan.
    await updateVideoJobStatus(jobId, 'failed', null);
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

// Auto-detect product category and Hebrew plural for the Beat-1 template
// "ניסיתי כבר מלא {plural} ו{negative outcome}". Categories: accessory, beauty,
// health, fashion, home, food. Each match returns the Hebrew plural to drop
// into the template; unmatched products fall back to the closest category and
// a generic plural ("מוצרים").
function detectProductCategory(productName, productDesc) {
  const text = ((productName || '') + ' ' + (productDesc || '')).toLowerCase();
  const m = (re, category, plural) => re.test(text) ? { category, plural } : null;

  return (
    // === Dynamic-pattern categories (Option B) — must come BEFORE the
    // legacy regexes below because skincare_aging steals "קרם" from beauty
    // and fitness_supplement steals "תוסף" from health.
    m(/אנרגי|energy\s*drink|red\s*bull|ראד\s*בול|מונסטר|monster|blaze/, 'energy', 'משקאות אנרגיה') ||
    m(/coffee|קפה|אספרסו|espresso|moka|מוקה|bulletproof|בולטפרוף|cold\s*brew/, 'coffee', 'מוצרי קפה') ||
    m(/pre.?workout|preworkout|פרי.?וורקאוט|powerpump|protein\s*powder|אבקת\s*חלבון|חלבון|creatine|קריאטין|bcaa|בי\.?סי\.?אי\.?אי|mass.?gainer|gainer/, 'fitness_supplement', 'תוספי אימון') ||
    m(/anti.?aging|אנטי.?אייג|רטינול|retinol|wrinkle|קמט|קמטים|alma|ageless|firming|hyaluron|היאלורון/, 'skincare_aging', 'קרמים נגד קמטים') ||
    m(/מנקה|ניקוי|cleaner|detergent|כביסה|רצפה|degreaser|disinfect|חיטוי|sanitiz|מסיר.*כתמ/, 'cleaning', 'מוצרי ניקוי') ||
    // === Legacy categories ===
    // accessory
    m(/כיפה|כיפת|kipah|yarmulke/, 'accessory', 'כיפות') ||
    m(/שרשרת|necklace/, 'accessory', 'שרשראות') ||
    m(/צמיד|bracelet/, 'accessory', 'צמידים') ||
    m(/שעון|watch/, 'accessory', 'שעונים') ||
    m(/משקפיים|glasses|sunglasses/, 'accessory', 'משקפיים') ||
    m(/טבעת|ring/, 'accessory', 'טבעות') ||
    m(/תיק|bag|handbag/, 'accessory', 'תיקים') ||
    m(/חגורה|belt/, 'accessory', 'חגורות') ||
    m(/כובע|hat|cap/, 'accessory', 'כובעים') ||
    m(/צעיף|scarf/, 'accessory', 'צעיפים') ||
    m(/עניבה|necktie\b|\btie\b/, 'accessory', 'עניבות') ||
    // beauty
    m(/קרם|cream|moisturizer/, 'beauty', 'קרמים') ||
    m(/בושם|perfume|fragrance/, 'beauty', 'בשמים') ||
    m(/איפור|makeup/, 'beauty', 'מוצרי איפור') ||
    m(/סרום|serum/, 'beauty', 'סרומים') ||
    m(/מסכת פנים|מסכה|face mask|mask/, 'beauty', 'מסכות') ||
    m(/שמפו|shampoo/, 'beauty', 'שמפו') ||
    m(/מרכך|conditioner/, 'beauty', 'מרככים') ||
    m(/ליפסטיק|שפתון|lipstick/, 'beauty', 'ליפסטיקים') ||
    m(/לק לציפורניים|לק|nail polish/, 'beauty', 'לקים') ||
    m(/אקדח שיער|מייבש שיער|hair ?dryer/, 'beauty', 'מייבשי שיער') ||
    // health
    m(/אבקת הלבנה|הלבנת שיניים|teeth whitening|whitening powder/, 'health', 'אבקות הלבנה') ||
    m(/ויטמין|vitamin/, 'health', 'ויטמינים') ||
    m(/משחת שיניים|toothpaste/, 'health', 'משחות שיניים') ||
    m(/דאודורנט|deodorant/, 'health', 'דאודורנטים') ||
    m(/מי פה|mouthwash/, 'health', 'מי פה') ||
    m(/תוסף תזונה|dietary supplement/, 'food', 'תוספי תזונה') ||
    m(/תוסף|supplement/, 'health', 'תוספים') ||
    // fashion
    m(/חולצה|חולצות|t-?shirt|shirt/, 'fashion', 'חולצות') ||
    m(/מכנסיים|מכנס|pants|trousers/, 'fashion', 'מכנסיים') ||
    m(/נעליים|נעל|shoes|sneakers/, 'fashion', 'נעליים') ||
    m(/שמלה|שמלות|dress/, 'fashion', 'שמלות') ||
    m(/ז.קט|jacket/, 'fashion', "ז'קטים") ||
    m(/חליפה|suit/, 'fashion', 'חליפות') ||
    m(/פיג.מה|pajama/, 'fashion', "פיג'מות") ||
    m(/גרביים|socks/, 'fashion', 'גרביים') ||
    // home
    m(/סיר|pot/, 'home', 'סירים') ||
    m(/מטבח|kitchenware/, 'home', 'מוצרי מטבח') ||
    m(/מזרון|מזרן|mattress/, 'home', 'מזרונים') ||
    m(/כרית|pillow/, 'home', 'כריות') ||
    m(/שמיכה|blanket|duvet/, 'home', 'שמיכות') ||
    m(/מנורה|lamp|lighting/, 'home', 'מנורות') ||
    m(/מארגן|organizer/, 'home', 'מארגנים') ||
    // food
    m(/חטיף|snack/, 'food', 'חטיפים') ||
    m(/משקה|drink|beverage/, 'food', 'משקאות') ||
    m(/אוכל ארוז|packaged food/, 'food', 'מוצרי אוכל') ||
    // fallback
    { category: 'beauty', plural: 'מוצרים' }
  );
}

// Category-specific Beat-1 hook pools (Option B). For each new category we
// keep both feminine and masculine variants explicitly so we don't depend on
// toMasculine for the new phrasing (some constructions like "את צריכה" →
// "אתה צריך" go beyond simple word-substitution). Entries are picked at
// random per generation so users see varied hooks across regens. Categories
// not listed here fall through to the legacy "ניסיתי כבר מלא ..." template.
const PRODUCT_BEAT1_PATTERNS = {
  energy: {
    female: [
      'השעה 3 אחה״צ והקפה השלישי לא עוזר',
      'את מנסה להתעורר אבל הגוף לא מקשיב',
      '10 בלילה ואת צריכה עוד לעבוד',
      'התעוררת עייפה שוב',
    ],
    male: [
      'השעה 3 אחה״צ והקפה השלישי לא עוזר',
      'אתה מנסה להתעורר אבל הגוף לא מקשיב',
      '10 בלילה ואתה צריך עוד לעבוד',
      'התעוררת עייף שוב',
    ],
  },
  coffee: {
    female: [
      'הקפה של הבוקר נותן לך שעה אנרגיה ואז זה נגמר',
      'טעמת אספרסו טוב פעם, הקפה של הבית לא קרוב',
      'קפה נמס שוב, זה לא הולך לעבוד',
    ],
    male: [
      'הקפה של הבוקר נותן לך שעה אנרגיה ואז זה נגמר',
      'טעמת אספרסו טוב פעם, הקפה של הבית לא קרוב',
      'קפה נמס שוב, זה לא הולך לעבוד',
    ],
  },
  fitness_supplement: {
    female: [
      'את מתחילה אימון בלי כוח',
      '20 דקות באימון ואת כבר נגמרת',
      'מגיעה לחדר כושר ואין לך אש',
      'האימון נגמר ואת לא הרגשת אותו',
    ],
    male: [
      'אתה מתחיל אימון בלי כוח',
      '20 דקות באימון ואתה כבר נגמר',
      'מגיע לחדר כושר ואין לך אש',
      'האימון נגמר ואתה לא הרגשת אותו',
    ],
  },
  skincare_aging: {
    female: [
      'כל בוקר את רואה את הקווים האלה',
      'הקרם הזול הזה כבר לא עוזר',
      'מסתכלת במראה, זו לא את לפני שנה',
      'הפנים נראים עייפים גם אחרי שמונה שעות שינה',
    ],
    male: [
      'כל בוקר אתה רואה את הקווים האלה',
      'הקרם הזול הזה כבר לא עוזר',
      'מסתכל במראה, זה לא אתה לפני שנה',
      'הפנים נראים עייפים גם אחרי שמונה שעות שינה',
    ],
  },
  cleaning: {
    female: [
      'הכתם הזה כבר חודש על השטיח',
      'ניקית את האמבטיה אתמול וכבר חזר הלכלוך',
      'המוצר הזול לא מסיר כלום',
    ],
    male: [
      'הכתם הזה כבר חודש על השטיח',
      'ניקית את האמבטיה אתמול וכבר חזר הלכלוך',
      'המוצר הזול לא מסיר כלום',
    ],
  },
};

// 4 viral hook templates from Meta Ads 2026 (Andromeda update) research.
// Each entry prepends a directive to its corresponding beat (1-4) of the
// merged 15s prompt — so the same script flow gains a distinct opening
// energy and through-line. Default is `finally` (closest to the legacy
// PAIN→DISCOVERY→USE→WIN behavior). Lookups outside this map fall back to
// `finally`.
const HOOK_DNA = {
  this_is_for: {
    label: "THIS IS FOR...",
    emoji: "🎯",
    description: "Calling out specific audience",
    best_for: ["B2B", "niche", "specific demographics"],
    beat1_directive: "Direct address to camera, pointing or looking at viewer with conviction. Confident, knowing expression. Text overlay implied: 'This is for...'",
    beat2_directive: "Show the specific problem this exact audience faces. Tight close-up on the pain point. Frustration in eyes (NO LIP MOVEMENT).",
    beat3_directive: "Product reveals as the specific solution for this audience. Hero shot - product alone for 1 second, then in use.",
    beat4_directive: "Same person transformed - now belongs to the success group. Different setting/lighting from beat 1. Confident posture.",
    voiceover_pattern: "This is for [audience] who want [desire]. Listen up...",
    cta_style: "membership / belonging"
  },
  pov: {
    label: "POV",
    emoji: "👀",
    description: "Point of view immersion",
    best_for: ["beauty", "fashion", "lifestyle", "emotional"],
    beat1_directive: "POV-style shot. Camera at eye-level, slight selfie angle. Subject's face shows desired emotional state (anticipation, joy). Text overlay implied: 'POV:'",
    beat2_directive: "Setup the scenario - what just happened in this POV. Could be hand reaching for product, or environment shot.",
    beat3_directive: "Product appears within the POV moment. Held firmly (never floating). Used naturally as part of the experience.",
    beat4_directive: "Emotional payoff - the feeling they wanted to live. Different setting suggests passage of time. Authentic satisfaction in eyes.",
    voiceover_pattern: "POV: you finally [desired state]...",
    cta_style: "experiential / aspirational"
  },
  little_known: {
    label: "LITTLE KNOWN...",
    emoji: "🤫",
    description: "Curiosity gap reveal",
    best_for: ["hacks", "new products", "underground trends"],
    beat1_directive: "Conspiratorial expression. Looking around as if sharing a secret. Slight lean toward camera. Mysterious, knowing look.",
    beat2_directive: "Build mystery - hint without revealing. Hand near mouth gesture (but mouth closed - NO LIP MOVEMENT). Eyes communicate the secret.",
    beat3_directive: "Dramatic product reveal. Product comes into frame from off-screen. Hero shot 1 second, then close interaction.",
    beat4_directive: "Knowing smile, satisfied expression. The 'I told you' moment. Result is visible and impressive.",
    voiceover_pattern: "Little known [product/hack] that [unexpected benefit]...",
    cta_style: "exclusivity / insider"
  },
  finally: {
    label: "FINALLY...",
    emoji: "✨",
    description: "Pain point finally solved",
    best_for: ["everyday problems", "skincare", "supplements"],
    beat1_directive: "Frustrated, exhausted expression. Hand on forehead or rubbing eyes. The 'I've tried everything' feeling.",
    beat2_directive: "Quick montage feel - showing things that didn't work. Multiple frustrated reactions or product alternatives shown failing.",
    beat3_directive: "Product reveal with visible relief. Shoulders drop. Eyes widen slightly. Hero shot of product 1 second.",
    beat4_directive: "Genuine 'this actually works' moment. Authentic satisfaction (not over-acted). Calm confidence. Result clearly visible.",
    voiceover_pattern: "Finally, a [product] that actually [delivers promise]...",
    cta_style: "relief / solution-focused"
  }
};

// Beat-4 (WIN) outcome guidance per product category. The WIN scene must
// show the AVATAR ENJOYING THE BENEFIT in a real-world situation that
// resolves the Beat-1 pain — NOT a generic "smiling with product" beauty
// shot. Product can be visible but is NOT the focus. Setting/lighting
// shifts vs. Beat 1 to suggest passage of time. Each entry replaces the
// generic Beat-4 guard line in the merged prompt. Categories without an
// entry fall back to the `beauty` rule.
const WIN_SCENE_RULES = {
  energy: `Avatar at work or in active situation with full energy — focused, productive, finishing a task or on a confident call. Product visible but NOT the focus. Different setting/lighting from Beat 1.`,
  coffee: `Avatar enjoying their morning at desk or in a quality moment with the perfect coffee — focused, content. Product visible but NOT the focus. Brighter, calmer setting than Beat 1.`,
  fitness_supplement: `Avatar mid-exercise with great form — successful pull-up, lifting weight, or finishing a strong rep. Visible energy and pump. Product visible but NOT the focus. Gym/active setting, different from Beat 1.`,
  skincare_aging: `Avatar in a social setting (date, meeting, selfie) showing glowing skin confidence. Bright, flattering lighting on the face. Product visible but NOT the focus. Different setting from the Beat-1 mirror moment.`,
  whitening: `Avatar smiling wide at a date or social event, laughing, or taking a confident selfie — bright white teeth clearly visible. Product NOT the focus. Social situation, different from Beat 1.`,
  cleaning: `Avatar relaxing in a clean, satisfied space — hosting guests or sitting back content with the result. Product visible but NOT the focus. Calm, post-cleaning atmosphere different from Beat 1.`,
  beauty: `Avatar in a social situation with confidence — genuine smile, "after" transformation visible. Product visible but NOT the focus. Different setting/lighting from Beat 1 to suggest passage of time.`,
};

// Whitening products are classified as `health` by detectProductCategory,
// but the WIN scene needs the dedicated "white teeth at a social event"
// framing. Detect inline so we don't have to touch the category function.
const WHITENING_RX = /אבקת\s*הלבנה|הלבנת\s*שיניים|teeth\s*whitening|whitening/i;

// Beat-1 template builder. Categories listed in PRODUCT_BEAT1_PATTERNS use
// the new dynamic pool (Option B). All other categories use the legacy
// "ניסיתי כבר מלא {plural} ו{negative outcome}" template.
function buildProductBeat1(category, plural, voiceGender = 'female') {
  const pool = PRODUCT_BEAT1_PATTERNS[category]?.[voiceGender];
  if (pool && pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const tailByCategory = {
    accessory: 'ושום דבר לא התאים לי ולא ידעתי מה לעשות',
    beauty: 'ושום דבר לא עבד לי באמת',
    health: 'ופשוט לא ראיתי תוצאות',
    fashion: 'ושום דבר לא נראה עליי טוב',
    home: 'ושום דבר לא עבד לי כמו שצריך',
    food: 'ושום דבר לא היה מספיק טעים',
  };
  const tail = tailByCategory[category] || tailByCategory.beauty;
  return `ניסיתי כבר מלא ${plural} ${tail}`;
}

function getHook(productName, productDesc, voiceGender = 'female') {
  const { category, plural } = detectProductCategory(productName, productDesc);
  const raw = buildProductBeat1(category, plural, voiceGender);
  // Dynamic-pool entries are already gender-correct; toMasculine becomes a
  // safe no-op on them. Legacy templates are feminine-base and need conversion.
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

const STABLE = SHARED_STABLE;
const PRODUCT_LOCK = SHARED_PRODUCT_LOCK;
const BUSINESS_CRAFT_LOCK = SHARED_BUSINESS_CRAFT_LOCK;

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
      kling_prompt: `Camera slowly orbits around ${productName} resting on a stable surface, product stays stationary and grounded with clear contact shadow, subtle zoom-in, cinematic product shot, soft natural light, no person in frame, no hands. ${PRODUCT_LOCK} silent, smooth natural motion only, no floating, no levitating, no hovering, product shape and colors unchanged from reference`,
      subtitle: `זה ${productName} — ${productDesc}.`
    },
    {
      type: 'פתרון',
      nb_prompt: `avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, excited expression, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar excitedly using ${productName} on themselves during ${applicationArea}, product ON the avatar, hands clearly visible, expression of pleasant surprise. ${PRODUCT_LOCK} ${STABLE}`,
      subtitle: `עד שגיליתי את ${productName} ואז הכל השתנה, ${applicationArea} והתוצאות מטורפות.`
    },
    {
      type: 'תוצאה',
      // Continuation fallback: avatar in the SAME everyday location as scene
      // 1, just satisfied now. Reads as one continuous moment rather than a
      // new "lifestyle" scene. Claude's live script overrides this.
      nb_prompt: `avatar in the same indoor everyday location as scene 1 (home / kitchen / bathroom / office) with a closed-lip confident satisfied smile, product naturally visible or its effect visible, same window daylight as scene 1, casual home atmosphere, correct human anatomy, NEVER show a phone or mobile device in any scene`,
      kling_prompt: `Avatar in the same indoor location as scene 1 with a quietly satisfied moment after using ${productName}, closed-lip warm smile forms gradually with eyes softening, small subtle nod, same window daylight and warm room practical, product naturally visible. ${PRODUCT_LOCK} ${STABLE}`,
      subtitle: `תנסו את ${productName} — יש אחריות מלאה אין מה להפסיד!`
    }
  ];
}

// ============ BUSINESS MODE ============

function getBusinessCategory(desc) {
  const d = (desc || '').toLowerCase();
  // Order matters: barbershop must beat the generic salon/hair regex below.
  if (/ברבר\s*שופ|ברברשופ|barbershop|barber\s*shop/.test(d)) return 'barbershop';
  if (/קוסמטיק|לייזר|טיפולי פנים|טיפול פנים|aesthetic|laser|cosmetic|botox/.test(d)) return 'beauty_clinic';
  if (/קליניק|מרפא|רופא|אסתטי|שיני|clinic|dental|doctor|therapy|spa|massage/.test(d)) return 'beauty_clinic';
  if (/מסעד|קפה|פיצרי|בר\b|אוכל|שף|מטבח|restaurant|cafe|bar|food|kitchen|pizza|sushi|burger/.test(d)) return 'restaurant';
  if (/אופנה|בוטיק|בגד|חולצ|שמל|fashion|boutique|clothing|apparel|shop|store/.test(d)) return 'fashion';
  if (/מספר|תסרוק|ספר|salon|hair|barber/.test(d)) return 'salon';
  if (/כושר|חדר כושר|אימון|יוגה|פילאטיס|gym|fitness|yoga|pilates|trainer/.test(d)) return 'fitness';
  return 'service';
}

// Map new business-category keys to the legacy ones used by the
// uniform/closeUp/scene3 helpers below (which were authored before the
// barbershop/beauty_clinic split). Keeps those helpers intact.
function legacyBusinessCategoryKey(cat) {
  if (cat === 'barbershop') return 'salon';
  if (cat === 'beauty_clinic') return 'clinic';
  if (cat === 'service') return 'generic';
  return cat;
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
// Scene-2 venue description for BUSINESS mode — the business "alive" with
// customers + staff in action. Replaces the old hands-only close-up. Used in
// generateBusinessScript scene-2 nb_prompt and kling_prompt.
function getBusinessVenueDesc(cat) {
  switch (cat) {
    case 'salon':
      return 'the salon/barbershop interior with styling chairs, mirrors and stations, 2-3 customers being served by stylists, natural conversation, branded signage visible';
    case 'restaurant':
      return 'the restaurant/cafe with tables of customers eating, staff serving plates, kitchen activity in soft focus, branded signage visible';
    case 'fitness':
      return 'the gym floor with members training on equipment, a trainer coaching, energy and movement in the space, branded signage visible';
    case 'fashion':
      return 'the boutique interior with customers browsing the racks, staff helping at the counter, garments on mannequins, branded signage visible';
    case 'clinic':
      return 'the clinic interior with the reception or treatment-room doorway visible, a client being greeted or seated by staff, calm professional activity, branded signage visible';
    default:
      return 'the business venue with 2-3 customers being served by staff, real activity in the space, branded signage visible';
  }
}

// Beat-1 hook for BUSINESS mode. First-person recollection of bad prior
// experiences with competing businesses — never names the current business.
// Each option opens with one of the required verbs ("הלכתי / הייתי / ניסיתי /
// אכלתי / התאמנתי") so the validator passes.
function getBusinessHook(desc, name, voiceGender = 'female') {
  const cat = getBusinessCategory(desc);
  const hooks = {
    barbershop: 'הלכתי לכבר מלא מספרות והתספורת אף פעם לא יצאה כמו שרציתי',
    salon: 'הייתי בכבר מלא סלונים ושום פעם לא יצאתי מרוצה מהתוצאה',
    beauty_clinic: 'ניסיתי כבר מלא קליניקות ולא ראיתי שינוי אמיתי בעור',
    restaurant: 'אכלתי בכבר מלא מסעדות ושום מקום לא הרגיש כמו בית',
    fitness: 'התאמנתי בכבר מלא חדרי כושר ולא הרגשתי שמתקדמת',
    fashion: 'הסתובבתי בכבר מלא חנויות ושום בגד לא דיבר אליי',
    service: 'ניסיתי כבר מלא מקומות ושום אחד לא נתן לי את מה שחיפשתי',
  };
  const raw = hooks[cat] || hooks.service;
  return voiceGender === 'male' ? toMasculine(raw) : raw;
}

function getBusinessDefaultVoiceover(name, desc, hook, voiceGender = 'female') {
  const h = hook || getBusinessHook(desc, name, voiceGender);
  // Third-person / customer perspective — avatar does NOT talk.
  return `${h}. הסוד? כל פרט נעשה בידיים, טרי, מהרגע הראשון. ב${name} מרגישים את ההבדל מיד — ${desc || 'חוויה אמיתית'}, וזה מה שגורם ללקוחות לחזור. בואו ל${name} — אתם חייבים לנסות את זה.`;
}

function getBusinessDefaultScenes(name, desc) {
  const hook = getBusinessHook(desc, name);
  const cat = legacyBusinessCategoryKey(getBusinessCategory(desc));
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
      kling_prompt: `Slow cinematic motion of ${closeUp}, hands working smoothly with clear purpose, NO person visible. ${BUSINESS_CRAFT_LOCK} silent, smooth natural motion only, business appearance unchanged from reference`,
      subtitle: `כל פרט נעשה בידיים`
    },
    {
      type: 'בפעולה',
      nb_prompt: `avatar wearing ${uniform} ${scene3Action}, inside the ${venue}, focused professional expression with mouth closed, authentic documentary moment, warm interior lighting, ${silentRule}, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle`,
      kling_prompt: `Avatar ${scene3Action}, natural working motion, hands moving with purpose, focused expression. ${BUSINESS_CRAFT_LOCK} ${STABLE}`,
      subtitle: `ב${name} עושים את זה ברמה אחרת`
    },
    {
      type: 'הזמנה',
      // Business-success contextual-result fallback: avatar IN the thriving
      // moment of the business (customers visibly enjoying, workspace alive)
      // rather than alone by the sign. Claude's live script overrides this.
      nb_prompt: `avatar wearing ${uniform} inside ${name} at a business-success moment — workspace alive with customers/activity softly visible in background, ${name} signage or branded element in frame, warm relaxed smile with mouth closed, quiet professional pride, context-appropriate warm lighting from the venue, inviting atmosphere, ${silentRule}, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene`,
      kling_prompt: `Avatar in the business-success moment of ${name}, mouth-closed warm smile forms gradually with eyes softening in quiet pride, customers or activity moving softly in the background, small welcoming nod. ${BUSINESS_CRAFT_LOCK} ${STABLE}`,
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

  const detectedCategory = getBusinessCategory(desc);
  const cat = legacyBusinessCategoryKey(detectedCategory);
  const uniform = getCategoryUniform(cat);
  const closeUp = getCategoryCloseUp(cat);
  const scene3Action = getCategoryScene3Action(cat);
  const venue = getCategoryVenue(cat);
  const businessVenue = getBusinessVenueDesc(cat);
  const categoryHints = {
    restaurant: 'Focus on the craft of the food, freshness, the kitchen energy, what customers taste and feel.',
    fashion: 'Focus on the boutique vibe, the pieces, the feel of the fabric, the personal touch.',
    clinic: 'Focus on expertise, care, results, the calm professionalism of the treatment room.',
    salon: 'Focus on the styling craft, the finish, the confidence customers leave with.',
    fitness: 'Focus on the energy of the space, the trainers, how members feel leaving a session.',
    generic: 'Focus on what the owner does uniquely well and why customers keep coming back.',
  };

  const callClaude = async (extra = '') => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 8192,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing Hebrew scripts for LOCAL BUSINESSES. Redesigned business-video format:

Business name: "${name}"
Business description: ${desc}
mode: business
auto_detected_category: ${detectedCategory}
Venue: ${venue}

CRITICAL OUTPUT CONSTRAINTS:
- Output VALID JSON only — no markdown fences (no \`\`\`json), no preamble, no commentary
- Each kling_prompt: 400-800 chars maximum
- Each nb_prompt: 200-400 chars maximum
- Total response under 6000 chars
- Start response with { and end with }
Uniform: ${uniform}
Close-up action: ${closeUp}
Scene-3 activity: ${scene3Action}
Category guidance: ${categoryHints[cat]}

${genderInstruction}

STEP 0 — BUSINESS CATEGORY DETECTION (REQUIRED OUTPUT FIELD):
Classify the business into EXACTLY ONE of:
  - "barbershop"     — מספרה, ברבר שופ
  - "salon"          — מספרת נשים, סלון יופי
  - "beauty_clinic"  — קוסמטיקה, טיפולי פנים, לייזר
  - "restaurant"     — מסעדה, בית קפה
  - "fitness"        — חדר כושר, קרוספיט, יוגה
  - "service"        — שירות אחר (קליניקה, תיקונים וכו')
Return the chosen value in a top-level "category" JSON field. Default to the auto-detected one (${detectedCategory}) unless clearly wrong.

CRITICAL ROLE RULES — THE AVATAR ON SCREEN PLAYS THE SILENT EMPLOYEE/OWNER:
- The avatar visually represents the employee or owner of "${name}" — silent in every shot, mouth closed or natural relaxed smile.
- Voiceover plays OVER the 4 scenes as a CUSTOMER TESTIMONIAL — the spoken voice is a satisfied customer recounting their journey, NOT the avatar.

⚡ STRICT 4-BEAT TEMPLATE — BUSINESS MODE — DO NOT DEVIATE ⚡

BEAT 1 — CUSTOMER'S PRIOR BAD EXPERIENCE (voiceover_scene1, ~10–14 Hebrew words):
  TEMPLATE — first person, customer recounting prior bad experiences at COMPETING businesses (never names "${name}"):
  • barbershop:    "הלכתי לכבר מלא מספרות והתספורת אף פעם לא יצאה כמו שרציתי"
  • salon:         "הייתי בכבר מלא סלונים ושום פעם לא יצאתי מרוצה מהתוצאה"
  • beauty_clinic: "ניסיתי כבר מלא קליניקות ולא ראיתי שינוי אמיתי בעור"
  • restaurant:    "אכלתי בכבר מלא מסעדות ושום מקום לא הרגיש כמו בית"
  • fitness:       "התאמנתי בכבר מלא חדרי כושר ולא הרגשתי שמתקדם/ת"
  • service:       "ניסיתי כבר מלא מקומות ושום אחד לא נתן לי את מה שחיפשתי"
  HARD REQUIREMENTS for Beat 1:
    - MUST contain ONE of: "הלכתי" / "הייתי" / "ניסיתי" / "אכלתי" / "התאמנתי"
    - MUST NOT contain "${name}"
    - MUST recount a prior bad experience at competing businesses (the customer's pain)

BEAT 2 — DISCOVERY OF THIS BUSINESS (voiceover_scene2, ~6–9 Hebrew words):
  TEMPLATE — pick one and adapt:
    - "עד שהגעתי ל${name} ופשוט הבנתי שמצאתי את המקום"
    - "עד שגיליתי את ${name} ופשוט הכל היה שונה"
    - "ואז הגעתי ל${name} ופתאום הבנתי איך אמור להיות"
  HARD REQUIREMENTS for Beat 2:
    - MUST START with one of: "עד שהגעתי ל" / "עד שגיליתי את" / "ואז הגעתי ל"
    - MUST contain "${name}"

BEAT 3 — WHAT MAKES ${name} SPECIAL (voiceover_scene3, ~14–20 Hebrew words):
  - One sentence on 2-3 specific things ${name} does well (professionalism, atmosphere, results) that resolve the Beat-1 pain
  - Concrete and specific — drawn from the business description, not generic praise
  HARD REQUIREMENTS for Beat 3:
    - MUST NOT contain "עד שגיליתי" / "ואז גיליתי" / "פתרון חכם" / "פתרון מושלם" / "התוצאות מטורפות"

BEAT 4 — CTA TEMPLATE (voiceover_scene4, ~8–11 Hebrew words):
  TEMPLATE — pick one:
    - "תיכנסו ל${name}, תקבעו תור עכשיו - {short promise}"
    - "תבואו ל${name}, תסמכו עליי - לא תתחרטו"
    - "תקבעו תור ב${name} עכשיו, אני מבטיח/ה לכם"
  HARD REQUIREMENTS for Beat 4:
    - MUST contain ONE of: "תקבעו תור" / "תבואו" / "תיכנסו"
    - MUST contain "${name}"

SANITY CHECK before returning:
  1. Beat 1 contains "הלכתי" / "הייתי" / "ניסיתי" / "אכלתי" / "התאמנתי", does NOT mention "${name}".
  2. Beat 2 STARTS with "עד שהגעתי ל" / "עד שגיליתי את" / "ואז הגעתי ל" AND contains "${name}".
  3. Beat 3 lists concrete special qualities; no forbidden phrases.
  4. Beat 4 contains "תקבעו תור" / "תבואו" / "תיכנסו" + "${name}".

VISUAL 4-SCENE STRUCTURE (matches the 4 voiceover beats):
- Scene 1 (👋 הכנסה): avatar wearing ${uniform}, inside the ${venue}, starting their workday — putting on apron / standing behind the counter / arriving at the workspace. Mouth closed. Voiceover HOOK.
- Scene 2 (🏪 העסק והלקוחות): MEDIUM/WIDE shot of the business in action — storefront with signage visible, OR interior with 2-3 customers being served, employees working, ambient activity. Uses business reference photos to lock the actual venue. The space FEELS alive — not empty, not staged. Voiceover introduces the business value proposition.
- Scene 3 (🏪 בפעולה): avatar ${scene3Action} inside the ${venue}. Mouth closed, focused professional expression. Voiceover describes the story / unique value of ${name}.
- Scene 4 (🚀 הזמנה — BUSINESS-SUCCESS CONTEXTUAL RESULT): NOT just the avatar standing by the sign. Show the BUSINESS ALIVE AND THRIVING — the lifestyle/moment the business delivers to its customers, with the owner/employee happy IN that moment. Category → business-success context:
  * restaurant → peak-service dining room with happy customers at tables in soft-focus background, owner at the pass with a quiet satisfied smile and a finished plate visible / outdoor terrace packed at sunset
  * fashion/boutique → store full of engaged customers browsing the rack, owner at the counter with a satisfied warm smile, garments visible on mannequins behind
  * clinic → calm consultation room with a happy client (off-camera or from behind — do NOT show identifiable client face) having just finished a treatment, clinician smiling quietly with professional pride
  * salon → mid-styling moment with a happy client's styled hair visible (client face partly off-frame or from behind), stylist confident with tools in hand
  * fitness → full class energised in soft-focus behind the trainer, trainer at the front with a proud calm smile, clients mid-movement
  * generic service → the OUTCOME moment — finished work handed to a satisfied customer (customer from behind or partial), branded van / signage / tools visible, golden-hour exterior
The lighting for scene 4 comes from the context (golden-hour terrace, warm dining-room pendants, mid-day natural daylight through the shopfront) — NOT generic "warm interior". The avatar may appear alongside their customers/workspace being USED, not alone by the sign.

VOICEOVER TIMING — STRICT (matches the BEAT word budgets above):
- Scene 1 / BEAT 1: ~10–14 Hebrew words — customer prior-experience template.
- Scene 2 / BEAT 2: ~6–9 Hebrew words — discovery of ${name}.
- Scene 3 / BEAT 3: ~14–20 Hebrew words — what makes ${name} special.
- Scene 4 / BEAT 4: ~8–11 Hebrew words — CTA naming ${name}.

SENTENCE COMPLETENESS (CRITICAL):
כל משפט חייב להסתיים בתוך הסצנה שלו. כל סצנה = משפט שלם או שניים שלמים.
- Each voiceover_sceneN must be a SELF-CONTAINED Hebrew sentence ending with . ? or !.
- NEVER end a scene mid-phrase; NEVER start a scene with a word that depends on the previous one.

HOOK (voiceover_scene1) — PRE-SET:
voiceover_scene1 is already: "${hook}" — use this EXACT text.

EVERY nb_prompt for scenes 1 and 3 MUST start with: "CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body." AND MUST end with: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle". Scene 4 follows the same anatomy rule BUT its ending must OMIT "NEVER in a car, NEVER in a vehicle" — service businesses may legitimately show a branded vehicle in the success-result context. The no-phone rule stays for scene 4. Scene 2 (business showcase) must explicitly include 2-3 customers/employees in the frame — NOT empty, NOT just tools. The business venue (storefront or interior) must be the dominant element.

EVERY nb_prompt for scenes with the avatar MUST include: "silent, NOT speaking, NOT looking like talking, mouth closed or natural relaxed smile, no open-mouth expression, no lip movement implied".

END every Kling prompt with: "silent, no talking, no lip movement, mouth closed or naturally relaxed, maintain consistent facial features, no face distortion, stable face anatomy, smooth natural motion only, no mouth movement, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference"

KLING/NB SCENE CONSISTENCY (CRITICAL):
The kling_prompt describes the SAME PHYSICAL SCENE as the nb_prompt. Both must lock identical venue, surface, lighting, fixtures, props, signage, and aesthetic — only the camera/motion language differs (NB = still frame composition, Kling = motion physics).

Required overlap between nb_prompt and kling_prompt:
- Same venue surfaces / fixtures / floor (e.g. "marble counter, brass fixtures, exposed-brick wall")
- Same lighting source and direction (e.g. "warm pendant lights overhead, daylight through the shopfront from left")
- Same environmental details (e.g. "tools laid out on the station, finished work on the pass, customers softly out of focus behind")
- Same aesthetic anchors (e.g. "no studio softbox, no catalog look, no seamless backdrop, no commercial set dressing")

For Scene 2 (BUSINESS SHOWCASE — hands+tools close-up of the craft):
The kling_prompt MUST explicitly include the same surface, the same tools, the same "no seamless backdrop, no studio softbox, no catalog look" anti-patterns the nb_prompt has. This prevents Seedance from inventing a generic stock-photo background.

For Scene 3 (avatar performing the service / craft):
The kling_prompt MUST repeat the same venue details — the station, the workspace clutter, the fixtures, the lighting source. Forbid the same things nb_prompt forbids (e.g. "no mirror reflection of the camera, no second crew member visible").

For Scenes 1 and 4 (avatar in the venue):
The kling_prompt MUST repeat the same room details — the bar/counter/station, the wall finish, the window direction, the signage / branded element, the specific props mentioned in nb_prompt.

Test: A viewer who sees the NB still and the Kling video side-by-side should recognize them as the SAME venue, SAME lighting, SAME aesthetic. Not "related but different" — SAME.

BUSINESS PRODUCT / CRAFT LOCK — CRITICAL (MANDATORY FOR SCENES 2, 3, 4):
Kling has an "object drift" failure mode where the signature item (the dish being plated, the garment being styled, the tool being used, the branded signage) slowly morphs into a different object over the 5–8s video. EVERY kling_prompt for scenes 2, 3, 4 MUST include a lock block, BEFORE the ending phrase:
(i) POSITIVE LOCK: "The signature items (tools, finished dish/garment/styling, branded signage, finished work) maintain EXACT same appearance throughout the entire video — same shape, color, logo, text, materials, position. They are rigid physical objects that do not morph. Every frame is visually identical in product identity to the reference."
(ii) NEGATIVE LOCK: "no tool or product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no dish/garment/finished-work becoming a different object, no identity drift, no gradual transformation into a similar-but-different item."
(iii) For scene 2 (close-up of hands+tools), emphasise: "the tools and the finished craft are the anchor — camera and light may shift, but the tools and item NEVER do."
(iv) For scene 4 (business-success context), emphasise: "signage text and logo remain identical frame-to-frame; finished dishes/garments/tools/branded elements stay rigid."

ACTION DESCRIPTION RULES:

1. תיאור פעולה כרצף של מיקרו-תנועות — לא פוזה סטטית.
   ✅ נכון: 'מטה את הבקבוק לכיוון המצלמה, לוקח לגימה, גבות עולות קלות, מניח על השולחן עם נהמת הסכמה קלה'
   ❌ שגוי: 'מחזיק את המוצר ומחייך'

2. רגשות = מיקרו-ביטוי פיזי, לא הצהרה.
   ✅ נכון: 'עיניים נפתחות, פינת פה מתרוממת'
   ❌ שגוי: 'נראית מרוצה'

3. תיאור פעולה = כוונה + תוצאה, לא ביו-מכניקה.
   ✅ נכון: 'מסובב את הפקק, מניח את הבקבוק'
   ❌ שגוי: 'יד ימין מסובבת פקק נגד כיוון השעון'

4. רק מה שרואים — לא מטא-תיאורים.
   ❌ אסור: 'המוצר ריחני' / 'מרגישה נינוחה'
   ✅ מותר: 'אגלי מים על הבקבוק, התווית מבריקה'

המטרה: 3-5 מיקרו-פעולות בכל סצנה, רצף טבעי, לא פוזה.

Return ONLY valid JSON (no markdown):
{
  "category": "one of: barbershop / salon / beauty_clinic / restaurant / fitness / service (the value you chose in STEP 0)",
  "mode": "business",
  "voiceover_scene1": "BEAT 1 — TEMPLATE 'הלכתי / הייתי / ניסיתי / אכלתי / התאמנתי לכבר מלא {category-plural} {negative outcome}'. ~10–14 Hebrew words. Must NOT contain '${name}'.",
  "voiceover_scene2": "BEAT 2 — TEMPLATE 'עד שהגעתי ל${name}...' / 'עד שגיליתי את ${name}...' / 'ואז הגעתי ל${name}...'. Must START with one of those openers and contain '${name}'.",
  "voiceover_scene3": "BEAT 3 — 2-3 specific things ${name} does well that resolve the Beat-1 pain. ~14–20 Hebrew words. Must NOT contain 'עד שגיליתי' / 'ואז גיליתי' / 'פתרון חכם' / 'פתרון מושלם' / 'התוצאות מטורפות'.",
  "voiceover_scene4": "BEAT 4 — CTA template 'תקבעו תור ב${name}' / 'תבואו ל${name}' / 'תיכנסו ל${name}'. Must contain '${name}' + a CTA verb.",
  "setting": "one-line description of the ${venue}",
  "scenes": [
    {
      "type": "הכנסה",
      "nb_prompt": "avatar wearing ${uniform} inside a ${venue}, starting their workday with calm confident posture, mouth closed with natural relaxed expression, silent NOT speaking, iPhone handheld documentary style, natural daylight, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar adjusts apron or uniform and looks around the workspace with calm confidence, subtle natural body motion, silent no talking no lip movement mouth closed or naturally relaxed, smooth natural motion only, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "הכרות",
      "nb_prompt": "Wide/medium shot of ${businessVenue} — storefront with branded signage clearly visible OR interior view showing 2-3 customers being served by staff. Real activity in the space — people in motion, natural conversations, work happening. Warm natural lighting matching scene 1, authentic documentary style, preserve exact venue appearance from reference images. Customers should look like real clients, not models — diverse, natural, mid-action.",
      "kling_prompt": "Phone-native handheld shot of ${businessVenue} alive with real activity — visible signage, 2-3 customers being served, staff working naturally, ambient conversation, gentle camera drift showing the space. The venue is the hero of the shot, not any single person. VENUE LOCK: the business space must be IDENTICAL to the reference photos — same storefront design, same interior layout, same signage text, same color palette, same furniture. Realistic daylight, no studio polish. silent no talking no lip movement, smooth natural motion only, no sudden jumps, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "בפעולה",
      "nb_prompt": "avatar wearing ${uniform} ${scene3Action}, inside the ${venue}, focused professional expression with mouth closed, silent NOT speaking, authentic documentary moment, warm interior lighting, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene, NEVER in a car, NEVER in a vehicle",
      "kling_prompt": "Avatar ${scene3Action}, natural working motion hands moving with purpose focused expression. PRODUCT/CRAFT LOCK: The signature items (tools, the work in progress, the finished dish/garment/styled-result, branded signage if visible) maintain EXACT same appearance throughout the entire video — same shape, color, logo, text, materials, position. They are rigid physical objects that do not morph. Every frame shows the same tools and the same work from the reference. no tool or product morphing, no shape changing, no color shifting, no logo transformation, no text changing, no material distortion, no identity drift, no gradual transformation into a similar-but-different item. silent no talking no lip movement mouth closed or naturally relaxed, smooth natural motion only, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "הזמנה",
      "nb_prompt": "avatar wearing ${uniform} inside the BUSINESS-SUCCESS CONTEXTUAL RESULT for ${name} — WRITE THE SPECIFIC MOMENT HERE based on the category (e.g., for a restaurant: 'standing calmly at the pass in a packed dining room at dinner service, happy customers softly out of focus at tables behind, warm pendant lighting, a finished plate visible on the pass'; for a fashion boutique: 'at the counter of the store with customers browsing the racks behind, satisfied warm smile, garments on mannequins softly visible'; for a salon: 'mid-styling with a happy client's styled hair visible from behind, tools in one hand, quiet professional pride'; for a clinic: 'quietly confident in a calm treatment room with a client off-camera or from behind'; for a fitness studio: 'at the front of the room with a full class moving behind, trainer with a proud calm expression'; for a generic service: 'outside next to the branded van at golden hour handing finished work to a customer shown from behind'). Warm relaxed mouth-closed smile, quiet pride. ${name} signage or branded element visible somewhere in frame. CONTEXTUAL LIGHTING from the scene (warm pendants, golden-hour, daylight through the shopfront) — NOT generic warm interior. Silent NOT speaking, correct human anatomy, exactly two arms, NEVER show a phone or mobile device in any scene",
      "kling_prompt": "Avatar in the BUSINESS-SUCCESS CONTEXTUAL RESULT scene described in the scene-4 nb_prompt — physics + environment motion: customers move gently in the soft-focus background, other hands or glasses or tools drift softly in the periphery, ${name} signage or branded element catches the contextual light. Avatar's closed-lip warm smile forms gradually with eyes softening at the outer corners in quiet professional pride, small subtle nod or calm looking-around gesture, eyes may briefly glance at a customer or finished work off-screen then refocus on the lens, optional small welcoming hand gesture. PRODUCT/CRAFT LOCK: ${name} signage text and logo remain identical frame-to-frame — the letters, colors, and layout of the sign are rigid across the entire video. Finished dishes/garments/tools/branded elements visible in the scene stay rigid and do not morph. The signage, finished work, and branded elements are visually identical in every frame to the reference. no sign-text morphing, no logo transformation, no finished-dish or finished-garment reshaping, no color shifting on branded elements, no product or craft identity drift. Handheld documentary-style iPhone feel with mild wobble, silent no talking no lip movement, mouth closed or naturally relaxed, smooth natural motion only, avatar is not speaking, natural micro-movements breathing only, handheld iPhone wobble no stabilizer, no sudden jumps, business appearance unchanged from reference, no burned-in subtitles, no caption cards, no on-screen text, no graphic overlays",
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
  // Validate the strict 4-beat structure (BUSINESS mode). Up to 2 retries,
  // then log a warning and pass through whatever was last produced.
  if (parsed) {
    const MAX_BEAT_REGEN = 2;
    let lastViolations = [];
    for (let attempt = 0; attempt <= MAX_BEAT_REGEN; attempt++) {
      const violations = beatStructureViolations(parsed.scenes, name, { mode: 'business' });
      lastViolations = violations;
      if (violations.length === 0) break;
      if (attempt === MAX_BEAT_REGEN) break;
      console.warn(`[generateBusinessScript] 4-beat structure violations (regen ${attempt + 1}/${MAX_BEAT_REGEN}):`, violations);
      const bullets = violations.map((v, i) => `  ${i + 1}. ${v}`).join('\n');
      const extraInstruction = `\n\nPREVIOUS ATTEMPT VIOLATED THE STRICT 4-BEAT BUSINESS STRUCTURE. Fix ALL of these specific issues and return a corrected script:\n${bullets}\n\nReminder of the rules:\n- voiceover_scene1 = BEAT 1 — must contain "הלכתי" / "הייתי" / "ניסיתי" / "אכלתי" / "התאמנתי" describing prior bad experiences at COMPETING businesses, never names "${name}".\n- voiceover_scene2 = BEAT 2 — must START with "עד שהגעתי ל" / "עד שגיליתי את" / "ואז הגעתי ל" AND contain "${name}".\n- voiceover_scene3 = BEAT 3 — 2-3 concrete special qualities of "${name}". NEVER contains "עד שגיליתי" / "ואז גיליתי" / "פתרון חכם" / "פתרון מושלם" / "התוצאות מטורפות".\n- voiceover_scene4 = BEAT 4 — CTA verb ("תקבעו תור" / "תבואו" / "תיכנסו") + "${name}".`;
      const retry = parseResponse(await callClaude(extraInstruction));
      if (retry) parsed = retry;
      else break;
    }
    if (lastViolations.length > 0) {
      console.warn(`[generateBusinessScript] 4-beat structure still violated after ${MAX_BEAT_REGEN} regens — passing through with violations:`, lastViolations);
    }
  }
  if (parsed?.scenes) logNbKlingOverlap(parsed.scenes, '[generateBusinessScript]');
  return parsed;
}
