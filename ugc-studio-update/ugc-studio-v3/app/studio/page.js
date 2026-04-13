'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

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
  const [clipOrder, setClipOrder] = useState([0, 1, 2, 3])
  const [dragIdx, setDragIdx] = useState(null)
  const [musicUrl, setMusicUrl] = useState(null)
  const [musicName, setMusicName] = useState('')
  const [playing, setPlaying] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const videoRef = useRef(null)
  const audioRef = useRef(null)
  const canvasRef = useRef(null)
  const musicRef = useRef(null)
  const audioBlobUrl = useRef(null)
  const playingRef = useRef(false)

  // Assign video and audio src after done step mounts the refs
  useEffect(() => {
    if (step !== 'done' || !result) return
    if (videoRef.current && result.videos?.[currentScene]) {
      videoRef.current.src = result.videos[currentScene]
      videoRef.current.load()
    }
    if (audioRef.current && audioBlobUrl.current) {
      audioRef.current.src = audioBlobUrl.current
      audioRef.current.load()
    }
  }, [step, result])

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
    ctx.font = 'bold 22px Heebo, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lineHeight = 28
    const startY = canvas.height * 0.82 - ((lines.length - 1) * lineHeight) / 2
    const x = canvas.width / 2
    lines.forEach((line, i) => {
      const y = startY + i * lineHeight
      ctx.strokeStyle = 'black'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.miterLimit = 2
      ctx.strokeText(line, x, y)
      ctx.fillStyle = 'white'; ctx.fillText(line, x, y)
    })
  }, [currentScene, result, step])

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

      // Animate progress steps while polling
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
      }, 45000) // advance step roughly every 45s

      // Poll for job completion
      const pollResult = await new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/agent/status?jobId=${jobId}`)
            const statusData = await statusRes.json()
            if (statusData.status === 'done') {
              clearInterval(poll)
              clearInterval(progressInterval)
              resolve(statusData.result)
            } else if (statusData.status === 'error') {
              clearInterval(poll)
              clearInterval(progressInterval)
              reject(new Error(statusData.error || 'Job failed'))
            }
            // status === 'pending' — keep polling
          } catch (err) {
            // Network error during poll — keep trying
            addLog('שגיאת רשת בבדיקת סטטוס, מנסה שוב...', 'err')
          }
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
      if (hasVideos) {
        setStep('done')
      } else {
        addLog('לא נוצרו סרטונים — נשאר בדף הלוגים', 'err')
      }
    } catch (e) { addLog(e.message, 'err'); alert('שגיאה: ' + e.message); setStep('form') }
  }

  const loadScene = (idx) => {
    setCurrentScene(idx)
    const url = result?.videos?.[idx]
    if (url && videoRef.current) { videoRef.current.src = url; videoRef.current.load() }
  }

  // Drag-and-drop reorder
  const handleDragStart = (e, idx) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', idx)
  }
  const handleDragOver = (e, idx) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const newOrder = [...clipOrder]
    const [moved] = newOrder.splice(dragIdx, 1)
    newOrder.splice(idx, 0, moved)
    setClipOrder(newOrder)
    setDragIdx(idx)
  }
  const handleDragEnd = () => setDragIdx(null)

  // Music upload
  const handleMusicUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setMusicName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      setMusicUrl(ev.target.result)
      if (musicRef.current) { musicRef.current.src = ev.target.result; musicRef.current.load() }
    }
    reader.readAsDataURL(file)
  }

  // Play all clips in order with voiceover + music
  const playAll = useCallback(async () => {
    if (!result?.videos) return
    if (playing) {
      playingRef.current = false
      setPlaying(false)
      if (videoRef.current) videoRef.current.pause()
      if (audioRef.current) audioRef.current.pause()
      if (musicRef.current) musicRef.current.pause()
      return
    }
    setPlaying(true)
    playingRef.current = true
    // Start voiceover and music
    if (audioRef.current && audioBlobUrl.current) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
    }
    if (musicRef.current && musicUrl) {
      musicRef.current.currentTime = 0
      musicRef.current.volume = 0.25
      musicRef.current.play().catch(() => {})
    }
    // Play clips sequentially in order
    for (const sceneIdx of clipOrder) {
      if (!playingRef.current) break
      const url = result.videos[sceneIdx]
      if (!url || !videoRef.current) continue
      setCurrentScene(sceneIdx)
      videoRef.current.src = url
      videoRef.current.load()
      await new Promise(resolve => {
        const onEnd = () => { videoRef.current.removeEventListener('ended', onEnd); resolve() }
        videoRef.current.addEventListener('ended', onEnd)
        videoRef.current.play().catch(resolve)
      })
    }
    setPlaying(false)
    playingRef.current = false
    if (audioRef.current) audioRef.current.pause()
    if (musicRef.current) musicRef.current.pause()
  }, [result, clipOrder, musicUrl, playing])

  // Server-side export via fal.ai ffmpeg
  const exportMp4 = async () => {
    if (!result?.videos?.length) return
    setExporting(true)
    setExportProgress('מאחד קליפים...')
    try {
      // Reorder videos according to timeline
      const orderedVideos = clipOrder.map(i => result.videos[i]).filter(Boolean)
      if (orderedVideos.length === 0) throw new Error('אין סרטונים לייצוא')

      // Build audio URL from base64
      let voiceAudioUrl = null
      if (audioBlobUrl.current) {
        voiceAudioUrl = audioBlobUrl.current
      }

      setExportProgress('מעבד וידאו + אודיו בשרת...')
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrls: orderedVideos,
          audioUrl: voiceAudioUrl,
          musicUrl: musicUrl || null
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (!data.videoUrl) throw new Error('לא התקבל URL לסרטון')

      setExportProgress('מוריד...')
      // Download the final video
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = data.videoUrl
      a.download = 'ugc-video.mp4'
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setExportProgress('')
    } catch (e) {
      alert('שגיאה בייצוא: ' + e.message)
      setExportProgress('')
    } finally {
      setExporting(false)
    }
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

  // ===== DONE STEP — CapCut-style editor =====
  return (
    <div style={{ ...pageStyle, maxWidth: 1200 }}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => { setStep('form'); setResult(null); setCurrentScene(0); setClipOrder([0,1,2,3]); setMusicUrl(null); setMusicName('') }} style={ghostBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            מודעה חדשה
          </button>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#f0f0ff', margin: 0 }}>עריכת סרטון</h2>
        </div>
        <button onClick={exportMp4} disabled={exporting} style={{ ...bigBtn, width: 'auto', padding: '12px 32px', margin: 0, fontSize: 15 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {exporting ? <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
            {exporting ? (exportProgress || 'מייצא...') : 'ייצוא MP4'}
          </span>
        </button>
      </div>

      {/* Main editor area */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, marginBottom: 20 }}>
        {/* Left: Preview */}
        <div>
          <div style={{ ...cardS, padding: 0, overflow: 'hidden', position: 'relative' }}>
            <div style={{ background: '#000', aspectRatio: '9/16', maxHeight: 520, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video ref={videoRef} playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
              {/* Play All overlay button */}
              {!playing && (
                <button onClick={playAll} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 64, height: 64, borderRadius: '50%', background: 'rgba(168,85,247,0.85)', border: '2px solid rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', transition: 'all 200ms ease' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>
              )}
              {playing && (
                <button onClick={playAll} style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: 10, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Audio controls + details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Voiceover */}
          <div style={cardS}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
              <div style={secTitle}>קריינות</div>
            </div>
            <audio ref={audioRef} controls style={{ width: '100%', borderRadius: 8, height: 36 }} />
            <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#a1a1aa', direction: 'rtl', lineHeight: 1.7, fontFamily: 'Heebo,sans-serif', maxHeight: 80, overflowY: 'auto' }}>{result?.hebrewVoice}</div>
          </div>

          {/* Music track */}
          <div style={cardS}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
              <div style={{ ...secTitle, color: '#22c55e' }}>מוזיקת רקע</div>
            </div>
            {musicUrl ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1, fontSize: 12, color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{musicName}</div>
                  <button onClick={() => { setMusicUrl(null); setMusicName(''); if (musicRef.current) musicRef.current.src = '' }} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 11, color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    הסר
                  </button>
                </div>
                <audio ref={musicRef} controls style={{ width: '100%', borderRadius: 8, height: 36 }} />
              </div>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px 12px', border: '2px dashed rgba(34,197,94,0.2)', borderRadius: 12, cursor: 'pointer', background: 'rgba(34,197,94,0.03)', transition: 'all 200ms ease', fontSize: 13, color: '#52525b' }}>
                <input type="file" accept="audio/*" onChange={handleMusicUpload} style={{ display: 'none' }} />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                העלה קובץ מוזיקה
              </label>
            )}
          </div>

          {/* Scene details for current scene */}
          <div style={cardS}>
            <div style={secTitle}>סצנה {currentScene + 1} — {result?.story?.scenes?.[currentScene]?.type}</div>
            {result?.story?.scenes?.[currentScene] && (
              <div>
                <div style={{ fontSize: 11, color: '#52525b', marginBottom: 6, lineHeight: 1.7 }}><span style={{ color: '#8b5cf6', fontWeight: 600 }}>NB:</span> {result.story.scenes[currentScene].nb_prompt}</div>
                <div style={{ fontSize: 11, color: '#52525b', marginBottom: 6, lineHeight: 1.7 }}><span style={{ color: '#7c3aed', fontWeight: 600 }}>Kling:</span> {result.story.scenes[currentScene].kling_prompt}</div>
                <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 600, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>{result.story.scenes[currentScene].subtitle}</div>
              </div>
            )}
          </div>

          {/* Download individual scenes */}
          <div style={cardS}>
            <div style={secTitle}>הורדות בודדות</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {result?.videos?.map((url, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: BORDER, borderRadius: 8, padding: '8px 10px', textAlign: 'center', fontSize: 11 }}>
                  <div style={{ color: '#52525b', marginBottom: 3 }}>סצנה {i+1}</div>
                  {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: '#a855f7', textDecoration: 'none', fontWeight: 600 }}>הורד</a> : <span style={{ color: '#27272a' }}>--</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline — drag-and-drop clips */}
      <div style={{ ...cardS, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            <div style={secTitle}>ציר זמן</div>
          </div>
          <div style={{ fontSize: 11, color: '#52525b' }}>גרור כדי לשנות סדר</div>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {clipOrder.map((sceneIdx, orderIdx) => {
            const scene = result?.story?.scenes?.[sceneIdx]
            const videoUrl = result?.videos?.[sceneIdx]
            const isActive = currentScene === sceneIdx
            const isDragging = dragIdx === orderIdx
            return (
              <div
                key={orderIdx}
                draggable
                onDragStart={(e) => handleDragStart(e, orderIdx)}
                onDragOver={(e) => handleDragOver(e, orderIdx)}
                onDragEnd={handleDragEnd}
                onClick={() => loadScene(sceneIdx)}
                style={{
                  flex: '1 1 0', minWidth: 140,
                  background: isActive ? 'rgba(168,85,247,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `2px solid ${isActive ? 'rgba(168,85,247,0.5)' : isDragging ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 12, overflow: 'hidden', cursor: 'grab',
                  opacity: isDragging ? 0.6 : 1,
                  transition: 'all 200ms ease',
                  boxShadow: isActive ? '0 0 16px rgba(168,85,247,0.12)' : 'none'
                }}
              >
                <div style={{ aspectRatio: '16/9', background: BG, position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {videoUrl
                    ? <video src={videoUrl} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onLoadedMetadata={e => { e.target.currentTime = 1 }} />
                    : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#27272a" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  }
                  {/* Duration badge */}
                  <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 6px', fontSize: 9, color: '#fff', fontWeight: 600 }}>5s</div>
                  {/* Scene number */}
                  <div style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 6, background: isActive ? '#a855f7' : 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700 }}>{orderIdx + 1}</div>
                </div>
                <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                  <div style={{ fontSize: 10, fontWeight: 600, color: isActive ? '#a855f7' : '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {scene?.type || `סצנה ${sceneIdx + 1}`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {/* Timeline bar visual */}
        <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.04)', display: 'flex', overflow: 'hidden' }}>
          {clipOrder.map((sceneIdx, i) => (
            <div key={i} style={{ flex: 1, background: currentScene === sceneIdx ? '#a855f7' : 'rgba(168,85,247,0.15)', borderRight: i < clipOrder.length - 1 ? '1px solid rgba(0,0,0,0.3)' : 'none', transition: 'background 300ms ease' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: '#3f3f46' }}>
          <span>0s</span>
          <span>5s</span>
          <span>10s</span>
          <span>15s</span>
          <span>20s</span>
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
