'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (!supabase) { setError('Supabase not configured'); setLoading(false); return }

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setError('בדוק את המייל שלך לאימות')
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) { setError(error.message); return }
        window.location.replace('/dashboard')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, position: 'relative', overflow: 'hidden' }}>
      {/* Background gradient orbs */}
      <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,0,128,0.12) 0%, transparent 70%)', filter: 'blur(80px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,0,128,0.08) 0%, transparent 70%)', filter: 'blur(80px)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1, opacity: mounted ? 1 : 0, transform: mounted ? 'translateY(0)' : 'translateY(20px)', transition: 'all 600ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontFamily: 'Heebo, system-ui, sans-serif', fontSize: 36, fontWeight: 900, color: '#F5F5F4', letterSpacing: '-0.03em', lineHeight: 1 }}>yotzr</span>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: '#FF0080', boxShadow: '0 0 20px rgba(255,0,128,0.5)' }} />
          </div>
          <p style={{ color: '#52525b', fontSize: 15 }}>
            {isSignUp ? 'צור חשבון חדש' : 'התחבר לחשבון שלך'}
          </p>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit} style={{ background: CARD_BG, backdropFilter: BLUR, WebkitBackdropFilter: BLUR, border: BORDER, borderRadius: 20, padding: 32 }}>
          <div style={{ marginBottom: 20 }}>
            <label style={lblS}>אימייל</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={inpS}
              onFocus={e => { e.target.style.borderColor = 'rgba(255,0,128,0.5)'; e.target.style.boxShadow = '0 0 20px rgba(255,0,128,0.1)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = 'none' }}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={lblS}>סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="לפחות 6 תווים"
              required
              minLength={6}
              style={inpS}
              onFocus={e => { e.target.style.borderColor = 'rgba(255,0,128,0.5)'; e.target.style.boxShadow = '0 0 20px rgba(255,0,128,0.1)' }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.08)'; e.target.style.boxShadow = 'none' }}
            />
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#ef4444', marginBottom: 20 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{ ...bigBtn, opacity: loading ? 0.6 : 1 }}>
            {loading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                מתחבר...
              </span>
            ) : isSignUp ? 'הרשמה' : 'התחברות'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError('') }} style={{ background: 'none', border: 'none', color: '#FF0080', cursor: 'pointer', fontSize: 14, fontFamily: 'Heebo,sans-serif', fontWeight: 500 }}>
              {isSignUp ? 'כבר יש לך חשבון? התחבר' : 'אין לך חשבון? הירשם'}
            </button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <a href="/" style={{ color: '#3f3f46', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'scaleX(-1)' }}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            חזרה לדף הבית
          </a>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const BG = '#0A0908'
const CARD_BG = 'rgba(255,255,255,0.03)'
const BORDER = '1px solid rgba(255,255,255,0.08)'
const BLUR = 'blur(12px)'
const GLOW = '0 0 30px rgba(255,0,128,0.3)'
const lblS = { fontSize: 13, color: '#71717a', display: 'block', marginBottom: 8, fontWeight: 500 }
const inpS = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '14px 16px', color: '#F5F5F4', fontSize: 15, outline: 'none', width: '100%', direction: 'ltr', fontFamily: 'monospace', transition: 'all 300ms ease' }
const bigBtn = { width: '100%', padding: 16, background: 'linear-gradient(135deg, #FF0080, #FF0080)', border: 'none', borderRadius: 14, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 17, fontWeight: 700, cursor: 'pointer', boxShadow: '0 0 30px rgba(255,0,128,0.3)', transition: 'all 300ms ease' }
