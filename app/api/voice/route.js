import { checkRateLimit } from '../middleware/rateLimit.js'
import { cleanHebrewText } from '../../../lib/hebrew-tts.js'

// Convert ElevenLabs char-level alignment into word-level timestamps.
// ElevenLabs returns { characters, character_start_times_seconds, character_end_times_seconds }.
// We split on whitespace, each word = range spanned by its characters.
function buildWordTimestamps(alignment) {
  if (!alignment) return []
  const chars = alignment.characters || []
  const starts = alignment.character_start_times_seconds || []
  const ends = alignment.character_end_times_seconds || []
  if (!chars.length) return []

  const words = []
  let cur = null
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const isSpace = /\s/.test(ch)
    if (isSpace) {
      if (cur) { words.push(cur); cur = null }
      continue
    }
    if (!cur) cur = { word: ch, start: starts[i] ?? 0, end: ends[i] ?? 0 }
    else { cur.word += ch; cur.end = ends[i] ?? cur.end }
  }
  if (cur) words.push(cur)
  return words
}

function durationFromAlignment(alignment) {
  if (!alignment?.character_end_times_seconds?.length) return 0
  return alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] || 0
}

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

    // ElevenLabs "with timestamps" endpoint returns audio + char-level alignment
    // so the client can render word-synced subtitles.
    const endpoint = (model) =>
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`

    let res = await fetch(endpoint('eleven_v3'), {
      method: 'POST',
      headers: {
        'xi-api-key': elevenKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        text: cleanedText,
        model_id: 'eleven_v3',
        voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true }
      })
    })

    if (!res.ok) {
      // Fallback to multilingual v2 (also supports with-timestamps)
      res = await fetch(endpoint('eleven_multilingual_v2'), {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          text: cleanedText,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.8 }
        })
      })
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('ElevenLabs with-timestamps failed:', res.status, errText.slice(0, 200))
      return Response.json({ error: 'Voice generation failed' }, { status: 500 })
    }

    const data = await res.json()
    const base64 = data.audio_base64 || data.audio || ''
    const alignment = data.normalized_alignment || data.alignment || null
    const wordTimestamps = buildWordTimestamps(alignment)
    const duration = durationFromAlignment(alignment)

    return Response.json({
      base64,
      wordTimestamps,
      duration,
      text: cleanedText
    })
  } catch (e) {
    console.error('Voice route exception:', e?.message)
    return Response.json({ error: 'Voice generation failed' }, { status: 500 })
  }
}
