export async function POST(req) {
  try {
    const { prompt, startImageUrl, falKey, sceneIdx } = await req.json()

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
      const err = await res.text()
      return Response.json({ error: `Kling scene ${sceneIdx + 1}: ${err}` }, { status: 500 })
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
          return Response.json({ error: 'Kling generation failed' }, { status: 500 })
        }
      }
      return Response.json({ error: 'Kling timeout' }, { status: 500 })
    }

    return Response.json({ error: 'No video URL in response' }, { status: 500 })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
