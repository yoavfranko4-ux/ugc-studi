// Preprocess Hebrew text before sending to ElevenLabs.
// ElevenLabs often mispronounces unvocalized Hebrew and digits.
// We inject nikud into known problem words and spell out digits in Hebrew.

const WORD_REPLACEMENTS = {
  // Common words ElevenLabs trips on — add nikud for correct pronunciation
  'לדוגמה': 'לְדוּגְמָה',
  'לדוגמא': 'לְדוּגְמָה',
  'כלומר': 'כְּלוֹמַר',
  'בסדר': 'בְּסֵדֶר',
  'בבקשה': 'בְּבַקָּשָׁה',
  'תודה': 'תּוֹדָה',
  'שלום': 'שָׁלוֹם',
  'בוקר': 'בֹּקֶר',
  'ערב': 'עֶרֶב',
  'לילה': 'לַיְלָה',
  'יום': 'יוֹם',
  'שבוע': 'שָׁבוּעַ',
  'חודש': 'חוֹדֶשׁ',
  'שנה': 'שָׁנָה',
  'מוצר': 'מוּצָר',
  'המוצר': 'הַמּוּצָר',
  'תוצאה': 'תּוֹצָאָה',
  'תוצאות': 'תּוֹצָאוֹת',
  'לתוצאות': 'לַתּוֹצָאוֹת',
  'בעיה': 'בְּעָיָה',
  'הבעיה': 'הַבְּעָיָה',
  'אמת': 'אֱמֶת',
  'באמת': 'בֶּאֱמֶת',
  'ממש': 'מַמָּשׁ',
  'חייבים': 'חַיָּבִים',
  'תנסו': 'תְּנַסּוּ',
  'יאללה': 'יָאלְלָה',
  'וואו': 'וָאוּ',
  'אוקיי': 'אוֹקֵיי',
  'רגע': 'רֶגַע',
  'עכשיו': 'עַכְשָׁיו',
  'אחריות': 'אַחֲרָיוּת',
  'מלאה': 'מְלֵאָה',
  'ברמה': 'בְּרָמָה',
  'ברמות': 'בְּרָמוֹת',
  'טעים': 'טָעִים',
  'נמאס': 'נִמְאַס',
  'מרוצה': 'מְרֻצָּה',
  'מרוצים': 'מְרֻצִּים',
  'אחרי': 'אַחֲרֵי',
  'לפני': 'לִפְנֵי',
  'מקום': 'מָקוֹם',
  'טוב': 'טוֹב',
  'גם': 'גַּם',
  'רק': 'רַק',
  'עוד': 'עוֹד',
  'כבר': 'כְּבָר',
  'אומר': 'אוֹמֵר',
  'אגיד': 'אַגִּיד',
  'אמרתי': 'אָמַרְתִּי',
  'המליץ': 'הִמְלִיץ',
  'המליצה': 'הִמְלִיצָה',
  'ניסיתי': 'נִסִּיתִי',
  'גיליתי': 'גִּלִּיתִי',
  'מצאתי': 'מָצָאתִי',
  'האמנתי': 'הֶאֱמַנְתִּי',
  'הכרתי': 'הִכַּרְתִּי',
  'מחפשת': 'מְחַפֶּשֶׂת',
  'מחפש': 'מְחַפֵּשׂ',
  'התאכזבתי': 'הִתְאַכְזַבְתִּי',
  'חודשים': 'חֳדָשִׁים',
  'שבועות': 'שָׁבוּעוֹת',
  'שנים': 'שָׁנִים',
}

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
  // Fallback: just spell digit-by-digit
  return String(n).split('').map(d => DIGIT_WORDS_F[d] || d).join(' ')
}

// Connectors that SHOULD have a comma right before them when they sit
// mid-sentence. Each one typically marks a logical pause ("but", "because",
// "so", "in order to", "although"…).
const PAUSE_BEFORE = [
  'אבל',
  'כי',
  'אז',
  'ולכן',
  'עד ש',
  'כדי ש',
  'למרות',
]

// Discourse markers that sit at the START of a clause and want a comma AFTER
// them ("well,", "so,", "in short,", "basically,"…).
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
  //    "...חיכיתי אבל זה..." -> "...חיכיתי, אבל זה..."
  //    Skip if already preceded by , . ! ? : ; — or at the very start.
  for (const word of PAUSE_BEFORE) {
    const re = new RegExp(`([^\\s,.!?:;\\-])\\s+(${word})(?=\\s)`, 'g')
    out = out.replace(re, (_, pre, w) => `${pre}, ${w}`)
  }

  // 2) Add a comma AFTER discourse markers that open a clause.
  //    "אז תקשיבו" -> "אז, תקשיבו"
  //    Only when followed by a space + more text (not already punctuated).
  for (const word of PAUSE_AFTER) {
    const re = new RegExp(`(^|[\\s.!?:;])(${word})\\s+(?=[^,.!?:;\\s])`, 'g')
    out = out.replace(re, (_, pre, w) => `${pre}${w}, `)
  }

  // 3) Break run-on sentences: if a clause is very long with no comma/period,
  //    insert a comma at the nearest space around the midpoint of that stretch.
  //    We scan segments between sentence terminators and split any that are
  //    longer than ~90 chars without internal punctuation.
  out = out.replace(/([^.!?]{90,}?)(\s)(?=[^.!?]*[.!?]|[^.!?]*$)/g, (m, seg, sp) => {
    if (/[,،;:]/.test(seg)) return m
    const mid = Math.floor(seg.length / 2)
    // Find the nearest space to the midpoint
    let splitAt = seg.lastIndexOf(' ', mid)
    if (splitAt < 20) splitAt = seg.indexOf(' ', mid)
    if (splitAt <= 0) return m
    return seg.slice(0, splitAt) + ',' + seg.slice(splitAt) + sp
  })

  // 4) If the text ends with no terminator, add a period.
  out = out.trim()
  if (out && !/[.!?]$/.test(out)) out += '.'

  // 5) Normalize duplicate commas/periods we may have introduced.
  out = out
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s+/g, ' ')
    .trim()

  return out
}

export function cleanHebrewText(text) {
  if (!text || typeof text !== 'string') return text

  let out = text

  // Replace standalone integers with Hebrew words (only when surrounded by non-digit chars)
  out = out.replace(/(^|[^\d])(\d+)(?=$|[^\d])/g, (_, pre, num) => `${pre}${spellNumber(num)}`)

  // Word-level replacements — match whole tokens only, ignore leading prefixes ו/ה/ב/ל/כ/מ/ש
  // Sort longer keys first so we don't clip matches
  const keys = Object.keys(WORD_REPLACEMENTS).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    const rep = WORD_REPLACEMENTS[key]
    // Match the word preceded by start/space/punct, optionally allow it as-is
    const re = new RegExp(`(^|[\\s.,!?:;"'\\-])${key}(?=$|[\\s.,!?:;"'\\-])`, 'g')
    out = out.replace(re, (_, pre) => `${pre}${rep}`)
  }

  // Collapse extra whitespace before pause insertion
  out = out.replace(/\s+/g, ' ').trim()

  // Apply natural pauses last, so comma insertions don't interfere with
  // the word-level regex matching above.
  out = addNaturalPauses(out)

  return out
}
