'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// === Subtitle Styles ===
const SUBTITLE_STYLES = [
  { id: 'classic', label: 'Classic', desc: 'לבן עם צל שחור' },
  { id: 'bold', label: 'Bold', desc: 'שחור על רקע לבן' },
  { id: 'minimal', label: 'Minimal', desc: 'טקסט לבן קטן' },
  { id: 'neon', label: 'Neon', desc: 'לבן עם glow סגול' },
]

// === Background Music Tracks ===
const MUSIC_TRACKS = [
  { id: 'upbeat', label: 'Upbeat TikTok', emoji: '🎵', bpm: 130, key: 'C' },
  { id: 'chill', label: 'Chill Vibes', emoji: '🌊', bpm: 85, key: 'Am' },
  { id: 'motivational', label: 'Motivational', emoji: '💪', bpm: 110, key: 'G' },
  { id: 'dramatic', label: 'Dramatic', emoji: '🎭', bpm: 70, key: 'Dm' },
  { id: 'none', label: 'No Music', emoji: '🔇' },
]

// === Scene Transitions ===
const TRANSITIONS = [
  { id: 'cut', label: 'Cut', desc: 'חיתוך ישר' },
  { id: 'fade', label: 'Fade', desc: 'דהייה' },
  { id: 'zoom', label: 'Zoom', desc: 'זום קל' },
]

// === Web Audio API Sound Generators ===
function createAudioContext() {
  return new (window.AudioContext || window.webkitAudioContext)()
}

function playWhoosh(ctx) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(800, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3)
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(1000, ctx.currentTime)
  filter.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.3)
  filter.Q.value = 2
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
  osc.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.4)
}

function playPop(ctx) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(600, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08)
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 0.15)
}

function playDing(ctx) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1200, ctx.currentTime)
  gain.gain.setValueAtTime(0.4, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + 1)
  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(1800, ctx.currentTime)
  gain2.gain.setValueAtTime(0.2, ctx.currentTime)
  gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
  osc2.connect(gain2)
  gain2.connect(ctx.destination)
  osc2.start(ctx.currentTime)
  osc2.stop(ctx.currentTime + 0.7)
}

// Generate background music buffer using Web Audio API
function generateMusicBuffer(ctx, trackId, durationSec) {
  const sampleRate = ctx.sampleRate
  const length = sampleRate * durationSec
  const buffer = ctx.createBuffer(2, length, sampleRate)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  const noteFreqs = {
    C: [261.63, 329.63, 392.00], Am: [220.00, 261.63, 329.63],
    G: [196.00, 246.94, 293.66], Dm: [293.66, 349.23, 440.00],
  }
  const track = MUSIC_TRACKS.find(t => t.id === trackId)
  if (!track || trackId === 'none') return buffer
  const bpm = track.bpm
  const beatLen = (60 / bpm) * sampleRate
  const freqs = noteFreqs[track.key] || noteFreqs.C
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const beatPhase = (i % beatLen) / beatLen
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
    const fadeIn = Math.min(1, t / 1.0)
    const fadeOut = Math.min(1, (durationSec - t) / 1.5)
    val *= fadeIn * fadeOut * 0.7
    left[i] = val
    right[i] = val * 0.95 + 0.01 * Math.sin(2 * Math.PI * 0.5 * t) * val
  }
  return buffer
}

// Draw subtitles with a specific style
function drawSubtitleOnCtx(ctx, lines, canvasW, canvasH, style) {
  const isMinimal = style === 'minimal'
  const fontSize = isMinimal ? 36 : 64
  ctx.font = `bold ${fontSize}px Heebo, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lineHeight = isMinimal ? 28 : 40
  const startY = canvasH * 0.80 - ((lines.length - 1) * lineHeight) / 2
  const x = canvasW / 2
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight
    if (style === 'classic') {
      ctx.strokeStyle = 'black'; ctx.lineWidth = 16; ctx.lineJoin = 'round'; ctx.miterLimit = 2
      ctx.strokeText(line, x, y); ctx.fillStyle = 'white'; ctx.fillText(line, x, y)
    } else if (style === 'bold') {
      const metrics = ctx.measureText(line)
      const tw = metrics.width + 28, th = fontSize + 16
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      const rx = x - tw / 2, ry = y - th / 2, r = 10
      ctx.beginPath()
      ctx.moveTo(rx + r, ry); ctx.lineTo(rx + tw - r, ry)
      ctx.quadraticCurveTo(rx + tw, ry, rx + tw, ry + r); ctx.lineTo(rx + tw, ry + th - r)
      ctx.quadraticCurveTo(rx + tw, ry + th, rx + tw - r, ry + th); ctx.lineTo(rx + r, ry + th)
      ctx.quadraticCurveTo(rx, ry + th, rx, ry + th - r); ctx.lineTo(rx, ry + r)
      ctx.quadraticCurveTo(rx, ry, rx + r, ry); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#111'; ctx.fillText(line, x, y)
    } else if (style === 'minimal') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(line, x, y)
    } else if (style === 'neon') {
      ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 24
      ctx.fillStyle = 'white'; ctx.fillText(line, x, y); ctx.fillText(line, x, y)
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'
    }
  })
}

const AVATARS = [
  { url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=600&fit=crop&crop=face', name: 'Maya' },
  { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=600&fit=crop&crop=face', name: 'Sarah' },
  { url: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&h=600&fit=crop&crop=face', name: 'Noa' },
  { url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=600&fit=crop&crop=face', name: 'Dana' },
  { url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=600&fit=crop&crop=face', name: 'Lior' },
  { url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop&crop=face', name: 'Avi' },
]

const AGENT_STEPS = [
  { id: 'script', label: 'Claude כותב את הסיפור — פרומפט לכל סצנה', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/></svg> },
  { id: 'frames', label: 'Nano Banana יוצר 4 פריימים מחוברים', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg> },
  { id: 'videos', label: 'Kling מחיה 4 סצנות × 5 שניות', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> },
  { id: 'voice',  label: 'ElevenLabs קריינות עברית V3', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg> },
]

export default function Home() {
  useEffect(() => {
    const checkUser = async () => {
      if (!supabase) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) window.location.replace('/login')
    }
    checkUser()
  }, [])

  const [step, setStep] = useState('form')
  const [businessType, setBusinessType] = useState('product')
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [customAvatar, setCustomAvatar] = useState(null)
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [applicationArea, setApplicationArea] = useState('')
  const [productImage, setProductImage] = useState(null)
  const [storyDescription, setStoryDescription] = useState('')
  // API keys are now server-side only — no client exposure
  const [agentStatus, setAgentStatus] = useState({})
  const [result, setResult] = useState(null)
  const [currentScene, setCurrentScene] = useState(0)
  const [logs, setLogs] = useState([])
  const [exporting, setExporting] = useState(false)
  // Editor settings
  const [subtitleStyle, setSubtitleStyle] = useState('classic')
  const [sfxWhoosh, setSfxWhoosh] = useState(true)
  const [sfxPop, setSfxPop] = useState(true)
  const [sfxDing, setSfxDing] = useState(true)
  const [bgMusic, setBgMusic] = useState('none')
  const [transition, setTransition] = useState('cut')
  const [musicPlaying, setMusicPlaying] = useState(false)
  // Per-scene voiceover editing + one-shot re-record
  const [editingSceneIdx, setEditingSceneIdx] = useState(null)
  const [editBuffer, setEditBuffer] = useState('')
  const [hasRerecorded, setHasRerecorded] = useState(false)
  const [rerecording, setRerecording] = useState(false)
  // Full-voiceover edit panel shown below the audio player
  const [showRerecordPanel, setShowRerecordPanel] = useState(false)
  const [rerecordText, setRerecordText] = useState('')
  const videoRef = useRef(null)
  const audioRef = useRef(null)
  const canvasRef = useRef(null)
  const musicSourceRef = useRef(null)
  const audioCtxRef = useRef(null)

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
    const words = subtitle.split(/\s+/)
    const lines = []
    for (let i = 0; i < words.length; i += 3) lines.push(words.slice(i, i + 3).join(' '))
    drawSubtitleOnCtx(ctx, lines, canvas.width, canvas.height, subtitleStyle)
  }, [currentScene, result, step, subtitleStyle])

  // Play pop sound when subtitle appears
  useEffect(() => {
    if (step !== 'done' || !sfxPop || !result?.story?.scenes?.[currentScene]?.subtitle) return
    try { const ctx = createAudioContext(); playPop(ctx); setTimeout(() => ctx.close(), 200) } catch {}
  }, [currentScene, step, sfxPop, result])

  // Background music preview
  const toggleMusicPreview = useCallback(() => {
    if (musicPlaying) {
      if (musicSourceRef.current) { try { musicSourceRef.current.stop() } catch {} }
      if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
      musicSourceRef.current = null; audioCtxRef.current = null; setMusicPlaying(false); return
    }
    if (bgMusic === 'none') return
    try {
      const ctx = createAudioContext(); audioCtxRef.current = ctx
      const buf = generateMusicBuffer(ctx, bgMusic, 8)
      const source = ctx.createBufferSource(); source.buffer = buf; source.connect(ctx.destination)
      source.onended = () => setMusicPlaying(false); source.start()
      musicSourceRef.current = source; setMusicPlaying(true)
    } catch {}
  }, [bgMusic, musicPlaying])

  // Stop music on track change
  useEffect(() => {
    if (musicSourceRef.current) { try { musicSourceRef.current.stop() } catch {} }
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
    musicSourceRef.current = null; audioCtxRef.current = null; setMusicPlaying(false)
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

  const runAgent = async () => {
    console.log('[runAgent] CLICKED', {
      customAvatar: !!customAvatar,
      selectedAvatar: selectedAvatar?.url || null,
      productName,
      productDesc,
      applicationArea,
      productImage: !!productImage,
      businessType,
      step,
    })
    const currentCheck = customAvatar || selectedAvatar?.url
    if (!currentCheck) { console.warn('[runAgent] EARLY RETURN: no avatar'); return alert('בחר דמות') }
    if (!productName || !productDesc) { console.warn('[runAgent] EARLY RETURN: missing productName/productDesc', { productName, productDesc }); return alert('הכנס שם ותיאור מוצר') }
    console.log('[runAgent] passed guards, entering generating step')
    setStep('generating'); setLogs([]); setAgentStatus({ script: 'active' }); setHasRerecorded(false); setEditingSceneIdx(null); setEditBuffer(''); setShowRerecordPanel(false); setRerecordText(''); addLog('Agent מתחיל לעבוד...')
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
        const fd = new FormData(); fd.append('file', blob, 'avatar.jpg')
        const up = await fetch('/api/upload', { method: 'POST', body: fd })
        const upData = await up.json()
        finalAvatarUrl = upData.url || upData.access_url
        addLog('אווטאר הועלה', 'ok')
      }
      addLog('Claude כותב סיפור מחובר ל-4 סצנות...'); setAgentStatus({ script: 'active' })
      let productImageUrl = null
      if (productImage && productImage.startsWith('data:')) {
        const [ph, pb] = productImage.split(',')
        const pm = ph.match(/:(.*?);/)[1]
        const pbc = atob(pb), pba = new Uint8Array(pbc.length)
        for (let i = 0; i < pbc.length; i++) pba[i] = pbc.charCodeAt(i)
        const pblob = new Blob([pba], { type: pm })
        const pfd = new FormData(); pfd.append('file', pblob, 'product.jpg')
        addLog('מעלה תמונת מוצר...')
        const pup = await fetch('/api/upload', { method: 'POST', body: pfd })
        const pupData = await pup.json()
        productImageUrl = pupData.url || pupData.access_url
        addLog('מוצר הועלה', 'ok')
      }
      const agentRes = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: productDesc, productName, applicationArea, storyDescription, avatarUrl: finalAvatarUrl, productImageUrl, businessType })
      })
      if (!agentRes.ok) throw new Error('Agent failed')
      addLog('מקבל תוצאות מה-Agent...')
      const data = await agentRes.json()
      if (data.frames) data.frames.forEach((f, i) => addLog(f ? `Frame ${i+1}: OK` : `Frame ${i+1}: נכשל`, f ? 'ok' : 'err'))
      if (data.videos) data.videos.forEach((v, i) => addLog(v ? `סרטון ${i+1}: OK` : `סרטון ${i+1}: נכשל`, v ? 'ok' : 'err'))
      setAgentStatus({ script: 'done', frames: 'done', videos: 'done', voice: data.audioBase64 ? 'done' : 'error' })
      addLog(data.audioBase64 ? 'קריינות מוכנה!' : 'קריינות נכשלה', data.audioBase64 ? 'ok' : 'err')
      if (data.audioBase64) {
        const blob = new Blob([Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0))], { type: 'audio/mpeg' })
        if (audioRef.current) audioRef.current.src = URL.createObjectURL(blob)
      }
      setResult(data)
      const hasVideos = data.videos?.some(v => v)
      if (hasVideos) {
        setStep('done')
        if (data.videos[0] && videoRef.current) { videoRef.current.src = data.videos[0]; videoRef.current.load() }
      } else {
        addLog('לא נוצרו סרטונים — נשאר בדף הלוגים', 'err')
      }
    } catch (e) { addLog(e.message, 'err'); alert('שגיאה: ' + e.message); setStep('form') }
  }

  // If the agent response didn't include per-scene voiceover chunks,
  // split the full monologue into 4 parts by sentence so the editor has
  // something to show. Runs whenever `result` changes.
  useEffect(() => {
    if (!result?.story?.scenes) return
    const scenes = result.story.scenes
    const anyMissing = scenes.some(s => !s.voiceover)
    if (!anyMissing) return
    const full = (result.hebrewVoice || result.story.hebrew_voice || '').trim()
    // Split on sentence terminators, keep non-empty pieces.
    const pieces = full.split(/(?<=[.!?])\s+/).filter(Boolean)
    const chunks = ['', '', '', '']
    if (pieces.length >= 4) {
      // Distribute pieces across 4 scenes, last scene gets the remainder.
      const per = Math.floor(pieces.length / 4)
      for (let i = 0; i < 4; i++) {
        const start = i * per
        const end = i === 3 ? pieces.length : start + per
        chunks[i] = pieces.slice(start, end).join(' ').trim()
      }
    } else {
      // Fallback: put whole text in scene 1, others get subtitle
      chunks[0] = full
    }
    const patched = scenes.map((s, i) => ({
      ...s,
      voiceover: s.voiceover || chunks[i] || s.subtitle || ''
    }))
    setResult(r => r ? { ...r, story: { ...r.story, scenes: patched } } : r)
  }, [result?.story?.scenes?.length, result?.hebrewVoice])

  const openSceneEdit = (idx) => {
    const current = result?.story?.scenes?.[idx]?.voiceover || ''
    setEditingSceneIdx(idx)
    setEditBuffer(current)
  }
  const saveSceneEdit = () => {
    if (editingSceneIdx == null) return
    setResult(r => {
      if (!r?.story?.scenes) return r
      const scenes = r.story.scenes.map((s, i) =>
        i === editingSceneIdx ? { ...s, voiceover: editBuffer, subtitle: editBuffer } : s
      )
      return { ...r, story: { ...r.story, scenes } }
    })
    setEditingSceneIdx(null); setEditBuffer('')
  }
  const cancelSceneEdit = () => { setEditingSceneIdx(null); setEditBuffer('') }

  // Open the full-voiceover edit panel, pre-filled with the current script.
  const openRerecordPanel = () => {
    if (hasRerecorded || rerecording) return
    const scenes = result?.story?.scenes || []
    const fromScenes = scenes.map(s => (s.voiceover || '').trim()).filter(Boolean).join(' ')
    const initial = fromScenes || result?.hebrewVoice || ''
    setRerecordText(initial)
    setShowRerecordPanel(true)
  }
  const closeRerecordPanel = () => { setShowRerecordPanel(false); setRerecordText('') }

  // Rebuild scene subtitles from new word timestamps by slicing the timeline
  // into N equal-duration segments (one per scene) and collecting the words
  // that fall into each segment. Returns a new scenes array.
  const rebuildSubtitleSegments = (scenes, wordTimestamps, duration) => {
    if (!scenes?.length) return scenes
    if (!wordTimestamps?.length || !duration) return scenes
    const n = scenes.length
    const segDur = duration / n
    const segs = Array.from({ length: n }, () => [])
    for (const wt of wordTimestamps) {
      const mid = (wt.start + wt.end) / 2
      let idx = Math.min(n - 1, Math.max(0, Math.floor(mid / segDur)))
      segs[idx].push(wt.word)
    }
    return scenes.map((s, i) => {
      const words = segs[i].join(' ').trim()
      return words
        ? { ...s, voiceover: words, subtitle: words }
        : s
    })
  }

  const rerecordVoiceover = async (textOverride) => {
    if (hasRerecorded || rerecording) return
    const text = (textOverride ?? rerecordText ?? '').trim()
    if (!text) { alert('אין טקסט קריינות לשלוח'); return }
    setRerecording(true)
    addLog('שולח טקסט ל-ElevenLabs...')
    try {
      const vRes = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      if (!vRes.ok) {
        const errBody = await vRes.json().catch(() => ({}))
        throw new Error(errBody.error || `Voice API ${vRes.status}`)
      }
      const { base64, wordTimestamps = [], duration = 0 } = await vRes.json()
      if (!base64) throw new Error('No audio returned')

      // Decode base64 → Blob → object URL, swap into the audio element.
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      if (audioRef.current) {
        if (audioRef.current.src?.startsWith('blob:')) URL.revokeObjectURL(audioRef.current.src)
        audioRef.current.src = URL.createObjectURL(blob)
        audioRef.current.load()
      }

      // Persist the new script, timestamps, duration, and rebuilt per-scene subtitles.
      setResult(r => {
        if (!r) return r
        const rebuilt = rebuildSubtitleSegments(r.story?.scenes, wordTimestamps, duration)
        return {
          ...r,
          hebrewVoice: text,
          wordTimestamps,
          voiceDuration: duration,
          story: { ...r.story, scenes: rebuilt || r.story.scenes }
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

  const loadScene = (idx) => {
    if (idx !== currentScene && sfxWhoosh) {
      try { const ctx = createAudioContext(); playWhoosh(ctx); setTimeout(() => ctx.close(), 500) } catch {}
    }
    setCurrentScene(idx)
    const url = result?.videos?.[idx]
    if (url && videoRef.current) { videoRef.current.src = url; videoRef.current.load() }
  }

  const exportMp4 = async () => {
    if (!result?.videos?.length) return
    setExporting(true)
    try {
      const offCanvas = document.createElement('canvas'); offCanvas.width = 1080; offCanvas.height = 1920
      const ctx = offCanvas.getContext('2d')
      let mimeType = 'video/mp4'
      if (!MediaRecorder.isTypeSupported(mimeType)) { mimeType = 'video/webm;codecs=h264'; if (!MediaRecorder.isTypeSupported(mimeType)) { mimeType = 'video/webm;codecs=vp9'; if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm' } }
      const stream = offCanvas.captureStream(30)

      // Create audio context for mixing voice, music, and SFX
      const exportAudioCtx = new AudioContext()
      const dest = exportAudioCtx.createMediaStreamDestination()
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))

      // Add voiceover audio
      if (audioRef.current?.src) {
        try {
          const source = exportAudioCtx.createMediaElementSource(audioRef.current)
          source.connect(dest); source.connect(exportAudioCtx.destination)
        } catch {}
      }

      // Add background music
      if (bgMusic !== 'none') {
        const totalDuration = result.videos.filter(v => v).length * 5
        const musicBuf = generateMusicBuffer(exportAudioCtx, bgMusic, totalDuration + 2)
        const musicSource = exportAudioCtx.createBufferSource()
        musicSource.buffer = musicBuf
        const musicGain = exportAudioCtx.createGain(); musicGain.gain.value = 0.3
        musicSource.connect(musicGain); musicGain.connect(dest); musicSource.start()
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType }); const chunks = []
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      const donePromise = new Promise(resolve => { mediaRecorder.onstop = resolve })
      mediaRecorder.start()

      for (let i = 0; i < result.videos.length; i++) {
        const url = result.videos[i]; if (!url) continue

        // Whoosh SFX between scenes
        if (i > 0 && sfxWhoosh) {
          const wo = exportAudioCtx.createOscillator(); const wg = exportAudioCtx.createGain()
          const wf = exportAudioCtx.createBiquadFilter()
          wo.type = 'sawtooth'; wo.frequency.setValueAtTime(800, exportAudioCtx.currentTime)
          wo.frequency.exponentialRampToValueAtTime(200, exportAudioCtx.currentTime + 0.3)
          wf.type = 'bandpass'; wf.frequency.value = 600; wf.Q.value = 2
          wg.gain.setValueAtTime(0.25, exportAudioCtx.currentTime)
          wg.gain.exponentialRampToValueAtTime(0.001, exportAudioCtx.currentTime + 0.35)
          wo.connect(wf); wf.connect(wg); wg.connect(dest)
          wo.start(exportAudioCtx.currentTime); wo.stop(exportAudioCtx.currentTime + 0.4)
        }

        // Pop SFX for subtitle
        if (sfxPop) {
          setTimeout(() => {
            try {
              const po = exportAudioCtx.createOscillator(); const pg = exportAudioCtx.createGain()
              po.type = 'sine'; po.frequency.setValueAtTime(600, exportAudioCtx.currentTime)
              po.frequency.exponentialRampToValueAtTime(200, exportAudioCtx.currentTime + 0.08)
              pg.gain.setValueAtTime(0.3, exportAudioCtx.currentTime)
              pg.gain.exponentialRampToValueAtTime(0.001, exportAudioCtx.currentTime + 0.12)
              po.connect(pg); pg.connect(dest)
              po.start(exportAudioCtx.currentTime); po.stop(exportAudioCtx.currentTime + 0.15)
            } catch {}
          }, 300)
        }

        const transitionFrames = transition === 'cut' ? 0 : 15

        await new Promise((resolve) => {
          const vid = document.createElement('video'); vid.crossOrigin = 'anonymous'; vid.src = url; vid.muted = true; vid.playsInline = true
          vid.onloadeddata = async () => {
            try { await vid.play() } catch { resolve(); return }
            const subtitle = result.story?.scenes?.[i]?.subtitle || ''
            const words = subtitle.split(/\s+/); const lines = []
            for (let w = 0; w < words.length; w += 3) lines.push(words.slice(w, w + 3).join(' '))
            let frameCount = 0
            const drawFrame = () => {
              if (vid.paused || vid.ended) { resolve(); return }
              frameCount++
              const inTransition = frameCount <= transitionFrames
              let alpha = 1, scale = 1
              if (inTransition && transition === 'fade') alpha = frameCount / transitionFrames
              if (inTransition && transition === 'zoom') { scale = 1.15 - 0.15 * (frameCount / transitionFrames); alpha = frameCount / transitionFrames }
              if (vid.duration && vid.currentTime > vid.duration - 0.5 && i < result.videos.length - 1 && transition === 'fade') {
                alpha = Math.max(0, (vid.duration - vid.currentTime) / 0.5)
              }
              ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, offCanvas.width, offCanvas.height)
              ctx.globalAlpha = alpha
              if (scale !== 1) {
                ctx.save(); ctx.translate(offCanvas.width / 2, offCanvas.height / 2); ctx.scale(scale, scale)
                ctx.drawImage(vid, -offCanvas.width / 2, -offCanvas.height / 2, offCanvas.width, offCanvas.height); ctx.restore()
              } else { ctx.drawImage(vid, 0, 0, offCanvas.width, offCanvas.height) }
              ctx.globalAlpha = 1
              drawSubtitleOnCtx(ctx, lines, offCanvas.width, offCanvas.height, subtitleStyle)
              requestAnimationFrame(drawFrame)
            }
            requestAnimationFrame(drawFrame)
          }
          vid.onerror = () => resolve()
        })
      }

      // Ding SFX at the end
      if (sfxDing) {
        const d1 = exportAudioCtx.createOscillator(); const dg = exportAudioCtx.createGain()
        d1.type = 'sine'; d1.frequency.setValueAtTime(1200, exportAudioCtx.currentTime)
        dg.gain.setValueAtTime(0.35, exportAudioCtx.currentTime)
        dg.gain.exponentialRampToValueAtTime(0.001, exportAudioCtx.currentTime + 0.8)
        d1.connect(dg); dg.connect(dest)
        d1.start(exportAudioCtx.currentTime); d1.stop(exportAudioCtx.currentTime + 1)
        await new Promise(r => setTimeout(r, 1000))
      }

      mediaRecorder.stop(); await donePromise
      try { exportAudioCtx.close() } catch {}
      const blob = new Blob(chunks, { type: mimeType }); const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.style.display = 'none'; a.href = blobUrl; a.download = 'ugc-video.mp4'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(blobUrl)
    } catch (e) { alert('שגיאה בייצוא: ' + e.message) } finally { setExporting(false) }
  }

  // ===== FORM STEP =====
  if (step === 'form') return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: '#f0f0ff', marginBottom: 4 }}>יצירת סרטון</h1>
          <p style={{ color: '#52525b', fontSize: 14 }}>Agent AI יוצר 4 סצנות מחוברות — סיפור אחד שלם</p>
        </div>
        <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#52525b', fontSize: 13, textDecoration: 'none' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          חזרה לדשבורד
        </a>
      </div>

      {/* Business Type Toggle */}
      <div style={cardS}>
        <div style={secTitle}>סוג</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { value: 'product', label: '🛍️ מוצר', desc: 'מוצר פיזי למכירה' },
            { value: 'business', label: '🏪 עסק / שירות', desc: 'מסעדה, מספרה, קליניקה...' }
          ].map(opt => (
            <div key={opt.value} onClick={() => setBusinessType(opt.value)}
              style={{ flex: 1, padding: '14px 16px', background: businessType === opt.value ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)', border: `2px solid ${businessType === opt.value ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 14, cursor: 'pointer', textAlign: 'center', transition: 'all 300ms ease' }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: '#52525b' }}>{opt.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Avatar Selection */}
      <div style={cardS}>
        <div style={secTitle}>בחר דמות</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          {AVATARS.map(av => {
            const sel = selectedAvatar?.name === av.name && !customAvatar
            return (
              <div key={av.name} onClick={() => { setSelectedAvatar(av); setCustomAvatar(null) }}
                style={{ position: 'relative', border: `2px solid ${sel ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', aspectRatio: '3/4', boxShadow: sel ? '0 0 24px rgba(168,85,247,0.2)' : 'none', transition: 'all 300ms ease' }}>
                <img src={av.url} alt={av.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', padding: '20px 6px 6px', fontSize: 11, color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontWeight: 500 }}>{av.name}</div>
                {sel && <div style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, background: 'linear-gradient(135deg, #7c3aed, #a855f7)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>
                </div>}
              </div>
            )
          })}
          {/* Custom upload */}
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

      {/* Product Details */}
      <div style={cardS}>
        <div style={secTitle}>{businessType === 'business' ? 'פרטי העסק' : 'פרטי המוצר'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={lblS}>{businessType === 'business' ? 'שם העסק' : 'שם המוצר הספציפי'}</label>
            <input value={productName} onChange={e => setProductName(e.target.value)} placeholder={businessType === 'business' ? 'שווארמה אבו חסן / סטודיו לציפורניים נויה' : 'HiSmile Whitening Strips'} style={{ ...inpS, direction: 'rtl', fontFamily: 'Heebo,sans-serif', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>{businessType === 'business' ? 'מה מיוחד בעסק?' : 'מה הוא פותר?'}</label>
            <textarea value={productDesc} onChange={e => setProductDesc(e.target.value)} placeholder={businessType === 'business' ? 'השווארמה הכי טובה בעיר, בשר טרי כל יום...' : 'רצועות הלבנת שיניים שמלבינות תוך 7 ימים...'} style={{ ...inpS, height: 80, direction: 'rtl', fontFamily: 'Heebo,sans-serif', resize: 'none', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>{businessType === 'business' ? 'מה הלקוחות מקבלים?' : 'איך משתמשים?'}</label>
            <input value={applicationArea} onChange={e => setApplicationArea(e.target.value)} placeholder={businessType === 'business' ? 'מנה ענקית עם תוספות, שירות מהיר ואווירה מעולה' : 'מניחים על השיניים למשך 30 דקות'} style={{ ...inpS, direction: 'rtl', fontFamily: 'Heebo,sans-serif', marginTop: 6 }} />
          </div>
          <div>
            <label style={lblS}>{businessType === 'business' ? 'תמונת העסק / המנה (חשוב!)' : 'תמונת מוצר (חשוב!)'}</label>
            <div style={{ marginTop: 6, border: `2px dashed ${productImage ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 14, minHeight: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden', background: 'rgba(255,255,255,0.02)', transition: 'all 300ms ease' }}>
              <input type="file" accept="image/*" onChange={e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setProductImage(ev.target.result); r.readAsDataURL(f) }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
              {productImage ? <img src={productImage} alt="product" style={{ maxHeight: 80, borderRadius: 8 }} /> : <span style={{ color: '#3f3f46', fontSize: 13 }}>{businessType === 'business' ? 'לחץ להעלאת תמונת העסק או המנה' : 'לחץ להעלאת תמונת מוצר'}</span>}
            </div>
          </div>
          <div>
            <label style={lblS}>תיאור סיפור מותאם (אופציונלי)</label>
            <textarea value={storyDescription} onChange={e => setStoryDescription(e.target.value)} placeholder="תאר סיפור מותאם אישית..." style={{ ...inpS, height: 80, direction: 'rtl', fontFamily: 'Heebo,sans-serif', resize: 'none', marginTop: 6 }} />
          </div>
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
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(168,85,247,0.2)', borderTopColor: '#a855f7', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 900, color: '#f0f0ff', marginBottom: 8 }}>Agent עובד...</h2>
        <p style={{ color: '#52525b', fontSize: 14 }}>יוצר סיפור מחובר עם 4 סצנות — 8-12 דקות</p>
      </div>

      {/* Progress Steps */}
      <div style={cardS}>
        {AGENT_STEPS.map((s, idx) => {
          const st = agentStatus[s.id]
          const colors = { active: '#a855f7', done: '#22c55e', error: '#ef4444' }
          const c = colors[st] || '#27272a'
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: st === 'active' ? 'rgba(168,85,247,0.04)' : 'transparent', borderRadius: 12, border: `1px solid ${st === 'active' ? 'rgba(168,85,247,0.2)' : st === 'done' ? 'rgba(34,197,94,0.15)' : st === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)'}`, marginBottom: 8, transition: 'all 0.4s ease' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${c}12`, color: c, flexShrink: 0 }}>
                {st === 'done' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                  : st === 'error' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  : st === 'active' ? <div style={{ width: 16, height: 16, border: '2px solid rgba(168,85,247,0.3)', borderTopColor: '#a855f7', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  : s.icon}
              </div>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 14, color: st ? '#e4e4e7' : '#52525b' }}>{s.label}</div>
              <div style={{ fontSize: 12, color: c, fontWeight: 600 }}>
                {st === 'active' ? 'בתהליך...' : st === 'done' ? 'הושלם' : st === 'error' ? 'שגיאה' : 'ממתין'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Logs */}
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

  // ===== DONE STEP =====
  return (
    <div style={{ ...pageStyle, maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 24, fontWeight: 900, color: '#f0f0ff' }}>הסרטון שלך מוכן!</h2>
        <button onClick={() => { setStep('form'); setResult(null); setCurrentScene(0); setHasRerecorded(false); setEditingSceneIdx(null); setEditBuffer(''); setShowRerecordPanel(false); setRerecordText('') }} style={ghostBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          מודעה חדשה
        </button>
      </div>

      {/* Scene Timeline */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
        {result?.story?.scenes?.map((scene, i) => (
          <div key={i} onClick={() => loadScene(i)} style={{ background: CARD_BG, border: `2px solid ${currentScene === i ? 'rgba(168,85,247,0.5)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', transition: 'all 300ms ease', boxShadow: currentScene === i ? '0 0 20px rgba(168,85,247,0.15)' : 'none' }}>
            <div style={{ aspectRatio: '9/16', maxHeight: 160, background: BG, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {result.videos[i]
                ? <video src={result.videos[i]} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onLoadedMetadata={e => { e.target.currentTime = 1 }} />
                : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#27272a" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              }
              <div style={{ position: 'absolute', bottom: '25%', left: 4, right: 4, textAlign: 'center', color: 'white', fontSize: 9, fontWeight: 700, WebkitTextStroke: '0.5px black', textShadow: '0 0 4px #000, 0 0 4px #000', fontFamily: 'Heebo,sans-serif', lineHeight: 1.5 }}>{scene.subtitle}</div>
            </div>
            <div style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: currentScene === i ? '#a855f7' : '#52525b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: currentScene === i ? '#a855f7' : '#27272a' }} />
              {scene.label}
            </div>
          </div>
        ))}
      </div>

      {/* Editor Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {/* Subtitle Style */}
        <div style={cardS}>
          <div style={secTitle}>סגנון כתוביות</div>
          <select value={subtitleStyle} onChange={e => setSubtitleStyle(e.target.value)}
            style={{ ...inpS, cursor: 'pointer', appearance: 'auto' }}>
            {SUBTITLE_STYLES.map(s => <option key={s.id} value={s.id}>{s.label} — {s.desc}</option>)}
          </select>
          <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: 10, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <canvas ref={el => {
              if (!el) return; const c = el.getContext('2d'); el.width = 200; el.height = 60
              c.clearRect(0, 0, 200, 60); c.font = 'bold 14px Heebo,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
              if (subtitleStyle === 'classic') { c.strokeStyle = 'black'; c.lineWidth = 4; c.lineJoin = 'round'; c.strokeText('טקסט לדוגמה', 100, 30); c.fillStyle = 'white'; c.fillText('טקסט לדוגמה', 100, 30) }
              else if (subtitleStyle === 'bold') { c.fillStyle = 'rgba(255,255,255,0.92)'; c.beginPath(); c.roundRect(20, 10, 160, 40, 6); c.fill(); c.fillStyle = '#111'; c.fillText('טקסט לדוגמה', 100, 30) }
              else if (subtitleStyle === 'minimal') { c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = '12px Heebo,sans-serif'; c.fillText('טקסט לדוגמה', 100, 30) }
              else if (subtitleStyle === 'neon') { c.shadowColor = '#a855f7'; c.shadowBlur = 10; c.fillStyle = 'white'; c.fillText('טקסט לדוגמה', 100, 30); c.fillText('טקסט לדוגמה', 100, 30); c.shadowBlur = 0 }
            }} width={200} height={60} style={{ borderRadius: 6 }} />
          </div>
        </div>

        {/* Sound Effects */}
        <div style={cardS}>
          <div style={secTitle}>סאונד אפקטים</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[{ label: 'Whoosh בין סצנות', val: sfxWhoosh, set: setSfxWhoosh, icon: '💨' },
              { label: 'Pop על כתוביות', val: sfxPop, set: setSfxPop, icon: '🫧' },
              { label: 'Ding בסוף', val: sfxDing, set: setSfxDing, icon: '🔔' }
            ].map(s => (
              <button key={s.label} onClick={() => s.set(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: s.val ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${s.val ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, cursor: 'pointer', color: s.val ? '#d4d4ff' : '#52525b', fontSize: 12, fontFamily: 'Heebo,sans-serif', textAlign: 'right', direction: 'rtl', transition: 'all 0.2s' }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span style={{ flex: 1 }}>{s.label}</span>
                <span style={{ fontSize: 10, color: s.val ? '#a855f7' : '#3f3f46', fontWeight: 700 }}>{s.val ? 'ON' : 'OFF'}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Background Music */}
        <div style={cardS}>
          <div style={secTitle}>מוזיקת רקע</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {MUSIC_TRACKS.map(t => (
              <button key={t.id} onClick={() => setBgMusic(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: bgMusic === t.id ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${bgMusic === t.id ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, cursor: 'pointer', color: bgMusic === t.id ? '#d4d4ff' : '#52525b', fontSize: 12, fontFamily: 'Heebo,sans-serif', transition: 'all 0.2s' }}>
                <span>{t.emoji}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{t.label}</span>
                {bgMusic === t.id && t.id !== 'none' && <span style={{ fontSize: 9, color: '#a855f7' }}>✓</span>}
              </button>
            ))}
          </div>
          {bgMusic !== 'none' && (
            <button onClick={toggleMusicPreview} style={{ ...ghostBtn, width: '100%', marginTop: 8, fontSize: 11, justifyContent: 'center', color: musicPlaying ? '#ef4444' : '#a855f7', borderColor: musicPlaying ? 'rgba(239,68,68,0.3)' : 'rgba(168,85,247,0.3)' }}>
              {musicPlaying ? '⏹ עצור תצוגה מקדימה' : '▶ השמע תצוגה מקדימה'}
            </button>
          )}
        </div>

        {/* Transitions */}
        <div style={cardS}>
          <div style={secTitle}>מעברים בין סצנות</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {TRANSITIONS.map(t => (
              <button key={t.id} onClick={() => setTransition(t.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: transition === t.id ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${transition === t.id ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, cursor: 'pointer', color: transition === t.id ? '#d4d4ff' : '#52525b', fontSize: 13, fontFamily: 'Heebo,sans-serif', direction: 'rtl', transition: 'all 0.2s' }}>
                <span style={{ flex: 1, textAlign: 'right', fontWeight: transition === t.id ? 700 : 400 }}>{t.label} — {t.desc}</span>
                {transition === t.id && <span style={{ color: '#a855f7', fontSize: 14 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 20 }}>
        <div>
          <div style={cardS}>
            <div style={secTitle}>תצוגה מקדימה</div>
            <div style={{ background: '#000', borderRadius: 14, overflow: 'hidden', aspectRatio: '9/16', maxHeight: 460, position: 'relative' }}>
              <video ref={videoRef} controls playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
            </div>
          </div>
          <button onClick={exportMp4} disabled={exporting} style={{ ...bigBtn, opacity: exporting ? 0.6 : 1, fontSize: 15, padding: 14, marginBottom: 16 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {exporting ? <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
              {exporting ? 'מייצא...' : 'ייצוא MP4 עם כתוביות'}
            </span>
          </button>
          <div style={cardS}>
            <div style={secTitle}>הורד סצנות</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {result?.videos?.map((url, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: BORDER, borderRadius: 10, padding: 10, textAlign: 'center', fontSize: 12 }}>
                  <div style={{ color: '#71717a', marginBottom: 4 }}>{result.story.scenes[i].label}</div>
                  {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: '#a855f7', textDecoration: 'none', fontWeight: 600 }}>הורד</a> : <span style={{ color: '#27272a' }}>שגיאה</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={cardS}>
            <div style={secTitle}>קריינות</div>
            <audio ref={audioRef} controls style={{ width: '100%', borderRadius: 8 }} />

            {/* Re-record button — rendered IMMEDIATELY under the audio player
                so it's always visible without scrolling. Shown unconditionally
                whenever the edit panel is closed and we're on the editor step. */}
            {step === 'done' && !showRerecordPanel && (
              <button
                onClick={openRerecordPanel}
                disabled={hasRerecorded || rerecording}
                title={hasRerecorded ? 'ההקלטה מחדש זמינה פעם אחת בלבד לכל סרטון' : 'ערוך את הטקסט והקלט את הקריינות מחדש'}
                style={{
                  marginTop: 12,
                  width: '100%',
                  padding: '14px 16px',
                  background: hasRerecorded ? 'rgba(255,255,255,0.02)' : 'linear-gradient(135deg, #7c3aed, #a855f7)',
                  border: `1px solid ${hasRerecorded ? 'rgba(255,255,255,0.06)' : 'rgba(168,85,247,0.5)'}`,
                  color: hasRerecorded ? '#52525b' : '#ffffff',
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: 'Heebo,sans-serif',
                  direction: 'rtl',
                  cursor: hasRerecorded || rerecording ? 'not-allowed' : 'pointer',
                  opacity: hasRerecorded || rerecording ? 0.6 : 1,
                  boxShadow: hasRerecorded ? 'none' : '0 4px 16px rgba(124,58,237,0.25)',
                  transition: 'all 200ms ease',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}>
                {hasRerecorded ? '✓ הוקלט מחדש' : '✎ ערוך וצלם מחדש'}
              </button>
            )}
            {hasRerecorded && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#52525b', direction: 'rtl', fontFamily: 'Heebo,sans-serif', textAlign: 'center' }}>
                הקלטה מחדש זמינה פעם אחת לכל סרטון.
              </div>
            )}

            {/* Voiceover text readout — capped height with scroll so it can
                never push the re-record button below the fold. */}
            <div style={{
              marginTop: 12,
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 10,
              padding: '12px 14px',
              fontSize: 13,
              color: '#a1a1aa',
              direction: 'rtl',
              lineHeight: 1.8,
              fontFamily: 'Heebo,sans-serif',
              maxHeight: 140,
              overflowY: 'auto'
            }}>{result?.hebrewVoice}</div>

            {/* Edit panel — textarea + record/cancel */}
            {showRerecordPanel && (
              <div style={{ marginTop: 14, padding: 14, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 12 }}>
                <div style={{ fontSize: 12, color: '#a855f7', fontWeight: 700, marginBottom: 8, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>
                  עריכת טקסט הקריינות
                </div>
                <textarea
                  value={rerecordText}
                  onChange={e => setRerecordText(e.target.value)}
                  disabled={rerecording}
                  rows={6}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(168,85,247,0.3)',
                    borderRadius: 10,
                    padding: 12,
                    color: '#f0f0ff',
                    fontSize: 14,
                    fontFamily: 'Heebo,sans-serif',
                    direction: 'rtl',
                    lineHeight: 1.8,
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10, direction: 'rtl' }}>
                  <button
                    onClick={() => rerecordVoiceover(rerecordText)}
                    disabled={rerecording || !rerecordText.trim()}
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      background: rerecording || !rerecordText.trim() ? 'rgba(168,85,247,0.2)' : 'linear-gradient(135deg, #7c3aed, #a855f7)',
                      border: 'none',
                      color: 'white',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: 'Heebo,sans-serif',
                      cursor: rerecording || !rerecordText.trim() ? 'not-allowed' : 'pointer',
                      opacity: rerecording || !rerecordText.trim() ? 0.6 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                    }}>
                    {rerecording
                      ? <><div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> מקליט...</>
                      : <>צלם קריינות מחדש 🎙️</>}
                  </button>
                  <button
                    onClick={closeRerecordPanel}
                    disabled={rerecording}
                    style={{ ...ghostBtn, padding: '10px 16px', fontSize: 13, opacity: rerecording ? 0.5 : 1, cursor: rerecording ? 'not-allowed' : 'pointer' }}>
                    ביטול
                  </button>
                </div>
              </div>
            )}
          </div>
          <div style={cardS}>
            <div style={secTitle}>פירוט הסיפור</div>
            {result?.story?.scenes?.map((scene, i) => (
              <div key={i} style={{ marginBottom: 10, padding: '14px 16px', background: currentScene === i ? 'rgba(168,85,247,0.04)' : 'rgba(255,255,255,0.02)', borderRadius: 12, border: `1px solid ${currentScene === i ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.04)'}`, transition: 'all 300ms ease' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#a855f7' }}>{scene.label}</div>
                  {editingSceneIdx !== i && (
                    <button
                      onClick={() => openSceneEdit(i)}
                      disabled={hasRerecorded}
                      title={hasRerecorded ? 'לא ניתן לערוך לאחר הקלטה מחדש' : 'ערוך את טקסט הקריינות של הסצנה'}
                      style={{
                        background: 'transparent',
                        border: `1px solid ${hasRerecorded ? 'rgba(255,255,255,0.06)' : 'rgba(168,85,247,0.3)'}`,
                        color: hasRerecorded ? '#3f3f46' : '#a855f7',
                        padding: '3px 10px',
                        borderRadius: 8,
                        fontSize: 11,
                        cursor: hasRerecorded ? 'not-allowed' : 'pointer',
                        fontFamily: 'Heebo,sans-serif',
                        direction: 'rtl',
                        opacity: hasRerecorded ? 0.6 : 1
                      }}>
                      ✎ ערוך טקסט
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#52525b', marginBottom: 4, lineHeight: 1.7 }}><span style={{ color: '#8b5cf6', fontWeight: 600 }}>NB:</span> {scene.nb_prompt}</div>
                <div style={{ fontSize: 11, color: '#52525b', marginBottom: 4, lineHeight: 1.7 }}><span style={{ color: '#7c3aed', fontWeight: 600 }}>Kling:</span> {scene.kling_prompt}</div>
                {editingSceneIdx === i ? (
                  <div style={{ marginTop: 6 }}>
                    <textarea
                      value={editBuffer}
                      onChange={e => setEditBuffer(e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(168,85,247,0.3)',
                        borderRadius: 8,
                        padding: 10,
                        color: '#f0f0ff',
                        fontSize: 12,
                        fontFamily: 'Heebo,sans-serif',
                        direction: 'rtl',
                        lineHeight: 1.7,
                        outline: 'none',
                        resize: 'vertical'
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                      <button onClick={cancelSceneEdit} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 11 }}>ביטול</button>
                      <button
                        onClick={saveSceneEdit}
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)', border: 'none', color: 'white', padding: '4px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', fontFamily: 'Heebo,sans-serif' }}>
                        שמור
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 500, direction: 'rtl', lineHeight: 1.7 }}>{scene.voiceover || scene.subtitle}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const BG = '#09090b'
const CARD_BG = 'rgba(255,255,255,0.03)'
const BORDER = '1px solid rgba(255,255,255,0.08)'
const GLOW = '0 0 30px rgba(124,58,237,0.3)'
const pageStyle = { position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto', padding: '32px 20px' }
const cardS = { background: CARD_BG, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: BORDER, borderRadius: 18, padding: 24, marginBottom: 16 }
const secTitle = { fontSize: 13, fontWeight: 700, color: '#a855f7', letterSpacing: 1, marginBottom: 16 }
const lblS = { fontSize: 13, color: '#71717a', display: 'block', fontWeight: 500 }
const inpS = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', color: '#f0f0ff', fontSize: 14, outline: 'none', width: '100%', direction: 'ltr', fontFamily: 'monospace', transition: 'all 300ms ease' }
const ghostBtn = { background: 'rgba(255,255,255,0.03)', border: BORDER, color: '#71717a', padding: '8px 16px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontFamily: 'Heebo,sans-serif', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 200ms ease' }
const bigBtn = { width: '100%', padding: 18, background: 'linear-gradient(135deg, #7c3aed, #a855f7)', border: 'none', borderRadius: 14, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 18, fontWeight: 700, cursor: 'pointer', marginTop: 8, boxShadow: GLOW, transition: 'all 300ms ease' }
