// Shared script-generation pipeline for the agent flow.
//
// This module is consumed by:
//   - app/api/agent/script-only/route.js          (script-first approval flow)
//   - app/api/agent/approve-and-generate/route.js (uses default scenes/hooks
//                                                  when reconstructing a job)
//   - app/api/agent/route.js                      (legacy compatibility)
//
// It returns 4 voiceover beats + per-scene `nb_prompt` (still-frame prompt) +
// `subtitle`. Seedance prompts are now built server-side at video generation
// time from natural-language templates (see lib/seedance-pipeline.js), so this
// module no longer emits kling_prompt / seedance_prompt fields.

import Anthropic from '@anthropic-ai/sdk'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
export const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'

export function joinVoiceoverChunks(chunks) {
  const cleaned = chunks
    .map(c => (c || '').trim())
    .filter(Boolean)
  if (cleaned.length === 0) return ''
  const last = cleaned.length - 1
  const stripped = cleaned.map((c, i) => {
    if (i === last) return c
    return c.replace(/[.!?…\s]+$/u, '')
  })
  let joined = stripped.join(' ').replace(/\s+/g, ' ').trim()
  joined = joined.replace(/[.!?…\s]+$/u, '')
  if (joined) joined += '.'
  return joined
}

const FEMALE_ONLY_PATTERNS = [
  /\bמביכה\b/, /\bמובכת\b/, /\bבטוחה\b/, /\bחייבת\b/, /\bמחפשת\b/,
  /\bמוכנה\b/, /\bמשתמשת\b/, /\bהייתי מובכת\b/, /\bהייתי מביכה\b/,
  /\bמרוצה\s+אני\b/, /\bעייפה\b/, /\bשמחה\b/, /\bעצובה\b/, /\bכועסת\b/,
]
const MALE_ONLY_PATTERNS = [
  /\bמובך\b/, /\bבטוח\b/, /\bחייב\b/, /\bמחפש\b/,
  /\bמוכן\b/, /\bמשתמש\b/, /\bהייתי מובך\b/,
  /\bעייף\b/, /\bשמח\b/, /\bעצוב\b/, /\bכועס\b/,
]
export function scriptGenderMismatch(text, voiceGender) {
  if (!text) return false
  if (voiceGender === 'male') return FEMALE_ONLY_PATTERNS.some(re => re.test(text))
  if (voiceGender === 'female') return MALE_ONLY_PATTERNS.some(re => re.test(text))
  return false
}

const MID_SENTENCE_STARTERS = new Set([
  'שלי', 'שלך', 'שלו', 'שלה', 'שלנו', 'שלכם', 'שלהם',
  'ואז', 'אבל', 'כי', 'אז', 'עד', 'וגם', 'גם',
  'ו', 'ב', 'ל', 'מ', 'כ',
  'אותי', 'אותך', 'אותו', 'אותה', 'אותנו', 'אותם',
  'הזה', 'הזו', 'האלה', 'ההוא', 'ההיא',
])
const BAD_SCENE1_FIRST_WORDS = new Set(['ניסיתי', 'חיפשתי', 'רציתי'])
export function sceneOneIsWeakOpener(sceneOneText) {
  if (!sceneOneText) return false
  const trimmed = sceneOneText.trim().replace(/^["'״'(\[]+/, '')
  const firstWord = trimmed.split(/\s+/)[0] || ''
  if (BAD_SCENE1_FIRST_WORDS.has(firstWord)) return true
  if (/ניסיתי המון דברים/.test(trimmed)) return true
  return false
}

const FOREIGN_BORROWED_WORDS = [
  /\bסטיילית\b/u, /\bסטיילי\b/u,
  /\bטרנדי\b/u, /\bטרנדית\b/u,
  /\bקולית\b/u, /\bקולי\b/u,
  /\bסאפר\b/u,
  /\bאאוטפיט\b/u,
]
export function scriptHasForeignWords(fullText) {
  if (!fullText) return false
  return FOREIGN_BORROWED_WORDS.some(re => re.test(fullText))
}

const DISCOVERY_OPENERS = /^(עד\s+ש|ואז\s+גיליתי|ואז\s+מצאתי|עד\s+שמצאתי|עד\s+שגיליתי)/u

// Beat 1 generic-pain phrases that kill emotional resonance.
// Expanded per the new spec — adds "ניסיתי המון", "כלום לא עבד", "שום פתרון".
export const BEAT_1_FORBIDDEN_PHRASES = [
  'מנסה כל פתרון',
  'ניסיתי כל פתרון',
  'ניסיתי המון',
  'שום דבר לא עבד',
  'שום פתרון לא עבד',
  'שום פתרון',
  'ניסיתי הכל',
  'חיפשתי פתרון',
  'לא מצאתי משהו שמתאים',
  'כלום לא התאים',
  'כלום לא עזר',
  'כלום לא עבד',
]
export const BEAT_3_FORBIDDEN_PHRASES = [
  'עד שגיליתי',
  'ואז גיליתי',
  'גיליתי את',
  'מצאתי את',
  'עד שמצאתי',
]

export function beatStructureViolations(scenes, productName) {
  const violations = []
  if (!Array.isArray(scenes) || scenes.length < 4) return violations
  const v1 = (scenes[0]?.subtitle || scenes[0]?.voiceover || '').trim()
  const v2 = (scenes[1]?.subtitle || scenes[1]?.voiceover || '').trim()
  const v3 = (scenes[2]?.subtitle || scenes[2]?.voiceover || '').trim()

  for (const phrase of BEAT_1_FORBIDDEN_PHRASES) {
    if (v1.includes(phrase)) {
      violations.push(`Beat 1 contains generic phrase "${phrase}" — pain must be SPECIFIC to the product category (sensory or emotional language tied to the category, not a one-size-fits-all line).`)
    }
  }
  if (productName && v1 && v1.toLowerCase().includes(productName.toLowerCase())) {
    violations.push(`Beat 1 mentions the product name "${productName}" — the product must only be introduced in Beat 2.`)
  }

  if (!DISCOVERY_OPENERS.test(v2)) {
    violations.push(`Scene 2 (Beat 2) must START with "עד ש..." or "ואז גיליתי..." and name the product. Got: "${v2.slice(0, 60)}"`)
  }
  const v2Words = v2.split(/\s+/).filter(Boolean).length
  if (v2Words > 10) {
    violations.push(`Scene 2 (Beat 2) must be short (4-6 words). Got ${v2Words} words — move benefits to scene 3.`)
  }

  for (const phrase of BEAT_3_FORBIDDEN_PHRASES) {
    if (v3.includes(phrase)) {
      violations.push(`Beat 3 contains discovery phrase "${phrase}" — that belongs in Beat 2 ONLY. Beat 3 must describe benefits and emotional payoff, not re-introduce the product.`)
    }
  }

  return violations
}

export function scenesHaveBrokenSentences(scenes) {
  if (!Array.isArray(scenes)) return false
  const chunks = scenes.map(s => (s?.subtitle || s?.voiceover || '').trim()).filter(Boolean)
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const last = c.replace(/["')\]\s]+$/, '').slice(-1)
    if (!/[.!?…]/.test(last)) return true
    if (i + 1 < chunks.length && i + 1 !== 1) {
      const nextFirstWord = chunks[i + 1].split(/\s+/)[0] || ''
      const cleaned = nextFirstWord.replace(/^["'(\[]+/, '')
      if (MID_SENTENCE_STARTERS.has(cleaned)) return true
    }
  }
  return false
}

const FEMININE_TO_MASCULINE = [
  ['מביכה', 'מובך'], ['מובכת', 'מובך'],
  ['מתהפכת', 'מתהפך'],
  ['הייתי כל כך עייפה', 'הייתי כל כך עייף'], ['עייפה', 'עייף'],
  ['מבזבזת', 'מבזבז'],
  ['מתביישת', 'מתבייש'],
  ['הרגשתי יפה', 'הרגשתי טוב'],
  ['מספיק מיוחדת', 'מספיק מיוחד'],
  ['לא נוח לי', 'לא נוח לי'],
  ['מחפשת', 'מחפש'],
  ['בטוחה', 'בטוח'],
  ['חייבת', 'חייב'],
  ['מוכנה', 'מוכן'],
  ['משתמשת', 'משתמש'],
  ['התאכזבתי', 'התאכזבתי'],
]
function toMasculine(text) {
  if (!text) return text
  let out = text
  for (const [fem, mas] of FEMININE_TO_MASCULINE) {
    if (fem === mas) continue
    out = out.split(fem).join(mas)
  }
  return out
}
export function applyGender(text, voiceGender) {
  return voiceGender === 'male' ? toMasculine(text) : text
}

// Per-category specific pain hooks. Reflects the spec's category cheatsheet.
export function getHook(productName, productDesc, voiceGender = 'female') {
  const desc = ((productDesc || '') + ' ' + (productName || '')).toLowerCase()
  let raw = 'הרגשתי שמשהו חסר לי ביומיום, משהו קטן שיעשה הבדל גדול'

  if (/כיפה|כיפות|יארמולקה|כיסוי ראש|מטפחת|kipah|yarmulke|head cover/.test(desc))
    raw = 'הרגשתי שאני עובר את היום בלי חיבור רוחני, שוכח מי שומר עליי'
  else if (/שמלה|בגד|חולצה|מכנס|נעל|תיק|אופנה|dress|shirt|clothes|fashion|pants|shoes|bag/.test(desc))
    raw = 'בכל אירוע הרגשתי שאני לא מספיק מיוחדת, הבגדים שלי נראו רגילים'
  else if (/שינ|דנטל|לבן|משחת|teeth|dental|whiten/.test(desc))
    raw = 'הייתי מתביישת לחייך בתמונות, השיניים שלי היו צהובות וזה הפריע לי כל יום'
  else if (/קרם|פנים|אקנה|עור|סרום|skincare|cream|serum|acne|face/.test(desc))
    raw = 'העור שלי היה יבש בבוקר וזה הפריע לי להרגיש יפה כשיצאתי מהבית'
  else if (/שיער|hair|שמפו/.test(desc))
    raw = 'השיער שלי היה נשבר כל בוקר מחדש, לא משנה איך סידרתי אותו'
  else if (/שעון|תכשיט|צמיד|שרשרת|watch|jewelry|bracelet|necklace/.test(desc))
    raw = 'האביזרים שלי תמיד נראו זולים ולא הרגשתי בנוח איתם'
  else if (/שינה|לישון|כרית|מזרון|sleep|pillow|mattress/.test(desc))
    raw = 'כל לילה הייתי מתהפכת במיטה שעות בלי להצליח להירדם'
  else if (/גלידה|קינוח|ממתק|שוקולד|מתוק|ice\s*cream|gelato|dessert|sweet|chocolate/.test(desc))
    raw = 'רציתי משהו טעים בלי להתחרט, אבל מצאתי רק חטיפים מלאים בסוכר'
  else if (/אוכל|מסעדה|ארוחה|מזון|תזונה|food|meal|restaurant|diet/.test(desc))
    raw = 'הייתי כל כך עייפה מלבשל כל יום ולא ידעתי מה לעשות'
  else if (/ויטמין|תוסף|חלבון|supplement|vitamin|protein/.test(desc))
    raw = 'הרגשתי עייפה כל היום וכלום לא נתן לי באמת אנרגיה'
  else if (/כושר|אימון|ספורט|הרזיה|דיאטה|fitness|workout|gym|weight|exercise/.test(desc))
    raw = 'הבגדים שלי לא ישבו טוב, הרגשתי לא נוח עם הגוף שלי'
  else if (/אפליקציה|גאדג׳ט|טכנולוגיה|מכשיר|app|tech|gadget|device|software/.test(desc))
    raw = 'בזבזתי שעות כל יום על משהו שהיה אמור להיות פשוט'
  else if (/ניקוי|ניקיון|כביסה|cleaning|detergent|clean/.test(desc))
    raw = 'ניקיתי את הבית כל יום ובכל זאת הרגיש לא נקי באמת'
  else if (/תינוק|ילד|baby|kid|child/.test(desc))
    raw = 'הילדים שלי לא היו מפסיקים להתעצבן ולא ידעתי מה לעשות'
  else if (/בית|ריהוט|עיצוב|מטבח|home|furniture|decor|kitchen/.test(desc))
    raw = 'המטבח שלי היה תמיד מבולגן, לא מצאתי כלום כשהייתי צריכה'
  else if (/כלב|חתול|חיית|pet|dog|cat/.test(desc))
    raw = 'הכלב שלי תמיד לכלך לי את הרכב, וחזרתי הביתה מותשת'
  else if (/רכב|אוטו|מכונית|car|vehicle/.test(desc))
    raw = 'בכל נסיעה ארוכה התעייפתי מהפרטים הקטנים שהפריעו לי'

  return voiceGender === 'male' ? toMasculine(raw) : raw
}

export function getDefaultVoiceover(productName, applicationArea, hook, voiceGender = 'female') {
  const h = hook || getHook(productName, '', voiceGender)
  const raw = `${h}. עד שגיליתי את ${productName}. ${productName} עובד מצוין, ${applicationArea} והרגשתי הבדל אמיתי. תזמינו עכשיו, אי אפשר להתחרט.`
  return applyGender(raw, voiceGender)
}

export function getDefaultScenes(productName, applicationArea, productDesc, voiceGender = 'female') {
  const hook = getHook(productName, productDesc, voiceGender)
  return [
    {
      type: 'כאב',
      nb_prompt: `Unedited still frame pulled from a handheld iPhone selfie video, not a photograph. Avatar showing specific problem related to ${productDesc}, closed-lip frustrated expression with brow furrow, caught mid-thought. iPhone 15 Pro front camera, native wide lens, real unretouched skin with visible pores, soft window daylight, flat washed-out color, handheld micro-shake, framing slightly off-center, no airbrushing, no beauty filter, no LUT, looks like a real person on their front camera not a render, correct human anatomy, exactly two arms, NEVER show a phone, NEVER in a car`,
      subtitle: hook,
    },
    {
      type: 'מוצר',
      nb_prompt: `PRODUCT ONLY SHOT — absolutely no person, no human, no hands, no face, no body parts. Close-up beauty shot of ${productName} resting naturally on a wooden table or marble counter. Realistic contact shadow, soft natural window light, mild warm white balance, flat washed-out color, no studio softbox, no seamless backdrop, looks like a real phone photo not a render. Negative: person, human, hands, face, body, holding, selfie. Product NOT floating, NOT levitating.`,
      subtitle: `עד שגיליתי את ${productName}`,
    },
    {
      type: 'פתרון',
      nb_prompt: `Unedited still frame pulled from a handheld iPhone selfie video. Avatar actively using ${productName} — wearing/applying/consuming based on product type, product ON the avatar not just held, fingers firmly wrapped around the product. Focused expression, mouth closed. iPhone front camera, real skin, soft window daylight, handheld micro-shake, no airbrushing, correct human anatomy, exactly two arms, NEVER show a phone, NEVER in a car`,
      subtitle: applyGender(`${productName} עובד מצוין, ${applicationArea} והרגשתי הבדל אמיתי`, voiceGender),
    },
    {
      type: 'תוצאה',
      nb_prompt: `Unedited still frame pulled from a handheld iPhone selfie video. SAME LOCATION AS SCENE 1 — same indoor everyday setting, same casual home atmosphere. Avatar wears a natural closed-lip warm smile, satisfied and quietly confident. Product naturally visible. Same window daylight as scene 1, NO golden hour, NO new fancy location. iPhone front camera, real skin, handheld micro-shake, looks like a real person on their front camera, correct human anatomy, NEVER show a phone`,
      subtitle: applyGender('תזמינו עכשיו, אי אפשר להתחרט', voiceGender),
    },
  ]
}

// Map an avatar URL/filename to the actor id used by the Seedance prompt
// templates and the lib/ugc-skills identity-lock layer.
export function mapAvatarToActorId(avatarUrl) {
  if (!avatarUrl) return null
  const url = String(avatarUrl).toLowerCase()
  if (url.includes('noa')) return 'noa'
  if (url.includes('daniel')) return 'daniel'
  if (url.includes('maya')) return 'maya'
  return null
}

const ACTOR_DISPLAY_NAMES = { daniel: 'Daniel', noa: 'Noa', maya: 'Maya' }
export function getActorDisplayName(actorId) {
  return ACTOR_DISPLAY_NAMES[actorId] || 'the avatar'
}

export async function generateScript(productName, productDesc, applicationArea, hook, voiceGender) {
  if (!ANTHROPIC_KEY) return null
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })
  const genderInstruction = voiceGender === 'male'
    ? `GENDER (CRITICAL — MALE SPEAKER): כתוב את כל הקריינות בלשון זכר בלבד. דוגמאות: 'הייתי מובך', 'הרגשתי', 'גיליתי', 'אני בטוח', 'מחפש', 'מרוצה' (זכר), 'מוכן', 'משתמש'. כל פועל, תואר וכינוי חייב להיות בלשון זכר.`
    : `GENDER (CRITICAL — FEMALE SPEAKER): כתוב את כל הקריינות בלשון נקבה בלבד. דוגמאות: 'הייתי מובכת', 'הרגשתי', 'גיליתי', 'אני בטוחה', 'מחפשת', 'מרוצה' (נקבה), 'מוכנה', 'משתמשת'. כל פועל, תואר וכינוי חייב להיות בלשון נקבה.`

  const callClaude = async (extra = '') => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 2000,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing scripts in Hebrew. Create a viral 4-scene ad for: "${productName}".
Description: ${productDesc}
How to use: ${applicationArea}

⚡ STRICT 4-BEAT UGC STRUCTURE — THE SINGLE MOST IMPORTANT RULE ⚡

Every script MUST follow these 4 beats, in this exact order. Each beat = one voiceover_sceneN. DO NOT reorder, DO NOT merge, DO NOT skip a beat.

BEAT 1 — SPECIFIC PAIN (voiceover_scene1, ~5 sec, ~12-15 Hebrew words):
  - The pain must be SPECIFIC to the product's category — name the body part / domain / situation
  - Use sensory or emotional language tied to the category
  - First-person, sounds like venting to a friend
  - MUST NOT mention the product name or any benefit

  ⛔ FORBIDDEN GENERIC PHRASES in Beat 1 (Beat 1 must NOT contain ANY of these):
    "מנסה כל פתרון", "ניסיתי כל פתרון", "ניסיתי המון", "ניסיתי הכל",
    "שום דבר לא עבד", "שום פתרון לא עבד", "שום פתרון",
    "כלום לא התאים", "כלום לא עזר", "כלום לא עבד",
    "חיפשתי פתרון", "לא מצאתי משהו שמתאים"

  📋 PRODUCT-CATEGORY-TO-PAIN CHEATSHEET:
    • Religious / spiritual (kippah, tzitzit, mezuzah): "הרגשתי שאני עובר את היום בלי חיבור רוחני"
    • Beauty — teeth: "הייתי מתבייש לחייך בתמונות"
    • Beauty — skin/face: "העור שלי תמיד היה יבש בבוקר, זה הפריע לי להרגיש יפה"
    • Beauty — hair: "השיער שלי היה נשבר כל בוקר מחדש"
    • Food / drink / dessert: "רציתי משהו טעים בלי להתחרט"
    • Fashion / clothing: "בכל אירוע הרגשתי שאני לא מספיק מיוחד"
    • Tech / app / service: "כל פעם שצריך X לקח לי שעות"
    • Sleep: "כל לילה הייתי מתהפך במיטה שעות בלי להירדם"

BEAT 2 — DISCOVERY OF PRODUCT (voiceover_scene2, ~2-3 sec, ~4-6 Hebrew words):
  - MUST start with "עד ש" or "ואז גיליתי" — no other opening
  - MUST name the product: ${productName}
  - DO NOT list benefits — pure discovery bridge
  - Examples: "עד שגיליתי את ${productName}" / "ואז גיליתי את ${productName}"

BEAT 3 — BENEFITS + EMOTIONAL PAYOFF (voiceover_scene3, ~7-8 sec, ~18-22 Hebrew words):
  - State 2-3 specific concrete benefits of ${productName}
  - Connect last benefit back to the pain from BEAT 1 with an emotional line
  - Beat 3 should flow directly from Beat 2 — go DIRECTLY into why the product is good

  ⛔ FORBIDDEN DISCOVERY PHRASES in Beat 3 (NOT anywhere in the line):
    "עד שגיליתי", "ואז גיליתי", "גיליתי את", "מצאתי את", "עד שמצאתי"

BEAT 4 — CTA + PERSONAL TESTIMONIAL (voiceover_scene4, ~3-4 sec, ~8-10 Hebrew words):
  - Direct CTA + short personal emotional line ("זה שינה לי את היום", "זה שווה כל שקל", "אי אפשר להתחרט")
  - Examples: "אתם חייבים לנסות את זה, זה באמת שינה לי את היום"

SCENE 2 VISUAL: product-only beauty shot, no avatar, no person.
SCENE 3 VISUAL: avatar performs SILENT ACTION with the product. Voiceover plays as background narration. Mouth closed or focused on the action. NEVER speaking on camera.

${genderInstruction}

HOOK (voiceover_scene1) — PRE-SET, DO NOT CHANGE:
voiceover_scene1 is already set to: "${hook}"
Use this EXACT text as voiceover_scene1.

AUTHENTIC HEBREW: avoid borrowed words (סטיילית, טרנדי, קולית, סאפר, אאוטפיט). Use native Hebrew.

SENTENCE COMPLETENESS (CRITICAL):
Each voiceover_sceneN must be a SELF-CONTAINED grammatically complete Hebrew sentence ending with . ? or !.

NB_PROMPT INSTRUCTIONS — for each scene's still-frame prompt:
- Scenes 1, 3, 4: include the avatar in a casual selfie style (iPhone front camera, real skin, soft natural light, handheld feel). Scene 4 stays in the SAME indoor location as scene 1.
- Scene 2: PRODUCT ONLY, no person, no hands. Close-up of ${productName} on a real surface with natural contact shadow.
- Append PRODUCT_LOCK markers when the product is in frame (scenes 2, 3, 4): preserve exact product appearance from reference image, no morphing, no shape changing, no logo transformation.

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "BEAT 1 — exact pre-set hook above",
  "voiceover_scene2": "BEAT 2 — DISCOVERY, ~4-6 Hebrew words, must start with 'עד ש' or 'ואז גיליתי' and include ${productName}",
  "voiceover_scene3": "BEAT 3 — BENEFITS + EMOTIONAL PAYOFF, ~18-22 Hebrew words. NO discovery phrase anywhere.",
  "voiceover_scene4": "BEAT 4 — CTA + personal testimonial, ~8-10 Hebrew words",
  "setting": "one-line description of the indoor setting",
  "scenes": [
    {
      "type": "כאב",
      "nb_prompt": "still-frame prompt for scene 1 (avatar showing pain, no product visible, casual selfie iPhone style, real skin, soft natural light, anatomy correct, no phone, no car)",
      "subtitle": "same as voiceover_scene1"
    },
    {
      "type": "מוצר",
      "nb_prompt": "still-frame prompt for scene 2 (PRODUCT ONLY, ${productName} on a wooden/marble surface, contact shadow, natural light, NO person, NO hands, preserve exact product appearance from reference)",
      "subtitle": "same as voiceover_scene2"
    },
    {
      "type": "פתרון",
      "nb_prompt": "still-frame prompt for scene 3 (avatar SILENTLY using ${productName}, product ON the avatar, mouth closed, focused expression, fingers anchored to product, casual selfie iPhone style, anatomy correct, no phone, no car)",
      "subtitle": "same as voiceover_scene3"
    },
    {
      "type": "תוצאה",
      "nb_prompt": "still-frame prompt for scene 4 (SAME LOCATION AS SCENE 1, avatar with closed-lip warm satisfied smile, product naturally visible or its effect visible, same daylight as scene 1, no golden hour, no new location, casual selfie iPhone style, anatomy correct, no phone)",
      "subtitle": "same as voiceover_scene4"
    }
  ]
}${extra}` }],
  })

  const parseResponse = (message) => {
    const text = message.content?.[0]?.text || ''
    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      const v1 = parsed.voiceover_scene1 || ''
      const v2 = parsed.voiceover_scene2 || ''
      const v3 = parsed.voiceover_scene3 || ''
      const v4 = parsed.voiceover_scene4 || ''
      parsed.voiceover = joinVoiceoverChunks([v1, v2, v3, v4])
      if (parsed.scenes) {
        parsed.scenes[0].subtitle = v1
        parsed.scenes[1].subtitle = v2
        parsed.scenes[2].subtitle = v3
        parsed.scenes[3].subtitle = v4
      }
      return parsed
    } catch { return null }
  }

  let parsed = parseResponse(await callClaude())

  if (parsed && scriptGenderMismatch(parsed.voiceover, voiceGender)) {
    console.warn(`[generateScript] Gender mismatch (wanted ${voiceGender}), regenerating...`)
    const extra = `\n\nPREVIOUS ATTEMPT HAD WRONG GENDER. ${genderInstruction}\nREWRITE every verb, adjective, and pronoun to match the speaker's gender (${voiceGender}).`
    const retry = parseResponse(await callClaude(extra))
    if (retry) parsed = retry
  }
  if (parsed && scenesHaveBrokenSentences(parsed.scenes)) {
    console.warn('[generateScript] Broken sentences across scenes, regenerating...')
    const extra = `\n\nPREVIOUS ATTEMPT HAD SENTENCES SPLIT ACROSS SCENES. REWRITE so each voiceover_sceneN is a SELF-CONTAINED grammatically complete Hebrew sentence ending with . ? or !.`
    const retry = parseResponse(await callClaude(extra))
    if (retry) parsed = retry
  }
  if (parsed && sceneOneIsWeakOpener(parsed.voiceover_scene1)) {
    console.warn('[generateScript] Weak scene-1 opener, regenerating...')
    const extra = `\n\nPREVIOUS ATTEMPT OPENED SCENE 1 WITH A BARE ACTION VERB. REWRITE voiceover_scene1 to open with an EMOTIONAL STATE or RECURRING SITUATION. The first word must NOT be ניסיתי/חיפשתי/רציתי. Keep the exact pre-set hook "${hook}".`
    const retry = parseResponse(await callClaude(extra))
    if (retry) parsed = retry
  }
  if (parsed) {
    const violations = beatStructureViolations(parsed.scenes, productName)
    if (violations.length > 0) {
      console.warn('[generateScript] 4-beat structure violations:', violations)
      const bullets = violations.map((v, i) => `  ${i + 1}. ${v}`).join('\n')
      const extra = `\n\nPREVIOUS ATTEMPT VIOLATED THE STRICT 4-BEAT STRUCTURE. Fix ALL of these specific issues:\n${bullets}\n\nReminder of the rules:\n- voiceover_scene1 = BEAT 1 (SPECIFIC pain tied to the product CATEGORY, never a generic phrase, never names the product)\n- voiceover_scene2 = BEAT 2 (SHORT 4-6 words, MUST start with "עד ש" or "ואז גיליתי" and include "${productName}")\n- voiceover_scene3 = BEAT 3 (2-3 concrete benefits + emotional payoff, MUST NOT contain "עד שגיליתי" / "ואז גיליתי" / "גיליתי את" / "מצאתי את")\n- voiceover_scene4 = BEAT 4 (CTA + personal testimonial line)`
      const retry = parseResponse(await callClaude(extra))
      if (retry) parsed = retry
    }
  }
  if (parsed && scriptHasForeignWords(parsed.voiceover)) {
    console.warn('[generateScript] Foreign borrowed words detected, regenerating...')
    const extra = `\n\nPREVIOUS ATTEMPT USED TRANSLITERATED ENGLISH WORDS (סטיילית / טרנדי / קולית / סאפר / אאוטפיט). REWRITE using authentic Hebrew. These banned words must appear ZERO times.`
    const retry = parseResponse(await callClaude(extra))
    if (retry) parsed = retry
  }
  return parsed
}

// ============ BUSINESS MODE ============

export function getBusinessCategory(desc) {
  const d = (desc || '').toLowerCase()
  if (/מסעד|קפה|פיצרי|בר|אוכל|שף|מטבח|restaurant|cafe|bar|food|kitchen|pizza|sushi|burger/.test(d)) return 'restaurant'
  if (/אופנה|בוטיק|בגד|חולצ|שמל|fashion|boutique|clothing|apparel|shop|store/.test(d)) return 'fashion'
  if (/קליניק|מרפא|רופא|טיפול|אסתטי|שיני|קוסמטיק|clinic|dental|doctor|therapy|aesthetic|beauty|spa|massage/.test(d)) return 'clinic'
  if (/מספר|תסרוק|ספר|salon|hair|barber/.test(d)) return 'salon'
  if (/כושר|חדר כושר|אימון|יוגה|פילאטיס|gym|fitness|yoga|pilates|trainer/.test(d)) return 'fitness'
  return 'generic'
}

export function getCategoryUniform(cat) {
  switch (cat) {
    case 'restaurant': return 'chef coat or clean apron over a casual work shirt'
    case 'salon': return 'stylist apron over a stylish casual outfit'
    case 'clinic': return 'white medical coat over professional attire'
    case 'fitness': return 'activewear and professional trainer outfit'
    case 'fashion': return 'on-brand stylish outfit matching a modern boutique'
    default: return 'professional business attire'
  }
}
export function getCategoryCloseUp(cat) {
  switch (cat) {
    case 'restaurant': return 'hands cutting fresh ingredients, plating food, garnishing a dish'
    case 'salon': return 'scissors trimming hair in motion, blow-dryer airflow, brush shaping strands'
    case 'clinic': return 'gloved hands applying product, professional device in use'
    case 'fitness': return 'weights moving, hands gripping equipment, resistance band under tension'
    case 'fashion': return 'hands sliding clothes on a rack, fabric texture detail'
    default: return 'hands performing the core service action of the business'
  }
}
export function getCategoryScene3Action(cat) {
  switch (cat) {
    case 'restaurant': return 'plating a finished dish at the pass, stirring a pot, focused on the food'
    case 'salon': return 'styling a client whose back is to the camera, holding scissors mid-cut'
    case 'clinic': return 'performing a treatment on a reclined client, holding a professional device'
    case 'fitness': return 'demonstrating an exercise, spotting a trainee, setting up equipment'
    case 'fashion': return 'arranging clothes on a display, folding a garment with care'
    default: return 'performing the core service of the business with focused expression'
  }
}
export function getCategoryVenue(cat) {
  switch (cat) {
    case 'restaurant': return 'restaurant kitchen and dining area'
    case 'salon': return 'hair salon with chairs, mirrors and styling stations'
    case 'clinic': return 'modern clean clinic treatment room'
    case 'fitness': return 'modern gym or training studio'
    case 'fashion': return 'stylish boutique interior with clothing racks'
    default: return 'professional business interior'
  }
}

export function getBusinessHook(desc, name, voiceGender = 'female') {
  const cat = getBusinessCategory(desc)
  const hooks = {
    restaurant: `${name || 'המסעדה הזאת'} — המקום שכולם מדברים עליו`,
    fashion: `${name || 'הבוטיק הזה'} — מוצאים כאן חתיכות שלא תמצאו בשום מקום`,
    clinic: `${name || 'הקליניקה הזאת'} — כאן מקבלים יחס אמיתי ותוצאות`,
    salon: `${name || 'המספרה הזאת'} — יוצאים מכאן אחרים`,
    fitness: `${name || 'הסטודיו הזה'} — מתאמנים כאן אחרת`,
    generic: `${name || 'העסק הזה'} — זה לא סתם עוד עסק בשכונה`,
  }
  return hooks[cat] || hooks.generic
}

export function getBusinessDefaultVoiceover(name, desc, hook) {
  const h = hook || getBusinessHook(desc, name)
  return `${h}. הסוד? כל פרט נעשה בידיים, טרי, מהרגע הראשון. ב${name} מרגישים את ההבדל מיד — ${desc || 'חוויה אמיתית'}. בואו ל${name} — אתם חייבים לנסות.`
}

export function getBusinessDefaultScenes(name, desc) {
  const hook = getBusinessHook(desc, name)
  const cat = getBusinessCategory(desc)
  const uniform = getCategoryUniform(cat)
  const closeUp = getCategoryCloseUp(cat)
  const scene3Action = getCategoryScene3Action(cat)
  const venue = getCategoryVenue(cat)
  return [
    {
      type: 'הכנסה',
      nb_prompt: `avatar wearing ${uniform} inside a ${venue}, calm confident posture, mouth closed, iPhone documentary style, natural daylight, anatomy correct, NEVER show a phone`,
      subtitle: hook,
    },
    {
      type: 'פעולה',
      nb_prompt: `extreme close-up of ${closeUp}, NO face visible, NO full person, only hands and tools, cinematic shallow depth of field, warm natural lighting, preserve atmosphere from reference images`,
      subtitle: `כל פרט נעשה בידיים`,
    },
    {
      type: 'בפעולה',
      nb_prompt: `avatar wearing ${uniform} ${scene3Action}, inside the ${venue}, focused expression with mouth closed, warm interior lighting, anatomy correct`,
      subtitle: `ב${name} עושים את זה ברמה אחרת`,
    },
    {
      type: 'הזמנה',
      nb_prompt: `avatar wearing ${uniform} inside ${name} with workspace alive in background, ${name} signage visible, warm relaxed mouth-closed smile, contextual lighting from venue, anatomy correct`,
      subtitle: `בואו ל${name} — אתם חייבים לנסות`,
    },
  ]
}

export async function generateBusinessScript(name, desc, hook, voiceGender) {
  if (!ANTHROPIC_KEY) return null
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY })
  const genderInstruction = voiceGender === 'male'
    ? `GENDER (CRITICAL — MALE): כתוב בלשון זכר בלבד.`
    : `GENDER (CRITICAL — FEMALE): כתוב בלשון נקבה בלבד.`

  const cat = getBusinessCategory(desc)
  const uniform = getCategoryUniform(cat)
  const closeUp = getCategoryCloseUp(cat)
  const scene3Action = getCategoryScene3Action(cat)
  const venue = getCategoryVenue(cat)

  const callClaude = async (extra = '') => anthropic.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 2000,
    messages: [{ role: 'user', content: `You are a UGC ad expert writing Hebrew scripts for LOCAL BUSINESSES.

Business name: "${name}"
Business description: ${desc}
Auto-detected category: ${cat}
Venue: ${venue}
Uniform: ${uniform}
Close-up action: ${closeUp}
Scene-3 activity: ${scene3Action}

${genderInstruction}

CRITICAL: The avatar plays the SILENT employee/owner — never talks on camera.
NARRATION STYLE: third-person or customer-perspective narration ABOUT "${name}". NEVER "היי אני ...".

4-SCENE STRUCTURE:
- Scene 1 (👋 הכנסה): avatar in ${uniform} at the ${venue}, calm confident, mouth closed
- Scene 2 (✨ פעולה): EXTREME CLOSE-UP of ${closeUp}, NO face, only hands and tools
- Scene 3 (🏪 בפעולה): avatar ${scene3Action} inside the ${venue}, mouth closed, focused
- Scene 4 (🚀 הזמנה): business-success contextual moment with customers/activity in background, ${name} signage visible, warm closed-lip smile

VOICEOVER TIMING:
- Scene 1: ~10 Hebrew words — third-person hook about ${name}
- Scene 2: ~12 Hebrew words — describe the craft
- Scene 3: ~16 Hebrew words — unique value of ${name}
- Scene 4: ~10 Hebrew words — direct CTA: "בואו ל${name}"

HOOK (voiceover_scene1) — PRE-SET: "${hook}". Use this EXACT text.

SENTENCE COMPLETENESS: each voiceover_sceneN must be a self-contained Hebrew sentence ending with . ? or !.

Return ONLY valid JSON (no markdown):
{
  "voiceover_scene1": "exact pre-set hook",
  "voiceover_scene2": "~12 Hebrew words — describe the craft",
  "voiceover_scene3": "~16 Hebrew words — unique value of ${name}",
  "voiceover_scene4": "~10 Hebrew words — direct CTA",
  "setting": "one-line description of the ${venue}",
  "scenes": [
    { "type": "הכנסה", "nb_prompt": "avatar wearing ${uniform} at ${venue}, calm confident, mouth closed, iPhone documentary, anatomy correct, no phone", "subtitle": "same as voiceover_scene1" },
    { "type": "פעולה", "nb_prompt": "extreme close-up of ${closeUp}, NO face, only hands and tools, shallow depth of field, warm light, preserve atmosphere from reference", "subtitle": "same as voiceover_scene2" },
    { "type": "בפעולה", "nb_prompt": "avatar in ${uniform} ${scene3Action}, ${venue}, mouth closed, focused, anatomy correct, no phone", "subtitle": "same as voiceover_scene3" },
    { "type": "הזמנה", "nb_prompt": "avatar in ${uniform} at ${name} with success context (customers visible in background), ${name} signage visible, warm mouth-closed smile, anatomy correct, no phone", "subtitle": "same as voiceover_scene4" }
  ]
}${extra}` }],
  })

  const parseResponse = (message) => {
    const text = message.content?.[0]?.text || ''
    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      const v1 = parsed.voiceover_scene1 || ''
      const v2 = parsed.voiceover_scene2 || ''
      const v3 = parsed.voiceover_scene3 || ''
      const v4 = parsed.voiceover_scene4 || ''
      parsed.voiceover = joinVoiceoverChunks([v1, v2, v3, v4])
      if (parsed.scenes) {
        parsed.scenes[0].subtitle = v1
        parsed.scenes[1].subtitle = v2
        parsed.scenes[2].subtitle = v3
        parsed.scenes[3].subtitle = v4
      }
      return parsed
    } catch { return null }
  }

  let parsed = parseResponse(await callClaude())
  if (parsed && scriptGenderMismatch(parsed.voiceover, voiceGender)) {
    const extra = `\n\nPREVIOUS ATTEMPT HAD WRONG GENDER. ${genderInstruction}`
    const retry = parseResponse(await callClaude(extra))
    if (retry) parsed = retry
  }
  if (parsed && scenesHaveBrokenSentences(parsed.scenes)) {
    const extra = `\n\nPREVIOUS ATTEMPT HAD SENTENCES SPLIT ACROSS SCENES. REWRITE so each voiceover_sceneN is a SELF-CONTAINED Hebrew sentence ending with . ? or !.`
    const retry = parseResponse(await callClaude(extra))
    if (retry) parsed = retry
  }
  return parsed
}
