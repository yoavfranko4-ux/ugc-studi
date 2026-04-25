'use client'
import { useState, useRef } from 'react'

const STUDIO_BUILD_MARKER = 'STUDIO_BUILD_MARKER_2026-04-26_minimal_v1'
if (typeof window !== 'undefined') {
  console.log(
    '%c[' + STUDIO_BUILD_MARKER + ']',
    'background:#d946ef;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold'
  )
}

const AVATARS = [
  {
    id: 'daniel',
    name: 'Daniel',
    gender: 'male',
    voiceId: 'nBiC8Jexp2XGyIxATg9S',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop&crop=face',
  },
  {
    id: 'noa',
    name: 'Noa',
    gender: 'female',
    voiceId: 'cp6q5qJLs8rR7eAWOepf',
    url: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&h=600&fit=crop&crop=face',
  },
  {
    id: 'maya',
    name: 'Maya',
    gender: 'female',
    voiceId: 'cp6q5qJLs8rR7eAWOepf',
    url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=600&fit=crop&crop=face',
  },
]

const VOICES = [
  { id: 'nBiC8Jexp2XGyIxATg9S', name: 'Daniel', desc: 'גבר • עברית' },
  { id: 'cp6q5qJLs8rR7eAWOepf', name: 'Noa', desc: 'אישה • עברית' },
]

const MUSIC = [
  { id: 'deep-house-1', name: 'Deep House 1', src: '/music/deep-house-1.mp3' },
  { id: 'deep-house-2', name: 'Deep House 2', src: '/music/deep-house-2.mp3' },
  { id: 'deep-house-3', name: 'Deep House 3', src: '/music/deep-house-3.mp3' },
  { id: 'deep-house-4', name: 'Deep House 4', src: '/music/deep-house-4.mp3' },
]

const MAGENTA = '#d946ef'
const MAGENTA_DEEP = '#a21caf'

export default function StudioPage() {
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [howToUse, setHowToUse] = useState('')
  const [productImageUrl, setProductImageUrl] = useState('')
  const [productImagePreview, setProductImagePreview] = useState('')
  const [voiceId, setVoiceId] = useState(VOICES[0].id)
  const [music, setMusic] = useState(MUSIC[0].id)

  const [uploading, setUploading] = useState(false)
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [toast, setToast] = useState(null)
  const [result, setResult] = useState(null)
  const fileInputRef = useRef(null)
  const elapsedTimer = useRef(null)

  const showToast = (msg, kind = 'error') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 5000)
  }

  const onPickImage = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.url) {
        showToast(data.error || 'העלאת תמונה נכשלה')
        return
      }
      setProductImageUrl(data.url)
      setProductImagePreview(data.url)
    } catch (err) {
      showToast('שגיאה בהעלאת תמונה')
    } finally {
      setUploading(false)
    }
  }

  const validate = () => {
    if (!productName.trim()) return 'חסר שם מוצר'
    if (!productDesc.trim()) return 'חסר תיאור מוצר'
    if (!howToUse.trim()) return 'חסר אופן שימוש'
    if (!productImageUrl) return 'חסרה תמונת מוצר'
    return null
  }

  const runAgent = async () => {
    const err = validate()
    if (err) {
      showToast(err)
      return
    }
    setResult(null)
    setRunning(true)
    setElapsed(0)
    const startedAt = Date.now()
    elapsedTimer.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarUrl: avatar.url,
          productName: productName.trim(),
          product: productDesc.trim(),
          applicationArea: howToUse.trim(),
          productImageUrl,
          voiceId,
          businessType: 'product',
          music,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'יצירת הסרטון נכשלה')
        return
      }
      setResult(data)
    } catch (e) {
      showToast('שגיאה בתקשורת עם השרת')
    } finally {
      clearInterval(elapsedTimer.current)
      setRunning(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.brand}>UGC Studio</div>
          <div style={styles.tagline}>צור סרטון UGC ב־4 סצנות אוטומטית</div>
        </header>

        {!result && (
          <div style={styles.grid}>
            <Section title="בחירת אווטאר">
              <div style={styles.row}>
                {AVATARS.map((a) => {
                  const active = avatar.id === a.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAvatar(a)
                        setVoiceId(a.voiceId)
                      }}
                      style={{ ...styles.avatarBtn, ...(active ? styles.avatarBtnActive : null) }}
                    >
                      <img src={a.url} alt={a.name} style={styles.avatarImg} />
                      <span style={styles.avatarName}>{a.name}</span>
                    </button>
                  )
                })}
              </div>
            </Section>

            <Section title="פרטי המוצר">
              <Field label="שם מוצר">
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="לדוגמה: קרם להלבנת שיניים"
                  style={styles.input}
                />
              </Field>
              <Field label="תיאור מוצר">
                <input
                  type="text"
                  value={productDesc}
                  onChange={(e) => setProductDesc(e.target.value)}
                  placeholder="קרם פעיל המלבין שיניים תוך שבוע"
                  style={styles.input}
                />
              </Field>
              <Field label="איך להשתמש">
                <input
                  type="text"
                  value={howToUse}
                  onChange={(e) => setHowToUse(e.target.value)}
                  placeholder="מורחים על השיניים בבוקר ובערב"
                  style={styles.input}
                />
              </Field>
              <Field label="תמונת מוצר">
                <div style={styles.uploadRow}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={styles.uploadBtn}
                  >
                    {uploading ? 'מעלה…' : productImageUrl ? 'החלף תמונה' : 'העלה תמונה'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onPickImage}
                    style={{ display: 'none' }}
                  />
                  {productImagePreview && (
                    <img src={productImagePreview} alt="מוצר" style={styles.productPreview} />
                  )}
                </div>
              </Field>
            </Section>

            <Section title="קריינות">
              <div style={styles.row}>
                {VOICES.map((v) => {
                  const active = voiceId === v.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVoiceId(v.id)}
                      style={{ ...styles.pill, ...(active ? styles.pillActive : null) }}
                    >
                      <span style={styles.pillName}>{v.name}</span>
                      <span style={styles.pillDesc}>{v.desc}</span>
                    </button>
                  )
                })}
              </div>
            </Section>

            <Section title="מוזיקת רקע">
              <div style={styles.row}>
                {MUSIC.map((m) => {
                  const active = music === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMusic(m.id)}
                      style={{ ...styles.pill, ...(active ? styles.pillActive : null) }}
                    >
                      <span style={styles.pillName}>{m.name}</span>
                      <span style={styles.pillDesc}>Deep House</span>
                    </button>
                  )
                })}
              </div>
            </Section>

            <button
              type="button"
              onClick={runAgent}
              disabled={running}
              style={{ ...styles.bigBtn, ...(running ? styles.bigBtnRunning : null) }}
            >
              {running ? (
                <>
                  <Spinner />
                  <span>מייצר סרטון… {formatElapsed(elapsed)}</span>
                </>
              ) : (
                <span>הפעל Agent — צור 4 סצנות מחוברות</span>
              )}
            </button>

            {running && (
              <div style={styles.note}>
                התהליך לוקח בערך 3 דקות. אל תסגור את החלון.
              </div>
            )}
          </div>
        )}

        {result && <ResultView data={result} onReset={() => setResult(null)} />}
      </div>

      {toast && (
        <div style={{ ...styles.toast, ...(toast.kind === 'error' ? styles.toastErr : styles.toastOk) }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.sectionBody}>{children}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 18,
        height: 18,
        border: '2px solid #ffffff55',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'studio-spin 0.9s linear infinite',
      }}
    >
      <style>{'@keyframes studio-spin { to { transform: rotate(360deg) } }'}</style>
    </span>
  )
}

function ResultView({ data, onReset }) {
  const videos = (data.videos || []).filter(Boolean)
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>הסרטון מוכן</div>
      <div style={styles.sectionBody}>
        {videos.length === 0 && (
          <div style={styles.note}>לא התקבלו סרטונים. נסה שוב.</div>
        )}
        <div style={styles.videoGrid}>
          {videos.map((url, i) => (
            <video
              key={i}
              src={url}
              controls
              playsInline
              style={styles.videoEl}
            />
          ))}
        </div>
        {data.audioBase64 && (
          <audio
            controls
            src={`data:audio/mpeg;base64,${data.audioBase64}`}
            style={{ width: '100%', marginTop: 16 }}
          />
        )}
        <button type="button" onClick={onReset} style={styles.resetBtn}>
          צור עוד סרטון
        </button>
      </div>
    </div>
  )
}

function formatElapsed(s) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#000',
    color: '#fff',
    padding: '32px 16px 64px',
    fontFamily: 'inherit',
  },
  shell: { maxWidth: 880, margin: '0 auto' },
  header: { textAlign: 'center', marginBottom: 32 },
  brand: {
    fontSize: 40,
    fontWeight: 900,
    background: `linear-gradient(135deg, ${MAGENTA}, #fff)`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  tagline: { color: '#bbb', fontSize: 16, marginTop: 6 },
  grid: { display: 'flex', flexDirection: 'column', gap: 20 },
  section: {
    background: '#0a0a0a',
    border: `1px solid ${MAGENTA}33`,
    borderRadius: 16,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: MAGENTA,
    marginBottom: 14,
  },
  sectionBody: { display: 'flex', flexDirection: 'column', gap: 14 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 13, color: '#bbb' },
  input: {
    background: '#0f0f0f',
    border: `1px solid ${MAGENTA}33`,
    borderRadius: 10,
    color: '#fff',
    padding: '12px 14px',
    fontSize: 15,
    direction: 'rtl',
    outline: 'none',
    fontFamily: 'inherit',
  },
  avatarBtn: {
    background: '#0f0f0f',
    border: `2px solid ${MAGENTA}33`,
    borderRadius: 14,
    padding: 8,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    width: 110,
    color: '#fff',
  },
  avatarBtnActive: {
    borderColor: MAGENTA,
    boxShadow: `0 0 0 3px ${MAGENTA}22`,
  },
  avatarImg: {
    width: 90,
    height: 110,
    objectFit: 'cover',
    borderRadius: 10,
  },
  avatarName: { fontSize: 14, fontWeight: 600 },
  pill: {
    background: '#0f0f0f',
    border: `2px solid ${MAGENTA}33`,
    borderRadius: 12,
    padding: '10px 16px',
    cursor: 'pointer',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    minWidth: 140,
    fontFamily: 'inherit',
  },
  pillActive: {
    borderColor: MAGENTA,
    background: `${MAGENTA}11`,
  },
  pillName: { fontSize: 15, fontWeight: 700 },
  pillDesc: { fontSize: 12, color: '#999' },
  uploadRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  uploadBtn: {
    background: '#0f0f0f',
    border: `1px solid ${MAGENTA}55`,
    color: '#fff',
    padding: '10px 18px',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 14,
  },
  productPreview: {
    width: 64,
    height: 64,
    objectFit: 'cover',
    borderRadius: 10,
    border: `1px solid ${MAGENTA}55`,
  },
  bigBtn: {
    marginTop: 8,
    background: `linear-gradient(135deg, ${MAGENTA}, ${MAGENTA_DEEP})`,
    border: 'none',
    color: '#fff',
    padding: '20px 24px',
    borderRadius: 14,
    fontSize: 18,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: `0 8px 28px ${MAGENTA}55`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    fontFamily: 'inherit',
  },
  bigBtnRunning: { opacity: 0.85, cursor: 'wait' },
  note: { textAlign: 'center', color: '#999', fontSize: 13 },
  videoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  videoEl: {
    width: '100%',
    aspectRatio: '9 / 16',
    background: '#000',
    borderRadius: 10,
    border: `1px solid ${MAGENTA}33`,
  },
  resetBtn: {
    marginTop: 16,
    background: 'transparent',
    border: `1px solid ${MAGENTA}55`,
    color: '#fff',
    padding: '12px 20px',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 14,
  },
  toast: {
    position: 'fixed',
    top: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 20px',
    borderRadius: 10,
    fontWeight: 600,
    direction: 'rtl',
    zIndex: 100,
    boxShadow: '0 8px 24px #0008',
  },
  toastErr: { background: '#7f1d1d', color: '#fff' },
  toastOk: { background: '#065f46', color: '#fff' },
}
