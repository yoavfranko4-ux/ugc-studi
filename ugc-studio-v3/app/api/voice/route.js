export async function POST(req) {
  try {
    const { text, voiceId, elevenKey } = await req.json()

    // Try V3 first
    let res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_v3',
        voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true }
      })
    })

    if (!res.ok) {
      // Fallback to multilingual v2
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 }
        })
      })
    }

    if (!res.ok) {
      return Response.json({ error: 'ElevenLabs failed: ' + await res.text() }, { status: 500 })
    }

    const audioBuffer = await res.arrayBuffer()
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString()
      }
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
