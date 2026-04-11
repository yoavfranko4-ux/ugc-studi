import { checkRateLimit } from '../middleware/rateLimit.js'

export async function POST(req) {
  // Rate limiting
  const rateLimitRes = await checkRateLimit(req, 'general')
  if (rateLimitRes) return rateLimitRes

  try {
    const { prompt, startImageUrl, sceneIdx } = await req.json()

    // Server-side API key only
    const falKey = process.env.FAL_API_KEY
    if (!falKey) {
      return Response.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const endpoint = startImageUrl
      ? 'https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video'
      : 'https://fal.run/fal-ai/kling-video/v1.6/standard/text-to-video'

    const body = { prompt, duration: '5', aspect_ratio: '9:16' }
    if (startImageUrl) body.image_url = startImageUrl

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      return Response.json({ error: `Video generation failed for scene ${(sceneIdx || 0) + 1}` }, { status: 500 })
    }

    const data = await res.json()

    // Direct result
    if (data.video?.url) return Response.json({ url: data.video.url })
    if (data.url) return Response.json({ url: data.url })

    // Poll for result
    if (data.request_id) {
      const model = startImageUrl
        ? 'kling-video/v1.6/standard/image-to-video'
        : 'kling-video/v1.6/standard/text-to-video'

      for (let i = 0; i < 72; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const poll = await fetch(
          `https://fal.run/fal-ai/${model}/requests/${data.request_id}`,
          { headers: { 'Authorization': `Key ${falKey}` } }
        )
        const pd = await poll.json()
        if (pd.video?.url) return Response.json({ url: pd.video.url })
        if (pd.output?.video?.url) return Response.json({ url: pd.output.video.url })
        if (pd.status === 'FAILED' || pd.state === 'FAILED') {
          return Response.json({ error: 'Video generation failed' }, { status: 500 })
        }
      }
      return Response.json({ error: 'Video generation timeout' }, { status: 500 })
    }

    return Response.json({ error: 'No video URL in response' }, { status: 500 })
  } catch (e) {
    return Response.json({ error: 'Video generation failed' }, { status: 500 })
  }
}
