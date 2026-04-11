'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { PLANS } from '../../lib/plans'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)
  const [videos, setVideos] = useState([])
  const [contactMsg, setContactMsg] = useState('')
  const router = useRouter()

  useEffect(() => {
    const init = async () => {
      if (!supabase) { setLoading(false); return }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser(user)

      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()
      setSubscription(data)

      // Load video history from localStorage
      try {
        const saved = localStorage.getItem(`videos_${user.id}`)
        if (saved) setVideos(JSON.parse(saved))
      } catch {}

      setLoading(false)
    }
    init()
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8888aa' }}>
      טוען...
    </div>
  )

  const plan = subscription?.plan ? PLANS[subscription.plan] : null
  const videosUsed = subscription?.videos_used || 0
  const videosLeft = plan ? plan.videos - videosUsed : 0
  const isActive = subscription?.status === 'active' && plan

  // Calculate renewal date
  const getRenewalDate = () => {
    if (!subscription?.created_at || !plan) return null
    const start = new Date(subscription.created_at)
    start.setDate(start.getDate() + plan.days)
    return start.toLocaleDateString('he-IL')
  }

  const planCards = [
    { key: 'trial', name: 'ניסוי', price: 20, videos: 1, period: '3 ימים', highlight: false },
    { key: 'basic', name: 'Basic', price: 299, videos: 4, period: 'חודש', highlight: true },
    { key: 'pro', name: 'Pro', price: 499, videos: 8, period: 'חודש', highlight: false },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#f0f0ff' }}>
      {/* Header */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ffffff08' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, background: 'linear-gradient(135deg,#fff,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>UGC Studio</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{ color: '#f0f0ff', fontSize: 14, fontWeight: 600 }}>{user?.user_metadata?.name || user?.email?.split('@')[0]}</div>
            <div style={{ color: '#8888aa', fontSize: 12 }}>{user?.email}</div>
          </div>
          <button onClick={handleLogout} style={logoutBtn}>התנתק</button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px 60px' }}>

        {isActive ? (
          /* ===== ACTIVE SUBSCRIPTION VIEW ===== */
          <>
            {/* Subscription status card */}
            <div style={{ background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 20, padding: 28, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#8888aa', marginBottom: 4 }}>תוכנית נוכחית</div>
                  <div style={{ fontSize: 24, fontWeight: 900 }}>{plan.name}</div>
                  <div style={{ color: '#8888aa', fontSize: 14, marginTop: 4 }}>
                    ₪{plan.price} / {plan.days === 3 ? '3 ימים' : 'חודש'}
                  </div>
                  {getRenewalDate() && (
                    <div style={{ color: '#7c3aed', fontSize: 13, marginTop: 8 }}>
                      חידוש: {getRenewalDate()}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 900, background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {videosLeft}
                  </div>
                  <div style={{ fontSize: 13, color: '#8888aa' }}>סרטונים נותרו</div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ marginTop: 16 }}>
                <div style={{ background: '#16162a', borderRadius: 10, height: 8, overflow: 'hidden' }}>
                  <div style={{ background: 'linear-gradient(90deg,#7c3aed,#06b6d4)', height: '100%', width: `${(videosUsed / plan.videos) * 100}%`, borderRadius: 10, transition: 'width 0.3s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8888aa', marginTop: 6 }}>
                  <span>{videosUsed} נוצרו</span>
                  <span>{plan.videos} סה״כ</span>
                </div>
              </div>
            </div>

            {/* Create video button */}
            <button
              onClick={() => router.push('/studio')}
              style={{ display: 'block', width: '100%', padding: 18, background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', border: 'none', borderRadius: 14, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 18, fontWeight: 700, cursor: 'pointer', marginBottom: 20 }}
            >
              ✨ צור סרטון חדש
            </button>

            {/* Video history */}
            <div style={{ background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 20, padding: 28 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 16 }}>היסטוריית סרטונים</div>
              {videos.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#8888aa', padding: 40, fontSize: 14 }}>
                  עדיין לא יצרת סרטונים — לחץ על ״צור סרטון חדש״ כדי להתחיל
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {videos.map((v, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#16162a', border: '1px solid #ffffff08', borderRadius: 12, padding: '14px 18px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{v.name || `סרטון ${i + 1}`}</div>
                        <div style={{ color: '#8888aa', fontSize: 12, marginTop: 2 }}>{v.date || ''}</div>
                      </div>
                      <div style={{ fontSize: 12, color: v.status === 'done' ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                        {v.status === 'done' ? '✅ הושלם' : '⏳ בתהליך'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          /* ===== NO SUBSCRIPTION VIEW ===== */
          <>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
              <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>אין לך מנוי פעיל</h2>
              <p style={{ color: '#8888aa', fontSize: 15 }}>בחר תוכנית כדי להתחיל ליצור סרטוני UGC מדהימים</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
              {planCards.map(p => (
                <div key={p.key} style={{
                  background: '#0f0f1a',
                  border: p.highlight ? '2px solid #7c3aed' : '1px solid #ffffff12',
                  borderRadius: 20,
                  padding: 28,
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center',
                }}>
                  {p.highlight && (
                    <div style={{ position: 'absolute', top: -12, background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 20 }}>
                      הכי פופולרי
                    </div>
                  )}
                  <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4, marginTop: p.highlight ? 8 : 0 }}>{p.name}</div>
                  <div style={{ fontSize: 36, fontWeight: 900, background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 4 }}>
                    ₪{p.price}
                  </div>
                  <div style={{ color: '#8888aa', fontSize: 13, marginBottom: 16 }}>/ {p.period}</div>
                  <div style={{ color: '#f0f0ff', fontSize: 14, marginBottom: 20 }}>
                    {p.videos} {p.videos === 1 ? 'סרטון' : 'סרטונים'}
                  </div>
                  <button
                    onClick={() => setContactMsg(p.key)}
                    style={{
                      width: '100%',
                      padding: 14,
                      background: p.highlight ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : 'transparent',
                      border: p.highlight ? 'none' : '1px solid #7c3aed',
                      borderRadius: 12,
                      color: '#fff',
                      fontFamily: 'Heebo,sans-serif',
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    בחר תוכנית
                  </button>
                  {contactMsg === p.key && (
                    <div style={{ marginTop: 12, background: '#7c3aed22', border: '1px solid #7c3aed55', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#c4b5fd' }}>
                      צור קשר לרכישה
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const logoutBtn = {
  background: '#ef444422',
  border: '1px solid #ef444444',
  color: '#ef4444',
  padding: '8px 18px',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'Heebo,sans-serif',
}
