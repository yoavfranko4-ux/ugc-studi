'use client'
import { useState, useRef, useCallback } from 'react'
import styles from './page.module.css'

const AVATARS = [
  { url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=300&h=400&fit=crop&crop=face', name: 'Maya' },
  { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&h=400&fit=crop&crop=face', name: 'Sarah' },
  { url: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=300&h=400&fit=crop&crop=face', name: 'Noa' },
  { url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&h=400&fit=crop&crop=face', name: 'Dana' },
  { url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=300&h=400&fit=crop&crop=face', name: 'Lior' },
  { url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=400&fit=crop&crop=face', name: 'Avi' },
  { url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=400&fit=crop&crop=face', name: 'Tamar' },
  { url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&h=400&fit=crop&crop=face', name: 'Yoni' },
]

const STEPS = ['upload', 'script', 'frames', 'voice', 'videos']
const STEP_INFO = {
  upload: { icon: '☁️', name: 'העלאת תמונות', desc: 'מעלה ל-fal.ai' },
  script: { icon: '✍️', name: 'סקריפט AI', desc: 'Claude כותב 4 פרומפטים + קריינות' },
  frames: { icon: '🎨', name: 'Nano Banana — Start Frames', desc: '4 תמונות עם אותה דמות' },
  voice: { icon: '🎙️', name: 'קריינות ElevenLabs V3', desc: 'עברית אותנטית — נוצרת ראשונה!' },
  videos: { icon: '🎬', name: 'Kling — 4 סרטונים × 5 שניות', desc: 'כאב → מנגנון → תוצאות → CTA' },
}

export default function Home() {
  const [page, setPage] = useState('main') // main | editor
  const [keys, setKeys] = useState({ fal: '', eleven: '', voiceId: '73z5yvUD5zgBgz92lJMW' })
  const [keysOpen, setKeysOpen] = useState(false)
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [customAvatarUrl, setCustomAvatarUrl] = useState(null)
  const [productImage, setProductImage] = useState(null)
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [applicationArea, setApplicationArea] = useState('')
  const [logs, setLogs] = useState([])
  const [stepStatus, setStepStatus] = useState({})
  const [generating, setGenerating] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const [appState, setAppState] = useState({
    videoUrls: ['', '', '', ''],
    audioUrl: '',
    audioBlob: null,
    script: '',
    prompts: ['', '', '', ''],
  })
  const [currentScene, setCurrentScene] = useState(0)
  const [subStyle, setSubStyle] = useState('white')
  const [subtitles, setSubs] = useState([])
  const [regenScript, setRegenScript] = useState('')
  const [regenVideo, setRegenVideo] = useState('')
  const mainVideoRef = useRef(null)
  const audioRef = useRef(null)

  const log = useCallback((msg, type = '') => {
    setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString('he-IL') }])
  }, [])

  const setStep = useCallback((id, status) => {
    setStepStatus(prev => ({ ...prev, [id]: status }))
  }, [])

  // Upload image and get base64
  const handleAvatarUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCustomAvatarUrl(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleProductUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setProductImage(ev.target.result)
    reader.readAsDataURL(file)
  }

  const avatarUrl = customAvatarUrl || selectedAvatar?.url

  // Upload to fal via our API route (no CORS!)
  const uploadToFal = async (base64, mime) => {
    const bc = atob(base64)
    const ba = new Uint8Array(bc.length)
    for (let i = 0; i < bc.length; i++) ba[i] = bc.charCodeAt(i)
    const blob = new Blob([ba], { type: mime })
    const fd = new FormData()
    fd.append('file', blob, 'img.' + (mime.split('/')[1] || 'jpg'))
    fd.append('falKey', keys.fal)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data.url || data.access_url
  }

  const generateScript = async () => {
    const res = await fetch('/api/generate-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: productDesc, productName, applicationArea })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data
  }

  const generateNanoBanana = async (imageUrl, prompt, idx) => {
    const res = await fetch('/api/nano-banana', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, imageUrl, falKey: keys.fal })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data.url
  }

  const generateKling = async (prompt, startImageUrl, idx) => {
    const res = await fetch('/api/kling', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, startImageUrl, falKey: keys.fal, sceneIdx: idx })
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data.url
  }

  const generateVoice = async (text) => {
    const res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: keys.voiceId, elevenKey: keys.eleven })
    })
    if (!res.ok) throw new Error('ElevenLabs failed')
    const blob = await res.blob()
    return { blob, url: URL.createObjectURL(blob) }
  }

  const startGeneration = async () => {
    if (!productDesc) return alert('אנא הכנס תיאור מוצר')
    if (!avatarUrl) return alert('אנא בחר דמות')
    if (!keys.fal) { setKeysOpen(true); return alert('אנא הכנס fal.ai API Key') }

    setGenerating(true)
    setShowProgress(true)
    setLogs([])
    setStepStatus({})
    STEPS.forEach(s => setStep(s, ''))

    try {
      // 1. Upload
      setStep('upload', 'active')
      let avatarFalUrl = avatarUrl
      if (avatarUrl.startsWith('data:')) {
        const [header, base64] = avatarUrl.split(',')
        const mime = header.match(/:(.*?);/)[1]
        log('מעלה אווטאר...')
        avatarFalUrl = await uploadToFal(base64, mime)
        log('✅ אווטאר: ' + avatarFalUrl, 'ok')
      }
      setStep('upload', 'done')

      // 2. Script via server API (no CORS!)
      setStep('script', 'active')
      let scene1 = 'Person frustrated overwhelmed with specific problem, stressed authentic expression, handheld iPhone selfie vertical 9:16 natural light'
      let scene2 = 'Continuing from previous scene same person holds product up to camera label facing camera clearly, surprised curious hopeful expression'
      let scene3 = 'Continuing from previous scene same person actively applies product shows result, genuinely amazed satisfied reaction'
      let scene4 = 'Continuing from previous scene same person confident excited holds product points at camera, enthusiastic urgent energy thumbs up'
      let nb1 = 'person frustrated overwhelmed bathroom mirror iPhone selfie natural light'
      let nb2 = `same person holds ${productName || 'product'} label facing camera clearly, curious hopeful expression bathroom`
      let nb3 = `same person ${applicationArea || 'applies product'} showing result, genuine amazed reaction`
      let nb4 = `same person excited holds ${productName || 'product'} up points at camera, big confident smile`
      const pName = productName || 'המוצר'
      let hebrewVoice = `אתם לא מאמינים כמה זמן בזבזתי על הבעיה הזאת. ניסיתי הכל ושום דבר לא עבד. עד שמישהו המליץ לי על ${pName} ולא הכרתי אותו בכלל. שבוע אחד ופשוט לא האמנתי לתוצאות. ואם אתם מסתפקים תדעו שיש גם אחריות מלאה אז אין סיכון. פשוט תנסו.`

      try {
        log('יוצר סקריפט עם Claude...')
        const s = await generateScript()
        if (s.scene1) scene1 = s.scene1
        if (s.scene2) scene2 = s.scene2
        if (s.scene3) scene3 = s.scene3
        if (s.scene4) scene4 = s.scene4
        if (s.nb1) nb1 = s.nb1
        if (s.nb2) nb2 = s.nb2
        if (s.nb3) nb3 = s.nb3
        if (s.nb4) nb4 = s.nb4
        if (s.hebrewVoice) hebrewVoice = s.hebrewVoice
        log('✅ סקריפט מוכן!', 'ok')
      } catch (e) {
        log('⚠️ Claude: ' + e.message + ' — משתמש בברירת מחדל', 'err')
      }

      const prompts = [scene1, scene2, scene3, scene4]
      setRegenScript(hebrewVoice)
      setStep('script', 'done')

      // 3. Nano Banana frames sequentially
      setStep('frames', 'active')
      const nbPrompts = [nb1, nb2, nb3, nb4]
      const frames = [null, null, null, null]
      for (let i = 0; i < 4; i++) {
        try {
          log(`Nano Banana סצנה ${i + 1}...`)
          const refUrl = i === 0 ? avatarFalUrl : (frames[i - 1] || avatarFalUrl)
          frames[i] = await generateNanoBanana(refUrl, nbPrompts[i], i)
          log(`✅ Frame ${i + 1}: ${frames[i]}`, 'ok')
        } catch (e) {
          log(`⚠️ Frame ${i + 1}: ${e.message}`, 'err')
          frames[i] = i === 0 ? avatarFalUrl : (frames[i - 1] || avatarFalUrl)
        }
      }
      setStep('frames', 'done')

      // 4. Voice FIRST — so user can hear while videos generate
      setStep('voice', 'active')
      let audioUrl = ''
      let audioBlob = null
      if (keys.eleven) {
        try {
          log('יוצר קריינות V3...')
          const { blob, url } = await generateVoice(hebrewVoice)
          audioBlob = blob
          audioUrl = url
          if (audioRef.current) audioRef.current.src = url
          log('✅ קריינות מוכנה!', 'ok')
          setStep('voice', 'done')
        } catch (e) {
          log('⚠️ קריינות: ' + e.message, 'err')
          setStep('voice', 'error')
        }
      } else {
        setStep('voice', 'error')
      }

      // Open editor with audio ready
      setAppState(prev => ({ ...prev, script: hebrewVoice, audioUrl, audioBlob, prompts }))
      setPage('editor')

      // 5. Kling videos sequentially
      setStep('videos', 'active')
      const videoUrls = ['', '', '', '']
      for (let i = 0; i < 4; i++) {
        try {
          log(`יוצר סרטון ${i + 1} עם Kling...`)
          const url = await generateKling(prompts[i], frames[i], i)
          videoUrls[i] = url
          log(`✅ סרטון ${i + 1}: ${url}`, 'ok')
          setAppState(prev => {
            const newUrls = [...prev.videoUrls]
            newUrls[i] = url
            return { ...prev, videoUrls: newUrls }
          })
          if (i === 0 && mainVideoRef.current) {
            mainVideoRef.current.src = url
            mainVideoRef.current.load()
          }
        } catch (e) {
          log(`❌ סרטון ${i + 1}: ${e.message}`, 'err')
        }
      }
      setStep('videos', 'done')
      log('🎉 הכל מוכן!', 'ok')

    } catch (e) {
      log('❌ ' + e.message, 'err')
      alert('שגיאה: ' + e.message)
    } finally {
      setGenerating(false)
    }
  }

  const regenVoiceHandler = async () => {
    if (!keys.eleven || !regenScript) return
    try {
      log('יוצר קריינות מחדש...')
      const { blob, url } = await generateVoice(regenScript)
      if (audioRef.current) audioRef.current.src = url
      setAppState(prev => ({ ...prev, audioUrl: url, audioBlob: blob, script: regenScript }))
      log('✅ קריינות חדשה מוכנה', 'ok')
    } catch (e) {
      alert('שגיאה: ' + e.message)
    }
  }

  const regenVideoHandler = async (idx) => {
    if (!regenVideo || !keys.fal) return
    try {
      log(`יוצר סצנה ${idx + 1} מחדש...`)
      const url = await generateKling(regenVideo, null, idx)
      setAppState(prev => {
        const newUrls = [...prev.videoUrls]
        newUrls[idx] = url
        return { ...prev, videoUrls: newUrls }
      })
      if (mainVideoRef.current && idx === currentScene) {
        mainVideoRef.current.src = url
        mainVideoRef.current.load()
      }
      log(`✅ סצנה ${idx + 1} מוכנה`, 'ok')
    } catch (e) {
      alert('שגיאה: ' + e.message)
    }
  }

  const loadScene = (idx) => {
    setCurrentScene(idx)
    const url = appState.videoUrls[idx]
    if (url && mainVideoRef.current) {
      mainVideoRef.current.src = url
      mainVideoRef.current.load()
    }
    setRegenVideo(appState.prompts[idx] || '')
  }

  const autoSubs = () => {
    const words = regenScript.trim().split(' ')
    const dur = mainVideoRef.current?.duration || 20
    const newSubs = []
    for (let i = 0; i < words.length; i += 4) {
      const chunk = words.slice(i, i + 4).join(' ')
      newSubs.push({
        text: chunk,
        start: (i / words.length) * dur,
        end: Math.min(((i + 4) / words.length) * dur, dur),
        id: Date.now() + i
      })
    }
    setSubs(newSubs)
  }

  const stepIcon = (id) => {
    const s = stepStatus[id]
    if (s === 'done') return '✅'
    if (s === 'error') return '❌'
    if (s === 'active') return '⏳'
    return STEP_INFO[id].icon
  }

  if (page === 'editor') {
    return (
      <div style={{ minHeight: '100vh', position: 'relative', zIndex: 1 }}>
        {/* Editor Header */}
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontSize: 26, fontWeight: 900, background: 'linear-gradient(135deg,#fff,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              ✂️ עורך — 4 סצנות
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage('main')} style={btnStyle}>← חזור</button>
            </div>
          </div>

          {/* Scene Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[0,1,2,3].map(i => (
              <div
                key={i}
                onClick={() => loadScene(i)}
                style={{
                  background: 'var(--surface)',
                  border: `2px solid ${currentScene === i ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 14, overflow: 'hidden', cursor: 'pointer', transition: 'all 0.3s'
                }}
              >
                <div style={{ aspectRatio: '9/16', maxHeight: 160, background: '#0a0a14', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                  {appState.videoUrls[i] ? (
                    <video
                      src={appState.videoUrls[i]}
                      muted playsInline preload="metadata"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onLoadedMetadata={e => { e.target.currentTime = 1 }}
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, border: '3px solid #ffffff22', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace' }}>מייצר...</span>
                    </div>
                  )}
                </div>
                <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: currentScene === i ? 'var(--accent)' : 'var(--text-dim)' }}>
                  {['😟 כאב', '💡 מנגנון', '✨ תוצאות', '🚀 CTA'][i]}
                </div>
              </div>
            ))}
          </div>

          {/* Main Editor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20 }}>
            {/* Video Preview */}
            <div>
              <div style={cardStyle}>
                <div style={ptStyle}>תצוגה מקדימה</div>
                <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: '9/16', maxHeight: 460, position: 'relative' }}>
                  <video
                    ref={mainVideoRef}
                    controls
                    playsInline
                    preload="auto"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  />
                </div>
              </div>

              {/* Video Links */}
              <div style={cardStyle}>
                <div style={ptStyle}>קישורי סרטונים</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                  {[0,1,2,3].map(i => (
                    <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, textAlign: 'center', fontSize: 12 }}>
                      {['😟','💡','✨','🚀'][i]} סצנה {i+1}<br/>
                      {appState.videoUrls[i]
                        ? <a href={appState.videoUrls[i]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent2)', textDecoration: 'none' }}>פתח ↗</a>
                        : <span style={{ color: '#ffffff33' }}>ממתין...</span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Voice */}
              <div style={cardStyle}>
                <div style={ptStyle}>קריינות עברית (V3)</div>
                <audio ref={audioRef} controls style={{ width: '100%', borderRadius: 8 }} src={appState.audioUrl} />
                <div style={{ marginTop: 14 }}>
                  <label style={labelStyle}>ערוך סקריפט:</label>
                  <textarea
                    value={regenScript}
                    onChange={e => setRegenScript(e.target.value)}
                    style={{ ...inputStyle, height: 80, direction: 'rtl', marginTop: 6, resize: 'none', fontFamily: 'Heebo, sans-serif' }}
                    placeholder="כתוב כאן את הסקריפט העברי..."
                  />
                  <button onClick={regenVoiceHandler} style={{ ...btnPrimaryStyle, width: '100%', marginTop: 8 }}>
                    🎙️ צור קריינות מחדש (V3)
                  </button>
                </div>
              </div>

              {/* Subtitles */}
              <div style={cardStyle}>
                <div style={ptStyle}>כתוביות</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {['white','yellow','bold','outline'].map(s => (
                    <button key={s} onClick={() => setSubStyle(s)}
                      style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${subStyle===s?'var(--accent)':'var(--border)'}`, cursor: 'pointer', fontSize: 12, background: subStyle===s?'#7c3aed22':'none', color: subStyle===s?'var(--accent)':'var(--text-dim)', fontFamily: 'Heebo, sans-serif' }}>
                      {{'white':'לבן','yellow':'צהוב','bold':'עבה','outline':'מסגרת'}[s]}
                    </button>
                  ))}
                </div>
                <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {subtitles.map((sub, i) => (
                    <div key={sub.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 11, color: 'var(--accent2)', fontFamily: 'monospace', paddingTop: 10, width: 80, flexShrink: 0 }}>
                        {Math.floor(sub.start/60).toString().padStart(2,'0')}:{Math.floor(sub.start%60).toString().padStart(2,'0')}-{Math.floor(sub.end/60).toString().padStart(2,'0')}:{Math.floor(sub.end%60).toString().padStart(2,'0')}
                      </span>
                      <textarea
                        value={sub.text}
                        onChange={e => setSubs(prev => prev.map((s,j) => j===i ? {...s,text:e.target.value} : s))}
                        style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: 13, direction: 'rtl', outline: 'none', resize: 'none', minHeight: 36, fontFamily: 'Heebo, sans-serif' }}
                      />
                      <button onClick={() => setSubs(prev => prev.filter((_,j)=>j!==i))} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: 16, padding: '8px 4px' }}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => setSubs(prev => [...prev, {text:'כתובית חדשה',start:0,end:3,id:Date.now()}])} style={{ ...btnStyle, flex: 1 }}>+ הוסף</button>
                  <button onClick={autoSubs} style={{ ...btnPrimaryStyle, flex: 1 }}>✨ אוטומטי</button>
                </div>
              </div>

              {/* Regen scene */}
              <div style={cardStyle}>
                <div style={ptStyle}>צור סצנה נוכחית מחדש</div>
                <textarea
                  value={regenVideo}
                  onChange={e => setRegenVideo(e.target.value)}
                  placeholder="ערוך פרומפט לסצנה..."
                  style={{ ...inputStyle, height: 65, direction: 'rtl', fontFamily: 'Heebo,sans-serif', resize: 'none', marginBottom: 8 }}
                />
                <button onClick={() => regenVideoHandler(currentScene)} style={{ ...btnStyle, width: '100%' }}>
                  🎬 צור סצנה {currentScene+1} מחדש
                </button>
              </div>
            </div>
          </div>

          {/* Logs */}
          {logs.length > 0 && (
            <div style={{ ...cardStyle, marginTop: 20 }}>
              <div style={ptStyle}>לוג</div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim)', maxHeight: 200, overflowY: 'auto', lineHeight: 2 }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ color: l.type==='ok'?'var(--success)':l.type==='err'?'var(--error)':'var(--text-dim)' }}>
                    [{l.time}] {l.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', zIndex: 1, maxWidth: 900, margin: '0 auto', padding: '40px 20px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 50 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent2)', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 16, opacity: 0.8 }}>
          ✦ AI UGC Generator ✦
        </div>
        <h1 style={{ fontSize: 'clamp(40px,7vw,72px)', fontWeight: 900, lineHeight: 1, background: 'linear-gradient(135deg,#fff 0%,#7c3aed 50%,#06b6d4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 14 }}>
          UGC Studio
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 17 }}>בחר דמות → תאר מוצר → קבל 4 סצנות UGC מקצועיות</p>
      </div>

      {/* Keys */}
      <div style={cardStyle}>
        <button onClick={() => setKeysOpen(o => !o)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'Heebo,sans-serif', marginBottom: keysOpen ? 20 : 0 }}>
          🔑 הגדרות API Keys
        </button>
        {keysOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>fal.ai API Key</label>
              <input type="password" value={keys.fal} onChange={e => setKeys(k=>({...k,fal:e.target.value}))} placeholder="xxxxxxxx:xxxxxxxx" style={inputStyle}/>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>ElevenLabs API Key</label>
              <input type="password" value={keys.eleven} onChange={e => setKeys(k=>({...k,eleven:e.target.value}))} placeholder="sk_xxxxxxxx" style={inputStyle}/>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1/-1' }}>
              <label style={labelStyle}>ElevenLabs Voice ID</label>
              <input type="text" value={keys.voiceId} onChange={e => setKeys(k=>({...k,voiceId:e.target.value}))} placeholder="73z5yvUD5zgBgz92lJMW" style={inputStyle}/>
            </div>
            <div style={{ gridColumn: '1/-1', background: '#7c3aed11', border: '1px solid #7c3aed33', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--text-dim)' }}>
              <strong style={{ color: 'var(--accent2)' }}>💡 Claude API</strong> רץ בשרת — לא צריך מפתח נוסף! הכל עובד אוטומטי.
            </div>
          </div>
        )}
      </div>

      {/* Avatar Gallery */}
      <div style={cardStyle}>
        <div style={ptStyle}>בחר דמות</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 16 }}>
          {AVATARS.map(av => (
            <div
              key={av.name}
              onClick={() => { setSelectedAvatar(av); setCustomAvatarUrl(null) }}
              style={{
                position: 'relative', border: `2px solid ${selectedAvatar?.name===av.name && !customAvatarUrl ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 14, overflow: 'hidden', cursor: 'pointer', transition: 'all 0.3s', aspectRatio: '3/4',
                boxShadow: selectedAvatar?.name===av.name && !customAvatarUrl ? '0 0 20px #7c3aed44' : 'none'
              }}
            >
              <img src={av.url} alt={av.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent,#000a)', padding: '6px 8px', fontSize: 10, color: 'rgba(255,255,255,0.8)', textAlign: 'center' }}>{av.name}</div>
              {selectedAvatar?.name===av.name && !customAvatarUrl && (
                <div style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white' }}>✓</div>
              )}
            </div>
          ))}
          {/* Upload custom */}
          <div
            style={{
              position: 'relative', border: `2px solid ${customAvatarUrl ? 'var(--success)' : 'var(--border)'}`,
              borderRadius: 14, overflow: 'hidden', cursor: 'pointer', aspectRatio: '3/4',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
              background: customAvatarUrl ? 'transparent' : 'var(--surface2)',
              backgroundImage: customAvatarUrl ? `url(${customAvatarUrl})` : 'none',
              backgroundSize: 'cover', backgroundPosition: 'center'
            }}
          >
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
            {!customAvatarUrl && <>
              <span style={{ fontSize: 24 }}>➕</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>העלה שלך</span>
            </>}
            {customAvatarUrl && <div style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, background: 'var(--success)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'white' }}>✓</div>}
          </div>
        </div>
        {(selectedAvatar || customAvatarUrl) && (
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--success)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--success)' }}>
            ✅ דמות נבחרה — {customAvatarUrl ? 'Custom' : selectedAvatar?.name}
          </div>
        )}
      </div>

      {/* Product */}
      <div style={cardStyle}>
        <div style={ptStyle}>מוצר ותיאור</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <label style={labelStyle}>שם המוצר הספציפי</label>
          <input type="text" value={productName} onChange={e=>setProductName(e.target.value)} placeholder="לדוגמה: HiSmile Whitening Strips, JiYu Toner Pads..." style={{ ...inputStyle, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <label style={labelStyle}>תיאור המוצר ומה הוא פותר</label>
          <textarea value={productDesc} onChange={e=>setProductDesc(e.target.value)} placeholder="לדוגמה: רצועות הלבנת שיניים שמלבינות תוך 7 ימים..." style={{ ...inputStyle, height: 80, direction: 'rtl', fontFamily: 'Heebo,sans-serif', resize: 'none' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <label style={labelStyle}>איך משתמשים במוצר</label>
          <input type="text" value={applicationArea} onChange={e=>setApplicationArea(e.target.value)} placeholder="לדוגמה: מניחים על שיניים 30 דקות / מורחים על הפנים..." style={{ ...inputStyle, direction: 'rtl', fontFamily: 'Heebo,sans-serif' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          <label style={labelStyle}>📦 תמונת מוצר (אופציונלי)</label>
          <div style={{ border: `2px dashed ${productImage ? 'var(--success)' : 'var(--border)'}`, borderRadius: 14, minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
            <input type="file" accept="image/*" onChange={handleProductUpload} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
            {productImage
              ? <img src={productImage} alt="product" style={{ maxHeight: 90, borderRadius: 10 }} />
              : <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>לחץ להעלאת תמונת מוצר</span>
            }
          </div>
        </div>

        <button
          onClick={startGeneration}
          disabled={generating}
          style={{ width: '100%', padding: 18, background: generating ? '#444' : 'linear-gradient(135deg,#7c3aed,#5b21b6)', border: 'none', borderRadius: 14, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 18, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', transition: 'all 0.3s' }}
        >
          {generating ? '⏳ יוצר...' : '✨ צור 4 סצנות UGC עכשיו'}
        </button>
      </div>

      {/* Progress */}
      {showProgress && (
        <div style={cardStyle}>
          <div style={ptStyle}>יצירה בתהליך</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {STEPS.map(id => {
              const s = stepStatus[id]
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'var(--surface2)', borderRadius: 12, border: `1px solid ${s==='active'?'var(--accent)':s==='done'?'var(--success)':s==='error'?'var(--error)':'var(--border)'}`, transition: 'all 0.3s' }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: s==='active'?'var(--accent)':s==='done'?'var(--success)':s==='error'?'var(--error)':'var(--surface)', border: `1px solid ${s==='active'?'var(--accent)':s==='done'?'var(--success)':s==='error'?'var(--error)':'var(--border)'}`, animation: s==='active'?'pulse 1.5s infinite':'none', flexShrink: 0 }}>
                    {stepIcon(id)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{STEP_INFO[id].name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{STEP_INFO[id].desc}</div>
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'var(--surface)', color: s==='active'?'var(--accent)':s==='done'?'var(--success)':s==='error'?'var(--error)':'var(--text-dim)' }}>
                    {s==='active'?'בתהליך...':s==='done'?'הושלם ✓':s==='error'?'שגיאה ✗':'ממתין'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div style={{ ...cardStyle, marginTop: 20 }}>
          <div style={ptStyle}>לוג</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-dim)', maxHeight: 200, overflowY: 'auto', lineHeight: 2 }}>
            {logs.map((l, i) => (
              <div key={i} style={{ color: l.type==='ok'?'var(--success)':l.type==='err'?'var(--error)':'var(--text-dim)' }}>
                [{l.time}] {l.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Styles
const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, marginBottom: 20 }
const ptStyle = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, color: 'var(--accent3)', textTransform: 'uppercase', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }
const labelStyle = { fontSize: 13, color: 'var(--text-dim)' }
const inputStyle = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 12, padding: '13px 16px', color: 'var(--text)', fontSize: 14, outline: 'none', width: '100%', direction: 'ltr', fontFamily: 'monospace' }
const btnStyle = { padding: '9px 16px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontFamily: 'Heebo,sans-serif', fontSize: 13, cursor: 'pointer' }
const btnPrimaryStyle = { padding: '9px 16px', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 8, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 13, cursor: 'pointer' }
