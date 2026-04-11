'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const router = useRouter()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    if (!supabase) { setError('Supabase not configured'); setLoading(false); return }

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
      } else {
        setMessage('נשלח אליך מייל אימות — בדוק את התיבה')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        router.push('/dashboard')
      }
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 32, fontWeight: 900, background: 'linear-gradient(135deg,#fff 0%,#7c3aed 50%,#06b6d4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8 }}>
            UGC Studio
          </h1>
          <p style={{ color: '#8888aa', fontSize: 15 }}>
            {isSignUp ? 'צור חשבון חדש' : 'התחבר לחשבון שלך'}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 20, padding: 28 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={lblS}>אימייל</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={inpS}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={lblS}>סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="לפחות 6 תווים"
              required
              minLength={6}
              style={inpS}
            />
          </div>

          {error && <div style={{ background: '#ef444422', border: '1px solid #ef4444', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#ef4444', marginBottom: 16 }}>{error}</div>}
          {message && <div style={{ background: '#10b98122', border: '1px solid #10b981', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#10b981', marginBottom: 16 }}>{message}</div>}

          <button type="submit" disabled={loading} style={{ ...bigBtn, opacity: loading ? 0.6 : 1 }}>
            {loading ? '...' : isSignUp ? 'הרשמה' : 'התחברות'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button type="button" onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage('') }} style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', fontSize: 14, fontFamily: 'Heebo,sans-serif' }}>
              {isSignUp ? 'כבר יש לך חשבון? התחבר' : 'אין לך חשבון? הירשם'}
            </button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <a href="/" style={{ color: '#8888aa', fontSize: 13, textDecoration: 'none' }}>← חזרה לדף הבית</a>
        </div>
      </div>
    </div>
  )
}

const lblS = { fontSize: 13, color: '#8888aa', display: 'block', marginBottom: 6 }
const inpS = { background: '#16162a', border: '1px solid #ffffff12', borderRadius: 12, padding: '12px 14px', color: '#f0f0ff', fontSize: 14, outline: 'none', width: '100%', direction: 'ltr', fontFamily: 'monospace' }
const bigBtn = { width: '100%', padding: 16, background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', border: 'none', borderRadius: 14, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 17, fontWeight: 700, cursor: 'pointer' }
