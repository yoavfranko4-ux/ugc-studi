export async function POST(req) {
  try {
    const { product, productName, applicationArea } = await req.json()

    const productInfo = [
      productName ? `Product name: ${productName}` : '',
      `Description: ${product}`,
      applicationArea ? `How to use: ${applicationArea}` : ''
    ].filter(Boolean).join('. ')

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY || ''
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `You are a UGC ad expert. Create a 4-scene TikTok ad for this specific product:
${productInfo}

WINNING FORMULA (4 scenes x 5 seconds):
Scene1 PAIN: Person experiencing the EXACT problem ${productName || 'this product'} solves. Strong relatable hook.
Scene2 MECHANISM: Person discovers and holds ${productName || 'the product'} up to camera. Label clearly visible.
Scene3 ACTIVE USE: Person ${applicationArea || 'actively uses the product'} and reacts to the result.
Scene4 CTA: Confident excited person holds ${productName || 'product'} up, points at camera, no-risk vibe.

Kling image-to-video rules:
- Describe MOTION and EMOTION only (35 words max per scene)
- No quotes, no apostrophes, no special characters
- Scenes 2-4 MUST start with: Continuing from previous scene same person
- Camera: handheld iPhone selfie vertical 9:16 natural light slight shake

Nano Banana start frame rules:
- Describe the person + what they hold + emotion + setting
- 40 words max, no quotes
- Include: "same person from reference" for scenes 2-4

Hebrew voiceover rules:
- ONE monologue for all 4 scenes combined (18-22 seconds spoken)
- MUST mention ${productName || 'the product'} by name
- Casual Israeli friend tone, zero salesy
- Pain → discovery → result → CTA structure
- ONLY Hebrew letters, no English

Return ONLY valid JSON:
{"scene1":"...","scene2":"Continuing from previous scene same person...","scene3":"Continuing from previous scene same person...","scene4":"Continuing from previous scene same person...","nb1":"person frustrated [emotion] bathroom iPhone selfie natural light","nb2":"same person from reference holds ${productName || 'product'} label facing camera [emotion]","nb3":"same person from reference ${applicationArea || 'applies product'} [reaction]","nb4":"same person from reference excited holds ${productName || 'product'} points at camera [energy]","hebrewVoice":"[ONLY Hebrew]"}`
        }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return Response.json({ error: 'Claude API failed: ' + err }, { status: 500 })
    }

    const data = await response.json()
    const text = data.content[0].text.trim().replace(/```json|```/g, '')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}') + 1
    const result = JSON.parse(text.slice(start, end))

    return Response.json(result)
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
