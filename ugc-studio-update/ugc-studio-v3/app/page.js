'use client'

import { PLANS } from '../lib/plans'
import WebGLShader from '../components/ui/web-gl-shader'
import LiquidButton from '../components/ui/liquid-glass-button'

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: BG, color: '#f0f0ff', position: 'relative' }}>
      <WebGLShader colors={['#7c3aed', '#a855f7', '#1e1b4b', '#6d28d9']} speed={0.2} intensity={0.6} />

      {/* Overlay */}
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 50% 20%, transparent 0%, rgba(9,9,11,0.6) 50%, rgba(9,9,11,0.92) 100%)', zIndex: 1, pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 2 }}>

        {/* Navbar */}
        <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', maxWidth: 1200, margin: '0 auto', backdropFilter: 'blur(12px)', background: 'rgba(9,9,11,0.4)', borderBottom: BORDER, position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff' }}>U</div>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#f0f0ff' }}>UGC Studio</span>
          </div>
          <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
            <a href="#how" style={navLink}>איך זה עובד</a>
            <a href="#pricing" style={navLink}>מחירים</a>
            <a href="/login" style={{ padding: '8px 22px', borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', boxShadow: GLOW }}>
              התחל בחינם
            </a>
          </div>
        </nav>

        {/* Hero */}
        <section style={{ textAlign: 'center', padding: '120px 20px 80px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 18px', borderRadius: 100, background: CARD_BG, border: BORDER, fontSize: 13, color: '#a78bfa', fontWeight: 600, marginBottom: 32, backdropFilter: BLUR }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 10px #a855f7' }} />
            Powered by AI Agents
          </div>

          <h1 style={{ fontSize: 'clamp(44px, 8vw, 80px)', fontWeight: 900, lineHeight: 1.0, background: 'linear-gradient(135deg, #ffffff 0%, #e9d5ff 30%, #a855f7 60%, #7c3aed 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 24, maxWidth: 850, filter: 'drop-shadow(0 0 60px rgba(168,85,247,0.2))' }}>
            סרטוני UGC מקצועיים
            <br />
            עם AI בדקות
          </h1>

          <p style={{ color: '#71717a', fontSize: 'clamp(16px, 2.5vw, 20px)', maxWidth: 560, margin: '0 auto 48px', lineHeight: 1.8 }}>
            Agent חכם שיוצר תסריט, פריימים, סרטוני וידאו וקריינות עברית — הכל אוטומטי, הכל ברמה מקצועית
          </p>

          <LiquidButton href="/login" size="xl">
            התחל עכשיו
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}>
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </LiquidButton>

          {/* Social proof */}
          <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: -8 }}>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ width: 32, height: 32, borderRadius: '50%', background: `linear-gradient(135deg, hsl(${260 + i*15}, 70%, ${50 + i*5}%), hsl(${260 + i*15}, 70%, ${35 + i*5}%))`, border: '2px solid #09090b', marginLeft: i > 1 ? -8 : 0 }} />
              ))}
            </div>
            <p style={{ color: '#71717a', fontSize: 14 }}>
              <span style={{ color: '#a855f7', fontWeight: 700 }}>500+</span> עסקים כבר משתמשים
            </p>
          </div>

          {/* Trust */}
          <div style={{ marginTop: 24, display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center', color: '#52525b', fontSize: 13 }}>
            {['ללא כרטיס אשראי', 'תוצאות תוך דקות', 'קריינות עברית'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section id="how" style={{ maxWidth: 1100, margin: '0 auto', padding: '100px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>תהליך פשוט</div>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 900, color: '#f0f0ff' }}>איך זה עובד?</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {[
              { icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>, title: 'תאר את המוצר', desc: 'הכנס שם מוצר, תיאור קצר, ותמונה — ה-AI מבין בדיוק מה לייצר', color: '#a855f7' },
              { icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>, title: 'Agent יוצר הכל', desc: 'תסריט מקצועי, 4 פריימים, 4 סרטונים + קריינות עברית — אוטומטי', color: '#8b5cf6' },
              { icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>, title: 'הורד ופרסם', desc: 'ייצוא MP4 מוכן עם כתוביות — ישר לטיקטוק, אינסטגרם ורילס', color: '#7c3aed' },
            ].map((s, i) => (
              <div key={i} style={glassCard}>
                <div style={{ position: 'absolute', top: 16, left: 16, width: 26, height: 26, borderRadius: 8, background: `${s.color}15`, border: `1px solid ${s.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: s.color }}>{i + 1}</div>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: BORDER, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>{s.icon}</div>
                <h3 style={{ fontWeight: 800, fontSize: 19, marginBottom: 10, color: '#f0f0ff' }}>{s.title}</h3>
                <p style={{ color: '#71717a', fontSize: 15, lineHeight: 1.7 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Results / Examples */}
        <section style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px 80px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>תוצאות</div>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 900, color: '#f0f0ff' }}>סרטונים שנוצרו</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {[
              { label: 'HiSmile Whitening', cat: 'יופי & טיפוח' },
              { label: 'Serum Pro', cat: 'קוסמטיקה' },
              { label: 'FitApp 360', cat: 'כושר & בריאות' },
              { label: 'CleanHome AI', cat: 'מוצרי בית' },
            ].map((ex, i) => (
              <div key={i} style={{ ...glassCard, padding: 0, overflow: 'hidden' }}>
                <div style={{ aspectRatio: '9/16', maxHeight: 240, background: `linear-gradient(135deg, ${['#7c3aed15','#a855f715','#6d28d915','#8b5cf615'][i]}, #09090b)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffffff15" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12 }}>
                    <div style={{ fontSize: 10, color: '#a855f7', fontWeight: 600, marginBottom: 2 }}>{ex.cat}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e4e7' }}>{ex.label}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Stats bar */}
        <section style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px 80px' }}>
          <div style={{ ...glassCard, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 24, padding: 36, textAlign: 'center' }}>
            {[
              { value: '4', label: 'סצנות מחוברות', color: '#a855f7' },
              { value: 'AI', label: 'תסריט חכם', color: '#8b5cf6' },
              { value: '9:16', label: 'פורמט טיקטוק', color: '#7c3aed' },
              { value: 'HE', label: 'קריינות עברית', color: '#c084fc' },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 30, fontWeight: 900, color: s.color, filter: `drop-shadow(0 0 12px ${s.color}40)`, marginBottom: 4 }}>{s.value}</div>
                <div style={{ color: '#52525b', fontSize: 13, fontWeight: 500 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" style={{ maxWidth: 1100, margin: '0 auto', padding: '60px 20px 120px' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>מחירים שקופים</div>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 900, color: '#f0f0ff' }}>תוכניות ומחירים</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {Object.entries(PLANS).map(([key, plan]) => {
              const pop = key === 'basic'
              return (
                <div key={key} style={{ ...glassCard, padding: 32, textAlign: 'center', position: 'relative', border: pop ? '1.5px solid rgba(168,85,247,0.4)' : BORDER, background: pop ? 'rgba(168,85,247,0.06)' : CARD_BG, transform: pop ? 'scale(1.04)' : 'none' }}>
                  {pop && <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 20px', borderRadius: 100, boxShadow: GLOW }}>הכי פופולרי</div>}
                  <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 16, color: '#a1a1aa' }}>{plan.name}</div>
                  <div style={{ fontSize: 48, fontWeight: 900, marginBottom: 4, background: pop ? 'linear-gradient(135deg, #fff, #c4b5fd)' : 'linear-gradient(135deg, #e4e4e7, #71717a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>&#8362;{plan.price}</div>
                  <div style={{ color: '#52525b', fontSize: 14, marginBottom: 28 }}>{plan.days === 3 ? 'ל-3 ימים' : 'לחודש'}</div>
                  <div style={{ marginBottom: 28, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[`${plan.videos} ${plan.videos === 1 ? 'סרטון UGC' : 'סרטוני UGC'}`, '4 סצנות לכל סרטון', 'קריינות עברית + כתוביות'].map(f => (
                      <div key={f} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#71717a', fontSize: 14 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                        {f}
                      </div>
                    ))}
                  </div>
                  {pop ? (
                    <LiquidButton href="/login" size="md" style={{ width: '100%', justifyContent: 'center' }}>התחל עכשיו</LiquidButton>
                  ) : (
                    <a href="/login" style={{ display: 'block', padding: '14px 28px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: BORDER, color: '#a1a1aa', fontSize: 15, fontWeight: 700, textDecoration: 'none', textAlign: 'center', transition: 'all 300ms ease' }}>בחר תוכנית</a>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Footer */}
        <footer style={{ borderTop: BORDER, padding: '36px 20px', maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, #7c3aed, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: '#fff' }}>U</div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#3f3f46' }}>UGC Studio AI</span>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              <a href="#how" style={{ color: '#3f3f46', fontSize: 13, textDecoration: 'none' }}>איך זה עובד</a>
              <a href="#pricing" style={{ color: '#3f3f46', fontSize: 13, textDecoration: 'none' }}>מחירים</a>
              <a href="/login" style={{ color: '#3f3f46', fontSize: 13, textDecoration: 'none' }}>התחברות</a>
            </div>
            <div style={{ color: '#27272a', fontSize: 12 }}>&copy; {new Date().getFullYear()} UGC Studio AI</div>
          </div>
        </footer>
      </div>
    </div>
  )
}

const BG = '#09090b'
const CARD_BG = 'rgba(255,255,255,0.03)'
const BORDER = '1px solid rgba(255,255,255,0.08)'
const BLUR = 'blur(12px)'
const GLOW = '0 0 30px rgba(124,58,237,0.3)'
const navLink = { color: '#71717a', fontSize: 14, fontWeight: 500, textDecoration: 'none' }
const glassCard = { position: 'relative', background: CARD_BG, backdropFilter: BLUR, WebkitBackdropFilter: BLUR, border: BORDER, borderRadius: 20, padding: 28, transition: 'all 400ms ease' }
