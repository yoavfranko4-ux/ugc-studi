export async function POST(req) {
  const req_data = await req.json()
  const { product, productName, applicationArea, avatarUrl, falKey, elevenKey, voiceId, productImageUrl } = req_data

  const pName = productName || 'המוצר'
  const pUse = applicationArea || 'מורחים על האזור הבעייתי'

  // ── STEP 1: Claude writes the full story ──
  let story = null
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': process.env.ANTHROPIC_API_KEY },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `You are a UGC ad director and AI video prompt engineer. 
Create a CONNECTED 4-scene TikTok story for: ${pName} - ${product}. Usage: ${pUse}

The 4 scenes must feel like ONE continuous story with the SAME person in the SAME bathroom.

WINNING FORMULA:
Scene 1 PAIN (0-5s): Person frustrated with the exact problem ${pName} solves. Strong hook.
Scene 2 DISCOVERY (5-10s): Same person discovers ${pName}, holds it up to camera. Label visible.  
Scene 3 ACTIVE USE (10-15s): Same person ${pUse} - actively using the product. Showing result.
Scene 4 CTA (15-20s): Same person excited, holds ${pName} up, points at camera. No-risk vibe.

For EACH scene, write:
1. Nano Banana prompt (40 words max): Describe the EXACT frame - person + emotion + what they hold + setting. Start scenes 2-4 with "same person from reference photo"
2. Kling prompt (35 words max): MOTION ONLY - how the person moves/feels. Scenes 2-4 start with "Continuing from previous scene same person". End with "then settles".
3. Hebrew subtitle (max 12 words): What appears on screen for this scene

Hebrew voiceover: ONE monologue 20 seconds, mentions ${pName} by name, casual Israeli friend, pain→discovery→result→CTA, ONLY Hebrew.

Return ONLY JSON:
{
  "scenes": [
    {
      "id": 1,
      "label": "😟 כאב",
      "nb_prompt": "...",
      "kling_prompt": "...", 
      "subtitle": "..."
    },
    {
      "id": 2,
      "label": "💡 גילוי",
      "nb_prompt": "same person from reference photo ...",
      "kling_prompt": "Continuing from previous scene same person ...",
      "subtitle": "..."
    },
    {
      "id": 3,
      "label": "✨ שימוש",
      "nb_prompt": "same person from reference photo ...",
      "kling_prompt": "Continuing from previous scene same person ...",
      "subtitle": "..."
    },
    {
      "id": 4,
      "label": "🚀 CTA",
      "nb_prompt": "same person from reference photo ...",
      "kling_prompt": "Continuing from previous scene same person ...",
      "subtitle": "..."
    }
  ],
  "hebrew_voice": "..."
}`
          }]
        })
      })
      if (r.ok) {
        const d = await r.json()
        const text = d.content[0].text.trim().replace(/```json|```/g, '')
        story = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      }
    } catch (e) { /* use fallback */ }
  }

  // Fallback story if Claude unavailable
  if (!story) {
    story = {
      scenes: [
        {
          id: 1, label: '😟 כאב',
          nb_prompt: `frustrated woman overwhelmed in bathroom mirror, stressed expression hand on forehead, morning natural light iPhone selfie vertical`,
          kling_prompt: `Person sighs looks at mirror frustrated shakes head overwhelmed, slight camera shake handheld iPhone natural light then settles`,
          subtitle: `כל כך נמאס לי מהבעיה הזאת`
        },
        {
          id: 2, label: '💡 גילוי',
          nb_prompt: `same person from reference photo holds ${pName} box up to camera label facing forward, curious surprised smile bathroom natural light`,
          kling_prompt: `Continuing from previous scene same person picks up ${pName} reads label eyes widen with curiosity holds it toward camera then settles`,
          subtitle: `מצאתי את ${pName} ולא האמנתי`
        },
        {
          id: 3, label: '✨ שימוש',
          nb_prompt: `same person from reference photo ${pUse} close up showing application, genuine amazed expression bathroom mirror natural light`,
          kling_prompt: `Continuing from previous scene same person ${pUse} carefully shows process to camera touches treated area with surprised satisfied reaction then settles`,
          subtitle: `שבוע אחד ולא האמנתי לתוצאות`
        },
        {
          id: 4, label: '🚀 CTA',
          nb_prompt: `same person from reference photo holds ${pName} up confidently points at camera big smile, excited energy bathroom natural light`,
          kling_prompt: `Continuing from previous scene same person holds ${pName} up points directly at camera with big excited smile thumbs up enthusiastic energy then settles`,
          subtitle: `תנסו את ${pName} — יש אחריות מלאה!`
        }
      ],
      hebrew_voice: `אתם לא מאמינים כמה זמן בזבזתי על הבעיה הזאת. ניסיתי הכל ושום דבר לא עבד. עד שמישהו המליץ לי על ${pName} ולא הכרתי אותו בכלל. התחלתי להשתמש, ${pUse}, ופשוט לא האמנתי לתוצאות. שבוע אחד ואני לגמרי מרוצה. ואם אתם מסתפקים, תדעו שיש גם אחריות מלאה. אין לכם מה להפסיד. פשוט תנסו את ${pName}.`
    }
  }

  // ── STEP 2: Nano Banana — תמונת אווטאר + מוצר עם פרומפט נכון ──
  const { productImageUrl } = req_data
  const frames = []
  for (let i = 0; i < 4; i++) {
    try {
      // אווטאר תמיד ראשון — מוצר שני אם קיים
      const imageUrls = [avatarUrl]
      if (productImageUrl && i >= 1) imageUrls.push(productImageUrl)

      // פרומפט עם הוראות עקביות לפי מה שNano Banana מבין
      const hasProduct = i >= 1 && productImageUrl
      const nbPrompt = hasProduct
        ? `Using the person from Image 1 as the subject with identical face hair and appearance, and the product from Image 2 in their hands. ${story.scenes[i].nb_prompt}. Keep facial features and identity exactly the same as Image 1. The product from Image 2 is clearly visible with label facing camera.`
        : `Using the person from Image 1 as the subject with identical face hair and appearance. ${story.scenes[i].nb_prompt}. Keep facial features and identity exactly the same as Image 1.`

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
  const finalVoiceId = voiceId || 'Z3R5wn05IrDiVCyEkUrK'
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
        const errText = await vRes.text()
        console.error('ElevenLabs V3 failed:', vRes.status, errText.slice(0,300))
      }
    } catch(e) {
      console.error('ElevenLabs exception:', e.message)
    }
  } else {
    console.log('No ElevenLabs key provided')
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
