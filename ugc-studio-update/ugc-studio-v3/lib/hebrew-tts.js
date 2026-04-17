// Preprocess Hebrew text before sending to ElevenLabs.
// ElevenLabs often mispronounces unvocalized Hebrew and digits.
// We inject nikud into known problem words and spell out digits in Hebrew.
//
// There are TWO replacement layers applied in order:
//   1. CUSTOM_PRONUNCIATIONS — applied FIRST, used for words where simple
//      nikud is not enough (ElevenLabs ignores the dagesh or vav-kubutz
//      confusion). We use phonetic hacks: doubled consonant letters for
//      דגש חזק, shva+dagesh chains, or syllable-hyphens (־/-) to force the
//      TTS to break the word into clear syllables.
//   2. WORD_REPLACEMENTS — straight nikud injection for the long tail of
//      regular words.
//
// CUSTOM_PRONUNCIATIONS overrides WORD_REPLACEMENTS for the same word.
// Both layers are prefix-aware: "המושלם", "ומושלם", "שמושלם" all match the
// entry for "מושלם" and keep the prefix attached.
//
// To add your own hard-override for a word ElevenLabs keeps mispronouncing,
// just drop it into CUSTOM_PRONUNCIATIONS.

const CUSTOM_PRONUNCIATIONS = {
  // ── Words where ElevenLabs V3 Hebrew ignores the dagesh / softens the ──
  // ── stop consonant, so plain nikud ("כִּיפָּה") still reads as "kifa".  ──
  // Strategy: double the stop consonant with a shva on the first copy and
  // dagesh+vowel on the second. This forces a geminated "kip-pa" reading.
  'כיפה': 'כִּיפְּפָה',       // kippa (yarmulke)
  'הכיפה': 'הַכִּיפְּפָה',
  'כיפות': 'כִּיפְּפוֹת',
  'הכיפות': 'הַכִּיפְּפוֹת',
  'סוכה': 'סֻכָּה-כָּה',      // sukkah
  'הסוכה': 'הַסֻּכָּה-כָּה',
  'חופה': 'חֻפָּה-פָּה',      // chuppah
  'החופה': 'הַחֻפָּה-פָּה',
  'אמא': 'אִמָּא-מָא',         // imma
  'האמא': 'הָאִמָּא-מָא',
  'כלה': 'כַּלָּה-לָּה',       // kalla
  'הכלה': 'הַכַּלָּה-לָּה',

  // ── Words where ElevenLabs inserts a spurious vowel after vav ──
  // "מושלם" was being read as "mesholam". The fix is to drop the vav
  // entirely and use kubutz (מֻ) — and also register the ה-prefixed form
  // so "המושלם" gets handled without relying on the prefix-aware matcher.
  'מושלם': 'מֻשְׁלָם',
  'המושלם': 'הַמֻּשְׁלָם',
  'מושלמת': 'מֻשְׁלֶמֶת',
  'המושלמת': 'הַמֻּשְׁלֶמֶת',
  'מושלמים': 'מֻשְׁלָמִים',
  'מושלמות': 'מֻשְׁלָמוֹת',

  // Other dagesh-forte words where plain nikud tends to lose the doubling.
  'סיפור': 'סִפּוּר-פּוּר',
  'דיבור': 'דִּבּוּר-בּוּר',
  'שבת': 'שַׁבָּת-בָּת',
  'סבתא': 'סָבְתָא-תָא',
  'סבא': 'סָבָּא-בָּא',
};

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

  // ── Head coverings (Jewish religious wear) ──
  // Kipah/yarmulke contexts — ElevenLabs mispronounces the unvocalized forms.
  'כיפה': 'כִּיפָּה',
  'הכיפה': 'הַכִּיפָּה',
  'כיפות': 'כִּיפּוֹת',
  'הכיפות': 'הַכִּיפּוֹת',
  'כיסוי': 'כִּיסּוּי',
  'ראש': 'רֹאשׁ',
  'הראש': 'הָרֹאשׁ',

  // ── Common adjectives / feelings ──
  // "יפה" defaults to the FEMININE form (יָפָה) — in UGC copy the subject is
  // almost always a feminine noun (כיפה, שמלה, תמונה, תוצאה, חתיכה). The
  // masculine form (יָפֶה) gets handled by the explicit phrase entries for
  // masculine contexts below ('יפה מאוד', 'נראה יפה' stay masculine verbs).
  'יפה': 'יָפָה',
  'יפת': 'יְפַת',
  'יפים': 'יָפִים',
  'יפות': 'יָפוֹת',
  'נוחה': 'נוֹחָה',
  'נוח': 'נוֹחַ',
  'נוחים': 'נוֹחִים',
  'נוחות': 'נוֹחוֹת',
  'מתאימה': 'מַתְאִימָה',
  'מתאים': 'מַתְאִים',
  'מתאימים': 'מַתְאִימִים',
  'מתאימות': 'מַתְאִימוֹת',
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

  // ── Religious / Jewish-life vocabulary ──
  'תפילה': 'תְּפִילָּה',
  'התפילה': 'הַתְּפִילָּה',
  'תפילות': 'תְּפִילּוֹת',
  'ברכה': 'בְּרָכָה',
  'הברכה': 'הַבְּרָכָה',
  'ברכות': 'בְּרָכוֹת',
  'תורה': 'תּוֹרָה',
  'התורה': 'הַתּוֹרָה',
  'מצווה': 'מִצְוָוה',
  'המצווה': 'הַמִּצְוָוה',
  'מצוות': 'מִצְווֹת',
  'כיפור': 'כִּיפּוּר',
  'שבתות': 'שַׁבָּתוֹת',
  'חב״ד': 'חָבַּ״ד',
  'חבד': 'חָבַּ״ד',
  'כיסוי ראש': 'כִּיסּוּי רֹאשׁ',
  'מטפחת': 'מִטְפַּחַת',
  'המטפחת': 'הַמִּטְפַּחַת',
  'טלית': 'טַלִּית',
  'תפילין': 'תְּפִילִּין',
  'מזוזה': 'מְזוּזָה',
  'חתונה': 'חֲתוּנָה',
  'החתונה': 'הַחֲתוּנָה',
  'ברית': 'בְּרִית',
  'הברית': 'הַבְּרִית',
  'חג': 'חַג',
  'החג': 'הֶחָג',
  'חגים': 'חַגִּים',
  'ראש השנה': 'רֹאשׁ הַשָּׁנָה',
  'פסח': 'פֶּסַח',
  'חנוכה': 'חֲנוּכָּה',
  'פורים': 'פּוּרִים',
  'שבועות': 'שָׁבוּעוֹת',
  'סוכות': 'סֻכּוֹת',
  'רב': 'רַב',
  'הרב': 'הָרַב',
  'רבי': 'רַבִּי',
  'קדוש': 'קָדוֹשׁ',
  'קדושה': 'קְדוּשָׁה',

  // ── Beauty / cosmetics / fashion ──
  'איפור': 'אִיפּוּר',
  'האיפור': 'הָאִיפּוּר',
  'אודם': 'אֹדֶם',
  'מסקרה': 'מַסְקָרָה',
  'לק': 'לָק',
  'לק ציפורניים': 'לָק צִיפָּרְנַיִים',
  'ציפורניים': 'צִיפָּרְנַיִים',
  'הציפורניים': 'הַצִּיפָּרְנַיִים',
  'בושם': 'בּוֹשֶׂם',
  'הבושם': 'הַבּוֹשֶׂם',
  'בשמים': 'בְּשָׂמִים',
  'תכשיט': 'תַּכְשִׁיט',
  'התכשיט': 'הַתַּכְשִׁיט',
  'תכשיטים': 'תַּכְשִׁיטִים',
  'טבעת': 'טַבַּעַת',
  'הטבעת': 'הַטַּבַּעַת',
  'עגיל': 'עָגִיל',
  'עגילים': 'עֲגִילִים',
  'שרשרת': 'שַׁרְשֶׁרֶת',
  'השרשרת': 'הַשַּׁרְשֶׁרֶת',
  'צמיד': 'צָמִיד',
  'הצמיד': 'הַצָּמִיד',
  'שעון': 'שָׁעוֹן',
  'השעון': 'הַשָּׁעוֹן',
  'שמלה': 'שִׂמְלָה',
  'השמלה': 'הַשִּׂמְלָה',
  'שמלות': 'שְׂמָלוֹת',
  'חולצה': 'חֻלְצָה',
  'החולצה': 'הַחֻלְצָה',
  'מכנסיים': 'מִכְנָסַיִים',
  'נעליים': 'נַעֲלַיִים',
  'הנעליים': 'הַנַּעֲלַיִים',
  'תיק': 'תִּיק',
  'התיק': 'הַתִּיק',
  'כובע': 'כּוֹבַע',
  'הכובע': 'הַכּוֹבַע',
  'מעיל': 'מְעִיל',
  'המעיל': 'הַמְּעִיל',
  'חצאית': 'חֲצָאִית',
  'החצאית': 'הַחֲצָאִית',
  'גרביים': 'גַּרְבַּיִים',
  'חגורה': 'חֲגוֹרָה',
  'לוק': 'לוּק',
  'הלוק': 'הַלּוּק',
  'סטייל': 'סְטַיְיל',

  // ── Food / cooking ──
  'לחם': 'לֶחֶם',
  'הלחם': 'הַלֶּחֶם',
  'חלב': 'חָלָב',
  'החלב': 'הֶחָלָב',
  'מים': 'מַיִם',
  'המים': 'הַמַּיִם',
  'קפה': 'קָפֶה',
  'הקפה': 'הַקָּפֶה',
  'תה': 'תֵּה',
  'פיצה': 'פִּיצָּה',
  'הפיצה': 'הַפִּיצָּה',
  'סלט': 'סָלָט',
  'הסלט': 'הַסָּלָט',
  'עוגה': 'עוּגָה',
  'העוגה': 'הָעוּגָה',
  'שוקולד': 'שׁוֹקוֹלָד',
  'השוקולד': 'הַשּׁוֹקוֹלָד',
  'בשר': 'בָּשָׂר',
  'הבשר': 'הַבָּשָׂר',
  'דג': 'דָּג',
  'דגים': 'דָּגִים',
  'ביצה': 'בֵּיצָה',
  'ביצים': 'בֵּיצִים',
  'גבינה': 'גְּבִינָה',
  'הגבינה': 'הַגְּבִינָה',
  'יוגורט': 'יוֹגוּרְט',
  'אורז': 'אֹרֶז',
  'תפוח': 'תַּפּוּחַ',
  'תפוחים': 'תַּפּוּחִים',
  'בננה': 'בָּנָנָה',
  'תות': 'תּוּת',
  'ירקות': 'יְרָקוֹת',
  'פירות': 'פֵּירוֹת',
  'ארוחה': 'אֲרוּחָה',
  'הארוחה': 'הָאֲרוּחָה',
  'ארוחת': 'אֲרוּחַת',
  'צהריים': 'צָהֳרַיִים',
  'מטבח': 'מִטְבָּח',
  'המטבח': 'הַמִּטְבָּח',

  // ── Body parts ──
  'יד': 'יָד',
  'ידיים': 'יָדַיִים',
  'הידיים': 'הַיָּדַיִים',
  'רגל': 'רֶגֶל',
  'רגליים': 'רַגְלַיִים',
  'הרגליים': 'הָרַגְלַיִים',
  'עין': 'עַיִן',
  'עיניים': 'עֵינַיִים',
  'העיניים': 'הָעֵינַיִים',
  'האף': 'הָאַף',
  'פה': 'פֶּה',
  'הפה': 'הַפֶּה',
  'אוזן': 'אֹזֶן',
  'אוזניים': 'אוֹזְנַיִים',
  'שפתיים': 'שְׂפָתַיִים',
  'השפתיים': 'הַשְּׂפָתַיִים',
  'שן': 'שֵׁן',
  'לב': 'לֵב',
  'הלב': 'הַלֵּב',
  'גב': 'גַּב',
  'הגב': 'הַגַּב',
  'בטן': 'בֶּטֶן',
  'הבטן': 'הַבֶּטֶן',
  'צוואר': 'צַוָּואר',
  'כתף': 'כָּתֵף',
  'כתפיים': 'כְּתֵפַיִים',

  // ── Expanded common adjectives ──
  'נחמד': 'נֶחְמָד',
  'נחמדה': 'נֶחְמָדָה',
  'נוראי': 'נוֹרָאִי',
  'נורא': 'נוֹרָא',
  'קשה': 'קָשֶׁה',
  'קשות': 'קָשׁוֹת',
  'קל': 'קַל',
  'קלה': 'קַלָּה',
  'פשוט': 'פָּשׁוּט',
  'פשוטה': 'פְּשׁוּטָה',
  'מסובך': 'מְסֻבָּךְ',
  'חכם': 'חָכָם',
  'חכמה': 'חֲכָמָה',
  'טיפש': 'טִפֵּשׁ',
  'טיפשה': 'טִפְּשָׁה',
  'חזק': 'חָזָק',
  'חזקה': 'חֲזָקָה',
  'חלש': 'חַלָּשׁ',
  'חלשה': 'חַלָּשָׁה',
  'רך': 'רַךְ',
  'רכה': 'רַכָּה',
  'קשיח': 'קָשִׁיחַ',
  'קשיחה': 'קָשִׁיחָה',
  'יקרה מאוד': 'יְקָרָה מְאוֹד',
  'מספיק': 'מַסְפִּיק',
  'מספיקה': 'מַסְפִּיקָה',
  'זהה': 'זֵהֶה',
  'שונה': 'שׁוֹנֶה',
  'שונים': 'שׁוֹנִים',
  'שונות': 'שׁוֹנוֹת',
  'דומה': 'דּוֹמֶה',
  'דומים': 'דּוֹמִים',
  'מתוק': 'מָתוֹק',
  'מתוקה': 'מְתוּקָה',
  'מר': 'מַר',
  'חמוץ': 'חָמוּץ',
  'חמוצה': 'חֲמוּצָה',
  'מלוח': 'מָלוּחַ',
  'טרי': 'טָרִי',
  'טריה': 'טְרִיָּה',
  'רטוב': 'רָטוֹב',
  'יבש': 'יָבֵשׁ',
  'יבשה': 'יְבֵשָׁה',
  'חם': 'חַם',
  'חמה': 'חַמָּה',
  'קר': 'קַר',
  'קרה': 'קָרָה',
  'מעניין': 'מְעַנְיֵין',
  'מעניינת': 'מְעַנְיֶינֶת',
  'משעמם': 'מְשַׁעֲמֵם',
  'משעממת': 'מְשַׁעֲמֶמֶת',
  'מרגש': 'מְרַגֵּשׁ',
  'מרגשת': 'מְרַגֶּשֶׁת',
  'פופולרי': 'פּוֹפּוּלָרִי',
  'פופולרית': 'פּוֹפּוּלָרִית',

  // ── Additional common verbs (past tense, both genders) ──
  'נהניתי': 'נֶהֱנֵיתִי',
  'נהנינו': 'נֶהֱנֵינוּ',
  'הבנתי': 'הֵבַנְתִּי',
  'זכרתי': 'זָכַרְתִּי',
  'שכחתי': 'שָׁכַחְתִּי',
  'חשבתי': 'חָשַׁבְתִּי',
  'שמעתי': 'שָׁמַעְתִּי',
  'ראיתי': 'רָאִיתִי',
  'לקחתי': 'לָקַחְתִּי',
  'נתתי': 'נָתַתִּי',
  'סיפרתי': 'סִפַּרְתִּי',
  'שאלתי': 'שָׁאַלְתִּי',
  'עניתי': 'עָנִיתִי',
  'צחקתי': 'צָחַקְתִּי',
  'בכיתי': 'בָּכִיתִי',
  'ישנתי': 'יָשַׁנְתִּי',
  'התעוררתי': 'הִתְעוֹרַרְתִּי',
  'יצאתי': 'יָצָאתִי',
  'חזרתי': 'חָזַרְתִּי',
  'באתי': 'בָּאתִי',
  'אכלתי': 'אָכַלְתִּי',
  'שתיתי': 'שָׁתִיתִי',

  // ── Common household / product words ──
  'ספה': 'סַפָּה',
  'הספה': 'הַסַּפָּה',
  'שטיח': 'שָׁטִיחַ',
  'מגבת': 'מַגֶּבֶת',
  'סדין': 'סָדִין',
  'כרית': 'כָּרִית',
  'שמיכה': 'שְׂמִיכָה',
  'מזרון': 'מִזְרוֹן',
  'מקרר': 'מְקָרֵר',
  'המקרר': 'הַמְּקָרֵר',
  'תנור': 'תַּנּוּר',
  'כיור': 'כִּיּוֹר',
  'מקלחת': 'מִקְלַחַת',
  'סבון': 'סַבּוֹן',
  'שמפו': 'שַׁמְפּוֹ',
  'מברשת': 'מִבְרֶשֶׁת',

  // ── Tech / app words ──
  'אפליקציה': 'אַפְּלִיקַצְיָה',
  'האפליקציה': 'הָאַפְּלִיקַצְיָה',
  'אינטרנט': 'אִינְטֶרְנֶט',
  'וואטסאפ': 'וָואטְסאַפּ',
  'אינסטגרם': 'אִינְסְטָגְרָם',
  'טיקטוק': 'טִיקְטוֹק',
  'יוטיוב': 'יוּטְיוּב',
  'סמארטפון': 'סְמַארְטְפוֹן',
  'טלפון': 'טֶלֶפוֹן',
  'הטלפון': 'הַטֶּלֶפוֹן',
  'מחשב': 'מַחְשֵׁב',
  'המחשב': 'הַמַּחְשֵׁב',

  // ── More daily-life verbs (present tense both genders) ──
  'נוסע': 'נוֹסֵעַ',
  'נוסעת': 'נוֹסַעַת',
  'אוכל': 'אוֹכֵל',
  'אוכלת': 'אוֹכֶלֶת',
  'שותה': 'שׁוֹתֶה',
  'קורא': 'קוֹרֵא',
  'קוראת': 'קוֹרֵאת',
  'כותב': 'כּוֹתֵב',
  'כותבת': 'כּוֹתֶבֶת',
  'עונה': 'עוֹנֶה',
  'שואל': 'שׁוֹאֵל',
  'שואלת': 'שׁוֹאֶלֶת',
  'צוחק': 'צוֹחֵק',
  'צוחקת': 'צוֹחֶקֶת',
  'בוכה': 'בּוֹכֶה',
  'יושב': 'יוֹשֵׁב',
  'יושבת': 'יוֹשֶׁבֶת',
  'עומד': 'עוֹמֵד',
  'עומדת': 'עוֹמֶדֶת',
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

// phoneticize(word) — lightweight rule-based phonetic nudger for Hebrew words
// that aren't in any dictionary. Applied only when there's no dictionary hit.
//
// Rules (conservative — only add hints that are safe to apply blindly):
//   1. בכפת at the START of a word gets an implicit dagesh (hard stop), so
//      add an explicit dagesh on that letter when it appears without nikud.
//   2. The vowel combos "וּ" and "וֹ" are preserved as-is when present; if the
//      raw word has a medial vav with no nikud, leave it (risky to guess).
//   3. If the word is > 6 chars and contains no nikud at all, insert a soft
//      hyphen every 3-4 chars to encourage ElevenLabs to break into syllables.
//
// This is intentionally narrow — aggressive phoneticization does more harm
// than good. Dictionary entries always take precedence.
export function phoneticize(word) {
  if (!word || typeof word !== 'string') return word
  // Skip if the word already carries nikud (any combining mark in U+0591..U+05C7)
  if (/[\u0591-\u05C7]/.test(word)) return word
  const firstChar = word.charAt(0)
  let out = word
  // Add dagesh (U+05BC) after initial בכפת when no nikud follows
  if (/^[בכפת]/.test(firstChar) && word.length > 1) {
    out = firstChar + '\u05BC' + word.slice(1)
  }
  // For long un-vocalized words, insert a syllable hyphen around the midpoint
  // so ElevenLabs treats them as two chunks instead of guessing one vowel.
  if (out.length > 7 && !/[\u0591-\u05C7\-\u05BE]/.test(word)) {
    const mid = Math.ceil(out.length / 2)
    out = out.slice(0, mid) + '-' + out.slice(mid)
  }
  return out
}

// Build a single regex that matches a dictionary key preceded by any single
// Hebrew single-letter prefix (ה/ו/ש/ל/ב/מ/כ) so that "המושלם", "ושמלה",
// "לחתונה" all trigger the replacement while preserving the prefix.
function replaceWithPrefixAwareness(text, dict) {
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length)
  let out = text
  for (const key of keys) {
    const rep = dict[key]
    // Boundary: start of string OR whitespace/punct. Followed by optional
    // one-letter Hebrew prefix (only when the key itself doesn't start with
    // the same prefix — otherwise we'd double up). Then the key. Then a
    // trailing boundary.
    // Allow up to TWO Hebrew single-letter prefixes (e.g. "וה" in "והמושלם",
    // "שב" in "שבמחיר"). We don't attempt to add nikud to the prefix itself —
    // TTS pronounces the prefix from context; we just want the stem vocalised.
    // Because keys are sorted LONGEST-first, a key that starts with a
    // "prefix letter" (e.g. "המושלם") is matched without a leading prefix
    // BEFORE the shorter "מושלם" key — so prefix greed is safe.
    const prefixPart = '(?:[הושלבמכ]{1,2})?'
    const re = new RegExp(
      `(^|[\\s.,!?:;"'\\-])(${prefixPart})${key}(?=$|[\\s.,!?:;"'\\-])`,
      'g'
    )
    out = out.replace(re, (_, pre, pfx) => `${pre}${pfx || ''}${rep}`)
  }
  return out
}

export function cleanHebrewText(text) {
  if (!text || typeof text !== 'string') return text

  let out = text

  // Remove artificial line breaks — ElevenLabs interprets them as long pauses.
  out = out.replace(/[\r\n]+/g, ' ')

  // Replace standalone integers with Hebrew words (only when surrounded by non-digit chars)
  out = out.replace(/(^|[^\d])(\d+)(?=$|[^\d])/g, (_, pre, num) => `${pre}${spellNumber(num)}`)

  // Layer 1 — custom phonetic hard-overrides. Applied FIRST so dagesh-hack
  // spellings for words ElevenLabs keeps mispronouncing (כיפה, מושלם…) win
  // over the long-tail nikud dictionary.
  out = replaceWithPrefixAwareness(out, CUSTOM_PRONUNCIATIONS)

  // Layer 2 — plain nikud replacements for the long-tail. Prefix-aware so
  // "המחיר", "ולחם", "שסיפור" all match their base forms.
  out = replaceWithPrefixAwareness(out, WORD_REPLACEMENTS)

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
