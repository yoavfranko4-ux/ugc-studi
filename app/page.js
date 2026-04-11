'use client'

import { PLANS } from '../lib/plans'
import WebGLShader from '../components/ui/web-gl-shader'
import LiquidButton from '../components/ui/liquid-glass-button'

export default function LandingPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#f0f0ff', position: 'relative' }}>
      {/* WebGL Shader Full-Screen Background */}
      <WebGLShader
        colors={['#7c3aed', '#06b6d4', '#1e1b4b', '#0ea5e9']}
        speed={0.25}
        intensity={0.7}
      />

      {/* Overlay gradient for readability */}
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: 'radial-gradient(ellipse at 50% 30%, transparent 0%, rgba(10,10,20,0.5) 50%, rgba(10,10,20,0.85) 100%)',
        zIndex: 1, pointerEvents: 'none',
      }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2 }}>

        {/* Navbar */}
        <nav style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 32px', maxWidth: 1200, margin: '0 auto',
        }}>
          <div style={{
            fontSize: 22, fontWeight: 900,
            background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            UGC Studio AI
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <a href="#how" style={navLink}>איך זה עובד</a>
            <a href="#pricing" style={navLink}>מחירים</a>
            <a href="/login" style={{
              padding: '8px 20px', borderRadius: 10,
              background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
              color: '#c4b5fd', fontSize: 14, fontWeight: 600, textDecoration: 'none',
              transition: 'all 300ms ease',
            }}>
              התחבר
            </a>
          </div>
        </nav>

        {/* Hero Section */}
        <section style={{
          textAlign: 'center', padding: '100px 20px 80px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 16px', borderRadius: 100,
            background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)',
            fontSize: 13, color: '#a78bfa', fontWeight: 600, marginBottom: 28,
            backdropFilter: 'blur(10px)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#06b6d4', boxShadow: '0 0 8px #06b6d4' }} />
            AI Agent מתקדם ליצירת תוכן
          </div>

          {/* Main Headline - Gradient Text */}
          <h1 style={{
            fontSize: 'clamp(42px, 8vw, 76px)', fontWeight: 900, lineHeight: 1.05,
            background: 'linear-gradient(135deg, #ffffff 0%, #e0e7ff 25%, #7c3aed 55%, #06b6d4 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: 24, maxWidth: 800,
            filter: 'drop-shadow(0 0 40px rgba(124,58,237,0.15))',
          }}>
            סרטוני UGC מקצועיים
            <br />
            עם AI בדקות
          </h1>

          {/* Subtitle */}
          <p style={{
            color: '#94a3b8', fontSize: 'clamp(16px, 2.5vw, 20px)',
            maxWidth: 540, margin: '0 auto 44px', lineHeight: 1.7,
          }}>
            Agent חכם שיוצר סיפור, פריימים, סרטונים וקריינות עברית — הכל אוטומטי, הכל מקצועי
          </p>

          {/* CTA - Liquid Glass Button */}
          <LiquidButton href="/login" size="xl">
            התחל עכשיו
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'scaleX(-1)' }}>
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </LiquidButton>

          {/* Trust strip */}
          <div style={{
            marginTop: 32, display: 'flex', gap: 24, alignItems: 'center',
            color: '#64748b', fontSize: 13,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
              ללא כרטיס אשראי
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
              תוצאות תוך דקות
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
              קריינות עברית
            </span>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how" style={{ maxWidth: 1000, margin: '0 auto', padding: '80px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#7c3aed', letterSpacing: 2,
              textTransform: 'uppercase', marginBottom: 12,
            }}>
              תהליך פשוט
            </div>
            <h2 style={{
              fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 900,
              background: 'linear-gradient(135deg, #f0f0ff, #a78bfa)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              איך זה עובד?
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {[
              {
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                  </svg>
                ),
                title: 'תאר את המוצר',
                desc: 'הכנס שם מוצר, תיאור, ותמונה — ה-AI מבין בדיוק מה צריך',
              },
              {
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                ),
                title: 'Agent יוצר הכל',
                desc: 'סיפור מושלם, 4 פריימים, 4 סרטונים וקריינות עברית — הכל אוטומטי',
              },
              {
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                ),
                title: 'הורד ופרסם',
                desc: 'ייצוא MP4 מוכן עם כתוביות — ישר לטיקטוק, אינסטגרם ורילס',
              },
            ].map((step, i) => (
              <div key={i} style={glassCard}>
                {/* Step number */}
                <div style={{
                  position: 'absolute', top: 16, left: 16,
                  width: 28, height: 28, borderRadius: 8,
                  background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: '#a78bfa',
                }}>
                  {i + 1}
                </div>
                {/* Icon */}
                <div style={{
                  width: 56, height: 56, borderRadius: 14,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: 20,
                }}>
                  {step.icon}
                </div>
                <h3 style={{ fontWeight: 800, fontSize: 20, marginBottom: 10, color: '#f0f0ff' }}>
                  {step.title}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.7 }}>
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Features highlight */}
        <section style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px 80px' }}>
          <div style={{
            ...glassCard,
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 32, padding: 40, textAlign: 'center',
          }}>
            {[
              { value: '4', label: 'סצנות מחוברות', color: '#7c3aed' },
              { value: 'AI', label: 'תסריט חכם', color: '#06b6d4' },
              { value: '9:16', label: 'פורמט טיקטוק', color: '#10b981' },
              { value: 'HE', label: 'קריינות עברית', color: '#f59e0b' },
            ].map((stat, i) => (
              <div key={i}>
                <div style={{
                  fontSize: 32, fontWeight: 900, color: stat.color,
                  filter: `drop-shadow(0 0 12px ${stat.color}40)`,
                  marginBottom: 6,
                }}>
                  {stat.value}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 14, fontWeight: 500 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" style={{ maxWidth: 1000, margin: '0 auto', padding: '60px 20px 120px' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#06b6d4', letterSpacing: 2,
              textTransform: 'uppercase', marginBottom: 12,
            }}>
              מחירים שקופים
            </div>
            <h2 style={{
              fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 900,
              background: 'linear-gradient(135deg, #f0f0ff, #67e8f9)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              תוכניות ומחירים
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {Object.entries(PLANS).map(([key, plan]) => {
              const isPopular = key === 'basic'
              return (
                <div key={key} style={{
                  ...glassCard,
                  padding: 32,
                  textAlign: 'center',
                  position: 'relative',
                  border: isPopular
                    ? '2px solid rgba(124,58,237,0.5)'
                    : '1px solid rgba(255,255,255,0.08)',
                  background: isPopular
                    ? 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(6,182,212,0.08))'
                    : glassCard.background,
                  transform: isPopular ? 'scale(1.03)' : 'none',
                }}>
                  {/* Popular badge */}
                  {isPopular && (
                    <div style={{
                      position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)',
                      background: 'linear-gradient(135deg, #7c3aed, #06b6d4)',
                      color: 'white', fontSize: 12, fontWeight: 700,
                      padding: '5px 18px', borderRadius: 100,
                      boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
                    }}>
                      הכי פופולרי
                    </div>
                  )}

                  <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 16, color: '#e2e8f0' }}>
                    {plan.name}
                  </div>

                  <div style={{
                    fontSize: 48, fontWeight: 900, marginBottom: 4,
                    background: isPopular
                      ? 'linear-gradient(135deg, #fff, #c4b5fd)'
                      : 'linear-gradient(135deg, #e2e8f0, #94a3b8)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  }}>
                    &#8362;{plan.price}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
                    {plan.days === 3 ? 'ל-3 ימים' : 'לחודש'}
                  </div>

                  {/* Features */}
                  <div style={{ marginBottom: 28 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      color: '#94a3b8', fontSize: 15, marginBottom: 8,
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                      {plan.videos} {plan.videos === 1 ? 'סרטון UGC' : 'סרטוני UGC'}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      color: '#94a3b8', fontSize: 15, marginBottom: 8,
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                      4 סצנות לכל סרטון
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      color: '#94a3b8', fontSize: 15,
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                      קריינות עברית + כתוביות
                    </div>
                  </div>

                  {isPopular ? (
                    <LiquidButton href="/login" size="md" style={{ width: '100%', justifyContent: 'center' }}>
                      התחל עכשיו
                    </LiquidButton>
                  ) : (
                    <a href="/login" style={{
                      display: 'block', padding: '14px 28px', borderRadius: 14,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#e2e8f0', fontSize: 15, fontWeight: 700,
                      textDecoration: 'none', textAlign: 'center',
                      transition: 'all 300ms ease',
                    }}>
                      בחר תוכנית
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Footer */}
        <footer style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '32px 20px', textAlign: 'center',
          color: '#475569', fontSize: 13,
        }}>
          UGC Studio AI &copy; {new Date().getFullYear()} — כל הזכויות שמורות
        </footer>
      </div>
    </div>
  )
}

// Glassmorphism card style (skill: Style #3 Glassmorphism + Style #14 Liquid Glass)
const glassCard = {
  position: 'relative',
  background: 'rgba(15, 15, 30, 0.6)',
  backdropFilter: 'blur(16px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.2)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 20,
  padding: 28,
  transition: 'all 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
}

const navLink = {
  color: '#94a3b8', fontSize: 14, fontWeight: 500,
  textDecoration: 'none', transition: 'color 200ms ease',
}
