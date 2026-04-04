export async function POST(req) {
  try {
    const { prompt, imageUrl, falKey } = await req.json()

    const res = await fetch('https://fal.run/fal-ai/nano-banana-2', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        image_urls: [imageUrl],
        aspect_ratio: '9:16',
        num_images: 1
      })
    })

    if (!res.ok) {
      const err = await res.text()
      // Fallback to Flux if Nano Banana fails
      const fluxRes = await fetch('https://fal.run/fal-ai/flux/schnell', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt + ', portrait photo',
          image_url: imageUrl,
          image_size: 'portrait_4_3',
          num_images: 1,
          num_inference_steps: 4
        })
      })
      const fluxData = await fluxRes.json()
      return Response.json({ url: fluxData.images?.[0]?.url })
    }

    const data = await res.json()
    const url = data.images?.[0]?.url || data.images?.[0]
    return Response.json({ url })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
