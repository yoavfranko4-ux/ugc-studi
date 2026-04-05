export async function POST(req) {
  try {
    const { product, productName, applicationArea } = await req.json()

    const pName = productName || 'המוצר'
    const pDesc = product || ''
    const pUse = applicationArea || 'משתמשים במוצר'

    // Try Claude API if key exists
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'empty') {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': process.env.ANTHROPIC_API_KEY
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1200,
            messages: [{ role: 'user', content: `Create 4-scene TikTok UGC ad for: ${productName} - ${product}. Use: ${applicationArea}. Return ONLY JSON: {"scene1":"...","scene2":"Continuing from previous scene same person...","scene3":"Continuing from previous scene same person...","scene4":"Continuing from previous scene same person...","nb1":"...","nb2":"...","nb3":"...","nb4":"...","hebrewVoice":"[Hebrew only mentioning ${productName}]"}` }]
          })
        })
        if (response.ok) {
          const data = await response.json()
          const text = data.content[0].text.trim().replace(/```json|```/g, '')
          const start = text.indexOf('{'), end = text.lastIndexOf('}') + 1
          return Response.json(JSON.parse(text.slice(start, end)))
        }
      } catch (e) { /* fall through */ }
    }

    // Smart template — uses actual product info, NO API KEY needed!
    return Response.json({
      scene1: `Person frustrated overwhelmed with problem that ${pDesc.slice(0,40)} solves, stressed authentic expression bathroom mirror, handheld iPhone selfie vertical 9:16 natural light slight shake then settles`,
      scene2: `Continuing from previous scene same person discovers ${pName} holds it up to camera label clearly facing camera, surprised curious hopeful expression, handheld natural light then settles`,
      scene3: `Continuing from previous scene same person ${pUse} showing visible result, genuinely amazed satisfied reaction touching treated area, authentic handheld iPhone natural light then settles`,
      scene4: `Continuing from previous scene same person confident excited holds ${pName} up to camera points directly at lens, enthusiastic energy thumbs up no risk guarantee vibe, handheld natural light then settles`,
      nb1: `person frustrated overwhelmed with problem, stressed authentic expression bathroom mirror iPhone selfie natural light`,
      nb2: `same person from reference holds ${pName} label facing camera clearly visible, curious hopeful expression bathroom natural light`,
      nb3: `same person from reference ${pUse}, genuine amazed satisfied reaction showing result, authentic bathroom natural light`,
      nb4: `same person from reference excited confident holds ${pName} points at camera, enthusiastic energy big smile bathroom natural light`,
      hebrewVoice: `אתם לא מאמינים כמה זמן בזבזתי על הבעיה הזאת. ניסיתי הכל ושום דבר לא עבד. עד שמישהו המליץ לי על ${pName} ולא הכרתי אותו בכלל. התחלתי להשתמש ו${pUse} ופשוט לא האמנתי לתוצאות. שבוע אחד ואני לגמרי מרוצה. ואם אתם מסתפקים תדעו שיש גם אחריות מלאה אז אין לכם מה להפסיד. פשוט תנסו את ${pName}.`
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
