// ElevenLabs Hebrew voice generation + per-scene split for Seedance lipsync.
//
// `generateVoice` reproduces the existing single-shot behavior for backwards
// compat (joined paragraph + word timestamps).
//
// `generateScenesVoice` is new — it generates ONE ElevenLabs call per scene
// (4 calls total) so we can pass each scene's MP3 buffer to Seedance as the
// audio_url that drives its native lipsync. Per-scene mp3 buffers are also
// uploaded to fal.storage so Seedance can fetch them by URL.

import { fal } from '@fal-ai/client'
import { prepareHebrewForTTS, remapWordTimestamps } from './hebrew-tts.js'

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY
const ELEVEN_DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || '73z5yvUD5zgBgz92lJMW'

// Single-shot ElevenLabs call. Returns base64 + raw MP3 buffer + duration +
// per-word timestamps (mapped to Hebrew subtitle form).
//
// callElevenLabs(text, voiceId)
//   → { base64, mp3Buffer, duration, wordTimestamps }
async function callElevenLabs(text, voiceId) {
  if (!ELEVEN_KEY || !text) return null
  const voice = voiceId || ELEVEN_DEFAULT_VOICE
  const { ttsText, subtitleText } = prepareHebrewForTTS(text)
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: ttsText,
        model_id: 'eleven_v3',
        voice_settings: { stability: 0.7, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
    })
    if (!res.ok) {
      console.error('[Voice] ElevenLabs failed:', await res.text())
      return null
    }
    const json = await res.json()
    const mp3Buffer = Buffer.from(json.audio_base64, 'base64')
    const base64 = json.audio_base64
    const duration = (mp3Buffer.length * 8) / (128 * 1000)

    let wordTimestamps = null
    if (json.alignment) {
      const { characters, character_start_times_seconds, character_end_times_seconds } = json.alignment
      wordTimestamps = []
      let wordStart = null
      let wordChars = ''
      for (let i = 0; i < characters.length; i++) {
        const ch = characters[i]
        if (ch === ' ' || ch === '\n' || ch === '\t') {
          if (wordChars.trim()) {
            wordTimestamps.push({ word: wordChars.trim(), start: wordStart, end: character_end_times_seconds[i - 1] })
          }
          wordChars = ''
          wordStart = null
        } else {
          if (wordStart === null) wordStart = character_start_times_seconds[i]
          wordChars += ch
        }
      }
      if (wordChars.trim()) {
        wordTimestamps.push({ word: wordChars.trim(), start: wordStart, end: character_end_times_seconds[characters.length - 1] })
      }
      wordTimestamps = remapWordTimestamps(wordTimestamps, subtitleText)
    }

    return { base64, mp3Buffer, duration: Math.round(duration * 100) / 100, wordTimestamps }
  } catch (e) {
    console.error('[Voice] error:', e.message)
    return null
  }
}

// Joined-paragraph voice generation — used for the final video's audio track.
export async function generateVoice(text, voiceId) {
  const r = await callElevenLabs(text, voiceId)
  if (!r) return null
  return { base64: r.base64, duration: r.duration, wordTimestamps: r.wordTimestamps }
}

// Upload an MP3 buffer to fal.storage so it can be referenced as a URL
// (Seedance audio_url requires an HTTPS URL — data: URLs are rejected).
export async function uploadAudioToFal(mp3Buffer, sceneIdx) {
  if (!mp3Buffer) return null
  try {
    const blob = new Blob([mp3Buffer], { type: 'audio/mpeg' })
    const url = await fal.storage.upload(blob)
    console.log(`[Voice] Scene ${sceneIdx + 1} audio uploaded to fal.storage:`, url?.slice(0, 80))
    return url
  } catch (e) {
    console.error(`[Voice] Scene ${sceneIdx + 1} fal.storage upload failed:`, e.message)
    return null
  }
}

// Generate ONE ElevenLabs call per scene (4 calls total), then upload each
// scene's MP3 to fal.storage so Seedance can lipsync against it.
//
//   sceneTexts — array of 4 Hebrew strings (one per scene). Empty/null
//                strings produce a null entry in the returned array.
//   voiceId    — ElevenLabs voice id to use for all 4 scenes.
//   options    — { uploadFor: number[] } — only upload to fal.storage for
//                these scene indices (saves an upload roundtrip for scenes
//                that don't need audio_url, e.g. silent scenes 2 & 3).
//                Defaults to [0, 3] (the speaking scenes).
//
// Returns an array of 4 entries:
//   [{ base64, duration, wordTimestamps, audioUrl } | null, ...]
//
// `audioUrl` is the fal.storage URL when uploadFor includes that index,
// otherwise null.
export async function generateScenesVoice(sceneTexts, voiceId, options = {}) {
  const uploadFor = new Set(options.uploadFor || [0, 3])
  const results = await Promise.all(
    (sceneTexts || []).map(async (text, i) => {
      if (!text || !text.trim()) return null
      const r = await callElevenLabs(text, voiceId)
      if (!r) return null
      let audioUrl = null
      if (uploadFor.has(i)) {
        audioUrl = await uploadAudioToFal(r.mp3Buffer, i)
      }
      return {
        base64: r.base64,
        duration: r.duration,
        wordTimestamps: r.wordTimestamps,
        audioUrl,
      }
    }),
  )
  return results
}

// Stitch per-scene audio results into a single joined timeline:
//   - concatenated base64 MP3 (for the final video's audio track)
//   - concatenated word timestamps with each scene offset by the cumulative
//     duration of preceding scenes
//
// MP3 frames can be concatenated byte-wise in this CBR (128kbps constant
// bitrate) configuration — every existing decoder we care about (browsers,
// ffmpeg) handles it. We pad each scene with ~120ms of silence-equivalent
// gap by relying on the concatenation alone (ElevenLabs output already has
// natural sentence-end pause).
export function stitchSceneVoices(sceneVoices) {
  const valid = (sceneVoices || []).filter(Boolean)
  if (valid.length === 0) return { base64: null, duration: 0, wordTimestamps: null }

  const buffers = valid.map(v => Buffer.from(v.base64, 'base64'))
  const merged = Buffer.concat(buffers)
  const base64 = merged.toString('base64')

  const totalDuration = valid.reduce((s, v) => s + (v.duration || 0), 0)

  let cumulative = 0
  const wordTimestamps = []
  for (const v of valid) {
    if (Array.isArray(v.wordTimestamps)) {
      for (const w of v.wordTimestamps) {
        wordTimestamps.push({
          word: w.word,
          start: (w.start || 0) + cumulative,
          end: (w.end || 0) + cumulative,
        })
      }
    }
    cumulative += v.duration || 0
  }

  return { base64, duration: totalDuration, wordTimestamps }
}
