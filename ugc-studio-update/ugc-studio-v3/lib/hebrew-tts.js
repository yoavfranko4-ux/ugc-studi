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
  'חייבת': 'חַיֶּבֶת',
  'חייב': 'חַיָּב',
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

  // ── Teeth / whitening / cosmetics ──
  'מדבקות': 'מַדְבֵּקוֹת',
  'מדבקה': 'מַדְבֵּקָה',
  'הלבנה': 'הַלְבָּנָה',
  'הלבנת': 'הַלְבָּנַת',
  'שיניים': 'שִׁינַיִים',
  'השיניים': 'הַשִּׁינַיִים',
  'לבנות': 'לְבָנוֹת',
  'לבן': 'לָבָן',
  'לבנה': 'לְבָנָה',
  'מושלמות': 'מֻשְׁלָמוֹת',
  'מושלם': 'מֻשְׁלָם',
  'מושלמת': 'מֻשְׁלֶמֶת',
  'מיוחדות': 'מְיוּחָדוֹת',
  'מיוחדת': 'מְיוּחֶדֶת',
  'מיוחד': 'מְיוּחָד',
  'נדבקות': 'נִדְבָּקוֹת',
  'נדבקת': 'נִדְבֶּקֶת',
  'נדבק': 'נִדְבָּק',
  'נהיות': 'נִהְיוֹת',
  'נהיה': 'נִהְיָה',
  'נהיית': 'נִהְיֵית',
  'חיוך': 'חִיּוּךְ',
  'חיוכים': 'חִיּוּכִים',
  'קוסמטיקה': 'קוֹסְמֶטִיקָה',
  'קרם': 'קְרֵם',
  'סרום': 'סֵרוּם',
  'מסכה': 'מַסֵּכָה',
  'מסכת': 'מַסֵּכַת',
  'פנים': 'פָּנִים',
  'הפנים': 'הַפָּנִים',
  'עור': 'עוֹר',
  'העור': 'הָעוֹר',
  'שיער': 'שֵׂעָר',
  'השיער': 'הַשֵּׂעָר',

  // ── Common nouns (objects, environments) ──
  'בית': 'בַּיִת',
  'הבית': 'הַבַּיִת',
  'חדר': 'חֶדֶר',
  'דלת': 'דֶּלֶת',
  'חלון': 'חַלּוֹן',
  'מיטה': 'מִיטָּה',
  'שולחן': 'שֻׁלְחָן',
  'כיסא': 'כִּסֵּא',
  'רכב': 'רֶכֶב',
  'אוטו': 'אוֹטוֹ',
  'רחוב': 'רְחוֹב',
  'עיר': 'עִיר',
  'מדינה': 'מְדִינָה',
  'משרד': 'מִשְׂרָד',
  'עבודה': 'עֲבוֹדָה',
  'חבר': 'חָבֵר',
  'חברה': 'חֲבֵרָה',
  'חברים': 'חֲבֵרִים',
  'משפחה': 'מִשְׁפָּחָה',
  'ילד': 'יֶלֶד',
  'ילדה': 'יַלְדָּה',
  'ילדים': 'יְלָדִים',
  'אישה': 'אִשָּׁה',
  'גבר': 'גֶּבֶר',
  'אנשים': 'אֲנָשִׁים',

  // ── Common adjectives / feelings ──
  'יפה': 'יָפֶה',
  'יפים': 'יָפִים',
  'יפות': 'יָפוֹת',
  'רע': 'רַע',
  'רעה': 'רָעָה',
  'נהדר': 'נֶהְדָּר',
  'נהדרת': 'נֶהְדֶּרֶת',
  'מדהים': 'מַדְהִים',
  'מדהימה': 'מַדְהִימָה',
  'מדהימות': 'מַדְהִימוֹת',
  'מגניב': 'מַגְנִיב',
  'מגניבה': 'מַגְנִיבָה',
  'מעולה': 'מְעֻלֶּה',
  'מעולות': 'מְעֻלּוֹת',
  'גרוע': 'גָּרוּעַ',
  'גדול': 'גָּדוֹל',
  'גדולה': 'גְּדוֹלָה',
  'קטן': 'קָטָן',
  'קטנה': 'קְטַנָּה',
  'חדש': 'חָדָשׁ',
  'חדשה': 'חֲדָשָׁה',
  'ישן': 'יָשָׁן',
  'ישנה': 'יְשָׁנָה',
  'זול': 'זוֹל',
  'זולה': 'זוֹלָה',
  'יקר': 'יָקָר',
  'יקרה': 'יְקָרָה',
  'מהיר': 'מָהִיר',
  'מהירה': 'מְהִירָה',
  'איטי': 'אִטִּי',
  'איטית': 'אִטִּית',
  'שמח': 'שָׂמֵחַ',
  'שמחה': 'שְׂמֵחָה',
  'עצוב': 'עָצוּב',
  'עצובה': 'עֲצוּבָה',
  'עייף': 'עָיֵף',
  'עייפה': 'עֲיֵפָה',
  'כועס': 'כּוֹעֵס',
  'כועסת': 'כּוֹעֶסֶת',
  'אוהב': 'אוֹהֵב',
  'אוהבת': 'אוֹהֶבֶת',
  'שונא': 'שׂוֹנֵא',
  'שונאת': 'שׂוֹנֵאת',
  'מובך': 'מוּבָךְ',
  'מובכת': 'מוּבֶכֶת',
  'מביכה': 'מְבִיכָה',
  'בטוח': 'בָּטוּחַ',
  'בטוחה': 'בְּטוּחָה',

  // ── Common verbs ──
  'רואה': 'רוֹאֶה',
  'רואים': 'רוֹאִים',
  'שומע': 'שׁוֹמֵעַ',
  'שומעת': 'שׁוֹמַעַת',
  'הולך': 'הוֹלֵךְ',
  'הולכת': 'הוֹלֶכֶת',
  'בא': 'בָּא',
  'באה': 'בָּאָה',
  'הלכתי': 'הָלַכְתִּי',
  'עשיתי': 'עָשִׂיתִי',
  'קניתי': 'קָנִיתִי',
  'הזמנתי': 'הִזְמַנְתִּי',
  'קיבלתי': 'קִבַּלְתִּי',
  'השתמשתי': 'הִשְׁתַּמַּשְׁתִּי',
  'משתמש': 'מִשְׁתַּמֵּשׁ',
  'משתמשת': 'מִשְׁתַּמֶּשֶׁת',
  'משתמשים': 'מִשְׁתַּמְּשִׁים',
  'רוצה': 'רוֹצֶה',
  'רוצים': 'רוֹצִים',
  'יכול': 'יָכוֹל',
  'יכולה': 'יְכוֹלָה',
  'חושב': 'חוֹשֵׁב',
  'חושבת': 'חוֹשֶׁבֶת',
  'מאמין': 'מַאֲמִין',
  'מאמינה': 'מַאֲמִינָה',
  'מרגיש': 'מַרְגִּישׁ',
  'מרגישה': 'מַרְגִּישָׁה',
  'הרגשתי': 'הִרְגַּשְׁתִּי',
  'קורה': 'קוֹרֶה',
  'עובד': 'עוֹבֵד',
  'עובדת': 'עוֹבֶדֶת',
  'עובדים': 'עוֹבְדִים',
  'מוכן': 'מוּכָן',
  'מוכנה': 'מוּכָנָה',

  // ── Time / quantity words ──
  'כל': 'כָּל',
  'הכל': 'הַכֹּל',
  'שום': 'שׁוּם',
  'תמיד': 'תָּמִיד',
  'אף': 'אַף',
  'לפעמים': 'לִפְעָמִים',
  'פעם': 'פַּעַם',
  'פעמים': 'פְּעָמִים',
  'מעט': 'מְעַט',
  'הרבה': 'הַרְבֵּה',
  'יותר': 'יוֹתֵר',
  'פחות': 'פָּחוֹת',
  'הכי': 'הֲכִי',
  'בערך': 'בְּעֵרֶךְ',
  'מאוד': 'מְאוֹד',
  'כמעט': 'כִּמְעַט',
  'בדיוק': 'בְּדִיּוּק',
  'דווקא': 'דַּוְקָא',
  'ממילא': 'מִמֵּילָא',
  'אולי': 'אוּלַי',
  'בטח': 'בֶּטַח',
  'ודאי': 'וַדַּאי',

  // ── Story-arc words specific to UGC scripts ──
  'גילוי': 'גִּילּוּי',
  'המלצה': 'הַמְלָצָה',
  'המלצות': 'הַמְלָצוֹת',
  'חוויה': 'חֲוָיָה',
  'החוויה': 'הַחֲוָיָה',
  'חוויות': 'חֲוָיוֹת',
  'שינוי': 'שִׁנּוּי',
  'השינוי': 'הַשִּׁנּוּי',
  'פתרון': 'פִּתְרוֹן',
  'הפתרון': 'הַפִּתְרוֹן',
  'סוף': 'סוֹף',
  'התחלה': 'הַתְחָלָה',
  'התחלתי': 'הִתְחַלְתִּי',
  'סיפור': 'סִפּוּר',
  'הסיפור': 'הַסִּפּוּר',
  'כסף': 'כֶּסֶף',
  'זמן': 'זְמַן',
  'הזמן': 'הַזְּמַן',
  'דבר': 'דָּבָר',
  'דברים': 'דְּבָרִים',
  'דרך': 'דֶּרֶךְ',
  'מחיר': 'מְחִיר',
  'המחיר': 'הַמְּחִיר',
  'איכות': 'אֵיכוּת',
  'האיכות': 'הָאֵיכוּת',
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

  // Remove artificial line breaks — ElevenLabs interprets them as long pauses.
  out = out.replace(/[\r\n]+/g, ' ')

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

  // Final space normalization: kill any residual double spaces, and ensure
  // exactly ONE space after commas/periods so ElevenLabs doesn't add extra
  // pauses at sentence boundaries.
  out = out
    .replace(/\s+/g, ' ')                // collapse any run of whitespace
    .replace(/\s*,\s*/g, ', ')           // comma → exactly one trailing space
    .replace(/\s*\.\s*/g, '. ')          // period → exactly one trailing space
    .replace(/\s*!\s*/g, '! ')
    .replace(/\s*\?\s*/g, '? ')
    .replace(/\s+$/u, '')                // trim trailing space

  return out
}
