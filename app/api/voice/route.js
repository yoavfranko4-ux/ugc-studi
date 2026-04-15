import { checkRateLimit } from '../middleware/rateLimit.js'
import { cleanHebrewText } from '../../../lib/hebrew-tts.js'

export async function POST(req) {
  // Rate limiting
  const rateLimitRes = await checkRateLimit(req, 'general')
  if (rateLimitRes) return rateLimitRes

  try {
    const { text, voiceId: requestedVoiceId } = await req.json()

    // Server-side API key only
    const elevenKey = process.env.ELEVENLABS_API_KEY
    if (!elevenKey) {
      return Response.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Use server-configured voice ID with fallback, allow client override for voice selection only
    const voiceId = requestedVoiceId || process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'

    // Validate text length
    if (!text || text.length > 5000) {
      return Response.json({ error: 'Text is required and must be under 5000 characters' }, { status: 400 })
    }

    // Preprocess Hebrew text to fix known ElevenLabs mispronunciations
    const cleanedText = cleanHebrewText(text)

    // Try V3 first
    let res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': elevenKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: cleanedText,
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
          text: cleanedText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 }
        })
      })
    }

    if (!res.ok) {
      return Response.json({ error: 'Voice generation failed' }, { status: 500 })
    }

    const audioBuffer = await res.arrayBuffer()
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString()
      }
    })
  } catch (e) {
    return Response.json({ error: 'Voice generation failed' }, { status: 500 })
  }
}
