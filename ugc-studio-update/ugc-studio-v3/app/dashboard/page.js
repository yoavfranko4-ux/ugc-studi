'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { PLANS } from '../../lib/plans'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      if (!supabase) { setLoading(false); return }
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      if (user) {
        const { data } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .single()
        setSubscription(data)
      }
      setLoading(false)
    }
    init()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8888aa' }}>
      טוען...
    </div>
  )

  const plan = subscription?.plan ? PLANS[subscription.plan] : null
  const videosUsed = subscription?.videos_used || 0
  const videosLeft = plan ? plan.videos - videosUsed : 0
  const isActive = subscription?.status === 'active'

  const history = [
    { id: 1, name: 'HiSmile — הלבנת שיניים', date: '2026-04-10', status: 'done' },
    { id: 2, name: 'סרום פנים — טיפוח', date: '2026-04-08', status: 'done' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#f0f0ff' }}>
      {/* Header */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, background: 'linear-gradient(135deg,#fff,#7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>UGC Studio</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#8888aa', fontSize: 13 }}>{user?.email}</span>
          <button onClick={handleLogout} style={ghostBtn}>התנתק</button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 60px' }}>
        {/* Subscription status */}
        <div style={{ background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 20, padding: 28, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: '#8888aa', marginBottom: 4 }}>תוכנית נוכחית</div>
              <div style={{ fontSize: 24, fontWeight: 900 }}>
                {plan ? plan.name : 'אין מנוי פעיל'}
              </div>
              {plan && (
                <div style={{ color: '#8888aa', fontSize: 14, marginTop: 4 }}>
                  {isActive ? `₪${plan.price} / ${plan.days === 3 ? '3 ימים' : 'חודש'}` : 'מנוי לא פעיל'}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, fontWeight: 900, background: 'linear-gradient(135deg,#7c3aed,#06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {videosLeft}
              </div>
              <div style={{ fontSize: 13, color: '#8888aa' }}>סרטונים נותרו החודש</div>
            </div>
          </div>

          {plan && (
            <div style={{ marginTop: 16 }}>
              <div style={{ background: '#16162a', borderRadius: 10, height: 8, overflow: 'hidden' }}>
                <div style={{ background: 'linear-gradient(90deg,#7c3aed,#06b6d4)', height: '100%', width: `${(videosUsed / plan.videos) * 100}%`, borderRadius: 10, transition: 'width 0.3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8888aa', marginTop: 6 }}>
                <span>{videosUsed} נוצרו</span>
                <span>{plan.videos} סה״כ</span>
              </div>
            </div>
          )}
        </div>

        <a href="/studio" style={{ display: 'block', width: '100%', padding: 18, background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', border: 'none', borderRadius: 14, color: 'white', fontFamily: 'Heebo,sans-serif', fontSize: 18, fontWeight: 700, cursor: 'pointer', textDecoration: 'none', textAlign: 'center', marginBottom: 20 }}>
          ✨ צור סרטון חדש
        </a>

        {/* History */}
        <div style={{ background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 20, padding: 28 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 16 }}>היסטוריית סרטונים</div>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#8888aa', padding: 40 }}>
              עדיין לא יצרת סרטונים
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {history.map(h => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#16162a', border: '1px solid #ffffff08', borderRadius: 12, padding: '14px 18px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{h.name}</div>
                    <div style={{ color: '#8888aa', fontSize: 12, marginTop: 2 }}>{h.date}</div>
                  </div>
                  <div style={{ fontSize: 12, color: h.status === 'done' ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                    {h.status === 'done' ? '✅ הושלם' : '⏳ בתהליך'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const ghostBtn = { background: 'none', border: '1px solid #ffffff12', color: '#8888aa', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontFamily: 'Heebo,sans-serif' }
