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

// === Background Music Tracks (Web Audio generated) ===
const MUSIC_TRACKS = [
  { id: 'none', label: 'ללא מוזיקה', emoji: '🔇' },
  { id: 'upbeat', label: 'Upbeat TikTok', emoji: '🎵', bpm: 130, key: 'C' },
  { id: 'chill', label: 'Chill Vibes', emoji: '🌊', bpm: 85, key: 'Am' },
  { id: 'motivational', label: 'Motivational', emoji: '💪', bpm: 110, key: 'G' },
  { id: 'dramatic', label: 'Dramatic', emoji: '🎭', bpm: 70, key: 'Dm' },
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
    val *= fadeIn * fadeOut * 0.7
    left[i] = val; right[i] = val * 0.95 + 0.01 * Math.sin(2 * Math.PI * 0.5 * t) * val
  }
  return buffer
}

// Draw subtitles with style on a Canvas context
function drawSubtitleOnCtx(ctx, lines, canvasW, canvasH, style) {
  const isMinimal = style === 'minimal'
  const fontSize = isMinimal ? 36 : 48
  ctx.font = `bold ${fontSize}px Heebo, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const lineHeight = isMinimal ? 42 : 58
  const startY = canvasH * 0.82 - ((lines.length - 1) * lineHeight) / 2
  const x = canvasW / 2
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight
    if (style === 'classic') {
      ctx.strokeStyle = 'black'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.miterLimit = 2
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

// Draw subtitles (preview size) on a canvas overlay
function drawSubtitlePreview(ctx, lines, canvasW, canvasH, style) {
  const isMinimal = style === 'minimal'
  const fontSize = isMinimal ? 16 : 22
  ctx.font = `bold ${fontSize}px Heebo, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const lineHeight = isMinimal ? 20 : 28
  const startY = canvasH * 0.82 - ((lines.length - 1) * lineHeight) / 2
  const x = canvasW / 2
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight
    if (style === 'classic') {
      ctx.strokeStyle = 'black'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.miterLimit = 2
      ctx.strokeText(line, x, y); ctx.fillStyle = 'white'; ctx.fillText(line, x, y)
    } else if (style === 'bold') {
      const metrics = ctx.measureText(line)
      const tw = metrics.width + 16, th = fontSize + 10
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      const rx = x - tw / 2, ry = y - th / 2, r = 6
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
      ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 12
      ctx.fillStyle = 'white'; ctx.fillText(line, x, y); ctx.fillText(line, x, y)
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'
    }
  })
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
  useEffect(() => {
    const checkUser = async () => {
      if (!supabase) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) window.location.replace('/login')
    }
    checkUser()
  }, [])

  const [step, setStep] = useState('form')
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [customAvatar, setCustomAvatar] = useState(null)
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [applicationArea, setApplicationArea] = useState('')
  const [productImage, setProductImage] = useState(null)
  const [storyDescription, setStoryDescription] = useState('')
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
  const [savingEdit, setSavingEdit] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const videoRef = useRef(null)
  const audioRef = useRef(null)
  const canvasRef = useRef(null)
  const audioBlobUrl = useRef(null)
  const playingRef = useRef(false)
  const musicSourceRef = useRef(null)
  const musicCtxRef = useRef(null)

  // Preload ALL video blobs on page load for instant playback
  useEffect(() => {
    if (step !== 'done' || !result?.videos) return
    let cancelled = false
    const preload = async () => {
      const urls = await Promise.all(result.videos.map(async (url) => {
        if (!url) return null
        try {
          const resp = await fetch(url)
          const blob = await resp.blob()
          return URL.createObjectURL(blob)
        } catch { return url }
      }))
      if (!cancelled) {
        setVideoBlobUrls(urls)
        if (videoRef.current && urls[currentScene]) {
          videoRef.current.src = urls[currentScene]
          videoRef.current.load()
        }
      }
    }
    preload()
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
    const words = subtitle.split(/\s+/)
    const lines = []
    for (let i = 0; i < words.length; i += 4) lines.push(words.slice(i, i + 4).join(' '))
    drawSubtitlePreview(ctx, lines, canvas.width, canvas.height, subtitleStyle)
  }, [currentScene, result, step, subtitleStyle])

  // Stop music preview on track change
  useEffect(() => {
    if (musicSourceRef.current) { try { musicSourceRef.current.stop() } catch {} }
    if (musicCtxRef.current) { try { musicCtxRef.current.close() } catch {} }
    musicSourceRef.current = null; musicCtxRef.current = null; setMusicPreviewing(false)
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
    const currentCheck = customAvatar || selectedAvatar?.url
    if (!currentCheck) return alert('בחר דמות')
    if (!productName || !productDesc) return alert('הכנס שם ותיאור מוצר')
    setStep('generating'); setLogs([]); setAgentStatus({ script: 'active' }); addLog('Agent מתחיל לעבוד...')
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
      if (productImage && productImage.startsWith('data:')) {
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
      const agentRes = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: productDesc, productName, applicationArea, storyDescription, avatarUrl: finalAvatarUrl, productImageUrl, falKey, elevenKey, voiceId: 'Z3R5wn05IrDiVCyEkUrK' })
      })
      if (!agentRes.ok) throw new Error('Agent failed')
      const { jobId } = await agentRes.json()
      if (!jobId) throw new Error('No jobId returned')
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
      setResult(data)
      const hasVideos = data.videos?.some(v => v)
      if (hasVideos) { setStep('done') } else { addLog('לא נוצרו סרטונים — נשאר בדף הלוגים', 'err') }
    } catch (e) { addLog(e.message, 'err'); alert('שגיאה: ' + e.message); setStep('form') }
  }

  const loadScene = (idx) => {
    setCurrentScene(idx)
    const url = videoBlobUrls[idx] || result?.videos?.[idx]
    if (url && videoRef.current) { videoRef.current.src = url; videoRef.current.load() }
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

  // Toggle music preview
  const toggleMusicPreview = useCallback(() => {
    if (musicPreviewing) {
      if (musicSourceRef.current) { try { musicSourceRef.current.stop() } catch {} }
      if (musicCtxRef.current) { try { musicCtxRef.current.close() } catch {} }
      musicSourceRef.current = null; musicCtxRef.current = null; setMusicPreviewing(false); return
    }
    if (bgMusic === 'none') return
    try {
      const ctx = createAudioContext(); musicCtxRef.current = ctx
      const buf = generateMusicBuffer(ctx, bgMusic, 8)
      const source = ctx.createBufferSource(); source.buffer = buf; source.connect(ctx.destination)
      source.onended = () => setMusicPreviewing(false); source.start()
      musicSourceRef.current = source; setMusicPreviewing(true)
    } catch {}
  }, [bgMusic, musicPreviewing])

  // Play all clips sequentially with voiceover + music
  const playAll = useCallback(async () => {
    if (!result?.videos) return
    if (playing) {
      playingRef.current = false; setPlaying(false)
      if (videoRef.current) videoRef.current.pause()
      if (audioRef.current) audioRef.current.pause()
      if (musicSourceRef.current) { try { musicSourceRef.current.stop() } catch {} }
      return
    }
    setPlaying(true); playingRef.current = true
    // Start voiceover
    if (audioRef.current && audioBlobUrl.current) { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => {}) }
    // Start generated music
    if (bgMusic !== 'none') {
      try {
        const ctx = createAudioContext(); musicCtxRef.current = ctx
        const buf = generateMusicBuffer(ctx, bgMusic, 22)
        const source = ctx.createBufferSource(); source.buffer = buf
        const gain = ctx.createGain(); gain.gain.value = 0.25
        source.connect(gain); gain.connect(ctx.destination); source.start()
        musicSourceRef.current = source
      } catch {}
    }
    for (const sceneIdx of clipOrder) {
      if (!playingRef.current) break
      const url = videoBlobUrls[sceneIdx] || result.videos[sceneIdx]
      if (!url || !videoRef.current) continue
      setCurrentScene(sceneIdx)
      videoRef.current.src = url; videoRef.current.load()
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 8000)
        const onEnd = () => { clearTimeout(timeout); videoRef.current.removeEventListener('ended', onEnd); resolve() }
        videoRef.current.addEventListener('ended', onEnd)
        videoRef.current.play().catch(() => { clearTimeout(timeout); resolve() })
      })
    }
    setPlaying(false); playingRef.current = false
    if (audioRef.current) audioRef.current.pause()
    if (musicSourceRef.current) { try { musicSourceRef.current.stop() } catch {} }
    if (musicCtxRef.current) { try { musicCtxRef.current.close() } catch {} }
  }, [result, clipOrder, bgMusic, playing])

  // === Canvas-based export (fixed: fetch-to-blob for CORS, AudioBuffer for voiceover) ===
  const exportMp4 = async () => {
    if (!result?.videos?.length) return
    setExporting(true); setExportProgress('מכין קבצים...')
    try {
      const orderedScenes = clipOrder.map(i => i).filter(i => result.videos[i])
      if (orderedScenes.length === 0) throw new Error('אין סרטונים לייצוא')

      // Use preloaded blob URLs if available, otherwise fetch
      setExportProgress('מכין סרטונים... 0%')
      const blobUrls = []
      for (let i = 0; i < orderedScenes.length; i++) {
        const preloaded = videoBlobUrls[orderedScenes[i]]
        if (preloaded && preloaded.startsWith('blob:')) {
          blobUrls.push(preloaded)
        } else {
          try {
            const resp = await fetch(result.videos[orderedScenes[i]])
            const blob = await resp.blob()
            blobUrls.push(URL.createObjectURL(blob))
          } catch {
            blobUrls.push(result.videos[orderedScenes[i]])
          }
        }
        setExportProgress(`מכין סרטונים... ${Math.round(((i + 1) / orderedScenes.length) * 20)}%`)
      }

      setExportProgress('מייצא וידאו...')
      const offCanvas = document.createElement('canvas'); offCanvas.width = 1080; offCanvas.height = 1920
      const ctx = offCanvas.getContext('2d')

      // Find supported mime type
      let mimeType = 'video/webm;codecs=vp9'
      if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) mimeType = 'video/webm;codecs=h264'
      if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4'

      const stream = offCanvas.captureStream(30)

      // Audio setup — use AudioBuffer approach (avoids createMediaElementSource one-time limit)
      const exportAudioCtx = new AudioContext()
      const dest = exportAudioCtx.createMediaStreamDestination()
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))

      // Add voiceover via decodeAudioData
      if (audioBlobUrl.current) {
        try {
          const audioResp = await fetch(audioBlobUrl.current)
          const audioArrayBuf = await audioResp.arrayBuffer()
          const audioBuf = await exportAudioCtx.decodeAudioData(audioArrayBuf)
          const voiceSource = exportAudioCtx.createBufferSource()
          voiceSource.buffer = audioBuf
          voiceSource.connect(dest)
          voiceSource.start()
        } catch (e) { console.warn('Voiceover decode failed:', e.message) }
      }

      // Add background music
      if (bgMusic !== 'none') {
        const totalDuration = orderedScenes.length * 5 + 2
        const musicBuf = generateMusicBuffer(exportAudioCtx, bgMusic, totalDuration)
        const musicSource = exportAudioCtx.createBufferSource()
        musicSource.buffer = musicBuf
        const musicGain = exportAudioCtx.createGain(); musicGain.gain.value = 0.3
        musicSource.connect(musicGain); musicGain.connect(dest); musicSource.start()
      }

      // Add SFX sounds to export audio dest
      const playSfxToExport = (type) => {
        if (!sfxEnabled) return
        try {
          if (type === 'whoosh') {
            const osc = exportAudioCtx.createOscillator(), gain = exportAudioCtx.createGain(), filter = exportAudioCtx.createBiquadFilter()
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(800, exportAudioCtx.currentTime)
            osc.frequency.exponentialRampToValueAtTime(200, exportAudioCtx.currentTime + 0.3)
            filter.type = 'bandpass'; filter.frequency.value = 600; filter.Q.value = 2
            gain.gain.setValueAtTime(0.25, exportAudioCtx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, exportAudioCtx.currentTime + 0.35)
            osc.connect(filter); filter.connect(gain); gain.connect(dest)
            osc.start(exportAudioCtx.currentTime); osc.stop(exportAudioCtx.currentTime + 0.4)
          } else if (type === 'pop') {
            const osc = exportAudioCtx.createOscillator(), gain = exportAudioCtx.createGain()
            osc.type = 'sine'; osc.frequency.setValueAtTime(600, exportAudioCtx.currentTime)
            osc.frequency.exponentialRampToValueAtTime(200, exportAudioCtx.currentTime + 0.08)
            gain.gain.setValueAtTime(0.3, exportAudioCtx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, exportAudioCtx.currentTime + 0.12)
            osc.connect(gain); gain.connect(dest)
            osc.start(exportAudioCtx.currentTime); osc.stop(exportAudioCtx.currentTime + 0.15)
          } else if (type === 'ding') {
            const osc = exportAudioCtx.createOscillator(), gain = exportAudioCtx.createGain()
            osc.type = 'sine'; osc.frequency.setValueAtTime(1200, exportAudioCtx.currentTime)
            gain.gain.setValueAtTime(0.35, exportAudioCtx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, exportAudioCtx.currentTime + 0.8)
            osc.connect(gain); gain.connect(dest)
            osc.start(exportAudioCtx.currentTime); osc.stop(exportAudioCtx.currentTime + 1)
          }
        } catch {}
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      const chunks = []
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      const donePromise = new Promise(resolve => { mediaRecorder.onstop = resolve })
      mediaRecorder.start()

      for (let clipIdx = 0; clipIdx < blobUrls.length; clipIdx++) {
        const sceneIdx = orderedScenes[clipIdx]
        const url = blobUrls[clipIdx]
        const pct = 20 + Math.round(((clipIdx + 1) / blobUrls.length) * 70)
        setExportProgress(`מייצא סצנה ${clipIdx + 1}/${blobUrls.length}... ${pct}%`)

        // SFX between scenes
        if (clipIdx > 0) playSfxToExport('whoosh')
        playSfxToExport('pop')

        const transitionFrames = transition === 'cut' ? 0 : 15

        await new Promise((resolve) => {
          let resolved = false
          const done = () => { if (!resolved) { resolved = true; resolve() } }
          const timeout = setTimeout(done, 8000) // 8s safety per 5s clip
          const vid = document.createElement('video')
          vid.crossOrigin = 'anonymous'; vid.src = url; vid.muted = true; vid.playsInline = true
          vid.onended = () => { clearTimeout(timeout); done() }
          vid.onerror = () => { clearTimeout(timeout); done() }
          vid.oncanplay = async () => {
            try { await vid.play() } catch { done(); return }
            const subtitle = result.story?.scenes?.[sceneIdx]?.subtitle || ''
            const words = subtitle.split(/\s+/); const lines = []
            for (let w = 0; w < words.length; w += 4) lines.push(words.slice(w, w + 4).join(' '))
            let frameCount = 0
            const drawFrame = () => {
              if (resolved || vid.paused || vid.ended) { clearTimeout(timeout); done(); return }
              frameCount++
              const inTransition = frameCount <= transitionFrames
              let alpha = 1, scale = 1
              if (inTransition && transition === 'fade') alpha = frameCount / transitionFrames
              if (inTransition && transition === 'zoom') { scale = 1.15 - 0.15 * (frameCount / transitionFrames); alpha = frameCount / transitionFrames }
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
        })
      }

      // Ding at end
      playSfxToExport('ding')
      await new Promise(r => setTimeout(r, 1000))

      setExportProgress('מסיים... 95%')
      mediaRecorder.stop(); await donePromise
      try { exportAudioCtx.close() } catch {}
      // Revoke blob URLs
      blobUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch {} })

      const blob = new Blob(chunks, { type: mimeType })
      const blobUrl = URL.createObjectURL(blob)
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
      const a = document.createElement('a'); a.style.display = 'none'; a.href = blobUrl; a.download = `ugc-video.${ext}`
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(blobUrl)
      setExportProgress('')
    } catch (e) { alert('שגיאה בייצוא: ' + e.message); setExportProgress('') } finally { setExporting(false) }
  }

  // === Save Edit to Supabase ===
  const saveEdit = async () => {
    if (!supabase || !result) return
    setSavingEdit(true); setSaveMsg('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setSaveMsg('יש להתחבר כדי לשמור'); setSavingEdit(false); return }
      const editData = {
        user_id: user.id,
        product_name: productName,
        clip_order: clipOrder,
        subtitle_style: subtitleStyle,
        bg_music: bgMusic,
        sfx_enabled: sfxEnabled,
        transition: transition,
        videos: result.videos,
        frames: result.frames,
        story: result.story,
        audio_base64: result.audioBase64,
        hebrew_voice: result.hebrewVoice,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('saved_edits').upsert(editData, { onConflict: 'user_id,product_name' })
      if (error) throw error
      setSaveMsg('נשמר בהצלחה!')
      setTimeout(() => setSaveMsg(''), 3000)
    } catch (e) { setSaveMsg('שגיאה: ' + e.message) } finally { setSavingEdit(false) }
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

      {/* API Keys */}
      <div style={cardS}>
        <button onClick={() => setKeysOpen(o => !o)} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          API Keys
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: keysOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 200ms' }}><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {keysOpen && (
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={lblS}>fal.ai Key</label><input type="password" value={falKey} onChange={e => setFalKey(e.target.value)} placeholder="xxxxxxxx:xxxxxxxx" style={{ ...inpS, marginTop: 6 }} /></div>
            <div><label style={lblS}>ElevenLabs Key</label><input type="password" value={elevenKey} onChange={e => setElevenKey(e.target.value)} placeholder="sk_xxxxxxxx" style={{ ...inpS, marginTop: 6 }} /></div>
            <div style={{ gridColumn: '1/-1', background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.12)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#52525b' }}>
              <span style={{ color: '#a855f7', fontWeight: 600 }}>Claude API</span> רץ בשרת — לא צריך מפתח
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

      <div style={cardS}>
        {AGENT_STEPS.map((s) => {
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
          <button onClick={() => { setStep('form'); setResult(null); setCurrentScene(0); setClipOrder([0,1,2,3]) }} style={ghostBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            מודעה חדשה
          </button>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: '#f0f0ff', margin: 0 }}>עריכת סרטון</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith('שגיאה') ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{saveMsg}</span>}
          <button onClick={saveEdit} disabled={savingEdit} style={{ ...ghostBtn, color: '#22c55e', borderColor: 'rgba(34,197,94,0.3)' }}>
            {savingEdit ? <div style={{ width: 14, height: 14, border: '2px solid rgba(34,197,94,0.3)', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>}
            שמור עריכה
          </button>
          <button onClick={playAll} style={{ ...ghostBtn, color: playing ? '#ef4444' : '#a855f7', borderColor: playing ? 'rgba(239,68,68,0.3)' : 'rgba(168,85,247,0.3)' }}>
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
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: subtitleStyle === s.id ? 'rgba(168,85,247,0.08)' : 'transparent', border: `1px solid ${subtitleStyle === s.id ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: subtitleStyle === s.id ? '#d4d4ff' : '#71717a', fontFamily: 'Heebo,sans-serif', transition: 'all 0.2s' }}>
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
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: sfxEnabled ? 'rgba(168,85,247,0.06)' : 'transparent', border: `1px solid ${sfxEnabled ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, color: sfxEnabled ? '#d4d4ff' : '#52525b', fontFamily: 'Heebo,sans-serif', width: '100%', marginBottom: 8, transition: 'all 0.2s' }}>
              <span>🔊</span><span style={{ flex: 1, textAlign: 'right' }}>אפקטי סאונד</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: sfxEnabled ? '#a855f7' : '#3f3f46' }}>{sfxEnabled ? 'ON' : 'OFF'}</span>
            </button>
            <div style={{ display: 'flex', gap: 4 }}>
              {TRANSITIONS.map(t => (
                <button key={t.id} onClick={() => setTransition(t.id)}
                  style={{ flex: 1, padding: '7px 6px', background: transition === t.id ? 'rgba(168,85,247,0.08)' : 'transparent', border: `1px solid ${transition === t.id ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 11, color: transition === t.id ? '#d4d4ff' : '#52525b', fontFamily: 'Heebo,sans-serif', textAlign: 'center', transition: 'all 0.2s' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Script / voiceover */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 10, fontSize: 12 }}>קריינות</div>
            <audio ref={audioRef} controls style={{ width: '100%', borderRadius: 8, height: 32 }} />
            <div style={{ marginTop: 8, fontSize: 11, color: '#a1a1aa', direction: 'rtl', lineHeight: 1.7, fontFamily: 'Heebo,sans-serif', maxHeight: 80, overflowY: 'auto' }}>{result?.hebrewVoice}</div>
          </div>

          {/* Scene detail for current */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 8, fontSize: 12 }}>סצנה {currentScene + 1} — {result?.story?.scenes?.[currentScene]?.type}</div>
            <div style={{ fontSize: 10, color: '#52525b', lineHeight: 1.6, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>
              <div style={{ marginBottom: 4 }}><span style={{ color: '#22c55e', fontWeight: 600 }}>{result?.story?.scenes?.[currentScene]?.subtitle}</span></div>
              <div><span style={{ color: '#8b5cf6', fontWeight: 500 }}>Kling:</span> {result?.story?.scenes?.[currentScene]?.kling_prompt?.slice(0, 120)}...</div>
            </div>
          </div>

          {/* Downloads */}
          <div style={{ ...cardS, marginBottom: 0, padding: 16 }}>
            <div style={{ ...secTitle, marginBottom: 8, fontSize: 12 }}>הורדות בודדות</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {result?.videos?.map((url, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: BORDER, borderRadius: 6, padding: '6px 8px', textAlign: 'center', fontSize: 10 }}>
                  <div style={{ color: '#52525b', marginBottom: 2 }}>{sceneLabels[i]}</div>
                  {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: '#a855f7', textDecoration: 'none', fontWeight: 600 }}>הורד</a> : <span style={{ color: '#27272a' }}>--</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Full-width Preview */}
        <div style={{ ...cardS, marginBottom: 0, padding: 0, overflow: 'hidden' }}>
          <div style={{ background: '#000', aspectRatio: '9/16', maxHeight: 640, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
            <video ref={videoRef} playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
            {!playing && (
              <button onClick={playAll} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 72, height: 72, borderRadius: '50%', background: 'rgba(168,85,247,0.8)', border: '2px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', transition: 'all 200ms ease' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
            )}
            {playing && (
              <button onClick={playAll} style={{ position: 'absolute', top: 12, right: 12, width: 36, height: 36, borderRadius: 8, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              </button>
            )}
            {/* Current scene badge */}
            <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(168,85,247,0.8)', borderRadius: 8, padding: '4px 10px', fontSize: 11, color: '#fff', fontWeight: 700, backdropFilter: 'blur(4px)' }}>
              סצנה {currentScene + 1} — {result?.story?.scenes?.[currentScene]?.type}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Full-width CapCut-style Timeline — always visible */}
      <div style={{ background: 'rgba(15,15,20,0.95)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 16px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#a855f7', letterSpacing: 0.5 }}>ציר זמן</span>
          </div>
          <div style={{ fontSize: 10, color: '#3f3f46' }}>גרור כדי לשנות סדר</div>
        </div>
        {/* Clip cards */}
        <div style={{ display: 'flex', gap: 6 }}>
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
                style={{ flex: '1 1 0', minWidth: 0, background: isActive ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)', border: `2px solid ${isActive ? 'rgba(168,85,247,0.5)' : isDragging ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, overflow: 'hidden', cursor: 'grab', opacity: isDragging ? 0.5 : 1, transition: 'all 200ms ease', boxShadow: isActive ? '0 0 16px rgba(168,85,247,0.2)' : 'none' }}>
                <div style={{ aspectRatio: '16/9', background: BG, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {videoUrl
                    ? <video src={videoUrl} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onLoadedMetadata={e => { e.target.currentTime = 1 }} />
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27272a" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/></svg>
                  }
                  <div style={{ position: 'absolute', top: 3, left: 3, background: 'rgba(0,0,0,0.7)', borderRadius: 3, padding: '1px 5px', fontSize: 8, color: '#fff', fontWeight: 600 }}>5s</div>
                  <div style={{ position: 'absolute', top: 3, right: 3, width: 16, height: 16, borderRadius: 4, background: isActive ? '#a855f7' : 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700 }}>{orderIdx + 1}</div>
                  <div style={{ position: 'absolute', bottom: 2, left: 3, right: 3, textAlign: 'center', color: 'white', fontSize: 8, fontWeight: 700, textShadow: '0 0 3px #000, 0 0 3px #000', fontFamily: 'Heebo,sans-serif', lineHeight: 1.3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{scene?.subtitle}</div>
                </div>
                <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                  <span style={{ fontSize: 9, fontWeight: 600, color: isActive ? '#a855f7' : '#52525b' }}>{scene?.type || sceneLabels[sceneIdx]}</span>
                </div>
              </div>
            )
          })}
        </div>
        {/* Progress bar */}
        <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.04)', display: 'flex', overflow: 'hidden' }}>
          {clipOrder.map((sceneIdx, i) => (
            <div key={i} style={{ flex: 1, background: currentScene === sceneIdx ? 'linear-gradient(90deg, #7c3aed, #a855f7)' : 'rgba(168,85,247,0.15)', borderRight: i < clipOrder.length - 1 ? '1px solid rgba(0,0,0,0.3)' : 'none', transition: 'background 300ms ease' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 9, color: '#3f3f46', fontWeight: 500 }}>
          <span>0s</span><span>5s</span><span>10s</span><span>15s</span><span>20s</span>
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
