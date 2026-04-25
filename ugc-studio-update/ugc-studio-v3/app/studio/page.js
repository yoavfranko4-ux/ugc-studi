'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { canUseAvatar, canUseVoice } from '../../lib/subscription-limits'

// === Subtitle Styles ===
const SUBTITLE_STYLES = [
  { id: 'classic', label: 'Classic', desc: 'לבן עם צל שחור' },
  { id: 'bold', label: 'Bold', desc: 'שחור על רקע לבן' },
  { id: 'minimal', label: 'Minimal', desc: 'טקסט לבן קטן' },
  { id: 'neon', label: 'Neon', desc: 'לבן עם glow סגול' },
]

// === Background Music Tracks — local 20s drops from public/music/ ===
const MUSIC_TRACKS = [
  { id: 'none',                 label: 'ללא מוזיקה',           emoji: '🔇', url: null },
  { id: 'deep-house-energetic', label: '🎵 Deep House אנרגטי', emoji: '🎵', url: '/music/deep-house-energetic.mp3' },
  { id: 'fashion-beat',         label: '✨ Fashion Beat',       emoji: '✨', url: '/music/fashion-beat.mp3' },
  { id: 'deep-house-classic',   label: '🏛️ Deep House קלאסי',  emoji: '🏛️', url: '/music/deep-house-classic.mp3' },
  { id: 'deep-house-lounge',    label: '🍸 Deep House Lounge',  emoji: '🍸', url: '/music/deep-house-lounge.mp3' },
]

// === Scene Transitions ===
const TRANSITIONS = [
  { id: 'cut', label: 'Cut', desc: 'חיתוך ישר' },
  { id: 'fade', label: 'Fade', desc: 'דהייה' },
  { id: 'zoom', label: 'Zoom', desc: 'זום קל' },
]

// === Web Audio SFX ===
function createAudioContext() {
  return new (window.AudioContext || window.webkitAudioContext)()
}

// === AudioBuffer → WAV (16-bit PCM) ArrayBuffer encoder ===
// Used to convert MP3 voiceover to WAV client-side before sending to FFmpeg.
// WAV is raw PCM — ffmpeg-static decodes it perfectly every time (unlike the MP3 path).
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = numChannels * bytesPerSample
  const dataLength = buffer.length * blockAlign
  const bufferLength = 44 + dataLength
  const ab = new ArrayBuffer(bufferLength)
  const view = new DataView(ab)
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)        // fmt chunk size
  view.setUint16(20, 1, true)         // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)
  const channels = []
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c))
  let pos = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]))
      s = s < 0 ? s * 0x8000 : s * 0x7FFF
      view.setInt16(pos, s | 0, true)
      pos += 2
    }
  }
  return ab
}

// Convert a base64 MP3 (or any browser-decodable audio) to base64 WAV via Web Audio API
async function mp3Base64ToWavBase64(mp3B64) {
  const bin = atob(mp3B64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  try {
    const audioBuf = await ctx.decodeAudioData(bytes.buffer.slice(0))
    const wavAb = audioBufferToWav(audioBuf)
    const wavBytes = new Uint8Array(wavAb)
    let s = ''
    for (let j = 0; j < wavBytes.length; j += 8192) {
      s += String.fromCharCode(...wavBytes.slice(j, j + 8192))
    }
    return { base64: btoa(s), byteLength: wavAb.byteLength, sampleRate: audioBuf.sampleRate, channels: audioBuf.numberOfChannels, duration: audioBuf.duration }
  } finally {
    try { ctx.close() } catch {}
  }
}
function playWhoosh(ctx) {
  const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter()
  osc.type = 'sawtooth'; osc.frequency.setValueAtTime(800, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3)
  filter.type = 'bandpass'; filter.frequency.setValueAtTime(1000, ctx.currentTime)
  filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.3); filter.Q.value = 2
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
  osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination)
  osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4)
}
function playPop(ctx) {
  const osc = ctx.createOscillator(), gain = ctx.createGain()
  osc.type = 'sine'; osc.frequency.setValueAtTime(600, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08)
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
  osc.connect(gain); gain.connect(ctx.destination)
  osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15)
}
function playDing(ctx) {
  const osc = ctx.createOscillator(), gain = ctx.createGain()
  osc.type = 'sine'; osc.frequency.setValueAtTime(1200, ctx.currentTime)
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
  osc.connect(gain); gain.connect(ctx.destination)
  osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 1)
}

// Generate background music buffer via Web Audio oscillators
function generateMusicBuffer(ctx, trackId, durationSec) {
  const sampleRate = ctx.sampleRate, length = sampleRate * durationSec
  const buffer = ctx.createBuffer(2, length, sampleRate)
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1)
  const noteFreqs = {
    C: [261.63, 329.63, 392.00], Am: [220.00, 261.63, 329.63],
    G: [196.00, 246.94, 293.66], Dm: [293.66, 349.23, 440.00],
  }
  const track = MUSIC_TRACKS.find(t => t.id === trackId)
  if (!track || trackId === 'none') return buffer
  const bpm = track.bpm, beatLen = (60 / bpm) * sampleRate
  const freqs = noteFreqs[track.key] || noteFreqs.C
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate, beatPhase = (i % beatLen) / beatLen
    let val = 0
    if (trackId === 'upbeat') {
      val += 0.08 * Math.sin(2 * Math.PI * freqs[0] * t)
      val += 0.06 * Math.sin(2 * Math.PI * freqs[1] * t)
      val += 0.04 * Math.sin(2 * Math.PI * freqs[2] * t)
      val += 0.05 * (beatPhase < 0.1 ? 1 - beatPhase * 10 : 0)
      val += 0.03 * ((beatPhase > 0.5 && beatPhase < 0.55) ? 1 : 0)
    } else if (trackId === 'chill') {
      const slow = Math.sin(2 * Math.PI * 0.2 * t)
      val += 0.06 * Math.sin(2 * Math.PI * freqs[0] * t) * (0.5 + 0.5 * slow)
      val += 0.04 * Math.sin(2 * Math.PI * freqs[1] * t * 0.5)
      val += 0.03 * Math.sin(2 * Math.PI * freqs[2] * t * 0.25)
    } else if (trackId === 'motivational') {
      val += 0.07 * Math.sin(2 * Math.PI * freqs[0] * t)
      val += 0.05 * Math.sin(2 * Math.PI * freqs[1] * t)
      val += 0.06 * Math.sin(2 * Math.PI * freqs[2] * t)
      val += 0.06 * (beatPhase < 0.08 ? 1 - beatPhase * 12 : 0)
    } else if (trackId === 'dramatic') {
      val += 0.08 * Math.sin(2 * Math.PI * freqs[0] * 0.5 * t)
      val += 0.06 * Math.sin(2 * Math.PI * freqs[1] * 0.5 * t)
      val += 0.04 * Math.sin(2 * Math.PI * freqs[2] * 0.5 * t)
      val += 0.02 * Math.sin(2 * Math.PI * 80 * t)
    }
    const fadeIn = Math.min(1, t / 1.0), fadeOut = Math.min(1, (durationSec - t) / 1.5)
    val *= fadeIn * fadeOut * 1.4
    left[i] = val; right[i] = val * 0.95 + 0.01 * Math.sin(2 * Math.PI * 0.5 * t) * val
  }
  return buffer
}

// Split subtitle into short segments: max 3 words per line, max 2 lines visible
function splitSubtitle(text, maxWordsPerLine = 3) {
  if (!text) return []
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    lines.push(words.slice(i, i + maxWordsPerLine).join(' '))
  }
  return lines
}

// Build subtitle segments from word timestamps: groups of 3-4 words with exact timing
function buildSubtitleSegments(wordTimestamps, maxWordsPerSegment = 3) {
  if (!wordTimestamps?.length) return []
  const segments = []
  for (let i = 0; i < wordTimestamps.length; i += maxWordsPerSegment) {
    const group = wordTimestamps.slice(i, i + maxWordsPerSegment)
    segments.push({
      text: group.map(w => w.word).join(' '),
      start: group[0].start,
      end: group[group.length - 1].end
    })
  }
  return segments
}

// Get the subtitle line(s) visible at a given time. Matches export ASS behavior:
// only renders when the current time falls inside an active word-timestamp segment.
// Past the last word's end time, nothing is shown — same as the exported MP4.
function getSubtitleLinesAtTime(text, timeInScene, sceneDuration, subtitleSegments, sceneStartTime) {
  // Preferred path: word-level segments with explicit start/end (from ElevenLabs alignment)
  if (subtitleSegments?.length) {
    const globalTime = (sceneStartTime || 0) + timeInScene
    for (const seg of subtitleSegments) {
      if (globalTime >= seg.start && globalTime <= seg.end) {
        // Single active segment only — matches the one-caption-at-a-time ASS behavior
        return [seg.text]
      }
    }
    // No segment contains this time → no subtitle (silence / end of voiceover)
    return []
  }
  // Fallback: no word-level data available — use equal time distribution across the scene
  const allLines = splitSubtitle(text, 3)
  if (allLines.length === 0) return []
  const timePerLine = sceneDuration / allLines.length
  const currentLineIdx = Math.min(Math.floor(timeInScene / timePerLine), allLines.length - 1)
  return [allLines[currentLineIdx]]
}

// Full-size renderer — same ASS style as drawSubtitlePreview, kept in sync with the export.
function drawSubtitleOnCtx(ctx, lines, canvasW, canvasH, style) {
  // Delegate to the same renderer — one source of truth for subtitle look
  return drawSubtitlePreview(ctx, lines, canvasW, canvasH, style)
}

// Draw styled subtitle lines on canvas (preview size) — MATCHES EXPORT ASS STYLING EXACTLY.
// Export ASS style (from /api/export/route.js buildAssFile):
//   Noto Sans Hebrew Bold, FontSize=56, PrimaryColour=white, OutlineColour=black,
//   Outline=4, Shadow=1, Alignment=2 (bottom-center), MarginV=140 at PlayResY=1280.
// We scale those values to whatever canvas size the editor happens to render at.
function drawSubtitlePreview(ctx, lines, canvasW, canvasH, style) {
  if (!lines.length) return
  const maxW = canvasW * 0.90
  // FontSize 56 at 1280h → ~4.375% of canvasH. Scale proportionally.
  const fontSize = Math.max(14, Math.round(canvasH * (56 / 1280)))
  ctx.font = `700 ${fontSize}px "Noto Sans Hebrew", Heebo, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
  ctx.direction = 'rtl'
  const lineHeight = Math.round(fontSize * 1.2)
  // ASS MarginV=140 from bottom of PlayResY=1280 → text baseline sits at canvasH - 140/1280*canvasH
  const marginV = Math.round(canvasH * (140 / 1280))
  const baseY = canvasH - marginV
  // Stack multiple lines upward from baseY
  const startY = baseY - (lines.length - 1) * lineHeight
  const x = canvasW / 2
  // Outline=4 at 1280h → ~4/1280 of canvasH per side, stroke is 2× outline for canvas
  const outlineW = Math.max(2, Math.round(fontSize * 0.14))
  const shadowOffset = Math.max(1, Math.round(fontSize * 0.035))

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight
    let displayLine = line
    while (ctx.measureText(displayLine).width > maxW && displayLine.length > 2) {
      displayLine = displayLine.slice(0, -1)
    }
    // Shadow=1 (soft drop shadow)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillText(displayLine, x + shadowOffset, y + shadowOffset)
    // Outline=4 (thick black stroke)
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = outlineW
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeText(displayLine, x, y)
    // PrimaryColour=white fill
    ctx.fillStyle = '#ffffff'
    ctx.fillText(displayLine, x, y)
  })
}

// Draw video frame on canvas with cover mode (fill entire frame, crop edges)
function drawVideoCover(ctx, vid, cw, ch) {
  const vw = vid.videoWidth || vid.width || cw
  const vh = vid.videoHeight || vid.height || ch
  const scale = Math.max(cw / vw, ch / vh)
  const sw = cw / scale, sh = ch / scale
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2
  ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, cw, ch)
}

const AVATARS = [
  { id: 1, url: '/avatars/avatar-1.jpg', name: 'Maya' },
  { id: 2, url: '/avatars/avatar-2.jpg', name: 'Noa' },
  { id: 3, url: '/avatars/avatar-3.jpg', name: 'Adam' },
  { id: 4, url: '/avatars/avatar-4.jpg', name: 'Yoav' },
  { id: 5, url: '/avatars/avatar-5.jpg', name: 'Lior' },
  { id: 6, url: '/avatars/avatar-6.jpg', name: 'Dana' },
]

const AGENT_STEPS = [
  { id: 'script', label: 'Claude כותב את הסיפור — פרומפט לכל סצנה', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/></svg> },
  { id: 'frames', label: 'Nano Banana יוצר 4 פריימים מחוברים', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> },
  { id: 'videos', label: 'Kling מחיה 4 סצנות × 5 שניות', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> },
  { id: 'voice',  label: 'ElevenLabs קריינות עברית V3', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg> },
]

export default function Home() {
  const [userTier, setUserTier] = useState('pro')   // default: no lock until we learn the tier
  const [userId, setUserId] = useState(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [step, setStep] = useState('form')
  const [mode, setMode] = useState('ugc') // 'ugc' | 'business'
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [customAvatar, setCustomAvatar] = useState(null)
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [applicationArea, setApplicationArea] = useState('')
  const [productImage, setProductImage] = useState(null)
  const [storyDescription, setStoryDescription] = useState('')
  // Business mode state
  const [businessName, setBusinessName] = useState('')
  const [businessDescription, setBusinessDescription] = useState('')
  const [businessPhotos, setBusinessPhotos] = useState([]) // array of data URLs (1-4)
  const [voiceId, setVoiceId] = useState('cp6q5qJLs8rR7eAWOepf')
  const [voiceGender, setVoiceGender] = useState('female')
  const [voicePreviewing, setVoicePreviewing] = useState(null)
  const voicePreviewRef = useRef(null)
  const [falKey, setFalKey] = useState('')
  const [elevenKey, setElevenKey] = useState('')
  const [keysOpen, setKeysOpen] = useState(false)
  useEffect(() => {
    fetch('/api/keys').then(r => r.json()).then(d => {
      if (d.fal) setFalKey(d.fal)
      if (d.eleven) setElevenKey(d.eleven)
    }).catch(() => {})
  }, [])
  const [agentStatus, setAgentStatus] = useState({})
  const [result, setResult] = useState(null)
  const [currentScene, setCurrentScene] = useState(0)
  const [logs, setLogs] = useState([])
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  // Editor state
  const [clipOrder, setClipOrder] = useState([0, 1, 2, 3])
  const [dragIdx, setDragIdx] = useState(null)
  const [subtitleStyle, setSubtitleStyle] = useState('classic')
  const [sfxEnabled, setSfxEnabled] = useState(true)
  const [bgMusic, setBgMusic] = useState('none')
  const [transition, setTransition] = useState('cut')
  const [playing, setPlaying] = useState(false)
  const [musicPreviewing, setMusicPreviewing] = useState(false)
  const [videoBlobUrls, setVideoBlobUrls] = useState([])
  const [videosReady, setVideosReady] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  // Scene-regeneration state. jobId + lastGenPayload are captured at the
  // end of runAgent() so the regenerate-scene endpoint can replay the
  // same reference-image set for any single scene.
  const [jobId, setJobId] = useState(null)
  const [lastGenPayload, setLastGenPayload] = useState(null)
  const [regenLoading, setRegenLoading] = useState(null) // scene number currently regenerating (1-4) or null
  const [regenCounts, setRegenCounts] = useState({}) // { "1": 0, ... }
  const [regenMsg, setRegenMsg] = useState('')
  // Voiceover re-record (one-shot per video session) — works on both fresh
  // generations and saved-edit restores via ?editId=, since both flows
  // populate result.hebrewVoice and audioBlobUrl.
  const [hasRerecorded, setHasRerecorded] = useState(false)
  const [rerecording, setRerecording] = useState(false)
  const [showRerecordPanel, setShowRerecordPanel] = useState(false)
  const [rerecordText, setRerecordText] = useState('')
  const videoRef = useRef(null)           // legacy single ref (still used in some places)
  const videoRefs = useRef([])            // one <video> element per clip — enables seamless back-to-back playback
  const audioRef = useRef(null)
  const musicAudioRef = useRef(null)      // real <audio> element for bgMusic (preview + playback)
  const canvasRef = useRef(null)
  const audioBlobUrl = useRef(null)
  const playingRef = useRef(false)
  const currentPlayingIdxRef = useRef(0)  // index into clipOrder during playback (no re-render)
  const autoExportRef = useRef(false)
  const blobUrlCache = useRef(new Map())  // remote-URL → blob: URL cache — survives re-renders
  const [preloadProgress, setPreloadProgress] = useState({ done: 0, total: 0 })
  const [slowLoadWarning, setSlowLoadWarning] = useState(false)
  // Map of sceneIdx → { reason, attempts } for videos that failed to load.
  // When a scene is here, the editor swaps the <video> for the NB still frame
  // so the user can keep working on the other scenes.
  const [brokenScenes, setBrokenScenes] = useState({})
  const brokenScenesRef = useRef({})
  const setSceneBroken = useCallback((i, reason) => {
    const prev = brokenScenesRef.current[i] || { attempts: 0 }
    const next = { reason, attempts: prev.attempts + 1, at: Date.now() }
    brokenScenesRef.current[i] = next
    setBrokenScenes({ ...brokenScenesRef.current })
    // Fire-and-forget analytics log so we can track how often this happens.
    console.warn(`[Studio][analytics] scene_broken idx=${i} reason=${reason} attempts=${next.attempts}`)
  }, [])
  const clearSceneBroken = useCallback((i) => {
    delete brokenScenesRef.current[i]
    setBrokenScenes({ ...brokenScenesRef.current })
  }, [])

  // Load the embedded Hebrew subtitle font (same file as server-side ASS burn-in) so the canvas
  // preview matches the exported MP4 glyphs pixel-for-pixel.
  useEffect(() => {
    if (typeof window === 'undefined' || !('FontFace' in window)) return
    const font = new FontFace('Noto Sans Hebrew', 'url(/fonts/NotoSansHebrew-Bold.ttf) format("truetype")', { weight: '700', style: 'normal' })
    font.load().then(f => {
      document.fonts.add(f)
      // Force a subtitle re-draw once the font is ready
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }).catch(e => console.warn('[Studio] Failed to load Noto Sans Hebrew:', e.message))
  }, [])

  // Auth check + restore saved edit from ?editId= query param
  useEffect(() => {
    const init = async () => {
      if (!supabase) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.replace('/login'); return }
      setUserId(user.id)

      // Load subscription tier for avatar/voice gating. If the users row or
      // subscription_tier column isn't there yet, leave userTier as-is.
      try {
        const { data: u } = await supabase
          .from('users')
          .select('subscription_tier')
          .eq('id', user.id)
          .maybeSingle()
        if (u?.subscription_tier) setUserTier(u.subscription_tier)
      } catch (err) {
        console.warn('[Studio] tier lookup skipped:', err?.message || err)
      }

      // Check for editId query param to restore a saved edit
      const params = new URLSearchParams(window.location.search)
      const editId = params.get('editId')
      if (!editId) return

      try {
        const { data: edit, error } = await supabase
          .from('saved_edits')
          .select('*')
          .eq('id', editId)
          .single()
        if (error || !edit?.edit_data) return

        const d = edit.edit_data
        // Restore all editor state
        if (d.product_name) setProductName(d.product_name)
        if (d.clip_order) setClipOrder(d.clip_order)
        if (d.subtitle_style) setSubtitleStyle(d.subtitle_style)
        if (d.bg_music) setBgMusic(d.bg_music)
        if (d.sfx_enabled !== undefined) setSfxEnabled(d.sfx_enabled)
        if (d.transition) setTransition(d.transition)
        if (d.voice_id) setVoiceId(d.voice_id)
        if (d.voice_gender) setVoiceGender(d.voice_gender)

        // Rebuild result object for the editor. Carry voiceId so re-record
        // picks the original voice even when state drifted for any reason.
        const restoredResult = {
          wordTimestamps: d.word_timestamps || null,
          story: d.story || null,
          frames: d.frames || [],
          videos: d.videos || [],
          audioBase64: d.audio_base64 || null,
          hebrewVoice: d.hebrew_voice || '',
          voiceId: d.voice_id || null,
        }
        // Rebuild voiceover blob URL from saved base64
        if (d.audio_base64) {
          try {
            const binary = atob(d.audio_base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            const blob = new Blob([bytes], { type: 'audio/mpeg' })
            audioBlobUrl.current = URL.createObjectURL(blob)
          } catch (e) { console.warn('Failed to restore voiceover audio:', e.message) }
        }
        // Build subtitle segments from word timestamps if available
        if (restoredResult.wordTimestamps?.length) {
          restoredResult.subtitleSegments = buildSubtitleSegments(restoredResult.wordTimestamps, 3)
        }
        setResult(restoredResult)

        // Restore the regenerate-scene state. With these set, the regen
        // card in the editor unhides itself — the existing UI is gated on
        // `jobId && lastGenPayload`. Older saved_edits without these
        // fields keep the prior behavior (regen card stays hidden).
        if (d.job_id) setJobId(d.job_id)
        if (d.last_gen_payload) setLastGenPayload(d.last_gen_payload)
        if (d.regenerations_used && typeof d.regenerations_used === 'object') {
          setRegenCounts(d.regenerations_used)
        }

        // Check for autoExport flag
        if (params.get('autoExport') === 'true') {
          autoExportRef.current = true
        }

        // Jump straight to editor
        setStep('done')

        // Clean URL without reload
        window.history.replaceState({}, '', '/studio')
      } catch (e) { console.warn('Failed to restore saved edit:', e.message) }
    }
    init()
  }, [])

  // Preload ALL video blobs IN PARALLEL + wait for canplaythrough on rendered <video> elements.
  // Uses a ref-based cache keyed on remote URL so re-renders / scene switches never re-fetch.
  // Reports per-clip progress to preloadProgress so the UI can show "טוען 3/4 סרטונים...".
  useEffect(() => {
    if (step !== 'done' || !result?.videos) return
    let cancelled = false
    setVideosReady(false)
    const remoteUrls = result.videos
    const total = remoteUrls.filter(Boolean).length
    setPreloadProgress({ done: 0, total })

    // === Route videos through the Railway proxy. ===
    // fal.ai's geo CDN is inconsistent — some users get 50ms TTFB, others get
    // 2MB-per-30s. Railway's link to fal.ai is fast and consistent, and the
    // proxy caches bytes in memory (pre-warmed at job completion), so second
    // load of the same URL is instant. See lib/video-cache.js.
    const USE_PROXY = true
    const viaProxy = (u) => (USE_PROXY && u && !u.startsWith('/api/')) ? `/api/proxy?url=${encodeURIComponent(u)}` : u
    console.log(`[Studio] Starting to load ${total} videos (USE_PROXY=${USE_PROXY})`)
    const loadStart = Date.now()

    // -----------------------------------------------------------------------
    // STEP 1 — Hand the REMOTE URL (or cached blob) straight to each <video>
    // element. The browser streams via HTTP Range — playback can start after
    // just the moov atom loads (~50-100KB), not after all 10MB download.
    // This unblocks the UI immediately; the full download continues in step 3.
    // -----------------------------------------------------------------------
    const initialUrls = remoteUrls.map(u => {
      if (!u) return null
      const cached = blobUrlCache.current.get(u)
      return cached || viaProxy(u)
    })
    setVideoBlobUrls(initialUrls)

    // -----------------------------------------------------------------------
    // STEP 2 — Wait for `canplay` (readyState ≥ 2 = HAVE_CURRENT_DATA) on each
    // <video>, NOT canplaythrough. canplay fires as soon as enough of the
    // video is buffered to start playing — usually seconds faster than
    // canplaythrough (which waits for the whole file). This is what unblocks
    // the editor UI.
    // -----------------------------------------------------------------------
    // Pretty-print a <video>'s TimeRanges for logs.
    const describeRanges = (tr) => {
      if (!tr || !tr.length) return '(empty)'
      const parts = []
      for (let k = 0; k < tr.length; k++) parts.push(`${tr.start(k).toFixed(2)}-${tr.end(k).toFixed(2)}`)
      return parts.join(',')
    }

    // Rich diagnostic snapshot of a <video> element. Used on timeout/error so
    // we can see exactly why playback stalled: duration, intrinsic dimensions,
    // networkState, readyState, video.error, and the currently buffered ranges.
    const describeVideoState = (el) => {
      if (!el) return '(no element)'
      const buffered = Array.from({ length: el.buffered?.length || 0 }, (_, k) => (
        [Number(el.buffered.start(k).toFixed(3)), Number(el.buffered.end(k).toFixed(3))]
      ))
      return JSON.stringify({
        readyState: el.readyState,
        networkState: el.networkState,          // 0=empty, 1=idle, 2=loading, 3=no-source
        duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : el.duration,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        paused: el.paused,
        currentTime: Number(el.currentTime.toFixed(3)),
        errorCode: el.error?.code ?? null,
        errorMessage: el.error?.message ?? null,
        buffered,
      })
    }

    const waitCanPlay = async () => {
      await new Promise(r => setTimeout(r, 50))
      const readyPromises = videoRefs.current.map((el, i) => {
        if (!el) return Promise.resolve()
        try { el.preload = 'auto'; el.load() } catch {}
        // Only mark canplaythrough (3+) as truly-ready. readyState < 3 after
        // the timeout means the file is corrupt or the decoder is stuck —
        // flag the scene as broken so the render swaps in the NB still frame.
        if (el.readyState >= 3) return Promise.resolve()
        return new Promise(resolve => {
          const t0 = Date.now()
          // `settled` guards against being called twice. This is the
          // regression cause of the "readyState=4/err=null" false-positive:
          // canplay fires first and resolves cleanly, but the 15s setTimeout
          // still fires later and would otherwise call setSceneBroken even
          // though playback is perfectly fine.
          let settled = false
          let timeoutId = null
          const done = (reason) => {
            if (settled) return
            settled = true
            if (timeoutId != null) clearTimeout(timeoutId)
            el.removeEventListener('canplay', onCanPlay)
            el.removeEventListener('canplaythrough', onCanPlayThrough)
            el.removeEventListener('loadeddata', onCanPlay)
            el.removeEventListener('error', onError)
            const rs = el.readyState
            const state = describeVideoState(el)
            console.log(`[Studio] Video ${i+1} <video> ${reason} after ${Date.now() - t0}ms state=${state}`)
            // Corrupt stream signature: timed out OR errored OR stuck at
            // readyState < 3. Do NOT mark broken on canplay/canplaythrough
            // regardless of later state changes — `settled` guard handles
            // the late-timeout race that was flagging healthy videos.
            const healthy = reason === 'canplay' || reason === 'canplaythrough'
            if (!healthy && (reason === 'timeout' || reason === 'error' || rs < 3)) {
              console.warn(`[Studio] Video ${i+1} MARKED BROKEN — reason=${reason}, state=${state}`)
              setSceneBroken(i, `${reason}/readyState=${rs}/err=${el.error?.code ?? null}`)
            }
            resolve()
          }
          const onCanPlay        = () => { if (el.readyState >= 3) done('canplay') }
          const onCanPlayThrough = () => done('canplaythrough')
          const onError          = () => done('error')
          el.addEventListener('canplay', onCanPlay)
          el.addEventListener('canplaythrough', onCanPlayThrough)
          el.addEventListener('loadeddata', onCanPlay)
          el.addEventListener('error', onError, { once: true })

          // Two-phase timeout:
          //  - At 15s: if any data is buffered or readyState ≥ 2, keep
          //    waiting — large files over a slow CDN still progress. Only
          //    mark broken if the stream is truly dead (readyState < 2 AND
          //    no buffered bytes).
          //  - At 30s: hard cap. Whatever state we're in, settle.
          timeoutId = setTimeout(() => {
            if (settled) return
            const hasProgress = el.readyState >= 2 || (el.buffered?.length || 0) > 0
            if (hasProgress) {
              console.log(`[Studio] Video ${i+1} slow but progressing at 15s (readyState=${el.readyState}, buffered=${el.buffered?.length || 0} ranges) — extending to 30s`)
              timeoutId = setTimeout(() => done('timeout'), 15000)
            } else {
              done('timeout')
            }
          }, 15000)
        })
      })
      await Promise.all(readyPromises)
      if (cancelled) return
      console.log(`[Studio] All <video> elements settled in ${Date.now() - loadStart}ms — UI unblocked (broken scenes: ${Object.keys(brokenScenesRef.current).join(',') || 'none'})`)
      setVideosReady(true)
      if (autoExportRef.current) {
        autoExportRef.current = false
        setTimeout(() => { exportMp4() }, 300)
      }
    }
    waitCanPlay()

    // -----------------------------------------------------------------------
    // STEP 3 — Background blob cache warmup (for the export path).
    // The editor can already play from the remote URLs above — these fetches
    // just pre-populate `blobUrlCache` so that when the user clicks "Export"
    // the bytes are already in memory and don't need to be re-downloaded.
    // Progress counter updates as each video arrives — user sees 1/4, 2/4, …
    // -----------------------------------------------------------------------
    // Fetch a single clip with up to 3 attempts (transient fal.ai CDN issues
    // are common — retrying usually succeeds). Each attempt gets a fresh
    // 15-second AbortController so one slow attempt can't eat the budget.
    const fetchClipWithRetry = async (remoteUrl, i, maxAttempts = 3) => {
      let lastErr = null
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const fetchUrl = viaProxy(remoteUrl)
        const start = Date.now()
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
        console.log(`[Studio] Video ${i+1} background fetch attempt ${attempt}/${maxAttempts}… url=${fetchUrl.slice(0, 100)}`)
        try {
          const resp = await fetch(fetchUrl, { signal: controller.signal })
          const ttfb = Date.now() - start
          const cl = resp.headers.get('content-length')
          const ct = resp.headers.get('content-type')
          console.log(`[Studio] Video ${i+1} attempt ${attempt} response in ${ttfb}ms, status=${resp.status}, content-type=${ct}, content-length=${cl}`)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const blob = await resp.blob()
          const totalMs = Date.now() - start
          console.log(`[Studio] Video ${i+1} attempt ${attempt} blob ready in ${totalMs}ms, size=${blob.size} (download=${totalMs - ttfb}ms)`)
          if (blob.size < 10 * 1024) throw new Error(`blob too small: ${blob.size} bytes`)
          return blob
        } catch (err) {
          lastErr = err
          const elapsed = Date.now() - start
          const reason = err?.name === 'AbortError' ? 'TIMEOUT' : 'ERROR'
          console.error(`[Studio] Video ${i+1} attempt ${attempt} ${reason} after ${elapsed}ms:`, err?.message || err)
          // Only pause between attempts — no sleep on the last one.
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1000))
        } finally {
          clearTimeout(timeoutId)
        }
      }
      throw lastErr || new Error('all attempts failed')
    }

    remoteUrls.forEach((remoteUrl, i) => {
      if (!remoteUrl) return
      if (blobUrlCache.current.has(remoteUrl)) {
        console.log(`[Studio] Video ${i+1} cache HIT`)
        if (!cancelled) setPreloadProgress(prev => ({ done: prev.done + 1, total }))
        return
      }
      fetchClipWithRetry(remoteUrl, i)
        .then(blob => {
          if (cancelled) return
          const blobUrl = URL.createObjectURL(blob)
          blobUrlCache.current.set(remoteUrl, blobUrl)
          setPreloadProgress(prev => ({ done: prev.done + 1, total }))
        })
        .catch(err => {
          if (cancelled) return
          console.error(`[Studio] Video ${i+1} ALL ATTEMPTS FAILED — marking scene broken. Last error:`, err?.message || err)
          setSceneBroken(i, `fetch_failed/${err?.name || 'err'}`)
          setSlowLoadWarning(true)
          // Still bump the counter so the UI doesn't stay stuck on N-1/N.
          setPreloadProgress(prev => ({ done: prev.done + 1, total }))
        })
    })
    if (audioRef.current && audioBlobUrl.current) {
      audioRef.current.src = audioBlobUrl.current
      audioRef.current.load()
    }
    return () => { cancelled = true }
  }, [step, result])

  // Draw subtitles on canvas overlay with selected style
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !result?.story?.scenes?.[currentScene]) return
    const subtitle = result.story.scenes[currentScene].subtitle
    if (!subtitle) return
    const ctx = canvas.getContext('2d')
    const container = canvas.parentElement
    canvas.width = container.offsetWidth
    canvas.height = container.offsetHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const segments = result.subtitleSegments || null
    const sceneStart = currentScene * 5
    const lines = getSubtitleLinesAtTime(subtitle, 0, 5, segments, sceneStart)
    drawSubtitlePreview(ctx, lines, canvas.width, canvas.height, subtitleStyle)
  }, [currentScene, result, step, subtitleStyle])

  // Stop music preview on track change
  useEffect(() => {
    if (musicAudioRef.current) { try { musicAudioRef.current.pause() } catch {} }
    setMusicPreviewing(false)
  }, [bgMusic])

  const avatarUrl = customAvatar || selectedAvatar?.url
  const addLog = (msg, type='') => setLogs(p => [...p, {msg, type, t: new Date().toLocaleTimeString('he-IL')}])

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setCustomAvatar(ev.target.result); setSelectedAvatar(null) }
    reader.readAsDataURL(file)
  }

  // ── Voiceover re-record (one-shot per video session) ──
  // Works for BOTH freshly generated videos AND saved-edit restores via ?editId=
  // because both flows hydrate result.hebrewVoice and audioBlobUrl identically.
  const openRerecordPanel = () => {
    if (hasRerecorded || rerecording) return
    const initial = (result?.hebrewVoice || '').trim()
    setRerecordText(initial)
    setShowRerecordPanel(true)
  }
  const closeRerecordPanel = () => { setShowRerecordPanel(false); setRerecordText('') }

  const rerecordVoiceover = async (textOverride) => {
    if (hasRerecorded || rerecording) return
    const text = (textOverride ?? rerecordText ?? '').trim()
    if (!text) { alert('אין טקסט קריינות לשלוח'); return }
    // Prefer the voiceId the job actually ran with (persisted on the result
    // object by /api/agent). Fall back to the selected state only if the
    // result didn't carry one through (e.g. legacy saved edits). This guards
    // against state drift if the user re-opens the voice picker after
    // generation and accidentally changes the selection.
    const effectiveVoiceId = result?.voiceId || voiceId
    if (!effectiveVoiceId) {
      alert('voiceId חסר — לא ניתן להקליט מחדש')
      return
    }
    setRerecording(true)
    addLog('שולח טקסט ל-ElevenLabs...')
    console.log('[Studio] rerecord POST /api/voice voiceId=', effectiveVoiceId, '(state=', voiceId, ', result=', result?.voiceId, ')')
    try {
      const vRes = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: effectiveVoiceId })
      })
      if (!vRes.ok) {
        const errBody = await vRes.json().catch(() => ({}))
        throw new Error(errBody.error || `Voice API ${vRes.status}`)
      }
      const { base64, wordTimestamps = [], duration = 0 } = await vRes.json()
      if (!base64) throw new Error('No audio returned')

      // Decode base64 → Blob → object URL, swap into the audio element AND
      // update audioBlobUrl.current so the export pipeline sees the new audio.
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const newUrl = URL.createObjectURL(blob)
      // Free the prior blob URL to avoid memory leaks across re-records
      if (audioBlobUrl.current && audioBlobUrl.current.startsWith('blob:')) {
        try { URL.revokeObjectURL(audioBlobUrl.current) } catch {}
      }
      audioBlobUrl.current = newUrl
      if (audioRef.current) {
        audioRef.current.src = newUrl
        audioRef.current.load()
      }

      // Persist new script + timestamps + rebuilt subtitle segments on result.
      // The export pipeline reads result.audioBase64 and result.wordTimestamps,
      // so updating both here means the next export uses the new voice.
      setResult(r => {
        if (!r) return r
        const subtitleSegments = wordTimestamps?.length
          ? buildSubtitleSegments(wordTimestamps, 3)
          : r.subtitleSegments
        return {
          ...r,
          hebrewVoice: text,
          audioBase64: base64,
          wordTimestamps,
          subtitleSegments,
          voiceDuration: duration
        }
      })

      setHasRerecorded(true)
      setShowRerecordPanel(false)
      setRerecordText('')
      addLog('קריינות חדשה מוכנה!', 'ok')
    } catch (e) {
      addLog('שגיאה בהקלטה מחדש: ' + e.message, 'err')
      alert('שגיאה: ' + e.message)
    } finally {
      setRerecording(false)
    }
  }

  const runAgent = async () => {
    const currentCheck = customAvatar || selectedAvatar?.url
    if (!currentCheck) return alert('בחר דמות')
    if (mode === 'ugc') {
      if (!productName || !productDesc) return alert('הכנס שם ותיאור מוצר')
    } else {
      if (!businessName || !businessDescription) return alert('הכנס שם ותיאור עסק')
      if (businessPhotos.length === 0) return alert('העלה לפחות תמונה אחת של העסק')
    }
    setStep('generating'); setLogs([]); setAgentStatus({ script: 'active' });
    setHasRerecorded(false); setShowRerecordPanel(false); setRerecordText('');
    addLog('Agent מתחיל לעבוד...')
    try {
      const currentAvatarUrl = customAvatar || selectedAvatar?.url
      addLog('Avatar: ' + (currentAvatarUrl ? currentAvatarUrl.slice(0,40) : 'NONE'), currentAvatarUrl ? '' : 'err')
      let finalAvatarUrl = currentAvatarUrl
      if (currentAvatarUrl && currentAvatarUrl.startsWith('data:')) {
        addLog('מעלה אווטאר ל-fal.ai...')
        const [header, base64] = avatarUrl.split(',')
        const mime = header.match(/:(.*?);/)[1]
        const bc = atob(base64), ba = new Uint8Array(bc.length)
        for (let i = 0; i < bc.length; i++) ba[i] = bc.charCodeAt(i)
        const blob = new Blob([ba], { type: mime })
        const fd = new FormData(); fd.append('file', blob, 'avatar.jpg'); fd.append('falKey', falKey)
        const up = await fetch('/api/upload', { method: 'POST', body: fd })
        const upData = await up.json()
        finalAvatarUrl = upData.url || upData.access_url
        addLog('אווטאר הועלה', 'ok')
      }
      addLog('שולח בקשה ל-Agent...'); setAgentStatus({ script: 'active' })
      let productImageUrl = null
      if (mode === 'ugc' && productImage && productImage.startsWith('data:')) {
        const [ph, pb] = productImage.split(',')
        const pm = ph.match(/:(.*?);/)[1]
        const pbc = atob(pb), pba = new Uint8Array(pbc.length)
        for (let i = 0; i < pbc.length; i++) pba[i] = pbc.charCodeAt(i)
        const pblob = new Blob([pba], { type: pm })
        const pfd = new FormData(); pfd.append('file', pblob, 'product.jpg'); pfd.append('falKey', falKey)
        addLog('מעלה תמונת מוצר...')
        const pup = await fetch('/api/upload', { method: 'POST', body: pfd })
        const pupData = await pup.json()
        productImageUrl = pupData.url || pupData.access_url
        addLog('מוצר הועלה', 'ok')
      }
      // In business mode the businessPhotos are already data URLs — send them directly
      // (the agent route accepts data: URLs via the same prepareUrl path)
      const bizPayload = mode === 'business' ? {
        videoType: 'business',
        businessName,
        businessDescription,
        businessPhotos,
      } : {
        videoType: 'ugc',
        product: productDesc,
        productName,
        applicationArea,
        storyDescription,
        productImageUrl,
      }
      const agentRes = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...bizPayload, avatarUrl: finalAvatarUrl, falKey, elevenKey, voiceId, userId })
      })
      if (!agentRes.ok) throw new Error('Agent failed')
      const { jobId } = await agentRes.json()
      if (!jobId) throw new Error('No jobId returned')
      // Persist jobId + the reference URLs we just used so the
      // regenerate-scene endpoint can replay any one scene without the
      // user re-entering the form.
      setJobId(jobId)
      setLastGenPayload({
        videoType: mode === 'business' ? 'business' : 'ugc',
        avatarUrl: finalAvatarUrl,
        productImageUrl,
        businessPhotos,
      })
      setRegenCounts({})
      addLog(`Job ${jobId.slice(0, 8)}... נוצר, ממתין לתוצאות...`)

      const steps = ['script', 'frames', 'videos', 'voice']
      let stepIdx = 0
      const progressInterval = setInterval(() => {
        stepIdx = Math.min(stepIdx + 1, steps.length - 1)
        const status = {}
        for (let i = 0; i < steps.length; i++) {
          if (i < stepIdx) status[steps[i]] = 'done'
          else if (i === stepIdx) status[steps[i]] = 'active'
        }
        setAgentStatus(status)
      }, 45000)

      const pollResult = await new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/agent/status?jobId=${jobId}`)
            const statusData = await statusRes.json()
            if (statusData.status === 'done') { clearInterval(poll); clearInterval(progressInterval); resolve(statusData.result) }
            else if (statusData.status === 'error') { clearInterval(poll); clearInterval(progressInterval); reject(new Error(statusData.error || 'Job failed')) }
          } catch { addLog('שגיאת רשת בבדיקת סטטוס, מנסה שוב...', 'err') }
        }, 3000)
      })

      const data = pollResult
      if (data.frames) data.frames.forEach((f, i) => addLog(f ? `Frame ${i+1}: OK` : `Frame ${i+1}: נכשל`, f ? 'ok' : 'err'))
      if (data.videos) data.videos.forEach((v, i) => addLog(v ? `סרטון ${i+1}: OK` : `סרטון ${i+1}: נכשל`, v ? 'ok' : 'err'))
      setAgentStatus({ script: 'done', frames: 'done', videos: 'done', voice: data.audioBase64 ? 'done' : 'error' })
      addLog(data.audioBase64 ? 'קריינות מוכנה!' : 'קריינות נכשלה', data.audioBase64 ? 'ok' : 'err')
      if (data.audioBase64) {
        const blob = new Blob([Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0))], { type: 'audio/mpeg' })
        audioBlobUrl.current = URL.createObjectURL(blob)
      }
      // Build subtitle segments from word-level timestamps if available
      if (data.wordTimestamps?.length) {
        data.subtitleSegments = buildSubtitleSegments(data.wordTimestamps, 3)
        console.log('[Studio] Subtitle segments from alignment:', data.subtitleSegments.length, 'segments')
      }
      // Guarantee the voiceId the user selected is on the result, even if the
      // server response ever drops the field — re-record reads result.voiceId
      // first. Logged so we can verify end-to-end voice routing.
      if (!data.voiceId) data.voiceId = voiceId
      console.log('[Studio] Generation complete, result.voiceId=', data.voiceId, '(state voiceId=', voiceId, ')')
      setResult(data)
      const hasVideos = data.videos?.some(v => v)
      if (hasVideos) { setStep('done') } else { addLog('לא נוצרו סרטונים — נשאר בדף הלוגים', 'err') }
    } catch (e) { addLog(e.message, 'err'); alert('שגיאה: ' + e.message); setStep('form') }
  }

  const loadScene = (idx) => {
    setCurrentScene(idx)
    // Swap visibility among preloaded <video> elements — no reload, no freeze
    const orderPos = clipOrder.indexOf(idx)
    videoRefs.current.forEach((v, i) => {
      if (!v) return
      try { v.pause(); v.currentTime = 0 } catch {}
      v.style.opacity = i === orderPos ? '1' : '0'
    })
  }

  // Drag-and-drop
  const handleDragStart = (e, idx) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', idx) }
  const handleDragOver = (e, idx) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const newOrder = [...clipOrder]; const [moved] = newOrder.splice(dragIdx, 1); newOrder.splice(idx, 0, moved)
    setClipOrder(newOrder); setDragIdx(idx)
  }
  const handleDragEnd = () => setDragIdx(null)

  // Regenerate a single scene (1-4) without remaking the whole video.
  // Hits POST /api/agent/regenerate-scene with the same reference set used
  // in the original job, updates result.frames[N] and result.videos[N],
  // and triggers the video-loading pipeline so the new clip shows up.
  const regenerateScene = async (sceneNumber) => {
    if (!jobId || !result || !lastGenPayload) {
      setRegenMsg('לא ניתן לייצר מחדש — צור סרטון חדש תחילה')
      return
    }
    if (regenLoading !== null) return
    setRegenLoading(sceneNumber)
    setRegenMsg(`מייצר מחדש סצנה ${sceneNumber}... (1-2 דקות)`)
    try {
      const res = await fetch('/api/agent/regenerate-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, sceneNumber, ...lastGenPayload }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.success) {
        const msg = body.error || `שגיאה ${res.status}`
        setRegenMsg(`סצנה ${sceneNumber} — ${msg}`)
        // If NB succeeded but Kling failed, body.newFrameUrl may be set.
        // Update the frame in the result so the user at least sees the
        // regenerated still.
        if (body.newFrameUrl && result?.frames) {
          const framesCopy = [...result.frames]
          framesCopy[sceneNumber - 1] = body.newFrameUrl
          setResult({ ...result, frames: framesCopy })
        }
        return
      }
      // Success: replace the new result, reset blob cache for this scene
      // so the video-loading effect re-fetches just scene N.
      setResult(body.result)
      setRegenCounts(body.regenerations_used || {})
      setVideoBlobUrls(prev => {
        const next = [...prev]
        next[sceneNumber - 1] = null
        return next
      })
      setVideosReady(false)
      setRegenMsg(`סצנה ${sceneNumber} עודכנה ✓`)
    } catch (e) {
      setRegenMsg(`סצנה ${sceneNumber} נכשלה: ${e.message || 'שגיאת רשת'}`)
    } finally {
      setRegenLoading(null)
    }
  }

  // Toggle music preview — real <audio> element playing the track URL
  const toggleMusicPreview = useCallback(() => {
    const el = musicAudioRef.current
    if (!el) return
    if (musicPreviewing) {
      try { el.pause() } catch {}
      setMusicPreviewing(false); return
    }
    if (bgMusic === 'none') return
    const track = MUSIC_TRACKS.find(t => t.id === bgMusic)
    if (!track?.url) return
    try {
      el.src = track.url
      el.volume = 0.35
      el.loop = true
      el.currentTime = 0
      el.play().then(() => setMusicPreviewing(true)).catch(() => setMusicPreviewing(false))
    } catch { setMusicPreviewing(false) }
  }, [bgMusic, musicPreviewing])

  // === Seamless back-to-back playback controller ===
  // All clips rendered as separate <video> elements, preloaded. Switch opacity + play() — zero reload, zero setState during playback.
  const playAll = useCallback(async () => {
    if (!result?.videos) return
    const videoEls = videoRefs.current.filter(Boolean)
    console.log(`[Studio] playAll started, video elements: ${videoEls.length}, DOM <video> count: ${typeof document !== 'undefined' ? document.querySelectorAll('video').length : 'N/A'}`)
    if (videoEls.length === 0) return

    if (playing) {
      playingRef.current = false
      setPlaying(false)
      videoEls.forEach(v => { try { v.pause() } catch {} })
      if (audioRef.current) { try { audioRef.current.pause() } catch {} }
      if (musicAudioRef.current) { try { musicAudioRef.current.pause() } catch {} }
      return
    }

    setPlaying(true); playingRef.current = true

    // Opacity is on the WRAPPING <div>, not the <video> itself — because
    // broken scenes layer a still-frame <img> on top and both need to be
    // hidden together during playback of other scenes. Walk to parentElement
    // so the cross-fade actually shows the next scene.
    const getOpacityTarget = (v) => v?.parentElement || v

    // Reset all videos to t=0, show only first
    videoEls.forEach((v, i) => {
      try { v.pause(); v.currentTime = 0 } catch {}
      const target = getOpacityTarget(v)
      target.style.opacity = i === 0 ? '1' : '0'
      target.style.transition = 'opacity 40ms linear'
      console.log(`[Studio] Scene ${i} mount: tag=${v.tagName}, src=${v.src?.slice(0, 80)}, readyState=${v.readyState}, opacity=${target.style.opacity}`)
    })

    // Start voiceover
    if (audioRef.current && audioBlobUrl.current) {
      try { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => {}) } catch {}
    }
    // Start real music track
    const track = MUSIC_TRACKS.find(t => t.id === bgMusic)
    if (track?.url && musicAudioRef.current) {
      try {
        const m = musicAudioRef.current
        if (m.src !== track.url) m.src = track.url
        m.volume = 0.15
        m.loop = true
        m.currentTime = 0
        m.play().catch(() => {})
      } catch {}
    }

    // Subtitle overlay rAF — reads currentPlayingIdxRef, no state reads
    const subtitleTick = () => {
      if (!playingRef.current) return
      const idx = currentPlayingIdxRef.current
      const sceneIdx = clipOrder[idx]
      const activeVid = videoEls[idx]
      if (!activeVid || activeVid.paused || activeVid.ended) {
        requestAnimationFrame(subtitleTick); return
      }
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        const container = canvas.parentElement
        if (canvas.width !== container.offsetWidth) canvas.width = container.offsetWidth
        if (canvas.height !== container.offsetHeight) canvas.height = container.offsetHeight
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        const subtitle = result.story?.scenes?.[sceneIdx]?.subtitle || ''
        const elapsed = activeVid.currentTime
        const segments = result.subtitleSegments || null
        const sceneStart = idx * 5
        const lines = getSubtitleLinesAtTime(subtitle, elapsed, 5, segments, sceneStart)
        drawSubtitlePreview(ctx, lines, canvas.width, canvas.height, subtitleStyle)
      }
      requestAnimationFrame(subtitleTick)
    }

    // Chain clips: on ended, immediately swap opacity + play next (zero gap)
    const playChain = (idx) => {
      if (!playingRef.current) return
      if (idx >= videoEls.length) {
        // Done
        console.log('[Studio] playChain finished after', videoEls.length, 'scenes')
        playingRef.current = false
        setPlaying(false)
        if (audioRef.current) { try { audioRef.current.pause() } catch {} }
        if (musicAudioRef.current) { try { musicAudioRef.current.pause() } catch {} }
        return
      }
      currentPlayingIdxRef.current = idx
      const v = videoEls[idx]
      const prev = idx > 0 ? videoEls[idx - 1] : null
      // Pause the outgoing video so its audio track can't overlap the next.
      if (prev) { try { prev.pause() } catch {} }
      // Swap visibility on the WRAPPING div (opacity is there, not on <video>).
      videoEls.forEach((el, i) => {
        const target = getOpacityTarget(el)
        target.style.opacity = i === idx ? '1' : '0'
      })
      console.log(`[Studio] Switching opacity: scene ${idx - 1} -> ${idx}, readyState=${v.readyState}, src=${v.src?.slice(0, 80)}`)
      try { v.currentTime = 0 } catch {}
      // Immediately play — catch autoplay rejection so a single scene failure
      // doesn't leave the chain stuck.
      const playPromise = v.play()
      if (playPromise?.catch) {
        playPromise.catch(err => {
          console.warn(`[Studio] Scene ${idx} play() rejected:`, err?.message || err, '— advancing to next scene')
          // Skip ahead so the whole sequence doesn't stall on one bad clip.
          setTimeout(() => playChain(idx + 1), 100)
        })
      }
      const onEnded = () => {
        console.log(`[Studio] Scene ${idx} ENDED at ${v.currentTime.toFixed(2)}s — transitioning to ${idx + 1}`)
        v.removeEventListener('ended', onEnded)
        playChain(idx + 1)
      }
      v.addEventListener('ended', onEnded, { once: true })
    }

    // Kick off rAF + chain
    requestAnimationFrame(subtitleTick)
    playChain(0)
  }, [result, clipOrder, bgMusic, playing, subtitleStyle])

  // === Server-side FFmpeg export via /api/export ===
  const exportMp4 = async () => {
    if (!result?.videos?.length) return
    setExporting(true); setExportProgress('מכין ייצוא... 0%')
    try {
      const orderedScenes = clipOrder.filter(i => result.videos[i])
      if (orderedScenes.length === 0) throw new Error('אין סרטונים לייצוא')

      // Log the job result structure so we can see what we're working with
      console.log('[Studio Export] result.videos:', result?.videos)
      console.log('[Studio Export] clipOrder:', clipOrder)
      console.log('[Studio Export] orderedScenes:', orderedScenes)
      console.log('[Studio Export] videoBlobUrls:', videoBlobUrls)
      console.log('[Studio Export] result.story?.scenes:', result?.story?.scenes?.map((s, i) => ({ i, video_url: s?.video_url })))

      // Always encode base64 from the preloaded blob URL (already in browser memory — fast & reliable).
      // HTTP URLs from Kling/fal.ai expire, so we only use them as a LAST RESORT.
      // videoUrls are still sent so the server has a secondary fallback.
      setExportProgress('מכין קליפים... 5%')
      const videoUrls = orderedScenes.map(si => {
        const u = result.videos?.[si]
        return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? u : null
      })

      const videoClipsB64 = []
      for (let idx = 0; idx < orderedScenes.length; idx++) {
        const si = orderedScenes[idx]
        const remoteUrl = result.videos?.[si]
        const cachedBlobUrl = remoteUrl ? blobUrlCache.current.get(remoteUrl) : null
        const stateUrl = videoBlobUrls[si]
        const httpUrl = videoUrls[idx]
        // Prefer the warmed blob cache (step 3 of preload), then any blob: URL
        // in state, then HTTP URL as final fallback.
        const src = cachedBlobUrl || (stateUrl?.startsWith('blob:') ? stateUrl : httpUrl)
        console.log(`[Studio Export] clip ${idx} (scene ${si}) — cachedBlobUrl:`, cachedBlobUrl, 'stateUrl:', stateUrl, 'httpUrl:', httpUrl, 'chosen src:', src)
        if (!src) {
          console.error(`[Studio Export] clip ${idx} (scene ${si}) has NO source — neither blob nor http URL`)
          throw new Error(`קליפ ${idx + 1} לא זמין — נסה ליצור מחדש`)
        }
        try {
          const resp = await fetch(src)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const buf = await resp.arrayBuffer()
          console.log(`[Studio Export] clip ${idx} blob size: ${buf.byteLength} bytes (${(buf.byteLength / 1024 / 1024).toFixed(2)}MB)`)
          if (buf.byteLength < 10 * 1024) {
            console.error(`[Studio Export] clip ${idx} is only ${buf.byteLength} bytes — likely corrupt`)
            throw new Error(`קליפ ${idx + 1} פגום (${buf.byteLength} בייטים). צור סרטון חדש.`)
          }
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let j = 0; j < bytes.length; j += 8192) {
            binary += String.fromCharCode(...bytes.slice(j, j + 8192))
          }
          const b64 = btoa(binary)
          console.log(`[Studio Export] clip ${idx} base64 length: ${b64.length} chars`)
          videoClipsB64.push(b64)
        } catch (e) {
          console.error(`[Studio Export] clip ${idx} fetch/encode failed:`, e.message)
          throw new Error(`קליפ ${idx + 1} לא זמין (${e.message}) — נסה ליצור מחדש`)
        }
        setExportProgress(`מכין קליפים... ${5 + Math.round(((idx + 1) / orderedScenes.length) * 10)}%`)
      }
      console.log(`[Studio Export] SUMMARY — ${videoClipsB64.length} clips encoded, total base64 chars: ${videoClipsB64.reduce((a, b) => a + (b?.length || 0), 0)}`)

      // Build subtitles array with timestamps
      let timeOffset = 0
      const subtitles = orderedScenes.map(i => {
        const text = result.story?.scenes?.[i]?.subtitle || ''
        const sub = { text, start: timeOffset, duration: 5 }
        timeOffset += 5
        return sub
      })

      setExportProgress('שולח לשרת... 20%')

      // Convert MP3 voiceover → WAV (raw PCM) on the CLIENT so FFmpeg never has to decode MP3.
      // Web Audio API's decodeAudioData handles MP3 reliably; the resulting WAV is bulletproof server-side.
      let voiceAudioB64 = result.audioBase64 || null
      let audioFormat = 'mp3'
      if (voiceAudioB64) {
        try {
          setExportProgress('ממיר קול ל-WAV... 16%')
          const wav = await mp3Base64ToWavBase64(voiceAudioB64)
          voiceAudioB64 = wav.base64
          audioFormat = 'wav'
          console.log('[Studio] Voice WAV:', wav.byteLength, 'bytes,', wav.sampleRate, 'Hz,', wav.channels, 'ch,', wav.duration.toFixed(2), 's')
        } catch (e) {
          console.warn('[Studio] Client-side WAV conversion failed — falling back to raw MP3:', e.message)
        }
      }

      // NB frame URLs / data URIs per scene — server uses these as the visual
      // fallback when a Kling clip is corrupt, so users see the product image
      // instead of a black screen.
      const nbFrameUrls = orderedScenes.map(si => result.frames?.[si] || null)
      console.log('[Studio Export] nbFrameUrls:', nbFrameUrls.map((u, i) => ({ i, present: !!u, kind: !u ? 'null' : u.startsWith?.('data:') ? 'data-uri' : 'http' })))

      const bgMusicTrack = MUSIC_TRACKS.find(t => t.id === bgMusic)
      const resp = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrls,
          videoClipsB64,
          nbFrameUrls,
          audioBase64: voiceAudioB64,
          audioFormat,
          subtitles,
          wordTimestamps: result.wordTimestamps || null,   // enables word-level ASS subtitles
          bgMusic,
          bgMusicUrl: bgMusicTrack?.url || null,
          subtitleStyle,
        })
      })

      setExportProgress('FFmpeg מעבד... 50%')

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
        throw new Error(err.error || 'שגיאת שרת')
      }

      setExportProgress('מוריד MP4... 90%')
      const blob = await resp.blob()
      if (blob.size < 1000) throw new Error('ייצוא נכשל — קובץ ריק')

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = 'ugc-video.mp4'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setExportProgress('הושלם! 100%')
      setTimeout(() => setExportProgress(''), 3000)
    } catch (e) {
      console.error('Export error:', e)
      alert('שגיאה בייצוא: ' + e.message)
      setExportProgress('')
    } finally { setExporting(false) }
  }

  // === Save Edit to Supabase ===
  const saveEdit = async () => {
    if (!result) return
    setSavingEdit(true); setSaveMsg('')
    try {
      if (!supabase) { setSaveMsg('Supabase לא מוגדר'); setSavingEdit(false); return }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setSaveMsg('יש להתחבר כדי לשמור'); setSavingEdit(false); return }
      const thumbnail = result.frames?.[0] || result.videos?.[0] || null
      const editData = {
        product_name: productName || 'ללא שם',
        clip_order: clipOrder,
        subtitle_style: subtitleStyle,
        bg_music: bgMusic,
        sfx_enabled: sfxEnabled,
        transition: transition,
        videos: result.videos,
        frames: result.frames,
        story: result.story,
        hebrew_voice: result.hebrewVoice,
        audio_base64: result.audioBase64 || null,
        word_timestamps: result.wordTimestamps || null,
        // Persist the voiceId the job actually ran with so re-record after
        // a reload picks the original voice, even if the state selector
        // has since been changed by the user.
        voice_id: result?.voiceId || voiceId,
        voice_gender: voiceGender,
        thumbnail: thumbnail,
        // Persist the regenerate-scene payload so the editor (saved-edit
        // restore path) can re-run any single scene later. Without these,
        // the regen card stays hidden because jobId/lastGenPayload are null.
        job_id: jobId,
        last_gen_payload: lastGenPayload,
        regenerations_used: regenCounts,
      }
      const { error } = await supabase.from('saved_edits').insert({
        user_id: user.id,
        edit_data: editData,
      })
      if (error) {
        console.warn('Save edit error:', error.message)
        // Fallback: save to localStorage
        try {
          const key = `saved_edit_${user.id}_${Date.now()}`
          localStorage.setItem(key, JSON.stringify(editData))
          setSaveMsg('נשמר מקומית (DB לא זמין)')
        } catch { setSaveMsg('שגיאה בשמירה') }
      } else {
        setSaveMsg('נשמר בהצלחה!')
      }
      setTimeout(() => setSaveMsg(''), 4000)
    } catch (e) {
      console.warn('Save edit error:', e.message)
      setSaveMsg('שגיאה: ' + e.message)
      setTimeout(() => setSaveMsg(''), 4000)
    } finally { setSavingEdit(false) }
  }

  // ===== FORM STEP =====
  if (step === 'form') return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: '#F5F5F4', marginBottom: 4 }}>יצירת סרטון</h1>
          <p style={{ color: '#52525b', fontSize: 14 }}>Agent AI יוצר 4 סצנות מחוברות — סיפור אחד שלם</p>
        </div>
        <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#52525b', fontSize: 13, textDecoration: 'none' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          חזרה לדשבורד
        </a>
      </div>

      {/* Mode toggle */}
      <div style={cardS}>
        <div style={secTitle}>סוג סרטון</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { id: 'ugc', label: 'סרטון UGC', emoji: '🎬', desc: 'מודעה למוצר' },
            { id: 'business', label: 'סרטון עסק', emoji: '🏪', desc: 'מודעה לעסק מקומי' },
          ].map(m => {
            const sel = mode === m.id
            return (
              <button key={m.id} onClick={() => setMode(m.id)}
                style={{
                  padding: 18, borderRadius: 14,
                  border: `2px solid ${sel ? 'rgba(255,0,128,0.6)' : 'rgba(255,255,255,0.08)'}`,
                  background: sel ? 'rgba(255,0,128,0.08)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                  direction: 'rtl', fontFamily: 'Heebo,sans-serif', transition: 'all 200ms ease'
                }}>
                <div style={{ fontSize: 28 }}>{m.emoji}</div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#F5F5F4' }}>{m.label} {m.emoji}</div>
                  <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>{m.desc}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* API Keys */}
      <div style={cardS}>
        <button onClick={() => setKeysOpen(o => !o)} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF0080" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          API Keys
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: keysOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 200ms' }}><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {keysOpen && (
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={lblS}>fal.ai Key</label><input type="password" value={falKey} onChange={e => setFalKey(e.target.value)} placeholder="xxxxxxxx:xxxxxxxx" style={{ ...inpS, marginTop: 6 }} /></div>
            <div><label style={lblS}>ElevenLabs Key</label><input type="password" value={elevenKey} onChange={e => setElevenKey(e.target.value)} placeholder="sk_xxxxxxxx" style={{ ...inpS, marginTop: 6 }} /></div>
            <div style={{ gridColumn: '1/-1', background: 'rgba(255,0,128,0.04)', border: '1px solid rgba(255,0,128,0.12)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#52525b' }}>
              <span style={{ color: '#FF0080', fontWeight: 600 }}>Claude API</span> רץ בשרת — לא צריך מפתח
            </div>
          </div>
        )}
      </div>

      {/* Avatar Selection */}
      <div style={cardS}>
        <div style={secTitle}>בחר דמות</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          {AVATARS.map(av => {
            const sel = selectedAvatar?.name === av.name && !customAvatar
            const allowed = canUseAvatar(userTier, av.name)
            return (
              <div key={av.name} onClick={() => {
                  if (!allowed) { setUpgradeOpen(true); return }
                  setSelectedAvatar(av); setCustomAvatar(null)
                }}
                style={{ position: 'relative', border: `2px solid ${sel ? 'rgba(255,0,128,0.6)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', aspectRatio: '3/4', boxShadow: sel ? '0 0 24px rgba(255,0,128,0.2)' : 'none', transition: 'all 300ms ease' }}>
                <img src={av.url} alt={av.name} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: allowed ? 'none' : 'grayscale(1) brightness(0.55)' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', padding: '20px 6px 6px', fontSize: 11, color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontWeight: 500 }}>{av.name}</div>
                {sel && <div style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, background: 'linear-gradient(135deg, #FF0080, #FF0080)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                </div>}
                {!allowed && <div style={{ position: 'absolute', top: 6, left: 6, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,0,128,0.9)', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>🔒 פרו בלבד</div>}
              </div>
            )
          })}
          <div style={{ position: 'relative', border: `2px solid ${customAvatar ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', aspectRatio: '3/4', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: customAvatar ? 'transparent' : 'rgba(255,255,255,0.02)', backgroundImage: customAvatar ? `url(${customAvatar})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', transition: 'all 300ms ease' }}>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
            {!customAvatar && <>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span style={{ fontSize: 10, color: '#52525b' }}>העלה שלך</span>
            </>}
            {customAvatar && <div style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, background: '#22c55e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
            </div>}
          </div>
        </div>
      </div>

      {/* Product / Business Details */}
      {mode === 'ugc' ? (
      <div style={cardS}>
        <div style={secTitle}>פרטי המוצר</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={lblS}>שם המוצר הספציפי</label>
            <input value={productName} onChange={e => setProductName(e.target.value)} placeholder="HiSmile Whitening Strips" style={{ ...inpS, direction: 'rtl', fontFamily: 'Heebo,sans-serif', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>מה הוא פותר?</label>
            <textarea value={productDesc} onChange={e => setProductDesc(e.target.value)} placeholder="רצועות הלבנת שיניים שמלבינות תוך 7 ימים..." style={{ ...inpS, height: 80, direction: 'rtl', fontFamily: 'Heebo,sans-serif', resize: 'none', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>איך משתמשים?</label>
            <input value={applicationArea} onChange={e => setApplicationArea(e.target.value)} placeholder="מניחים על השיניים למשך 30 דקות" style={{ ...inpS, direction: 'rtl', fontFamily: 'Heebo,sans-serif', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>תמונת מוצר (חשוב!)</label>
            <div style={{ marginTop: 6, border: `2px dashed ${productImage ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, minHeight: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden', background: 'rgba(255,255,255,0.02)', transition: 'all 300ms ease' }}>
              <input type="file" accept="image/*" onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setProductImage(ev.target.result); r.readAsDataURL(f) }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
              {productImage ? <img src={productImage} alt="product" style={{ maxHeight: 80, borderRadius: 8 }} /> : <span style={{ color: '#3f3f46', fontSize: 13 }}>לחץ להעלאת תמונת מוצר</span>}
            </div>
          </div>
          <div>
            <label style={lblS}>תיאור סיפור מותאם (אופציונלי)</label>
            <textarea value={storyDescription} onChange={e => setStoryDescription(e.target.value)} placeholder="תאר סיפור מותאם אישית..." style={{ ...inpS, height: 80, direction: 'rtl', fontFamily: 'Heebo,sans-serif', resize: 'none', marginTop: 6 }} />
          </div>
        </div>
      </div>
      ) : (
      <div style={cardS}>
        <div style={secTitle}>פרטי העסק</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={lblS}>שם העסק</label>
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="מסעדת פסטה רומא" style={{ ...inpS, direction: 'rtl', fontFamily: 'Heebo,sans-serif', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>תיאור העסק</label>
            <textarea value={businessDescription} onChange={e => setBusinessDescription(e.target.value)} placeholder="מסעדה איטלקית בתל אביב, אוכל ביתי, אווירה משפחתית" style={{ ...inpS, height: 90, direction: 'rtl', fontFamily: 'Heebo,sans-serif', resize: 'none', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>תמונות העסק (1-4 תמונות)</label>
            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {businessPhotos.map((img, i) => (
                <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', border: '2px solid rgba(34,197,94,0.4)' }}>
                  <img src={img} alt={`business-${i}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button
                    onClick={() => setBusinessPhotos(p => p.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(239,68,68,0.9)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >×</button>
                </div>
              ))}
              {businessPhotos.length < 4 && (
                <div style={{ position: 'relative', aspectRatio: '1', border: '2px dashed rgba(255,255,255,0.08)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'rgba(255,255,255,0.02)' }}>
                  <input type="file" accept="image/*" onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setBusinessPhotos(p => [...p, ev.target.result]); r.readAsDataURL(f) }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </div>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#52525b', marginTop: 6, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>העלה תמונות של המקום, האוכל, המוצרים או האווירה</div>
          </div>
        </div>
      </div>
      )}

      {/* Voice Selection */}
      <div style={cardS}>
        <div style={secTitle}>בחר קול</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { id: 'cp6q5qJLs8rR7eAWOepf', name: 'נועה', gender: 'female', emoji: '👩' },
            { id: 'nBiC8Jexp2XGyIxATg9S', name: 'דניאל', gender: 'male', emoji: '👨' },
          ].map(v => {
            const selected = voiceId === v.id
            const isPlaying = voicePreviewing === v.id
            const allowed = canUseVoice(userTier, v.id)
            return (
              <div
                key={v.id}
                onClick={() => {
                  if (!allowed) { setUpgradeOpen(true); return }
                  setVoiceId(v.id); setVoiceGender(v.gender)
                }}
                style={{
                  padding: 18,
                  borderRadius: 14,
                  border: `2px solid ${selected ? 'rgba(255,0,128,0.6)' : 'rgba(255,255,255,0.08)'}`,
                  background: selected ? 'rgba(255,0,128,0.08)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  direction: 'rtl',
                  fontFamily: 'Heebo,sans-serif',
                  transition: 'all 300ms ease',
                  opacity: allowed ? 1 : 0.55,
                  position: 'relative',
                }}
              >
                <div style={{ fontSize: 32 }}>{v.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#F5F5F4' }}>{v.name}</div>
                  <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>{v.gender === 'female' ? 'קול נשי' : 'קול גברי'}</div>
                </div>
                {!allowed && <div style={{ position: 'absolute', top: 6, left: 6, padding: '3px 8px', borderRadius: 6, background: 'rgba(255,0,128,0.9)', color: '#fff', fontSize: 10, fontWeight: 700 }}>🔒 פרו בלבד</div>}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (voicePreviewRef.current) { try { voicePreviewRef.current.pause() } catch {} }
                    if (isPlaying) { setVoicePreviewing(null); return }
                    const audio = new Audio(`/api/voice-preview?voiceId=${v.id}`)
                    audio.onended = () => setVoicePreviewing(null)
                    audio.onerror = () => setVoicePreviewing(null)
                    audio.play().catch(() => setVoicePreviewing(null))
                    voicePreviewRef.current = audio
                    setVoicePreviewing(v.id)
                  }}
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: isPlaying ? 'rgba(239,68,68,0.15)' : 'rgba(255,0,128,0.15)',
                    border: `1px solid ${isPlaying ? 'rgba(239,68,68,0.4)' : 'rgba(255,0,128,0.4)'}`,
                    color: isPlaying ? '#ef4444' : '#FF0080',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}
                  title={isPlaying ? 'עצור' : 'נגן'}
                >
                  {isPlaying
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>}
                </button>
                {selected && (
                  <div style={{ position: 'absolute' }}>
                    <div style={{ width: 20, height: 20, background: '#FF0080', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: -28, marginTop: -24 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <button onClick={runAgent} style={bigBtn}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          הפעל Agent — צור 4 סצנות מחוברות
        </span>
      </button>
    </div>
  )

  // ===== GENERATING STEP =====
  if (step === 'generating') return (
    <div style={pageStyle}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(255,0,128,0.08)', border: '1px solid rgba(255,0,128,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,0,128,0.2)', borderTopColor: '#FF0080', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 900, color: '#F5F5F4', marginBottom: 8 }}>Agent עובד...</h2>
        <p style={{ color: '#52525b', fontSize: 14 }}>יוצר סיפור מחובר עם 4 סצנות — 8-12 דקות</p>
      </div>

      <div style={cardS}>
        {AGENT_STEPS.map((s) => {
          const st = agentStatus[s.id]
          const colors = { active: '#FF0080', done: '#22c55e', error: '#ef4444' }
          const c = colors[st] || '#27272a'
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: st === 'active' ? 'rgba(255,0,128,0.04)' : 'transparent', borderRadius: 12, border: `1px solid ${st === 'active' ? 'rgba(255,0,128,0.2)' : st === 'done' ? 'rgba(34,197,94,0.15)' : st === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)'}`, marginBottom: 8, transition: 'all 0.4s ease' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${c}12`, color: c, flexShrink: 0 }}>
                {st === 'done' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                  : st === 'error' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  : st === 'active' ? <div style={{ width: 16, height: 16, border: '2px solid rgba(255,0,128,0.3)', borderTopColor: '#FF0080', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  : s.icon}
              </div>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 14, color: st ? '#e4e4e7' : '#52525b' }}>{s.label}</div>
              <div style={{ fontSize: 12, color: c, fontWeight: 600 }}>{st === 'active' ? 'בתהליך...' : st === 'done' ? 'הושלם' : st === 'error' ? 'שגיאה' : 'ממתין'}</div>
            </div>
          )
        })}
      </div>

      <div style={{ ...cardS, maxHeight: 180, overflowY: 'auto' }}>
        <div style={{ ...secTitle, marginBottom: 10 }}>לוגים</div>
        <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {logs.map((l, i) => (
            <div key={i} style={{ color: l.type === 'ok' ? '#22c55e' : l.type === 'err' ? '#ef4444' : '#52525b', lineHeight: 2 }}>
              <span style={{ color: '#3f3f46' }}>[{l.t}]</span> {l.msg}
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  // ===== DONE STEP — CapCut-style editor =====
  const sceneLabels = ['כאב', 'מוצר', 'שימוש', 'תוצאה']

  return (
    <div style={{ position: 'relative', zIndex: 1, maxWidth: 1300, margin: '0 auto', padding: '12px 20px 0 20px', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setStep('form'); setResult(null); setCurrentScene(0); setClipOrder([0,1,2,3]); setBusinessPhotos([]); setHasRerecorded(false); setShowRerecordPanel(false); setRerecordText('') }} style={ghostBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            מודעה חדשה
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: '#F5F5F4', margin: 0 }}>עריכת סרטון</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith('שגיאה') ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{saveMsg}</span>}
          <button onClick={saveEdit} disabled={savingEdit} style={{ ...ghostBtn, color: '#22c55e', borderColor: 'rgba(34,197,94,0.3)' }}>
            {savingEdit ? <div style={{ width: 14, height: 14, border: '2px solid rgba(34,197,94,0.3)', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>}
            שמור עריכה
          </button>
          <button onClick={playAll} style={{ ...ghostBtn, color: playing ? '#ef4444' : '#FF0080', borderColor: playing ? 'rgba(239,68,68,0.3)' : 'rgba(255,0,128,0.3)' }}>
            {playing ? '⏹ עצור' : '▶ הפעל הכל'}
          </button>
          <button onClick={exportMp4} disabled={exporting} style={{ ...bigBtn, width: 'auto', padding: '10px 28px', margin: 0, fontSize: 14 }}>
            {exporting ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />{exportProgress || 'מייצא...'}</span> : <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>ייצוא MP4</span>}
          </button>
        </div>
      </div>

      {/* Main layout: Left sidebar + Center preview */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          {/* Subtitle Style */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 10, fontSize: 12 }}>כתוביות</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {SUBTITLE_STYLES.map(s => (
                <button key={s.id} onClick={() => setSubtitleStyle(s.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: subtitleStyle === s.id ? 'rgba(255,0,128,0.08)' : 'transparent', border: `1px solid ${subtitleStyle === s.id ? 'rgba(255,0,128,0.3)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: subtitleStyle === s.id ? '#d4d4ff' : '#71717a', fontFamily: 'Heebo,sans-serif', transition: 'all 0.2s' }}>
                  <span style={{ fontWeight: 600, minWidth: 50 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: '#52525b' }}>{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Music */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 10, fontSize: 12, color: '#22c55e' }}>מוזיקת רקע</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {MUSIC_TRACKS.map(t => (
                <button key={t.id} onClick={() => setBgMusic(t.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: bgMusic === t.id ? 'rgba(34,197,94,0.06)' : 'transparent', border: `1px solid ${bgMusic === t.id ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: bgMusic === t.id ? '#86efac' : '#71717a', fontFamily: 'Heebo,sans-serif', transition: 'all 0.2s' }}>
                  <span>{t.emoji}</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>{t.label}</span>
                </button>
              ))}
            </div>
            {bgMusic !== 'none' && (
              <button onClick={toggleMusicPreview} style={{ ...ghostBtn, width: '100%', marginTop: 6, fontSize: 11, justifyContent: 'center', padding: '6px 10px', color: musicPreviewing ? '#ef4444' : '#22c55e', borderColor: musicPreviewing ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)' }}>
                {musicPreviewing ? '⏹ עצור' : '▶ השמע'}
              </button>
            )}
          </div>

          {/* SFX + Transitions */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 10, fontSize: 12 }}>אפקטים ומעברים</div>
            <button onClick={() => setSfxEnabled(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: sfxEnabled ? 'rgba(255,0,128,0.06)' : 'transparent', border: `1px solid ${sfxEnabled ? 'rgba(255,0,128,0.2)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: sfxEnabled ? '#d4d4ff' : '#52525b', fontFamily: 'Heebo,sans-serif', width: '100%', marginBottom: 8, transition: 'all 0.2s' }}>
              <span>🔊</span><span style={{ flex: 1, textAlign: 'right' }}>אפקטי סאונד</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: sfxEnabled ? '#FF0080' : '#3f3f46' }}>{sfxEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <div style={{ display: 'flex', gap: 4 }}>
              {TRANSITIONS.map(t => (
                <button key={t.id} onClick={() => setTransition(t.id)}
                  style={{ flex: 1, padding: '7px 6px', background: transition === t.id ? 'rgba(255,0,128,0.08)' : 'transparent', border: `1px solid ${transition === t.id ? 'rgba(255,0,128,0.3)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 11, color: transition === t.id ? '#d4d4ff' : '#52525b', fontFamily: 'Heebo,sans-serif', textAlign: 'center', transition: 'all 0.2s' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Script / voiceover */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 10, fontSize: 12 }}>קריינות</div>
            <audio ref={audioRef} controls style={{ width: '100%', borderRadius: 8, height: 32 }} />

            {/* Re-record button — rendered IMMEDIATELY under the audio player.
                Shown unconditionally on step==='done' (whether the video was
                just generated OR restored via ?editId=) until first use. */}
            {step === 'done' && !showRerecordPanel && (
              <button
                onClick={openRerecordPanel}
                disabled={hasRerecorded || rerecording}
                title={hasRerecorded ? 'ההקלטה מחדש זמינה פעם אחת בלבד לכל סרטון' : 'ערוך את הטקסט והקלט את הקריינות מחדש'}
                style={{
                  marginTop: 10,
                  width: '100%',
                  padding: '10px 12px',
                  background: hasRerecorded ? 'rgba(255,255,255,0.02)' : 'linear-gradient(135deg, #FF0080, #FF0080)',
                  border: `1px solid ${hasRerecorded ? 'rgba(255,255,255,0.06)' : 'rgba(255,0,128,0.5)'}`,
                  color: hasRerecorded ? '#52525b' : '#ffffff',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: 'Heebo,sans-serif',
                  direction: 'rtl',
                  cursor: hasRerecorded || rerecording ? 'not-allowed' : 'pointer',
                  opacity: hasRerecorded || rerecording ? 0.6 : 1,
                  boxShadow: hasRerecorded ? 'none' : '0 4px 14px rgba(255,0,128,0.25)',
                  transition: 'all 200ms ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                }}>
                {hasRerecorded ? '✓ הוקלט מחדש' : '✎ ערוך וצלם מחדש'}
              </button>
            )}
            {hasRerecorded && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#52525b', direction: 'rtl', fontFamily: 'Heebo,sans-serif', textAlign: 'center' }}>
                הקלטה מחדש זמינה פעם אחת לכל סרטון.
              </div>
            )}

            {/* Voiceover text readout — capped height with scroll so it never
                pushes the re-record button below the fold. */}
            <div style={{ marginTop: 8, fontSize: 11, color: '#a1a1aa', direction: 'rtl', lineHeight: 1.7, fontFamily: 'Heebo,sans-serif', maxHeight: 80, overflowY: 'auto' }}>{result?.hebrewVoice}</div>

            {/* Edit panel — textarea + record/cancel */}
            {showRerecordPanel && (
              <div style={{ marginTop: 10, padding: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,0,128,0.25)', borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: '#FF0080', fontWeight: 700, marginBottom: 6, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>
                  עריכת טקסט הקריינות
                </div>
                <textarea
                  value={rerecordText}
                  onChange={e => setRerecordText(e.target.value)}
                  disabled={rerecording}
                  rows={5}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,0,128,0.3)',
                    borderRadius: 8,
                    padding: 8,
                    color: '#F5F5F4',
                    fontSize: 12,
                    fontFamily: 'Heebo,sans-serif',
                    direction: 'rtl',
                    lineHeight: 1.7,
                    outline: 'none',
                    resize: 'vertical',
                    boxSizing: 'border-box'
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 8, direction: 'rtl' }}>
                  <button
                    onClick={() => rerecordVoiceover(rerecordText)}
                    disabled={rerecording || !rerecordText.trim()}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      background: rerecording || !rerecordText.trim() ? 'rgba(255,0,128,0.2)' : 'linear-gradient(135deg, #FF0080, #FF0080)',
                      border: 'none',
                      color: 'white',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      fontFamily: 'Heebo,sans-serif',
                      cursor: rerecording || !rerecordText.trim() ? 'not-allowed' : 'pointer',
                      opacity: rerecording || !rerecordText.trim() ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                    }}>
                    {rerecording
                      ? <><div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> מקליט...</>
                      : <>צלם קריינות מחדש 🎙️</>}
                  </button>
                  <button
                    onClick={closeRerecordPanel}
                    disabled={rerecording}
                    style={{ ...ghostBtn, padding: '8px 12px', fontSize: 11, opacity: rerecording ? 0.5 : 1, cursor: rerecording ? 'not-allowed' : 'pointer' }}>
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Scene detail for current */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 8, fontSize: 12 }}>סצנה {currentScene + 1} — {result?.story?.scenes?.[currentScene]?.type}</div>
            <div style={{ fontSize: 10, color: '#52525b', lineHeight: 1.6, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>
              <div style={{ marginBottom: 4 }}><span style={{ color: '#22c55e', fontWeight: 600 }}>{result?.story?.scenes?.[currentScene]?.subtitle}</span></div>
              <div><span style={{ color: '#FF0080', fontWeight: 500 }}>Kling:</span> {result?.story?.scenes?.[currentScene]?.kling_prompt?.slice(0, 120)}...</div>
            </div>
          </div>

          {/* Downloads */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 8, fontSize: 12 }}>הורדות בודדות</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {result?.videos?.map((url, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: BORDER, borderRadius: 6, padding: '6px 8px', textAlign: 'center', fontSize: 10 }}>
                  <div style={{ color: '#52525b', marginBottom: 2 }}>{sceneLabels[i]}</div>
                  {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: '#FF0080', textDecoration: 'none', fontWeight: 600 }}>הורד</a> : <span style={{ color: '#27272a' }}>--</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Regenerate single scene — only shown for fresh generations where
              we have the jobId + reference payload. Hidden in the restore-
              from-saved-edit path, since regenerating a saved edit doesn't
              make sense (the user already tweaked it). */}
          {jobId && lastGenPayload && (
            <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
              <div style={{ ...secTitle, marginBottom: 8, fontSize: 12 }}>יצירה מחדש של סצנה בודדת</div>
              <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>
                אם סצנה אחת יצאה לא טוב (לדוגמה המוצר השתנה באמצע), אפשר לייצר אותה מחדש בלי לפגוע בשאר הסרטון. עד 3 יצירות מחדש לכל סצנה.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {[1, 2, 3, 4].map(n => {
                  const used = regenCounts[String(n)] || 0
                  const atLimit = used >= 3
                  const isThisLoading = regenLoading === n
                  const isAnyLoading = regenLoading !== null
                  return (
                    <button
                      key={n}
                      onClick={() => regenerateScene(n)}
                      disabled={isAnyLoading || atLimit}
                      style={{
                        background: isThisLoading ? 'rgba(255,0,128,0.2)' : 'rgba(255,255,255,0.03)',
                        border: BORDER,
                        borderRadius: 6,
                        padding: '8px 4px',
                        textAlign: 'center',
                        fontSize: 10,
                        color: atLimit ? '#27272a' : (isThisLoading ? '#FF0080' : '#a1a1aa'),
                        cursor: (isAnyLoading || atLimit) ? 'not-allowed' : 'pointer',
                        opacity: (isAnyLoading && !isThisLoading) ? 0.4 : 1,
                        direction: 'rtl',
                        fontFamily: 'Heebo,sans-serif',
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>סצנה {n}</div>
                      <div style={{ fontSize: 9 }}>
                        {isThisLoading ? 'מייצר...' : atLimit ? 'הגעת למקסימום' : `🔄 צור מחדש${used ? ` (${used}/3)` : ''}`}
                      </div>
                    </button>
                  )
                })}
              </div>
              {regenMsg && (
                <div style={{ marginTop: 8, fontSize: 10, color: regenMsg.includes('✓') ? '#22c55e' : '#ef4444', direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>
                  {regenMsg}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Center: Full-width Preview */}
        <div style={{ ...cardS, marginBottom: 0, padding: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#000', aspectRatio: '9/16', maxHeight: 'calc(100vh - 280px)', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
            {/* Stack of preloaded <video> elements — one per clip. Opacity swap = seamless back-to-back playback, zero reload */}
            {clipOrder.map((sceneIdx, orderIdx) => {
              const url = videoBlobUrls[sceneIdx]
              const broken = brokenScenes[sceneIdx]
              // If the clip failed to load, show the still NB frame for this
              // scene in place of the <video>. We keep the <video> in the DOM
              // (so refs/playback logic still work) but layer the frame on top.
              const frameUrl = result?.frames?.[sceneIdx]
              return (
                <div key={`scene-${sceneIdx}`} style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  opacity: orderIdx === 0 ? 1 : 0, transition: 'opacity 40ms linear',
                }}>
                  <video
                    ref={el => { if (el) videoRefs.current[orderIdx] = el; else videoRefs.current[orderIdx] = null }}
                    src={url || undefined}
                    playsInline
                    preload="auto"
                    style={{
                      position: 'absolute', top: 0, left: 0,
                      width: '100%', height: '100%', objectFit: 'cover',
                      display: broken ? 'none' : 'block',
                    }}
                  />
                  {broken && frameUrl && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={frameUrl}
                        alt={`Scene ${sceneIdx + 1} still`}
                        style={{
                          position: 'absolute', top: 0, left: 0,
                          width: '100%', height: '100%', objectFit: 'cover',
                        }}
                      />
                      <div style={{
                        position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(245, 158, 11, 0.92)', borderRadius: 6, padding: '4px 10px',
                        fontSize: 11, color: '#000', fontWeight: 700, fontFamily: 'Heebo,sans-serif',
                        direction: 'rtl', whiteSpace: 'nowrap',
                      }}>
                        תמונה סטטית
                      </div>
                    </>
                  )}
                </div>
              )
            })}
            {/* Legacy single ref — kept pointing to first video for backward compat */}
            <video ref={videoRef} style={{ display: 'none' }} />
            {/* Hidden music audio element (also used for preview) */}
            <audio ref={musicAudioRef} preload="auto" style={{ display: 'none' }} />
            <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
            {!playing && !videosReady && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, minWidth: 180 }}>
                <div style={{ width: 36, height: 36, border: '3px solid rgba(255,0,128,0.2)', borderTopColor: '#FF0080', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ color: '#a1a1aa', fontSize: 13, fontWeight: 600, fontFamily: 'Heebo,sans-serif' }}>
                  {preloadProgress.total > 0
                    ? `טוען ${preloadProgress.done}/${preloadProgress.total} סרטונים (זה יכול לקחת כמה שניות)`
                    : 'טוען סרטונים...'}
                </span>
                {preloadProgress.total > 0 && (
                  <div style={{ width: 160, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${(preloadProgress.done / preloadProgress.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #FF0080, #FF0080)', transition: 'width 200ms ease' }} />
                  </div>
                )}
                {(slowLoadWarning || Object.keys(brokenScenes).length > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, maxWidth: 240 }}>
                    <span style={{ color: '#f59e0b', fontSize: 11, fontWeight: 600, fontFamily: 'Heebo,sans-serif', textAlign: 'center', direction: 'rtl' }}>
                      {Object.keys(brokenScenes).length > 0
                        ? `סצנה ${Number(Object.keys(brokenScenes)[0]) + 1} לא נטענה. זה יכול לקרות לפעמים - לחץ 'נסה שוב' או המשך בעריכה`
                        : 'טעינת הסרטונים איטית מהרגיל. נסה לרענן'}
                    </span>
                    <button
                      onClick={() => {
                        console.log('[Studio] retry clicked — clearing broken scenes + reloading page')
                        brokenScenesRef.current = {}
                        setBrokenScenes({})
                        setSlowLoadWarning(false)
                        window.location.reload()
                      }}
                      style={{
                        padding: '6px 14px', background: 'rgba(245, 158, 11, 0.18)',
                        border: '1px solid rgba(245, 158, 11, 0.5)', borderRadius: 6,
                        color: '#f59e0b', fontSize: 11, fontWeight: 700,
                        fontFamily: 'Heebo,sans-serif', cursor: 'pointer',
                      }}
                    >
                      נסה שוב
                    </button>
                  </div>
                )}
              </div>
            )}
            {!playing && videosReady && (
              <button onClick={playAll} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,0,128,0.8)', border: '2px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', transition: 'all 200ms ease' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
            )}
            {playing && (
              <button onClick={playAll} style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 8, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              </button>
            )}
            {/* Current scene badge */}
            <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(255,0,128,0.8)', borderRadius: 8, padding: '4px 10px', fontSize: 11, color: '#fff', fontWeight: 700, backdropFilter: 'blur(4px)' }}>
              סצנה {currentScene + 1} — {result?.story?.scenes?.[currentScene]?.type}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Multi-track NLE Timeline — DaVinci/CapCut style */}
      <div style={{ background: 'rgba(12,12,16,0.98)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '8px 16px 10px', flexShrink: 0 }}>
        {/* Time ruler */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, paddingLeft: 72 }}>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#3f3f46', fontWeight: 500, fontFamily: 'monospace' }}>
            <span>00:00</span><span>00:05</span><span>00:10</span><span>00:15</span><span>00:20</span>
          </div>
        </div>

        {/* Track 1: Video clips */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 0 }}>
          <div style={{ width: 68, flexShrink: 0, fontSize: 9, color: '#FF0080', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FF0080" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            Video
          </div>
          <div style={{ flex: 1, display: 'flex', gap: 2, height: 48 }}>
            {clipOrder.map((sceneIdx, orderIdx) => {
              const scene = result?.story?.scenes?.[sceneIdx]
              const videoUrl = videoBlobUrls[sceneIdx] || result?.videos?.[sceneIdx]
              const isActive = currentScene === sceneIdx
              const isDragging = dragIdx === orderIdx
              return (
                <div key={orderIdx} draggable
                  onDragStart={(e) => handleDragStart(e, orderIdx)}
                  onDragOver={(e) => handleDragOver(e, orderIdx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => loadScene(sceneIdx)}
                  style={{ flex: '1 1 0', minWidth: 0, background: isActive ? 'rgba(255,0,128,0.15)' : 'rgba(255,0,128,0.06)', border: `1.5px solid ${isActive ? 'rgba(255,0,128,0.6)' : isDragging ? 'rgba(255,0,128,0.4)' : 'rgba(255,0,128,0.12)'}`, borderRadius: 6, overflow: 'hidden', cursor: 'grab', opacity: isDragging ? 0.5 : 1, transition: 'all 150ms ease', display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
                  <div style={{ width: 48, height: '100%', flexShrink: 0, background: BG, position: 'relative', overflow: 'hidden' }}>
                    {videoUrl
                      ? <video src={videoUrl} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onLoadedMetadata={e => { e.target.currentTime = 1 }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#27272a" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/></svg></div>
                    }
                  </div>
                  <div style={{ flex: 1, padding: '2px 6px', overflow: 'hidden' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: isActive ? '#d4b4ff' : '#FF0080', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scene?.type || sceneLabels[sceneIdx]}</div>
                    <div style={{ fontSize: 7, color: '#52525b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Heebo,sans-serif', direction: 'rtl' }}>{scene?.subtitle?.slice(0, 30)}</div>
                  </div>
                  <div style={{ position: 'absolute', top: 2, right: 4, fontSize: 7, color: '#52525b', fontWeight: 600, fontFamily: 'monospace' }}>5.0s</div>
                  <div style={{ position: 'absolute', top: 2, left: 50, width: 14, height: 14, borderRadius: 3, background: isActive ? '#FF0080' : 'rgba(255,0,128,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff', fontWeight: 700 }}>{orderIdx + 1}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Track 2: Voiceover waveform bar */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 0 }}>
          <div style={{ width: 68, flexShrink: 0, fontSize: 9, color: '#22c55e', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            Voice
          </div>
          <div style={{ flex: 1, height: 22, background: audioBlobUrl.current ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${audioBlobUrl.current ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 5, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
            {audioBlobUrl.current ? (
              <>
                {/* Fake waveform visualization */}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 1, padding: '0 4px' }}>
                  {Array.from({ length: 80 }, (_, i) => {
                    const h = 4 + Math.sin(i * 0.4) * 4 + Math.random() * 4
                    return <div key={i} style={{ flex: 1, height: h, background: 'rgba(34,197,94,0.4)', borderRadius: 1, minWidth: 1 }} />
                  })}
                </div>
                <span style={{ position: 'relative', zIndex: 1, fontSize: 8, color: '#22c55e', fontWeight: 600, padding: '0 6px', background: 'rgba(12,12,16,0.7)', borderRadius: 3 }}>קריינות עברית ~20s</span>
              </>
            ) : (
              <span style={{ fontSize: 8, color: '#3f3f46', padding: '0 8px' }}>אין קריינות</span>
            )}
          </div>
        </div>

        {/* Track 3: Background music bar */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 0 }}>
          <div style={{ width: 68, flexShrink: 0, fontSize: 9, color: '#f59e0b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            Music
          </div>
          <div style={{ flex: 1, height: 18, background: bgMusic !== 'none' ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${bgMusic !== 'none' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 5, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
            {bgMusic !== 'none' ? (
              <>
                <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', gap: 1, padding: '0 4px', opacity: 0.3 }}>
                  {Array.from({ length: 60 }, (_, i) => {
                    const h = 2 + Math.sin(i * 0.6 + 1) * 3 + Math.random() * 2
                    return <div key={i} style={{ width: 2, height: h, background: 'rgba(245,158,11,0.5)', borderRadius: 1 }} />
                  })}
                </div>
                <span style={{ position: 'relative', zIndex: 1, fontSize: 8, color: '#f59e0b', fontWeight: 600, padding: '0 6px' }}>
                  {MUSIC_TRACKS.find(t => t.id === bgMusic)?.emoji} {MUSIC_TRACKS.find(t => t.id === bgMusic)?.label} — 20s
                </span>
              </>
            ) : (
              <span style={{ fontSize: 8, color: '#3f3f46', padding: '0 8px' }}>אין מוזיקה</span>
            )}
          </div>
        </div>

        {/* Playhead / progress indicator */}
        <div style={{ marginLeft: 72, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', display: 'flex', overflow: 'hidden' }}>
          {clipOrder.map((sceneIdx, i) => (
            <div key={i} style={{ flex: 1, background: currentScene === sceneIdx ? 'linear-gradient(90deg, #FF0080, #FF0080)' : 'rgba(255,0,128,0.1)', borderRight: i < clipOrder.length - 1 ? '1px solid rgba(0,0,0,0.3)' : 'none', transition: 'background 300ms ease' }} />
          ))}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {upgradeOpen && (
        <div
          onClick={() => setUpgradeOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440, width: '100%', background: '#111010', border: '1px solid rgba(255,0,128,0.3)', borderRadius: 16, padding: 32, direction: 'rtl', fontFamily: 'Heebo,sans-serif', boxShadow: '0 30px 80px -20px rgba(255,0,128,0.4)' }}
          >
            <div style={{ fontSize: 24, fontWeight: 900, color: '#F5F5F4', marginBottom: 12, letterSpacing: '-0.02em' }}>שדרג לפרו</div>
            <p style={{ color: 'rgba(245,245,244,0.64)', fontSize: 15, lineHeight: 1.55, marginBottom: 24 }}>
              האווטאר הזה זמין רק במנוי פרו. שדרג ב-₪499/חודש לגישה לכל האווטארים והקולות.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setUpgradeOpen(false)}
                style={{ padding: '12px 20px', borderRadius: 6, background: 'transparent', border: '1px solid rgba(245,245,244,0.18)', color: '#F5F5F4', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                אולי מאוחר יותר
              </button>
              <button
                onClick={() => { console.log('TODO: implement checkout for pro upgrade'); setUpgradeOpen(false) }}
                style={{ padding: '12px 22px', borderRadius: 6, background: '#FF0080', border: 'none', color: '#0A0908', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                שדרג עכשיו
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const BG = '#0A0908'
const CARD_BG = 'rgba(255,255,255,0.03)'
const BORDER = '1px solid rgba(255,255,255,0.08)'
const GLOW = '0 0 30px rgba(255,0,128,0.3)'
const pageStyle = { position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto', padding: '32px 20px' }
const cardS = { background: CARD_BG, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: BORDER, borderRadius: 18, padding: 24, marginBottom: 16 }
const secTitle = { fontSize: 13, fontWeight: 700, color: '#FF0080', letterSpacing: 1, marginBottom: 16 }
const lblS = { fontSize: 13, color: '#71717a', display: 'block', fontWeight: 500 }
const inpS = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', color: '#F5F5F4', fontSize: 14, outline: 'none', width: '100%', direction: 'ltr', fontFamily: 'monospace', transition: 'all 300ms ease' }
const ghostBtn = { background: 'rgba(255,255,255,0.03)', border: BORDER, color: '#71717a', padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontFamily: 'Heebo,sans-serif', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 200ms ease' }
const bigBtn = { width: '100%', padding: 18, background: 'linear-gradient(135deg, #FF0080, #FF0080)', border: 'none', borderRadius: 14, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 18, fontWeight: 700, cursor: 'pointer', marginTop: 8, boxShadow: GLOW, transition: 'all 300ms ease' }
