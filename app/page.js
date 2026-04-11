'use client'
import { PLANS } from '../lib/plans'

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#f0f0ff' }}>
      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '80px 20px 60px' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#06b6d4', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 16, opacity: 0.8 }}>✦ AI UGC Agent ✦</div>
        <h1 style={{ fontSize: 'clamp(40px,7vw,68px)', fontWeight: 900, lineHeight: 1.1, background: 'linear-gradient(135deg,#fff 0%,#7c3aed 50%,#06b6d4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 20 }}>
          סרטוני UGC מקצועיים<br/>עם AI בדקות
        </h1>
        <p style={{ color: '#8888aa', fontSize: 18, maxWidth: 500, margin: '0 auto 32px' }}>
          Agent חכם יוצר סיפור, פריימים, סרטונים וקריינות — הכל אוטומטי
        </p>
        <a href="/login" style={ctaBtn}>התחל עכשיו ←</a>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '60px 20px' }}>
        <h2 style={sectionTitle}>איך זה עובד?</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
          {[
            { icon: '🧠', title: 'תאר את המוצר', desc: 'הכנס שם, תיאור, ותמונה — ה-AI מבין מה צריך' },
            { icon: '🎬', title: 'Agent יוצר הכל', desc: 'סיפור, 4 פריימים, 4 סרטונים וקריינות עברית — אוטומטי' },
            { icon: '📥', title: 'הורד ופרסם', desc: 'ייצוא MP4 מוכן עם כתוביות — ישר לרשתות החברתיות' },
          ].map((s, i) => (
            <div key={i} style={stepCard}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>{s.icon}</div>
              <div style={{ fontSize: 13, color: '#7c3aed', fontWeight: 700, marginBottom: 4 }}>שלב {i + 1}</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{s.title}</div>
              <div style={{ color: '#8888aa', fontSize: 14, lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Example results */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '60px 20px' }}>
        <h2 style={sectionTitle}>תוצאות לדוגמה</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
          {[
            { label: 'HiSmile — הלבנת שיניים', emoji: '🦷' },
            { label: 'סרום פנים — טיפוח', emoji: '✨' },
            { label: 'אפליקציית כושר', emoji: '💪' },
          ].map((ex, i) => (
            <div key={i} style={{ background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 16, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{ex.emoji}</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{ex.label}</div>
              <div style={{ color: '#8888aa', fontSize: 12, marginTop: 8 }}>4 סצנות + קריינות עברית</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ maxWidth: 900, margin: '0 auto', padding: '60px 20px 100px' }}>
        <h2 style={sectionTitle}>תוכניות ומחירים</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
          {Object.entries(PLANS).map(([key, plan]) => (
            <div key={key} style={{ background: key === 'basic' ? '#1a1040' : '#0f0f1a', border: `2px solid ${key === 'basic' ? '#7c3aed' : '#ffffff12'}`, borderRadius: 20, padding: 28, textAlign: 'center', position: 'relative' }}>
              {key === 'basic' && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#7c3aed', color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 20 }}>פופולרי</div>}
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 8 }}>{plan.name}</div>
              <div style={{ fontSize: 36, fontWeight: 900, background: 'linear-gradient(135deg,#fff,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                ₪{plan.price}
              </div>
              <div style={{ color: '#8888aa', fontSize: 13, marginBottom: 16 }}>
                {plan.days === 3 ? 'ל-3 ימים' : 'לחודש'}
              </div>
              <div style={{ color: '#f0f0ff', fontSize: 15, marginBottom: 20 }}>
                {plan.videos} {plan.videos === 1 ? 'סרטון' : 'סרטונים'}
              </div>
              <a href="/login" style={{ ...ctaBtn, fontSize: 15, padding: '12px 28px', display: 'inline-block', background: key === 'basic' ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : '#16162a', border: key === 'basic' ? 'none' : '1px solid #ffffff22' }}>
                התחל
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

const ctaBtn = {
  display: 'inline-block',
  padding: '16px 36px',
  background: 'linear-gradient(135deg,#7c3aed,#5b21b6)',
  border: 'none',
  borderRadius: 14,
  color: 'white',
  fontFamily: 'Heebo,sans-serif',
  fontSize: 18,
  fontWeight: 700,
  cursor: 'pointer',
  textDecoration: 'none',
}
const sectionTitle = { textAlign: 'center', fontSize: 28, fontWeight: 900, marginBottom: 32, color: '#f0f0ff' }
const stepCard = { background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 16, padding: 24, textAlign: 'center' }
