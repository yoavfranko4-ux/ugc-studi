import Anthropic from '@anthropic-ai/sdk'
import { checkRateLimit } from '../middleware/rateLimit.js'
import { validateProductInput, sanitizeForLLM } from '../middleware/validate.js'

export async function POST(req) {
  // Rate limiting
  const rateLimitRes = await checkRateLimit(req, 'general')
  if (rateLimitRes) return rateLimitRes

  const req_data = await req.json()
  const { avatarUrl, productImageUrl, businessType } = req_data
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
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'

  console.log('Keys available:', { hasFal: !!falKey, hasEleven: !!elevenKey, voiceId })

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

  // ── STEP 1: Claude writes the full story ──
  let story = null
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const promptContent = isBusiness
            ? `You are a UGC ad director and AI video prompt engineer for LOCAL BUSINESSES and SERVICES.
Create a CONNECTED 4-scene TikTok story for: ${pName} - ${product}. What customers get: ${pUse}

The 4 scenes must feel like ONE continuous TikTok story.

ANATOMY RULE (CRITICAL): Every nb_prompt MUST include: "correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body"

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
8. MUST include: "correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body"

For EACH scene, write:
1. Nano Banana prompt (50 words max): Follow ALL NB PROMPT RULES above. Scenes 1,3,4 start with "same person from reference photo". Scene 2 is a hero shot — no person needed.
2. Kling prompt (35 words max): MOTION ONLY — how the person moves/feels. Scenes 3-4 start with "Continuing from previous scene same person". Scene 2 describes food/product motion (steam rising, sauce dripping, etc.). End with "then settles".
3. Hebrew subtitle (max 12 words): What appears on screen for this scene

Hebrew voiceover: ONE monologue exactly 20 seconds long, mentions ${pName} by name, casual Israeli friend, craving→discovery→experience→recommendation, ONLY Hebrew.
VOICEOVER WORD COUNT (CRITICAL): Scene 1: ~8 words, Scene 2: ~8 words, Scene 3: ~16 words, Scene 4: ~8 words = total ~40 words = 20 seconds.

Return ONLY JSON:
{
  "scenes": [
    { "id": 1, "label": "😩 צורך", "nb_prompt": "same person from reference photo ...", "kling_prompt": "...", "subtitle": "..." },
    { "id": 2, "label": "🍽️ הירו שוט", "nb_prompt": "...", "kling_prompt": "...", "subtitle": "..." },
    { "id": 3, "label": "😍 חוויה", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "..." },
    { "id": 4, "label": "🚀 המלצה", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "..." }
  ],
  "hebrew_voice": "..."
}`
            : `You are a UGC ad director and AI video prompt engineer.
Create a CONNECTED 4-scene TikTok story for: ${pName} - ${product}. Usage: ${pUse}

The 4 scenes must feel like ONE continuous story with the SAME person in the SAME setting.

ANATOMY RULE (CRITICAL): Every nb_prompt MUST include: "correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body"

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
8. MUST include: "correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body"

Example nb_prompt style:
Scene 2: "same person from reference photo, holding product up toward camera with both hands, direct eye contact, authentic excited expression, ring light from front, shot on iPhone, slightly imperfect handheld, correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body, no text overlay, no captions, no watermark, no brand name or writing on product, vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"
Scene 3: "same person from reference photo, actively using product mid-action, candid authentic moment, natural setting appropriate for product type, correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body, no text overlay, no captions, no watermark, no brand name or writing on product, vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"
Scene 4: "same person from reference photo, genuine happy smile showing result, touching face/wearing product naturally, warm lighting, eye contact with camera, correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body, no text overlay, no captions, no watermark, no brand name or writing on product, vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic"

For EACH scene, write:
1. Nano Banana prompt (50 words max): Follow ALL NB PROMPT RULES above. Start scenes 2-4 with "same person from reference photo".
2. Kling prompt (35 words max): MOTION ONLY - how the person moves/feels. Scenes 2-4 start with "Continuing from previous scene same person". End with "then settles".
3. Hebrew subtitle (max 12 words): What appears on screen for this scene

Hebrew voiceover: ONE monologue exactly 20 seconds long, mentions ${pName} by name, casual Israeli friend, pain→discovery→result→CTA, ONLY Hebrew.
VOICEOVER WORD COUNT (CRITICAL): Scene 1: ~8 words, Scene 2: ~8 words, Scene 3: ~16 words, Scene 4: ~8 words = total ~40 words = 20 seconds. voiceover MUST fill the full duration — write enough words to fill each scene completely, do not leave silence.

Return ONLY JSON:
{
  "scenes": [
    { "id": 1, "label": "😟 כאב", "nb_prompt": "...", "kling_prompt": "...", "subtitle": "..." },
    { "id": 2, "label": "💡 גילוי", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "..." },
    { "id": 3, "label": "✨ שימוש", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "..." },
    { "id": 4, "label": "🚀 CTA", "nb_prompt": "same person from reference photo ...", "kling_prompt": "Continuing from previous scene same person ...", "subtitle": "..." }
  ],
  "hebrew_voice": "..."
}`
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: promptContent }]
      })
      const rawText = message.content[0].text.trim().replace(/```json|```/g, '')
      console.log('Claude response:', rawText.slice(0, 500))
      story = JSON.parse(rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1))
    } catch (e) {
      console.error('Claude SDK error:', e.message)
      /* use fallback */
    }
  }

  // Fallback story if Claude unavailable
  if (!story) {
    const anatomyRule = 'correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body'
    const noText = 'no text overlay, no captions, no watermark, no brand name or writing on product'
    const format = 'vertical 9:16, TikTok UGC creator style, photorealistic, Nano Banana 2 ultra-realistic'

    if (isBusiness) {
      story = {
        scenes: [
          {
            id: 1, label: '😩 צורך',
            nb_prompt: `same person from reference photo, young woman mid-20s walking on busy street looking at phone disappointed, casual outfit jeans and t-shirt, crowded sidewalk with shops in background, searching expression frustrated, iPhone handheld street style, natural daylight, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Person walks slowly looking at phone sighs with disappointment looks around searching, handheld camera slight shake natural street sounds then settles`,
            subtitle: `כבר חודשים שאני מחפשת מקום טוב`
          },
          {
            id: 2, label: '🍽️ הירו שוט',
            nb_prompt: `beautiful close-up hero shot of the food or service offering from ${pName}, steam rising, vibrant colors, professional food photography style, warm golden lighting, shallow depth of field, appetizing details visible, TikTok food creator style, ${noText}, ${format}`,
            kling_prompt: `Steam rising slowly from food, gentle camera push-in revealing details, warm light catching textures, slight movement of fresh ingredients then settles`,
            subtitle: `${pName} — פשוט ברמה אחרת`
          },
          {
            id: 3, label: '😍 חוויה',
            nb_prompt: `same person from reference photo, sitting at table experiencing ${pName} for the first time, eyes wide genuine amazement, mid-bite or mid-experience candid moment, warm interior lighting, cozy restaurant atmosphere in background, authentic happiness, iPhone handheld, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person takes first bite or experiences service, eyes light up with genuine surprise, nods approvingly with amazed expression then settles`,
            subtitle: `אוקיי וואו זה טעים ברמות`
          },
          {
            id: 4, label: '🚀 המלצה',
            nb_prompt: `same person from reference photo, standing outside ${pName} pointing at the place behind, talking directly to camera with excited genuine recommendation smile, golden hour warm lighting, iPhone selfie style, enthusiastic energy, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person points enthusiastically at place behind, looks at camera with big excited smile, gestures with hands recommending then settles`,
            subtitle: `אתם חייבים לנסות את ${pName}!`
          }
        ],
        hebrew_voice: `אני כבר חודשים מחפשת מקום טוב באמת. ניסיתי המון ותמיד התאכזבתי. אז חברה המליצה לי על ${pName} ואמרתי יאללה ננסה. אני אגיד לכם — מהביס הראשון הבנתי שזה ברמה אחרת לגמרי. ${pUse}. אין מילים. אתם חייבים לנסות את ${pName}, תגיעו ותגידו לי אחר כך.`
      }
    } else {
      story = {
        scenes: [
          {
            id: 1, label: '😟 כאב',
            nb_prompt: `frustrated young woman mid-20s with messy bun hair in oversized t-shirt, standing in front of bathroom mirror, stressed expression hand on forehead, white tile bathroom with morning natural daylight from window, iPhone handheld selfie style, slightly imperfect framing, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Person sighs looks at mirror frustrated shakes head overwhelmed, slight camera shake handheld iPhone natural light then settles`,
            subtitle: `כל כך נמאס לי מהבעיה הזאת`
          },
          {
            id: 2, label: '💡 גילוי',
            nb_prompt: `same person from reference photo, holding ${pName} box up toward camera with both hands label facing forward, direct eye contact, authentic excited curious expression, ring light from front, shot on iPhone slightly imperfect handheld, bathroom counter with products in background, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person picks up ${pName} reads label eyes widen with curiosity holds it toward camera then settles`,
            subtitle: `מצאתי את ${pName} ולא האמנתי`
          },
          {
            id: 3, label: '✨ שימוש',
            nb_prompt: `same person from reference photo, actively using ${pName} mid-action ${pUse}, candid authentic moment, genuine amazed expression looking at mirror, natural bathroom setting with warm lighting, close-up showing application detail, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person ${pUse} carefully shows process to camera touches treated area with surprised satisfied reaction then settles`,
            subtitle: `שבוע אחד ולא האמנתי לתוצאות`
          },
          {
            id: 4, label: '🚀 CTA',
            nb_prompt: `same person from reference photo, genuine happy smile showing result, holding ${pName} up confidently, pointing at camera with other hand, warm bathroom lighting, eye contact with camera, excited grateful energy, ${anatomyRule}, ${noText}, ${format}`,
            kling_prompt: `Continuing from previous scene same person holds ${pName} up points directly at camera with big excited smile thumbs up enthusiastic energy then settles`,
            subtitle: `תנסו את ${pName} — יש אחריות מלאה!`
          }
        ],
        hebrew_voice: `אתם לא מאמינים כמה זמן בזבזתי על הבעיה הזאת. ניסיתי הכל ושום דבר לא עבד. עד שמישהו המליץ לי על ${pName} ולא הכרתי אותו בכלל. התחלתי להשתמש, ${pUse}, ופשוט לא האמנתי לתוצאות. שבוע אחד ואני לגמרי מרוצה. ואם אתם מסתפקים, תדעו שיש גם אחריות מלאה. אין לכם מה להפסיד. פשוט תנסו את ${pName}.`
      }
    }
  }

  // ── STEP 2: Nano Banana — תמונת אווטאר + מוצר עם פרומפט נכון ──
  const frames = []
  for (let i = 0; i < 4; i++) {
    try {
      // For business scene 2 (hero shot) — no avatar needed, only product image if available
      const isHeroShot = isBusiness && i === 1
      const imageUrls = isHeroShot
        ? (productImageUrl ? [productImageUrl] : [finalAvatarUrl])
        : [finalAvatarUrl]
      if (!isHeroShot && productImageUrl && i >= 1) imageUrls.push(productImageUrl)

      // פרומפט עם הוראות עקביות לפי מה שNano Banana מבין
      const hasProduct = !isHeroShot && i >= 1 && productImageUrl
      const anatomyRule = 'correct human anatomy, exactly two arms, no extra limbs, no floating hands, no third arm, anatomically correct body'
      let nbPrompt
      if (isHeroShot) {
        nbPrompt = productImageUrl
          ? `Using the product/food from Image 1 as the main subject. ${story.scenes[i].nb_prompt}. Make the product/food from Image 1 the hero of the shot, beautifully presented.`
          : `${story.scenes[i].nb_prompt}.`
      } else if (hasProduct) {
        nbPrompt = `Using the person from Image 1 as the subject with identical face hair and appearance, and the product from Image 2 in their hands. ${story.scenes[i].nb_prompt}. Keep facial features and identity exactly the same as Image 1. The product from Image 2 is clearly visible with label facing camera. ${anatomyRule}.`
      } else {
        nbPrompt = `Using the person from Image 1 as the subject with identical face hair and appearance. ${story.scenes[i].nb_prompt}. Keep facial features and identity exactly the same as Image 1. ${anatomyRule}.`
      }

      const nbRes = await fetch('https://fal.run/fal-ai/nano-banana-2/edit', {
        method: 'POST',
        headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: nbPrompt,
          image_urls: imageUrls,
          aspect_ratio: '9:16',
          num_images: 1
        })
      })
      if (nbRes.ok) {
        const d = await nbRes.json()
        const url = d.images?.[0]?.url || d.images?.[0]
        frames.push(url || (i === 0 ? avatarUrl : frames[i-1]))
        console.log('NB frame', i+1, 'OK:', url?.slice(0,50))
      } else {
        const err = await nbRes.text()
        console.error('NB frame', i+1, 'failed:', nbRes.status, err.slice(0,100))
        frames.push(i === 0 ? avatarUrl : (frames[i-1] || avatarUrl))
      }
    } catch(e) {
      console.error('NB frame', i+1, 'exception:', e.message)
      frames.push(i === 0 ? avatarUrl : (frames[i-1] || avatarUrl))
    }
  }

    console.log('Frames done:', frames.map((f,i) => `${i+1}:${f?'OK':'FAIL'}`))

  // ── STEP 3: Generate Kling videos SEQUENTIALLY ──
  const videos = []
  for (let i = 0; i < 4; i++) {
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

      // Poll if needed
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
      videos.push(videoUrl || null)
    } catch {
      videos.push(null)
    }
  }

  // ── STEP 4: Generate voice — V3 only ──
  let audioBase64 = null
  const finalVoiceId = voiceId || '73z5yvUD5zgBgz92lJMW'
  if (elevenKey) {
    try {
      console.log('ElevenLabs: trying V3 with voice:', finalVoiceId)
      const vRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': elevenKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: story.hebrew_voice,
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
