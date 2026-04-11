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
        <section id="how" style={{ background: '#09090b', padding: '100px 20px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', position: 'relative' }}>

            <div style={{ textAlign: 'center', marginBottom: 64 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>תהליך פשוט</div>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 900, color: '#f0f0ff' }}>איך זה עובד?</h2>
            </div>

            {/* Main layout: floating images + steps */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40, flexWrap: 'wrap' }}>

              {/* Left floating UGC images */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0 }}>
                {[
                  { src: '/ugc-showcase/ugc-1.jpg', rot: '-6deg' },
                  { src: '/ugc-showcase/ugc-2.jpg', rot: '3deg' },
                  { src: '/ugc-showcase/ugc-3.jpg', rot: '-3deg' },
                ].map((img, i) => (
                  <img key={i} src={img.src} alt="" style={{ width: 110, height: 140, objectFit: 'cover', borderRadius: 16, transform: `rotate(${img.rot})`, boxShadow: '0 8px 32px rgba(124,58,237,0.25), 0 2px 8px rgba(0,0,0,0.5)', border: '2px solid rgba(255,255,255,0.08)' }} />
                ))}
              </div>

              {/* Center: 3 steps with curved arrows */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, maxWidth: 420 }}>

                {/* Step 1 */}
                <div style={{ ...glassCard, padding: '24px 32px', textAlign: 'center', width: '100%', background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: '#fff' }}>1</div>
                    <h3 style={{ fontWeight: 800, fontSize: 17, color: '#f0f0ff', margin: 0 }}>תאר את המוצר או העסק</h3>
                  </div>
                  <p style={{ color: '#71717a', fontSize: 14, margin: 0, lineHeight: 1.6 }}>שם, תיאור קצר ותמונה</p>
                </div>

                {/* Arrow down */}
                <svg width="40" height="48" viewBox="0 0 40 48" fill="none" style={{ margin: '-4px 0' }}>
                  <path d="M20 4 C20 20, 32 24, 32 32 C32 38, 26 44, 20 44" stroke="url(#arrowGrad1)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                  <polygon points="16,40 20,48 24,40" fill="#a855f7" />
                  <defs><linearGradient id="arrowGrad1" x1="20" y1="4" x2="20" y2="44"><stop offset="0%" stopColor="#7c3aed" /><stop offset="100%" stopColor="#a855f7" /></linearGradient></defs>
                </svg>

                {/* Step 2 */}
                <div style={{ ...glassCard, padding: '24px 32px', textAlign: 'center', width: '100%', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: '#fff' }}>2</div>
                    <h3 style={{ fontWeight: 800, fontSize: 17, color: '#f0f0ff', margin: 0 }}>בחר אווטאר</h3>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12 }}>
                    {[1, 2, 3].map(n => (
                      <img key={n} src={`/avatars/avatar-${n}.jpg`} alt="" style={{ width: 52, height: 52, borderRadius: 14, objectFit: 'cover', border: '2px solid rgba(168,85,247,0.3)', boxShadow: '0 4px 16px rgba(124,58,237,0.2)' }} />
                    ))}
                  </div>
                </div>

                {/* Arrow down */}
                <svg width="40" height="48" viewBox="0 0 40 48" fill="none" style={{ margin: '-4px 0' }}>
                  <path d="M20 4 C20 20, 8 24, 8 32 C8 38, 14 44, 20 44" stroke="url(#arrowGrad2)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                  <polygon points="16,40 20,48 24,40" fill="#a855f7" />
                  <defs><linearGradient id="arrowGrad2" x1="20" y1="4" x2="20" y2="44"><stop offset="0%" stopColor="#a855f7" /><stop offset="100%" stopColor="#c084fc" /></linearGradient></defs>
                </svg>

                {/* Step 3 */}
                <div style={{ ...glassCard, padding: '24px 32px', textAlign: 'center', width: '100%', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #a855f7, #c084fc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: '#fff' }}>3</div>
                    <h3 style={{ fontWeight: 800, fontSize: 17, color: '#f0f0ff', margin: 0 }}>AI מייצר סרטון מוכן</h3>
                  </div>
                  <p style={{ color: '#71717a', fontSize: 14, margin: 0, lineHeight: 1.6 }}>תסריט, פריימים, קריינות וכתוביות — הכל אוטומטי</p>
                </div>
              </div>

              {/* Right floating UGC images */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0 }}>
                {[
                  { src: '/ugc-showcase/ugc-4.jpg', rot: '6deg' },
                  { src: '/ugc-showcase/ugc-5.jpg', rot: '-3deg' },
                  { src: '/ugc-showcase/ugc-6.jpg', rot: '3deg' },
                ].map((img, i) => (
                  <img key={i} src={img.src} alt="" style={{ width: 110, height: 140, objectFit: 'cover', borderRadius: 16, transform: `rotate(${img.rot})`, boxShadow: '0 8px 32px rgba(124,58,237,0.25), 0 2px 8px rgba(0,0,0,0.5)', border: '2px solid rgba(255,255,255,0.08)' }} />
                ))}
              </div>

            </div>

            {/* Showcase grid */}
            <div style={{ marginTop: 80 }}>
              <h3 style={{ textAlign: 'center', fontSize: 'clamp(22px, 3vw, 32px)', fontWeight: 900, color: '#f0f0ff', marginBottom: 36 }}>התוצאות מדברות בעד עצמן</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                {[1, 2, 3, 4].map(n => (
                  <div key={n} style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                    <img src={`/ugc-showcase/ugc-${n}.jpg`} alt="" style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
                  </div>
                ))}
              </div>
            </div>

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
