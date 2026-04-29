import Anthropic from '@anthropic-ai/sdk'
import { checkRateLimit } from '../middleware/rateLimit.js'
import { validateProductInput, sanitizeForLLM } from '../middleware/validate.js'
import { cleanHebrewText } from '../../../lib/hebrew-tts.js'
import { generateVideo as byteplusGenerateVideo, isByteplusConfigured } from '../../../lib/byteplus-client.js'

export async function POST(req) {
  // Rate limiting
  const rateLimitRes = await checkRateLimit(req, 'general')
  if (rateLimitRes) return rateLimitRes

  const req_data = await req.json()
  const { avatarUrl, productImageUrl, businessType, voiceId: requestedVoiceId } = req_data
  const isBusiness = businessType === 'business'

  // Input validation
  const validation = validateProductInput({
    productName: req_data.productName,
    product: req_data.product,
    applicationArea: req_data.applicationArea,
    storyDescription: req_data.storyDescription,
  })
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 })
  }

  const { productName: rawProductName, product, applicationArea, storyDescription } = validation.data

  // Server-side keys ONLY — never from client
  const falKey = process.env.FAL_API_KEY || ''
  const elevenKey = process.env.ELEVENLABS_API_KEY || ''
  const voiceId = requestedVoiceId || process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'

  // ── Voice → gender mapping ──
  // nBiC8Jexp2XGyIxATg9S = Daniel (male), cp6q5qJLs8rR7eAWOepf = Noa (female)
  const MALE_VOICE_IDS = new Set(['nBiC8Jexp2XGyIxATg9S'])
  const FEMALE_VOICE_IDS = new Set(['cp6q5qJLs8rR7eAWOepf'])
  const voiceGender = MALE_VOICE_IDS.has(voiceId)
    ? 'male'
    : FEMALE_VOICE_IDS.has(voiceId)
      ? 'female'
      : 'female'
  const isMale = voiceGender === 'male'

  const byteplusReady = isByteplusConfigured()
  console.log('Keys available:', { hasFal: !!falKey, hasEleven: !!elevenKey, hasByteplus: byteplusReady, voiceId, voiceGender })

  const pName = rawProductName || 'המוצר'
  const pUse = applicationArea || 'מורחים על האזור הבעייתי'

  // If avatar is base64 data URL, upload it to fal first
  let finalAvatarUrl = avatarUrl
  if (avatarUrl && avatarUrl.startsWith('data:')) {
    try {
      const [header, base64] = avatarUrl.split(',')
      const mime = header.match(/:(.*?);/)[1]
      const binaryStr = atob(base64)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
      const blob = new Blob([bytes], { type: mime })
      const fd = new FormData()
      fd.append('file', blob, 'avatar.jpg')
      const upRes = await fetch('https://fal.run/fal-ai/storage/upload', {
        method: 'POST',
        headers: { 'Authorization': `Key ${falKey}` },
        body: fd
      })
      if (upRes.ok) {
        const upData = await upRes.json()
        finalAvatarUrl = upData.url || upData.access_url
        console.log('Avatar uploaded to fal:', finalAvatarUrl?.slice(0,50))
      }
    } catch(e) {
      console.error('Avatar upload failed:', e.message)
    }
  }

  console.log('Agent started:', { productName: rawProductName, applicationArea, hasAvatar: !!finalAvatarUrl, isDataUrl: avatarUrl?.startsWith('data:'), hasProduct: !!productImageUrl })

  // ── Gender instruction for the Hebrew script ──
  const grammarNote = `GRAMMAR NOTE (CRITICAL): 'מביכה' is an ACTIVE PARTICIPLE meaning 'embarrassing' (describes something that causes embarrassment) — it does NOT mean 'was embarrassed'. NEVER write 'הייתי מביכה' (that would mean 'I was an embarrassing thing'). Correct passive forms: 'הייתי מובכת' (female, 'I was embarrassed') / 'הייתי מובך' (male, 'I was embarrassed').`
  const genderInstruction = isMale
    ? `GENDER (CRITICAL — MALE SPEAKER): כתוב את כל הקריינות בלשון זכר בלבד. דוגמאות: 'הייתי מובך' (לא 'מביכה'), 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוח', 'אני חייב', 'התאכזבתי', 'האמנתי', 'מחפש' (לא 'מחפשת'), 'מרוצה' (זכר), 'מוכן', 'משתמש'. כל פועל, תואר וכינוי חייב להיות בלשון זכר. הדובר הוא גבר.\n${grammarNote}`
    : `GENDER (CRITICAL — FEMALE SPEAKER): כתוב את כל הקריינות בלשון נקבה בלבד. דוגמאות: 'הייתי מובכת' (לא 'הייתי מביכה'), 'הרגשתי', 'ניסיתי', 'גיליתי', 'אני בטוחה', 'אני חייבת', 'התאכזבתי', 'האמנתי', 'מחפשת' (לא 'מחפש'), 'מרוצה' (נקבה), 'מוכנה', 'משתמשת'. כל פועל, תואר וכינוי חייב להיות בלשון נקבה. הדוברת היא אישה.\n${grammarNote}`

  const transitionRule = `TRANSITION RULE (CRITICAL): Scene 1 MUST end with unresolved emotion (frustration, disappointment, longing) — no product mentioned, no resolution. Scene 2 MUST start with a discovery phrase (one of: "עד שגיליתי", "ואז גיליתי", "חברה הכירה", "פעם אחת ניסיתי", "מצאתי את", "גיליתי את") BEFORE mentioning the product. Never jump directly from pain to product description.`

  // ── Gender validator: detect mismatches in a generated script ──
  const MALE_ONLY_PATTERNS = [
    /\bמובך\b/, /\bבטוח\b/, /\bחייב\b/, /\bמחפש\b/, /\bמוכן\b/, /\bמשתמש\b/, /\bהייתי מובך\b/
  ]
  const FEMALE_ONLY_PATTERNS = [
    /\bמובכת\b/, /\bבטוחה\b/, /\bחייבת\b/, /\bמחפשת\b/, /\bמוכנה\b/, /\bמשתמשת\b/, /\bהייתי מובכת\b/,
    /\bמרוצה אני\b/, /\bהתאכזבתי.*?אני.*?מחפשת\b/
  ]
  // Patterns that are grammatically WRONG for a female speaker (active participle misuse)
  const FEMALE_WRONG_PATTERNS = [
    /הייתי מביכה/,
    /הייתי מבייש/,
    /מביכה לחייך/,
    /מביכה לי/
  ]
  // Auto-correction map: wrong form → correct form. Applied BEFORE validator runs
  // so obvious grammar slips get repaired without a round-trip to Claude.
  const FEMALE_AUTO_CORRECTIONS = [
    [/הייתי מביכה/g, 'הייתי מובכת'],
    [/הייתי מבולבל\b/g, 'הייתי מבולבלת'],
    [/הייתי נבוך\b/g, 'הייתי נבוכה'],
    [/מביכה לחייך/g, 'מובכת לחייך'],
    [/מביכה לי/g, 'מובכת לי']
  ]
  const applyFemaleAutoCorrections = (text) => {
    if (!text) return text
    let out = text
    for (const [re, rep] of FEMALE_AUTO_CORRECTIONS) out = out.replace(re, rep)
    return out
  }
  const hasFeminineMarkers = (text) => {
    if (!text) return false
    return FEMALE_ONLY_PATTERNS.some(re => re.test(text))
  }
  const hasMasculineMarkers = (text) => {
    if (!text) return false
    return MALE_ONLY_PATTERNS.some(re => re.test(text))
  }
  const hasFemaleWrongForms = (text) => {
    if (!text) return false
    return FEMALE_WRONG_PATTERNS.some(re => re.test(text))
  }
  // Normalize storyObj in place: repair known-wrong female forms before checking.
  const autoFixFemaleWrongForms = (storyObj) => {
    if (!storyObj) return
    if (typeof storyObj.hebrew_voice === 'string') {
      storyObj.hebrew_voice = applyFemaleAutoCorrections(storyObj.hebrew_voice)
    }
    if (Array.isArray(storyObj.scenes)) {
      for (const sc of storyObj.scenes) {
        if (typeof sc.voiceover === 'string') sc.voiceover = applyFemaleAutoCorrections(sc.voiceover)
      }
    }
  }
  const scriptGenderMismatch = (storyObj) => {
    if (!storyObj?.hebrew_voice) return false
    const fullText = storyObj.hebrew_voice + ' ' + (storyObj.scenes || []).map(s => s.voiceover || '').join(' ')
    // Always check wrong female forms (active-participle misuse), even for male speakers
    const wrongForms = hasFemaleWrongForms(fullText)
    const maleMismatch = isMale && hasFeminineMarkers(fullText)
    const femaleMismatch = !isMale && hasMasculineMarkers(fullText)
    const mismatch = wrongForms || maleMismatch || femaleMismatch
    console.log(`[Gender Check] voice: ${voiceGender} | wrongForms: ${wrongForms} | maleMismatch: ${maleMismatch} | femaleMismatch: ${femaleMismatch} | mismatch: ${mismatch}`)
    return mismatch
  }

  // ── Discovery-transition validator ──
  // Scene 2 must start with a discovery phrase; Scene 1 must not name the product category.
  const DISCOVERY_PHRASES = [
    'עד שגיליתי', 'ואז גיליתי', 'חברה הכירה', 'פעם אחת ניסיתי', 'מצאתי את', 'גיליתי את'
  ]
  const productCategoryWord = (product || '').split(/\s+/).filter(Boolean)[0] || ''
  const scriptHasDiscoveryTransition = (storyObj) => {
    if (!storyObj?.scenes || storyObj.scenes.length < 2) return true
    const scene1 = (storyObj.scenes[0]?.voiceover || '').trim()
    const scene2 = (storyObj.scenes[1]?.voiceover || '').trim()
    const scene2StartsOk = DISCOVERY_PHRASES.some(p => scene2.startsWith(p))
    if (!scene2StartsOk) return false
    if (productCategoryWord && scene1.includes(productCategoryWord)) return false
    return true
  }

  // ── STEP 1: Claude writes the full story ──
  let story = null
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const promptContent = isBusiness
            ? `You are a UGC ad director and AI video prompt engineer for LOCAL BUSINESSES and SERVICES.
Create a CONNECTED 4-scene TikTok story for: ${pName} - ${product}. What customers get: ${pUse}

The 4 scenes must feel like ONE continuous TikTok story.

${genderInstruction}

${transitionRule}

ANATOMY RULE (CRITICAL): Every nb_prompt MUST START with: "CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body." AND MUST include: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body". Avoid describing hands holding multiple items — ONE item at a time max.

HOOK RULE (CRITICAL): voiceover_scene1 MUST name the EXACT specific craving/need of THIS business — never use 'הבעיה הזאת' alone. Be specific: for restaurant say 'חיפשתי מקום עם שווארמה אמיתית כבר חודשים', for salon say 'תמיד יצאתי מאוכזבת מתספורות'. Be specific to the business.

${storyDescription ? `STORY OVERRIDE (MANDATORY): ${storyDescription} — You MUST change scenes to match. Scene 4 must be exactly: ${storyDescription}. This overrides ALL default settings.` : ''}

SCENE DURATIONS = [5, 5, 5, 5] = 20 seconds total.

WINNING FORMULA FOR BUSINESS:
Scene 1 CRAVING (0-5s): Customer looking frustrated, craving/needing the service. Authentic expression. No business visible yet. iPhone street style.
Scene 2 HERO SHOT (5-10s): Beautiful close-up of the food/service/product offering. Steam/movement/detail shot. TikTok food/service creator style. No person needed — hero shot of the offering.
Scene 3 EXPERIENCE (10-15s): Person experiencing/enjoying the service. Authentic reaction, genuine happiness. Mid-experience candid moment.
Scene 4 CTA (15-20s): Satisfied customer talking directly to camera, pointing at place/product. Genuine excited recommendation. "You need to try this" energy. TikTok style.

NB PROMPT RULES (CRITICAL — follow for EVERY nb_prompt):
1. Character description: age range, hair color/style, clothing, body type
2. Specific environment: exact location with background details (street, counter, table, etc.)
3. Exact action: what the person is doing in this frame
4. Photography style: "iPhone handheld" / "ring light from front" / "natural daylight"
5. Expression: specific facial expression and energy
6. MUST end with: "no text overlay, no captions, no watermark, no brand name or writing on product"
7. MUST end with: "vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"
8. MUST include: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body"

For EACH scene, write:
1. Nano Banana prompt (50 words max): Follow ALL NB PROMPT RULES above. Scenes 1,3,4 start with "same person from reference photo". Scene 2 is a hero shot — no person needed.
2. Kling prompt (35 words max): MOTION ONLY — how the person moves/feels. Scenes 3-4 start with "Continuing from previous scene same person". Scene 2 describes food/product motion (steam rising, sauce dripping, etc.). End with "then settles".
3. Hebrew subtitle (max 12 words): What appears on screen for this scene

Hebrew voiceover: ONE monologue exactly 20 seconds long, mentions ${pName} by name, casual Israeli friend, craving→FAILED ATTEMPTS→discovery→experience→recommendation, ONLY Hebrew.

SCRIPT FLOW RULES (CRITICAL — the monologue MUST follow this arc):
- Scene 1 (craving): describe the frustration, end with a CLIFFHANGER or unsolved problem. Examples: "ונגמר הערב בפלאפל...", "וכל פעם יצאתי מאוכזבת...", "וכל מקום שניסיתי היה אותו דבר...". NEVER say ${pName} in scene 1. NEVER end scene 1 with the business name.
- Scene 2 (discovery): MUST start with a discovery transition phrase — one of: "ואז גיליתי את...", "עד שחבר המליץ לי על...", "פעם אחת ניסיתי את...", "ואז מישהו סיפר לי על...". THEN mention ${pName}. Never jump straight to the name without a transition.
- Scene 3 (experience): describe the actual experience — what made it amazing, specific details.
- Scene 4 (CTA): direct recommendation, "אתם חייבים לנסות".
- The flow MUST feel like: Problem → Failed attempts → Discovery → Love it → CTA. Natural storytelling, not a jump-cut.

PUNCTUATION RULES (CRITICAL):
1. Every scene voiceover MUST end with a period (.) or exclamation mark (!).
2. Within a scene, add commas after natural pause points: after transition phrases like "עד שגיליתי,", "ואז גיליתי,", "פעם אחת,"; before connectors "אבל", "כי", "אז", "ולכן"; between independent clauses.
3. Each scene = 1–2 COMPLETE sentences with proper punctuation, NOT fragments.
4. כל סצנה חייבת להסתיים בנקודה (.) או סימן קריאה (!). הוסף פסיקים (,) בנקודות עצירה טבעיות - אחרי 'עד שגיליתי', לפני 'אבל', 'כי', 'אז'. כל סצנה = 1-2 משפטים שלמים עם ניקוד נכון.

VOICEOVER WORD COUNT (CRITICAL): Scene 1: ~8 words, Scene 2: ~8 words, Scene 3: ~16 words, Scene 4: ~8 words = total ~40 words = 20 seconds.

Return ONLY JSON:
{
  "scenes": [
    { "id": 1, "label": "😩 צורך", "nb_prompt": "same person from reference photo ...", "kling_prompt": "...", "subtitle": "...", "voiceover": "scene 1 chunk of the monologue" },
    { "id": 2, "label": "🍽️ הירו שוט", "nb_prompt": "...", "kling_prompt": "...", "subtitle": "...", "voiceover": "scene 2 chunk starting with discovery phrase then ${pName}" },
    { "id": 3, "label": "😍 חוויה", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "...", "voiceover": "scene 3 chunk" },
    { "id": 4, "label": "🚀 המלצה", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "...", "voiceover": "scene 4 chunk" }
  ],
  "hebrew_voice": "concatenation of the 4 scene voiceover chunks exactly, no extra words"
}`
            : `You are a UGC ad director and AI video prompt engineer.
Create a CONNECTED 4-scene TikTok story for: ${pName} - ${product}. Usage: ${pUse}

The 4 scenes must feel like ONE continuous story with the SAME person in the SAME setting.

${genderInstruction}

${transitionRule}

ANATOMY RULE (CRITICAL): Every nb_prompt MUST START with: "CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body." AND MUST include: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body". For scenes where hands hold the product, say explicitly: "person holding product with ONE hand only, other hand visible and relaxed at side". Never describe multiple items held simultaneously.

HOOK RULE (CRITICAL): voiceover_scene1 MUST name the EXACT specific problem of THIS product — never use 'הבעיה הזאת' alone without naming what the problem is. Examples: for teeth whitening say 'שיניים צהובות שמביכות אותי בכל תמונה', for face cream say 'כתמים ואקנה שמופיעים כל בוקר', for dress say 'לא מוצאת שמלה שמחמיאה לדמות שלי'. Be specific to the product.

${storyDescription ? `STORY OVERRIDE (MANDATORY): ${storyDescription} — You MUST change scenes to match. Scene 4 must be exactly: ${storyDescription}. This overrides ALL default settings.` : ''}

SCENE DURATIONS = [5, 5, 5, 5] = 20 seconds total.

WINNING FORMULA:
Scene 1 PAIN (0-5s): Person frustrated with the exact problem ${pName} solves. Strong hook.
Scene 2 DISCOVERY (5-10s): Same person discovers ${pName}, holds it up to camera. Label visible.
Scene 3 ACTIVE USE (10-15s): Same person ${pUse} - actively using the product. Showing result.
Scene 4 CTA (15-20s): Same person excited, holds ${pName} up, points at camera. No-risk vibe.

NB PROMPT RULES (CRITICAL — follow for EVERY nb_prompt):
1. Character description: age range, hair color/style, clothing, body type
2. Specific environment: exact location with background details (bathroom mirror, vanity, shelf, etc.)
3. Exact action: what the person is doing with the product
4. Photography style: "iPhone handheld" / "ring light from front" / "natural daylight"
5. Expression: specific facial expression and energy
6. MUST end with: "no text overlay, no captions, no watermark, no brand name or writing on product"
7. MUST end with: "vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"
8. MUST include: "exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body"

Example nb_prompt style:
Scene 2: "same person from reference photo, holding product up toward camera with both hands, direct eye contact, authentic excited expression, ring light from front, shot on iPhone, slightly imperfect handheld, exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, no text overlay, no captions, no watermark, no brand name or writing on product, vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"
Scene 3: "same person from reference photo, actively using product mid-action, candid authentic moment, natural setting appropriate for product type, exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, no text overlay, no captions, no watermark, no brand name or writing on product, vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"
Scene 4: "same person from reference photo, genuine happy smile showing result, touching face/wearing product naturally, warm lighting, eye contact with camera, exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body, no text overlay, no captions, no watermark, no brand name or writing on product, vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"

For EACH scene, write:
1. Nano Banana prompt (50 words max): Follow ALL NB PROMPT RULES above. Start scenes 2-4 with "same person from reference photo".
2. Kling prompt (35 words max): MOTION ONLY - how the person moves/feels. Scenes 2-4 start with "Continuing from previous scene same person". End with "then settles".
3. Hebrew subtitle (max 12 words): What appears on screen for this scene

Hebrew voiceover: ONE monologue exactly 20 seconds long, mentions ${pName} by name, casual Israeli friend, pain→FAILED ATTEMPTS→discovery→result→CTA, ONLY Hebrew.

SCRIPT FLOW RULES (CRITICAL — the monologue MUST follow this arc):
- Scene 1 (pain): describe the specific problem AND mention you already tried other things that failed. End with a CLIFFHANGER or unsolved problem. Examples: "...וכלום לא עזר", "...וכבר איבדתי תקווה", "...אבל כל בוקר אותו סיפור". NEVER say ${pName} in scene 1. NEVER end scene 1 with the product name.
- Scene 2 (discovery): MUST start with a discovery transition phrase — one of: "ואז גיליתי את...", "עד שחבר המליץ לי על...", "פעם אחת ניסיתי את...", "ואז מישהו סיפר לי על...". THEN mention ${pName}. Never jump straight to the product name without a transition.
- Scene 3 (result): describe actively using the product and the result — specific, believable.
- Scene 4 (CTA): direct recommendation, "אתם חייבים לנסות".
- The flow MUST feel like: Problem → Failed attempts → Discovery → Love it → CTA. Natural storytelling, not a jump-cut.

PUNCTUATION RULES (CRITICAL):
1. Every scene voiceover MUST end with a period (.) or exclamation mark (!).
2. Within a scene, add commas after natural pause points: after transition phrases like "עד שגיליתי,", "ואז גיליתי,", "פעם אחת,"; before connectors "אבל", "כי", "אז", "ולכן"; between independent clauses.
3. Each scene = 1–2 COMPLETE sentences with proper punctuation, NOT fragments.
4. כל סצנה חייבת להסתיים בנקודה (.) או סימן קריאה (!). הוסף פסיקים (,) בנקודות עצירה טבעיות - אחרי 'עד שגיליתי', לפני 'אבל', 'כי', 'אז'. כל סצנה = 1-2 משפטים שלמים עם ניקוד נכון.

VOICEOVER WORD COUNT (CRITICAL): Scene 1: ~8 words, Scene 2: ~8 words, Scene 3: ~16 words, Scene 4: ~8 words = total ~40 words = 20 seconds. voiceover MUST fill the full duration — write enough words to fill each scene completely, do not leave silence.

Return ONLY JSON:
{
  "scenes": [
    { "id": 1, "label": "😟 כאב", "nb_prompt": "...", "kling_prompt": "...", "subtitle": "...", "voiceover": "scene 1 chunk of the monologue (no product name, ends with cliffhanger)" },
    { "id": 2, "label": "💡 גילוי", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "...", "voiceover": "scene 2 chunk starting with discovery phrase then ${pName}" },
    { "id": 3, "label": "✨ שימוש", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "...", "voiceover": "scene 3 chunk" },
    { "id": 4, "label": "🚀 CTA", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "...", "voiceover": "scene 4 chunk" }
  ],
  "hebrew_voice": "concatenation of the 4 scene voiceover chunks exactly, no extra words"
}`
      // Try up to 3 times — regenerate if gender mismatch OR discovery transition missing
      let attempts = 0
      let currentPrompt = promptContent
      while (attempts < 3) {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: currentPrompt }]
        })
        const rawText = message.content[0].text.trim().replace(/```json|```/g, '')
        console.log('Claude response:', rawText.slice(0, 500))
        const parsed = JSON.parse(rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1))
        // Apply auto-corrections for the most common feminine misconjugation before we validate.
        autoFixFemaleWrongForms(parsed)
        const genderBad = scriptGenderMismatch(parsed)
        const transitionBad = !scriptHasDiscoveryTransition(parsed)
        if (!genderBad && !transitionBad) {
          story = parsed
          break
        }
        if (genderBad) console.warn(`Gender mismatch detected on attempt ${attempts + 1}, regenerating...`)
        if (transitionBad) console.warn(`Discovery transition missing on attempt ${attempts + 1}, regenerating...`)
        attempts++
        const corrections = []
        if (genderBad) corrections.push(`PREVIOUS ATTEMPT HAD WRONG GENDER OR WRONG GRAMMAR. The previous script used 'הייתי מביכה' (or a similar active-participle form) which is WRONG. 'מביכה' is an active participle meaning 'embarrassing others' or 'causes embarrassment' — it is NOT 'was embarrassed'. For 'I was embarrassed (female)' use 'הייתי מובכת'. For male use 'הייתי מובך'. Rewrite the ENTIRE script with correct ${isMale ? 'masculine' : 'feminine'} past-tense forms. ${genderInstruction}\nREWRITE every verb, adjective, and pronoun to match the speaker's gender (${isMale ? 'male/זכר' : 'female/נקבה'}). Do NOT mix genders. Verify every single word. ${grammarNote}`)
        if (transitionBad) corrections.push(`PREVIOUS ATTEMPT FAILED THE TRANSITION RULE. Scene 1 voiceover MUST NOT mention the product category word "${productCategoryWord}" or the product name, and MUST end with unresolved emotion. Scene 2 voiceover MUST START with one of exactly: "עד שגיליתי", "ואז גיליתי", "חברה הכירה", "פעם אחת ניסיתי", "מצאתי את", "גיליתי את" — BEFORE any product mention. Rewrite scenes 1 and 2 accordingly.`)
        currentPrompt = `${promptContent}\n\n${corrections.join('\n\n')}`
        story = parsed // keep in case next attempt fails
      }
      // Final safety net: even if we exhausted retries, apply auto-corrections to the last attempt.
      if (story) autoFixFemaleWrongForms(story)
    } catch (e) {
      console.error('Claude SDK error:', e.message)
      /* use fallback */
    }
  }

  // Fallback story if Claude unavailable
  if (!story) {
    const anatomyPrefix = 'CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body.'
    const anatomyRule = 'exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body'
    const noText = 'no text overlay, no captions, no watermark, no brand name or writing on product'
    const format = 'vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic'
    const personDesc = isMale ? 'young man mid-20s' : 'young woman mid-20s'

    if (isBusiness) {
      const vo1 = isMale
        ? `אני כבר חודשים מחפש מקום טוב באמת. ניסיתי המון ותמיד התאכזבתי`
        : `אני כבר חודשים מחפשת מקום טוב באמת. ניסיתי המון ותמיד התאכזבתי`
      const vo2 = isMale
        ? `עד שחבר המליץ לי על ${pName} ואמרתי יאללה ננסה`
        : `עד שחברה המליצה לי על ${pName} ואמרתי יאללה ננסה`
      const vo3 = isMale
        ? `אני אגיד לכם — מהרגע הראשון הבנתי שזה ברמה אחרת לגמרי. ${pUse}. אין מילים`
        : `אני אגיד לכם — מהרגע הראשון הבנתי שזה ברמה אחרת לגמרי. ${pUse}. אין מילים`
      const vo4 = `אתם חייבים לנסות את ${pName}, תגיעו ותגידו לי אחר כך`
      story = {
        scenes: [
          {
            id: 1, label: '😩 צורך',
            nb_prompt: `${anatomyPrefix} same person from reference photo, ${personDesc} walking on busy street looking at phone disappointed, casual outfit jeans and t-shirt, crowded sidewalk with shops in background, searching expression frustrated, iPhone handheld street style, natural daylight, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Person walks slowly looking at phone sighs with disappointment looks around searching, handheld camera slight shake natural street sounds then settles`,
            subtitle: isMale ? `כבר חודשים שאני מחפש מקום טוב` : `כבר חודשים שאני מחפשת מקום טוב`,
            voiceover: vo1
          },
          {
            id: 2, label: '🍽️ הירו שוט',
            nb_prompt: `beautiful close-up hero shot of the food or service offering from ${pName}, steam rising, vibrant colors, professional food photography style, warm golden lighting, shallow depth of field, appetizing details visible, TikTok food creator style, ${noText}, ${format}`,
            kling_prompt: `Steam rising slowly from food, gentle camera push-in revealing details, warm light catching textures, slight movement of fresh ingredients then settles`,
            subtitle: `${pName} — פשוט ברמה אחרת`,
            voiceover: vo2
          },
          {
            id: 3, label: '😍 חוויה',
            nb_prompt: `${anatomyPrefix} same person from reference photo, sitting at table experiencing ${pName} for the first time, eyes wide genuine amazement, mid-bite or mid-experience candid moment, warm interior lighting, cozy restaurant atmosphere in background, authentic happiness, iPhone handheld, person holding utensil with ONE hand only other hand visible and relaxed, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person takes first bite or experiences service, eyes light up with genuine surprise, nods approvingly with amazed expression then settles`,
            subtitle: `אוקיי וואו זה טעים ברמות`,
            voiceover: vo3
          },
          {
            id: 4, label: '🚀 המלצה',
            nb_prompt: `${anatomyPrefix} same person from reference photo, standing outside ${pName} pointing at the place behind with ONE hand only other hand relaxed at side, talking directly to camera with excited genuine recommendation smile, golden hour warm lighting, iPhone selfie style, enthusiastic energy, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person points enthusiastically at place behind, looks at camera with big excited smile, gestures with hands recommending then settles`,
            subtitle: `אתם חייבים לנסות את ${pName}!`,
            voiceover: vo4
          }
        ],
        hebrew_voice: `${vo1}. ${vo2}. ${vo3}. ${vo4}.`
      }
    } else {
      const personDescProduct = isMale
        ? 'frustrated young man mid-20s with short hair in a plain t-shirt'
        : 'frustrated young woman mid-20s with messy bun hair in oversized t-shirt'
      const vo1 = isMale
        ? `אתם לא מאמינים כמה זמן בזבזתי על הבעיה הזאת. ניסיתי הכל ושום דבר לא עבד`
        : `אתם לא מאמינים כמה זמן בזבזתי על הבעיה הזאת. ניסיתי הכל ושום דבר לא עבד`
      const vo2 = isMale
        ? `עד שמישהו המליץ לי על ${pName} ולא הכרתי אותו בכלל`
        : `עד שמישהו המליץ לי על ${pName} ולא הכרתי אותו בכלל`
      const vo3 = isMale
        ? `התחלתי להשתמש, ${pUse}, ופשוט לא האמנתי לתוצאות. שבוע אחד ואני לגמרי מרוצה`
        : `התחלתי להשתמש, ${pUse}, ופשוט לא האמנתי לתוצאות. שבוע אחד ואני לגמרי מרוצה`
      const vo4 = `אין לכם מה להפסיד, פשוט תנסו את ${pName}`
      story = {
        scenes: [
          {
            id: 1, label: '😟 כאב',
            nb_prompt: `${anatomyPrefix} ${personDescProduct}, standing in front of bathroom mirror, stressed expression hand on forehead, white tile bathroom with morning natural daylight from window, iPhone handheld selfie style, slightly imperfect framing, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Person sighs looks at mirror frustrated shakes head overwhelmed, slight camera shake handheld iPhone natural light then settles`,
            subtitle: `כל כך נמאס לי מהבעיה הזאת`,
            voiceover: vo1
          },
          {
            id: 2, label: '💡 גילוי',
            nb_prompt: `${anatomyPrefix} same person from reference photo, holding ${pName} box up toward camera with ONE hand only label facing forward other hand visible and relaxed at side, direct eye contact, authentic excited curious expression, ring light from front, shot on iPhone slightly imperfect handheld, bathroom counter with products in background, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person picks up ${pName} reads label eyes widen with curiosity holds it toward camera then settles`,
            subtitle: isMale ? `מצאתי את ${pName} ולא האמנתי` : `מצאתי את ${pName} ולא האמנתי`,
            voiceover: vo2
          },
          {
            id: 3, label: '✨ שימוש',
            nb_prompt: `${anatomyPrefix} same person from reference photo, actively using ${pName} mid-action ${pUse} with ONE hand only other hand visible and relaxed, candid authentic moment, genuine amazed expression looking at mirror, natural bathroom setting with warm lighting, close-up showing application detail, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person ${pUse} carefully shows process to camera touches treated area with surprised satisfied reaction then settles`,
            subtitle: `שבוע אחד ולא האמנתי לתוצאות`,
            voiceover: vo3
          },
          {
            id: 4, label: '🚀 CTA',
            nb_prompt: `${anatomyPrefix} same person from reference photo, genuine happy smile showing result, holding ${pName} up confidently with ONE hand only other hand relaxed at side, warm bathroom lighting, eye contact with camera, excited grateful energy, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person holds ${pName} up points directly at camera with big excited smile thumbs up enthusiastic energy then settles`,
            subtitle: `תנסו את ${pName} — יש אחריות מלאה!`,
            voiceover: vo4
          }
        ],
        hebrew_voice: `${vo1}. ${vo2}. ${vo3}. ${vo4}.`
      }
    }
  }

  // Ensure every scene has a voiceover chunk (fall back to subtitle).
  // This keeps the per-scene re-record editor working even if Claude
  // returned the old schema without the voiceover field.
  if (story?.scenes) {
    for (const sc of story.scenes) {
      if (!sc.voiceover || typeof sc.voiceover !== 'string') {
        sc.voiceover = sc.subtitle || ''
      }
    }
  }

  // ── STEP 2: Nano Banana — תמונת אווטאר + מוצר עם פרומפט נכון ──
  // generateNBFrame: primary generator with 8 retries on network errors,
  // limited retries (≤2) on 4xx, and a flux/schnell text-to-image fallback
  // after 4 failed primary attempts. Per-attempt 90s AbortController timeout.
  // Returns { url, source } where source ∈ 'primary' | 'fallback' | 'placeholder'.
  const jobId = Math.random().toString(36).slice(2, 8)
  const NETWORK_RETRY_DELAYS_MS = [2000, 4000, 8000, 12000, 16000, 20000, 25000, 30000] // 8 attempts
  const MAX_NETWORK_ATTEMPTS = NETWORK_RETRY_DELAYS_MS.length
  const MAX_4XX_ATTEMPTS = 2

  const isNetworkError = (e) => {
    const msg = e?.message || ''
    return msg.includes('fetch failed')
      || e?.name === 'AbortError'
      || e?.code === 'ECONNRESET'
      || e?.code === 'ETIMEDOUT'
      || !!e?.cause
  }

  async function callNBPrimary(i, nbPrompt, imageUrls) {
    let networkAttempts = 0
    let clientAttempts = 0
    while (networkAttempts < MAX_NETWORK_ATTEMPTS && clientAttempts < MAX_4XX_ATTEMPTS) {
      const attemptLabel = `${networkAttempts + 1}/${MAX_NETWORK_ATTEMPTS}`
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 90000)
      try {
        const nbRes = await fetch('https://fal.run/fal-ai/nano-banana-2/edit', {
          method: 'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: nbPrompt,
            image_urls: imageUrls,
            aspect_ratio: '9:16',
            num_images: 1
          }),
          signal: ac.signal
        })
        clearTimeout(timer)
        if (nbRes.ok) {
          const d = await nbRes.json()
          const url = d.images?.[0]?.url || d.images?.[0]
          if (url) return url
          console.error(`[NB scene ${i+1}] attempt ${attemptLabel}: empty response`)
          networkAttempts++
        } else {
          const err = await nbRes.text()
          if (nbRes.status >= 400 && nbRes.status < 500) {
            clientAttempts++
            console.error(`[NB scene ${i+1}] attempt ${networkAttempts + 1}/${MAX_NETWORK_ATTEMPTS}: client error ${nbRes.status} (${clientAttempts}/${MAX_4XX_ATTEMPTS}) — ${err.slice(0,100)}`)
          } else {
            networkAttempts++
            console.error(`[NB scene ${i+1}] attempt ${attemptLabel}: server error ${nbRes.status} — ${err.slice(0,100)}`)
          }
        }
      } catch (e) {
        clearTimeout(timer)
        if (isNetworkError(e)) {
          console.error(`[NB scene ${i+1}] attempt ${attemptLabel}: network error (${e.message || e.name}), retrying...`)
          networkAttempts++
        } else {
          console.error(`[NB scene ${i+1}] attempt ${attemptLabel}: non-retryable exception — ${e?.message}`)
          break
        }
      }
      const totalAttempts = networkAttempts + clientAttempts
      if (totalAttempts < MAX_NETWORK_ATTEMPTS && networkAttempts > 0) {
        const wait = NETWORK_RETRY_DELAYS_MS[Math.min(networkAttempts - 1, MAX_NETWORK_ATTEMPTS - 1)]
        console.log(`[NB scene ${i+1}] attempt ${networkAttempts}/${MAX_NETWORK_ATTEMPTS}: retrying in ${Math.round(wait/1000)}s...`)
        await new Promise(r => setTimeout(r, wait))
      }
    }
    return null
  }

  async function callFluxFallback(i, textPrompt) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 90000)
    try {
      console.log(`[NB scene ${i+1}] falling back to fal-ai/flux/schnell text-to-image`)
      const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textPrompt,
          image_size: 'portrait_16_9',
          num_images: 1,
          num_inference_steps: 4
        }),
        signal: ac.signal
      })
      clearTimeout(timer)
      if (res.ok) {
        const d = await res.json()
        const url = d.images?.[0]?.url || d.images?.[0]
        if (url) return url
      } else {
        const err = await res.text()
        console.error(`[NB scene ${i+1}] flux fallback failed: ${res.status} — ${err.slice(0,100)}`)
      }
    } catch (e) {
      clearTimeout(timer)
      console.error(`[NB scene ${i+1}] flux fallback exception: ${e?.message}`)
    }
    return null
  }

  const frameSources = [] // 'primary' | 'fallback' | 'placeholder'
  async function generateNBFrame(i, nbPrompt, imageUrls, placeholder) {
    const primaryUrl = await callNBPrimary(i, nbPrompt, imageUrls)
    if (primaryUrl) {
      console.log(`[Job ${jobId}] [NB scene ${i+1}] OK from PRIMARY (nano-banana-2)`)
      frameSources[i] = 'primary'
      return primaryUrl
    }
    const fluxUrl = await callFluxFallback(i, nbPrompt)
    if (fluxUrl) {
      console.log(`[Job ${jobId}] [NB scene ${i+1}] OK from FALLBACK (flux/schnell)`)
      frameSources[i] = 'fallback'
      return fluxUrl
    }
    console.error(`[Job ${jobId}] [NB scene ${i+1}] all sources exhausted, using placeholder`)
    frameSources[i] = 'placeholder'
    return placeholder
  }

  const frames = []
  for (let i = 0; i < 4; i++) {
    // 500ms spacing between sequential frames to avoid hammering the API
    if (i > 0) await new Promise(r => setTimeout(r, 500))
    try {
      // For business scene 2 (hero shot) — user's reference image is the MAIN image.
      // We want NanoBanana to stay faithful to the reference, not invent a new AI-looking shot.
      const isHeroShot = isBusiness && i === 1
      const imageUrls = isHeroShot
        ? (productImageUrl ? [productImageUrl] : [finalAvatarUrl])
        : [finalAvatarUrl]
      if (!isHeroShot && productImageUrl && i >= 1) imageUrls.push(productImageUrl)

      // פרומפט עם הוראות עקביות לפי מה שNano Banana מבין
      const hasProduct = !isHeroShot && i >= 1 && productImageUrl
      const anatomyPrefix = 'CRITICAL ANATOMY: exactly one person in the frame with exactly two arms and two hands, no extra limbs, no disembodied hands, no third arm, no floating hands, no hands appearing from outside the frame, no partial limbs entering from edges, anatomically perfect human body.'
      const anatomyRule = 'exactly one person in frame, no extra hands, no disembodied limbs, no hands entering from edges, no third arm, correct human anatomy, exactly two arms, no floating hands, anatomically correct body'
      const singleHandRule = 'person holding product with ONE hand only, other hand visible and relaxed at side, never two items at once'
      const negativeConcepts = 'Negative (avoid): extra arms, extra hands, third hand, disembodied limbs, floating hands, phantom limbs, multiple arms, anatomically incorrect, deformed hands, mutant hands, extra fingers, six fingers, hands from outside frame, partial limbs entering from edges.'
      const fidelityRule = 'stay faithful to reference image style, realistic photo quality, not AI-looking, preserve original atmosphere and colors, keep the same lighting colors composition and mood as the reference photo, minimal creative deviation'
      let nbPrompt
      if (isHeroShot) {
        nbPrompt = productImageUrl
          ? `Recreate the scene from the reference image (Image 1) faithfully. Keep the SAME subject, lighting, colors, composition, and atmosphere as Image 1 — treat Image 1 as the ground truth. Only make subtle improvements: slightly cleaner framing, a touch more vibrance, a natural TikTok hero-shot feel. Do not reinvent the shot, do not add new elements, do not stylize into a generic AI look. ${fidelityRule}. ${negativeConcepts} Optional subtle context: ${story.scenes[i].nb_prompt}`
          : `${anatomyPrefix} ${story.scenes[i].nb_prompt}. ${fidelityRule}. ${negativeConcepts}`
      } else if (hasProduct) {
        nbPrompt = `${anatomyPrefix} Using the person from Image 1 as the subject with identical face hair and appearance, and the product from Image 2 held in ONE hand only. ${story.scenes[i].nb_prompt}. Keep facial features and identity exactly the same as Image 1. The product from Image 2 is clearly visible with label facing camera. ${singleHandRule}. ${anatomyRule}. ${negativeConcepts}`
      } else {
        nbPrompt = `${anatomyPrefix} Using the person from Image 1 as the subject with identical face hair and appearance. ${story.scenes[i].nb_prompt}. Keep facial features and identity exactly the same as Image 1. ${anatomyRule}. ${negativeConcepts}`
      }

      const placeholder = i === 0 ? (finalAvatarUrl || avatarUrl) : (frames[i-1] || finalAvatarUrl || avatarUrl)
      const url = await generateNBFrame(i, nbPrompt, imageUrls, placeholder)
      frames.push(url || placeholder)
    } catch(e) {
      console.error('NB frame', i+1, 'outer exception:', e.message)
      frames.push(i === 0 ? avatarUrl : (frames[i-1] || avatarUrl))
    }
  }

    console.log('Frames done:', frames.map((f,i) => `${i+1}:${f?'OK':'FAIL'}`))
  const nPrimary = frameSources.filter(s => s === 'primary').length
  const nFallback = frameSources.filter(s => s === 'fallback').length
  const nPlaceholder = frameSources.filter(s => s === 'placeholder').length
  console.log(`[Job ${jobId}] Completed: ${nPrimary}/4 frames from NB primary, ${nFallback}/4 from flux fallback, ${nPlaceholder}/4 placeholder`)

  // ── STEP 3: Generate videos SEQUENTIALLY ──
  // Primary: BytePlus ModelArk Seedance 2.0 (when ARK_API_KEY is set).
  // ModelArk trusts face-containing outputs from Seedream models, which
  // bypasses fal.ai's content filter on real-person reference frames.
  // Fallback: fal.ai Kling v1.6 (existing path) — used when BytePlus is not
  // configured or fails for a specific scene.
  async function generateSceneVideoFal(i) {
    try {
      const kRes = await fetch('https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
        method: 'POST',
        headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: story.scenes[i].kling_prompt,
          image_url: frames[i],
          duration: '5',
          aspect_ratio: '9:16'
        })
      })
      const kData = await kRes.json()
      let videoUrl = kData.video?.url || kData.url
      if (!videoUrl && kData.request_id) {
        for (let p = 0; p < 72; p++) {
          await new Promise(r => setTimeout(r, 5000))
          const poll = await fetch(
            `https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/${kData.request_id}`,
            { headers: { 'Authorization': `Key ${falKey}` } }
          )
          const pd = await poll.json()
          if (pd.video?.url) { videoUrl = pd.video.url; break }
          if (pd.output?.video?.url) { videoUrl = pd.output.video.url; break }
          if (pd.status === 'FAILED') break
        }
      }
      return videoUrl || null
    } catch (e) {
      console.error(`[Video scene ${i+1}] fal/Kling exception:`, e?.message)
      return null
    }
  }

  async function generateSceneVideoByteplus(i) {
    try {
      const { videoUrl } = await byteplusGenerateVideo({
        prompt: story.scenes[i].kling_prompt,
        imageUrls: frames[i] ? [frames[i]] : [],
        duration: 5
      })
      return videoUrl || null
    } catch (e) {
      console.error(`[Video scene ${i+1}] BytePlus failed: ${e?.message}`)
      return null
    }
  }

  const videos = []
  for (let i = 0; i < 4; i++) {
    let videoUrl = null
    if (byteplusReady) {
      console.log(`[Video scene ${i+1}] using BytePlus ModelArk (Seedance 2.0)`)
      videoUrl = await generateSceneVideoByteplus(i)
      if (!videoUrl && falKey) {
        console.warn(`[Video scene ${i+1}] BytePlus failed — falling back to fal.ai/Kling`)
        videoUrl = await generateSceneVideoFal(i)
      }
    } else if (falKey) {
      console.log(`[Video scene ${i+1}] using fal.ai/Kling (BytePlus not configured)`)
      videoUrl = await generateSceneVideoFal(i)
    } else {
      console.warn(`[Video scene ${i+1}] no video provider configured`)
    }
    videos.push(videoUrl)
  }

  // ── STEP 4: Generate voice — V3 only ──
  let audioBase64 = null
  const finalVoiceId = voiceId || '73z5yvUD5zgBgz92lJMW'
  if (elevenKey) {
    try {
      console.log('ElevenLabs: trying V3 with voice:', finalVoiceId)
      const cleanedVoiceText = cleanHebrewText(story.hebrew_voice)
      const vRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanedVoiceText,
          model_id: 'eleven_v3',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      })
      if (vRes.ok) {
        const buf = await vRes.arrayBuffer()
        audioBase64 = Buffer.from(buf).toString('base64')
        console.log('ElevenLabs V3: success!')
      } else {
        console.error('ElevenLabs V3 failed:', vRes.status)
      }
    } catch(e) {
      console.error('ElevenLabs exception:', e.message)
    }
  } else {
    console.log('No ElevenLabs key configured')
  }

  // ── Return everything ──
  return Response.json({
    story,
    frames,
    videos,
    audioBase64,
    hebrewVoice: story.hebrew_voice
  })
}
