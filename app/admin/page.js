'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const ADMIN_EMAIL = 'yoavfranko34@gmail.com'

const PLAN_OPTIONS = [
  { key: 'trial', label: 'ניסוי — ₪20, 3 ימים, 1 סרטון' },
  { key: 'basic', label: 'Basic — ₪299, 30 ימים, 4 סרטונים' },
  { key: 'pro', label: 'Pro — ₪499, 30 ימים, 8 סרטונים' },
]

export default function AdminPage() {
  const [user, setUser] = useState(null)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [granting, setGranting] = useState({})
  const [selectedPlan, setSelectedPlan] = useState({})
  const [message, setMessage] = useState('')

  useEffect(() => {
    const checkUser = async () => {
      if (!supabase) { setLoading(false); return }
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) { window.location.replace('/login'); return }
      if (user.email !== ADMIN_EMAIL) { window.location.replace('/'); return }

      setUser(user)
      await fetchUsers()
      setLoading(false)
    }
    checkUser()
  }, [])

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return {}
    return { 'Authorization': `Bearer ${session.access_token}` }
  }

  const fetchUsers = async () => {
    const headers = await getAuthHeaders()
    const res = await fetch('/api/admin/grant', { headers })
    if (res.ok) {
      const data = await res.json()
      setUsers(data.users || [])
    }
  }

  const handleGrant = async (userId, email) => {
    const plan = selectedPlan[userId]
    if (!plan) return

    setGranting(g => ({ ...g, [userId]: true }))
    setMessage('')

    try {
      const authHeaders = await getAuthHeaders()
      const res = await fetch('/api/admin/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ userId, plan }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage(`מנוי ${plan} הוענק ל-${email}`)
        await fetchUsers()
      } else {
        setMessage(`שגיאה: ${data.error}`)
      }
    } catch (err) {
      setMessage(`שגיאה: ${err.message}`)
    }
    setGranting(g => ({ ...g, [userId]: false }))
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8888aa' }}>
      טוען...
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#f0f0ff' }}>
      {/* Header */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ffffff08' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, background: 'linear-gradient(135deg,#fff,#ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Admin Panel</h1>
          <div style={{ color: '#8888aa', fontSize: 12, marginTop: 2 }}>{user?.email}</div>
        </div>
        <a href="/dashboard" style={{ color: '#8888aa', fontSize: 13, textDecoration: 'none' }}>← חזרה לדשבורד</a>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 20px' }}>
        {message && (
          <div style={{ background: message.startsWith('שגיאה') ? '#ef444422' : '#10b98122', border: `1px solid ${message.startsWith('שגיאה') ? '#ef4444' : '#10b981'}`, borderRadius: 12, padding: '12px 18px', fontSize: 14, color: message.startsWith('שגיאה') ? '#ef4444' : '#10b981', marginBottom: 20 }}>
            {message}
          </div>
        )}

        <div style={{ background: '#0f0f1a', border: '1px solid #ffffff12', borderRadius: 20, padding: 28 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 3, color: '#f59e0b', textTransform: 'uppercase', marginBottom: 20 }}>
            משתמשים ({users.length})
          </div>

          {users.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#8888aa', padding: 40 }}>אין משתמשים רשומים</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {users.map(u => (
                <div key={u.id} style={{ background: '#16162a', border: '1px solid #ffffff08', borderRadius: 14, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    {/* User info */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{u.email}</div>
                      <div style={{ color: '#8888aa', fontSize: 12, marginTop: 4 }}>
                        נרשם: {new Date(u.created_at).toLocaleDateString('he-IL')}
                      </div>
                      {u.subscription ? (
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          <span style={{ color: u.subscription.status === 'active' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                            {u.subscription.status === 'active' ? '✅ פעיל' : '❌ לא פעיל'}
                          </span>
                          <span style={{ color: '#8888aa', marginRight: 8 }}>
                            {' '}— {u.subscription.plan} | {u.subscription.videos_used}/{u.subscription.videos_total} סרטונים
                          </span>
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, fontSize: 13, color: '#8888aa' }}>אין מנוי</div>
                      )}
                    </div>

                    {/* Grant controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <select
                        value={selectedPlan[u.id] || ''}
                        onChange={e => setSelectedPlan(s => ({ ...s, [u.id]: e.target.value }))}
                        style={{ background: '#0f0f1a', border: '1px solid #ffffff20', borderRadius: 8, padding: '8px 12px', color: '#f0f0ff', fontSize: 13, fontFamily: 'Heebo,sans-serif' }}
                      >
                        <option value="">בחר תוכנית</option>
                        {PLAN_OPTIONS.map(p => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleGrant(u.id, u.email)}
                        disabled={!selectedPlan[u.id] || granting[u.id]}
                        style={{
                          background: selectedPlan[u.id] ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : '#333',
                          border: 'none',
                          borderRadius: 8,
                          padding: '8px 18px',
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 700,
                          fontFamily: 'Heebo,sans-serif',
                          cursor: selectedPlan[u.id] ? 'pointer' : 'not-allowed',
                          opacity: granting[u.id] ? 0.6 : 1,
                        }}
                      >
                        {granting[u.id] ? '...' : 'הענק מנוי'}
                      </button>
                    </div>
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
