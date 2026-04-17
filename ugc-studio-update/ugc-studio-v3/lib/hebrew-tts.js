// Preprocess Hebrew text before sending to ElevenLabs V3.
//
// APPROACH (after experimentation):
//   Heavy nikud was HURTING pronunciation for most words — ElevenLabs V3
//   handles unvocalized Hebrew well for common vocabulary, but a dense wall
//   of combining marks confused the model and caused even simple words to
//   come out wrong. Doubled-consonant tricks (כיפפה) were taken literally
//   and geminated audibly.
//
//   New two-layer strategy:
//     1. CUSTOM_PRONUNCIATIONS — Latin transliteration for a small set of
//        stubborn words the TTS keeps mispronouncing in Hebrew script
//        (כיפה, מושלם, שבת, religious terms, etc.). ElevenLabs V3 reads
//        mixed Hebrew + Latin text cleanly, rendering the Latin tokens in
//        a Hebrew-speaker accent — which for these specific words is the
//        correct pronunciation.
//     2. WORD_REPLACEMENTS — a SHORT list of nikud injections only for
//        truly ambiguous words where the unvocalized form has multiple
//        common pronunciations (e.g. "בוקר" morning vs. "בוקר" cowboy).
//
//   Everything else flows through untouched — natural Hebrew handling.
//
//   Digit-to-word conversion and natural comma pauses are unchanged.

// ─────────────────────────────────────────────────────────────────────────
// Layer 1 — Latin transliterations for stubborn words.
//
// Rendered by ElevenLabs V3 in a Hebrew-speaker accent. We use the
// conventions familiar to Israeli readers: "ch" = חֿ, "kh" also χ, "tz" = צ,
// double consonants only where actually doubled in pronunciation.
//
// If any of these reads wrong in TTS, remove just that entry — the Hebrew
// original will then flow through unchanged and ElevenLabs handles it.
// ─────────────────────────────────────────────────────────────────────────
const CUSTOM_PRONUNCIATIONS = {
  // Religious head-covering / life-cycle vocabulary
  'כיפה': 'kipa',
  'הכיפה': 'ha-kipa',
  'כיפות': 'kipot',
  'הכיפות': 'ha-kipot',
  'מטפחת': 'mitpachat',
  'המטפחת': 'ha-mitpachat',
  'טלית': 'talit',
  'הטלית': 'ha-talit',
  'תפילין': 'tfilin',
  'מזוזה': 'mezuza',
  'סוכה': 'sukka',
  'הסוכה': 'ha-sukka',
  'חופה': 'chupa',
  'החופה': 'ha-chupa',
  'חתונה': 'chatuna',
  'החתונה': 'ha-chatuna',
  'כלה': 'kala',
  'הכלה': 'ha-kala',
  'חתן': 'chatan',
  'החתן': 'ha-chatan',
  'ברית': 'brit',
  'הברית': 'ha-brit',
  'שבת': 'shabbat',
  'תפילה': 'tfila',
  'התפילה': 'ha-tfila',
  'תפילות': 'tfilot',
  'ברכה': 'bracha',
  'הברכה': 'ha-bracha',
  'ברכות': 'brachot',
  'תורה': 'tora',
  'התורה': 'ha-tora',
  'מצווה': 'mitzva',
  'מצוות': 'mitzvot',
  'חנוכה': 'chanuka',
  'פסח': 'pesach',
  'פורים': 'purim',
  'שבועות': 'shavuot',
  'סוכות': 'sukot',
  'כיפור': 'kipur',
  'חב״ד': 'chabad',
  'חבד': 'chabad',
  'רב': 'rav',
  'הרב': 'ha-rav',
  'רבי': 'rabi',

  // "מושלם" — the drop-the-vav reading. Transliteration avoids the
  // "mesholam" misreading that nikud alone couldn't defeat.
  'מושלם': 'mushlam',
  'המושלם': 'ha-mushlam',
  'מושלמת': 'mushlemet',
  'המושלמת': 'ha-mushlemet',
  'מושלמים': 'mushlamim',
  'מושלמות': 'mushlamot',

  // Common feminine "אמא"/"אבא" endearments that TTS stumbles on
  'אמא': 'ima',
  'האמא': 'ha-ima',
  'אבא': 'aba',
  'האבא': 'ha-aba',
  'סבא': 'saba',
  'סבתא': 'savta',
}

// ─────────────────────────────────────────────────────────────────────────
// Layer 2 — MINIMAL nikud injections. Only for genuinely ambiguous words
// where ElevenLabs V3 picks the wrong reading without help. Keep this list
// SHORT (<25 entries). Adding more nikud here almost always makes things
// worse, not better.
// ─────────────────────────────────────────────────────────────────────────
const WORD_REPLACEMENTS = {
  // Disambiguation of words with multiple common readings
  'בוקר': 'בֹּקֶר',     // morning (not "boker" = cowboy)
  'ערב': 'עֶרֶב',        // evening (not "arev" = pleasant, or "erev" mixed)
  'חודש': 'חוֹדֶשׁ',
  'שנה': 'שָׁנָה',        // year (not "shina" = she taught)
  'דבר': 'דָּבָר',        // thing (not "diber" = he spoke)

  // Words with guttural ayin that TTS commonly softens
  'עור': 'עוֹר',         // skin
  'שיער': 'שֵׂעָר',      // hair (not "sheyar" = remained)
  'פנים': 'פָּנִים',      // face

  // Common UGC script vocabulary the TTS kept tripping on
  'בעיה': 'בְּעָיָה',
  'הבעיה': 'הַבְּעָיָה',
  'תוצאה': 'תּוֹצָאָה',
  'תוצאות': 'תּוֹצָאוֹת',
  'פתרון': 'פִּתְרוֹן',
  'אמת': 'אֱמֶת',
  'באמת': 'בֶּאֱמֶת',

  // Interjections (TTS reads them literally without nikud)
  'וואו': 'וָאוּ',
  'יאללה': 'יָאלְלָה',
  'אוקיי': 'אוֹקֵיי',
}

// ─────────────────────────────────────────────────────────────────────────
// Digit → Hebrew feminine word (for "שלוש שניות", "חמש פעמים" etc.)
// ─────────────────────────────────────────────────────────────────────────
const DIGIT_WORDS_F = {
  '0': 'אפס',
  '1': 'אחת',
  '2': 'שתיים',
  '3': 'שלוש',
  '4': 'ארבע',
  '5': 'חמש',
  '6': 'שש',
  '7': 'שבע',
  '8': 'שמונה',
  '9': 'תשע',
  '10': 'עשר',
}

function spellNumber(n) {
  if (DIGIT_WORDS_F[n]) return DIGIT_WORDS_F[n]
  return String(n).split('').map(d => DIGIT_WORDS_F[d] || d).join(' ')
}

// ─────────────────────────────────────────────────────────────────────────
// Natural pause / comma insertion for smoother TTS delivery
// ─────────────────────────────────────────────────────────────────────────
const PAUSE_BEFORE = [
  'אבל',
  'כי',
  'אז',
  'ולכן',
  'עד ש',
  'כדי ש',
  'למרות',
]

const PAUSE_AFTER = [
  'ובכן',
  'אז',
  'לכן',
  'בעצם',
  'כלומר',
  'בקיצור',
  'רגע',
]

export function addNaturalPauses(text) {
  if (!text || typeof text !== 'string') return text
  let out = text

  // 1) Add a comma BEFORE connector words when they appear mid-sentence.
  for (const word of PAUSE_BEFORE) {
    const re = new RegExp(`([^\\s,.!?:;\\-])\\s+(${word})(?=\\s)`, 'g')
    out = out.replace(re, (_, pre, w) => `${pre}, ${w}`)
  }

  // 2) Add a comma AFTER discourse markers that open a clause.
  for (const word of PAUSE_AFTER) {
    const re = new RegExp(`(^|[\\s.!?:;])(${word})\\s+(?=[^,.!?:;\\s])`, 'g')
    out = out.replace(re, (_, pre, w) => `${pre}${w}, `)
  }

  // 3) Break long run-on clauses with a comma near the midpoint.
  out = out.replace(/([^.!?]{90,}?)(\s)(?=[^.!?]*[.!?]|[^.!?]*$)/g, (m, seg, sp) => {
    if (/[,،;:]/.test(seg)) return m
    const mid = Math.floor(seg.length / 2)
    let splitAt = seg.lastIndexOf(' ', mid)
    if (splitAt < 20) splitAt = seg.indexOf(' ', mid)
    if (splitAt <= 0) return m
    return seg.slice(0, splitAt) + ',' + seg.slice(splitAt) + sp
  })

  // 4) If the text ends with no terminator, add a period.
  out = out.trim()
  if (out && !/[.!?]$/.test(out)) out += '.'

  // 5) Normalize duplicate commas/periods.
  out = out
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+/g, ' ')
    .trim()

  return out
}

// Lightweight rule-based nudger kept as an exported helper — no longer
// called from cleanHebrewText by default. Available for opt-in use.
export function phoneticize(word) {
  if (!word || typeof word !== 'string') return word
  if (/[\u0591-\u05C7]/.test(word)) return word
  const firstChar = word.charAt(0)
  let out = word
  if (/^[בכפת]/.test(firstChar) && word.length > 1) {
    out = firstChar + '\u05BC' + word.slice(1)
  }
  return out
}

// Replace dictionary keys in `text` with their values, allowing 0-2 Hebrew
// single-letter prefixes (ה/ו/ש/ל/ב/מ/כ) before the key so that "והכיפה",
// "שבמחיר", "לחתונה" also match the base entry. The prefix letters are
// preserved verbatim in the output (they don't need nikud themselves).
function replaceWithPrefixAwareness(text, dict) {
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length)
  let out = text
  for (const key of keys) {
    const rep = dict[key]
    const prefixPart = '(?:[הושלבמכ]{1,2})?'
    const re = new RegExp(
      `(^|[\\s.,!?:;"'\\-])(${prefixPart})${key}(?=$|[\\s.,!?:;"'\\-])`,
      'g'
    )
    out = out.replace(re, (_, pre, pfx) => `${pre}${pfx || ''}${rep}`)
  }
  return out
}

// Latin transliterations in CUSTOM_PRONUNCIATIONS already include their
// own "ha-" prefix variants ("הכיפה" → "ha-kipa"). For those we skip
// the prefix-aware matcher to avoid double-prefixing ("ha-ha-kipa" from
// prepending ה- again). Hebrew prefixes OTHER than ה (ו/ש/ל/ב/מ/כ) are
// still stitched on verbatim.
function replaceLatinTransliterations(text, dict) {
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length)
  let out = text
  for (const key of keys) {
    const rep = dict[key]
    // Prefix set EXCLUDES ה when the key doesn't start with ה and the
    // replacement starts with "ha-" (would double up). Simpler: just
    // forbid ה prefix entirely for Latin replacements, since every
    // ה-prefixed form we care about is already an explicit key.
    const prefixPart = '(?:[ושלבמכ]{1,2})?'
    const re = new RegExp(
      `(^|[\\s.,!?:;"'\\-])(${prefixPart})${key}(?=$|[\\s.,!?:;"'\\-])`,
      'g'
    )
    out = out.replace(re, (_, pre, pfx) => `${pre}${pfx || ''}${rep}`)
  }
  return out
}

function normalizeSpacing(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*\.\s*/g, '. ')
    .replace(/\s*!\s*/g, '! ')
    .replace(/\s*\?\s*/g, '? ')
    .replace(/\s+$/u, '')
    .trim()
}

// prepareHebrewForTTS(text) — returns BOTH versions of the text:
//   - subtitleText: Hebrew form used for subtitles / UI display. No Latin
//     transliterations. Digits spelled out as Hebrew words. Commas inserted
//     at natural pause points.
//   - ttsText: the same text with Latin transliterations applied on top
//     (e.g. "הכיפה" → "ha-kipa") plus minimal nikud disambiguations.
//     This is what gets sent to ElevenLabs.
//
// WORD-COUNT GUARANTEE: subtitleText and ttsText split on whitespace to
// the SAME number of tokens, in 1:1 correspondence. Every replacement
// (Latin or nikud) is a single-word-in / single-token-out rewrite, so
// timestamps coming back from ElevenLabs for ttsText words can be remapped
// index-by-index onto subtitleText words. See remapWordTimestamps() below.
export function prepareHebrewForTTS(text) {
  if (!text || typeof text !== 'string') return { ttsText: text || '', subtitleText: text || '' }

  // Base normalisation — shared by both outputs.
  let base = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/(^|[^\d])(\d+)(?=$|[^\d])/g, (_, pre, num) => `${pre}${spellNumber(num)}`)
    .replace(/\s+/g, ' ')
    .trim()

  // Subtitle form — add natural pauses (commas), no nikud, no Latin.
  // This is the text users will SEE in the rendered video.
  let subtitleText = addNaturalPauses(base)
  subtitleText = normalizeSpacing(subtitleText)

  // TTS form — built on top of subtitleText so whitespace token indexes
  // line up exactly. Nikud first (1:1 word replacement), then Latin
  // transliterations (also 1:1). Neither layer introduces new whitespace.
  let ttsText = replaceWithPrefixAwareness(subtitleText, WORD_REPLACEMENTS)
  ttsText = replaceLatinTransliterations(ttsText, CUSTOM_PRONUNCIATIONS)
  ttsText = normalizeSpacing(ttsText)

  return { ttsText, subtitleText }
}

// Map ElevenLabs word timestamps (whose `word` values are from ttsText,
// i.e. they may contain Latin transliterations like "kipa") back onto the
// original Hebrew words in subtitleText. The two streams are assumed to be
// in 1:1 index correspondence (prepareHebrewForTTS guarantees this).
//
// If the counts ever diverge (unexpected), we fall back to the TTS word —
// a Latin-looking subtitle is better than a runtime crash.
export function remapWordTimestamps(wordTimestamps, subtitleText) {
  if (!Array.isArray(wordTimestamps) || !subtitleText) return wordTimestamps || []
  const subWords = subtitleText.split(/\s+/).filter(Boolean)
  if (subWords.length !== wordTimestamps.length) {
    // Diagnostic log — helps catch future regressions where a replacement
    // accidentally introduces/removes whitespace.
    console.warn('[hebrew-tts] remapWordTimestamps length mismatch: subtitle=%d tts=%d',
      subWords.length, wordTimestamps.length)
    return wordTimestamps
  }
  return wordTimestamps.map((t, i) => ({ ...t, word: subWords[i] }))
}

// Back-compat: cleanHebrewText now returns the TTS form (the text that
// goes to ElevenLabs) — same behaviour existing callers relied on. Prefer
// prepareHebrewForTTS() for any new code that also needs the subtitle form.
export function cleanHebrewText(text) {
  return prepareHebrewForTTS(text).ttsText
}
