import { prepareHebrewForTTS, remapWordTimestamps } from '../../../lib/hebrew-tts.js'

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY

// Convert ElevenLabs char-level alignment into word-level timestamps
// (same shape the agent route already returns: { word, start, end }).
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
  const ends = alignment.character_end_times_seconds
  return ends[ends.length - 1] || 0
}

export async function POST(req) {
  try {
    if (!ELEVEN_KEY) {
      return Response.json({ error: 'ElevenLabs key missing' }, { status: 500 })
    }
    const { text, voiceId } = await req.json()
    if (!text || typeof text !== 'string') {
      return Response.json({ error: 'text required' }, { status: 400 })
    }
    if (text.length > 5000) {
      return Response.json({ error: 'text too long' }, { status: 400 })
    }
    if (!voiceId || typeof voiceId !== 'string') {
      return Response.json({ error: 'voiceId required' }, { status: 400 })
    }
    const voice = voiceId
    console.log('[/api/voice] using voiceId:', voice)

    // Hebrew preprocessing — produce TWO versions:
    //   ttsText: goes to ElevenLabs (includes Latin transliterations for
    //     stubborn words like כיפה → kipa so pronunciation comes out right).
    //   subtitleText: the original Hebrew form (no Latin) used for subtitles
    //     and word-level timestamps returned to the client.
    const { ttsText, subtitleText } = prepareHebrewForTTS(text)

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVEN_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          text: ttsText,
          model_id: 'eleven_v3',
          // Higher stability (0.7) + zero style — prioritises consistent
          // pronunciation over expressive swings. Style exaggeration was
          // distorting Hebrew consonants (soft פ read as "f" etc.).
          voice_settings: { stability: 0.7, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
        })
      }
    )

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error('[/api/voice] ElevenLabs failed:', res.status, errBody.slice(0, 300))
      return Response.json({ error: 'Voice generation failed' }, { status: 500 })
    }

    const json = await res.json()
    const base64 = json.audio_base64 || ''
    const alignment = json.normalized_alignment || json.alignment || null
    // Build word timestamps from the ElevenLabs char alignment (whose word
    // text is the TTS/Latin form), then remap the `word` field back onto
    // the Hebrew subtitle text by 1:1 index correspondence.
    const ttsWordTimestamps = buildWordTimestamps(alignment)
    const wordTimestamps = remapWordTimestamps(ttsWordTimestamps, subtitleText)
    const duration = durationFromAlignment(alignment)

    return Response.json({
      base64,
      wordTimestamps,
      duration,
      // Return the Hebrew subtitle form so the client stores/displays
      // "חיפשתי כיפה" instead of "חיפשתי kipa".
      text: subtitleText
    })
  } catch (e) {
    console.error('[/api/voice] exception:', e?.message)
    return Response.json({ error: 'Voice generation failed' }, { status: 500 })
  }
}
