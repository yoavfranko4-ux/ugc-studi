'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { PLANS } from '../../lib/plans'
import { remainingVideos } from '../../lib/subscription-limits'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [userRow, setUserRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [videos, setVideos] = useState([])
  const [savedEdits, setSavedEdits] = useState([])
  const [contactMsg, setContactMsg] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    let authSub = null
    let onVis = null
    let currentUserId = null

    // Loading saved_edits is split out so we can re-run it on auth events
    // (TOKEN_REFRESHED / SIGNED_IN) and on tab refocus. Without that, a
    // first-paint race on navigation from /studio left the dashboard empty
    // until the user pressed F5.
    const loadSavedEdits = async (userId) => {
      if (!supabase || !userId) return
      const { data: edits, error } = await supabase
        .from('saved_edits')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) { console.warn('Failed to load saved_edits:', error.message); return }
      if (edits) setSavedEdits(edits)
    }

    const checkUser = async () => {
      if (!supabase) { setLoading(false); return }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.replace('/login'); return }
      if (cancelled) return
      setUser(user)
      currentUserId = user.id

      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()
      if (!cancelled) setSubscription(data)

      // Load the users row (subscription_tier + counters) — source of truth
      // for quota. Falls through silently when columns are missing so the
      // dashboard still renders on a database that hasn't run the migration.
      try {
        const { data: u } = await supabase
          .from('users')
          .select('subscription_tier, subscription_expires_at, videos_used_this_period, lifetime_videos_used, subscription_period_start, trial_started_at')
          .eq('id', user.id)
          .maybeSingle()
        if (u && !cancelled) setUserRow(u)
      } catch {}

      try {
        const saved = localStorage.getItem(`videos_${user.id}`)
        if (saved && !cancelled) setVideos(JSON.parse(saved))
      } catch {}

      await loadSavedEdits(user.id)

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
          const uid = session?.user?.id || currentUserId
          if (uid) loadSavedEdits(uid)
        }
      })
      authSub = sub?.subscription

      onVis = () => {
        if (document.visibilityState === 'visible') loadSavedEdits(currentUserId)
      }
      document.addEventListener('visibilitychange', onVis)

      if (!cancelled) setLoading(false)
    }
    checkUser()

    return () => {
      cancelled = true
      authSub?.unsubscribe?.()
      if (onVis) document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.replace('/')
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 40, height: 40, border: '3px solid rgba(255,0,128,0.2)', borderTopColor: '#FF0080', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ color: '#52525b', fontSize: 14 }}>טוען...</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  const plan = subscription?.plan ? PLANS[subscription.plan] : null
  const isActive = subscription?.status === 'active' && plan

  // Quota — derived from the users-row counters (source of truth), not from
  // savedEdits.length. savedEdits is lifetime history and includes rows from
  // previous billing periods, so it badly inflated "videos created" before.
  // Falls back to tier='trial' when the migration hasn't run on this DB yet.
  const quotaTier = userRow?.subscription_tier || 'trial'
  const quotaPlan = PLANS[quotaTier] || PLANS.trial
  const quotaRemaining = userRow ? remainingVideos(userRow) : (plan ? plan.videos : 1)
  const quotaExhausted = quotaRemaining === 0
  const videosUsedThisPeriod = userRow?.videos_used_this_period || 0
  const planTotal = (plan?.videos) || quotaPlan.videos
  const progressPercent = planTotal ? (videosUsedThisPeriod / planTotal) * 100 : 0

  const getRenewalDate = () => {
    if (!subscription?.created_at || !plan) return null
    const start = new Date(subscription.created_at)
    start.setDate(start.getDate() + plan.days)
    return start.toLocaleDateString('he-IL')
  }

  const sidebarItems = [
    { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>, label: 'דשבורד', active: true },
    { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>, label: 'צור סרטון', href: '/studio' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: BG, color: '#F5F5F4', display: 'flex' }}>
      {/* Sidebar */}
      <aside style={{ width: sidebarOpen ? 240 : 0, minHeight: '100vh', background: 'rgba(255,255,255,0.02)', borderLeft: BORDER, display: 'flex', flexDirection: 'column', transition: 'width 300ms ease', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '20px 16px', borderBottom: BORDER, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span style={{ fontFamily: 'Heebo, system-ui, sans-serif', fontSize: 20, fontWeight: 900, color: '#F5F5F4', letterSpacing: '-0.03em', whiteSpace: 'nowrap' }}>yotzr</span>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#FF0080', boxShadow: '0 0 12px rgba(255,0,128,0.5)', display: 'inline-block' }} />
          </div>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {sidebarItems.map((item, i) => (
            <a key={i} href={item.href || '#'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, marginBottom: 4, color: item.active ? '#FF0080' : '#52525b', background: item.active ? 'rgba(255,0,128,0.08)' : 'transparent', textDecoration: 'none', fontSize: 14, fontWeight: item.active ? 600 : 400, transition: 'all 200ms ease', whiteSpace: 'nowrap' }}>
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>

        {/* User section */}
        <div style={{ padding: '16px', borderTop: BORDER }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,0,128,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#FF0080', flexShrink: 0 }}>
              {(user?.email?.[0] || 'U').toUpperCase()}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ color: '#a1a1aa', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email?.split('@')[0]}</div>
              <div style={{ color: '#3f3f46', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
            </div>
          </div>
          <button onClick={handleLogout} style={{ width: '100%', padding: '8px 12px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'Heebo,sans-serif' }}>
            התנתק
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '28px 32px', maxWidth: 960, overflow: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#F5F5F4', marginBottom: 4 }}>
              שלום, {user?.email?.split('@')[0]}
            </h1>
            <p style={{ color: '#52525b', fontSize: 14 }}>
              {isActive ? 'הנה הסטטוס של החשבון שלך' : 'בחר תוכנית כדי להתחיל'}
            </p>
          </div>
          <button onClick={() => window.location.href = '/studio'} style={ctaBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            צור סרטון
          </button>
        </div>

        {/* Quota banner — green when remaining > 0, red when exhausted. */}
        <div style={{
          padding: '12px 16px',
          marginBottom: 16,
          borderRadius: 10,
          background: quotaExhausted ? 'rgba(244,63,94,0.08)' : 'rgba(34,197,94,0.06)',
          border: `1px solid ${quotaExhausted ? 'rgba(244,63,94,0.4)' : 'rgba(34,197,94,0.3)'}`,
          color: quotaExhausted ? '#f43f5e' : '#22c55e',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: 'Heebo,sans-serif',
          direction: 'rtl',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <span>
            {quotaExhausted
              ? (quotaTier === 'trial'
                  ? 'הניסוי הסתיים — שדרג ל-Basic או Pro כדי להמשיך'
                  : 'נגמרה המכסה — שדרג ל-Pro לעוד סרטונים')
              : `${quotaRemaining} מתוך ${quotaPlan.videos} סרטונים זמינים${quotaTier === 'trial' ? ' (תוכנית ניסוי)' : ''}`}
          </span>
          {quotaExhausted && (
            <button onClick={() => window.location.href = '/#pricing'} style={{
              padding: '6px 14px', background: '#f43f5e', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'Heebo,sans-serif', fontSize: 13, fontWeight: 700,
            }}>
              שדרג עכשיו
            </button>
          )}
        </div>

        {isActive ? (
          <>
            {/* Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
              {/* Plan card */}
              <div style={glassCard}>
                <div style={{ fontSize: 12, color: '#52525b', marginBottom: 8, fontWeight: 500 }}>תוכנית נוכחית</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: '#F5F5F4', marginBottom: 4 }}>{plan.name}</div>
                <div style={{ color: '#52525b', fontSize: 13 }}>&#8362;{plan.price} / {plan.days === 3 ? '3 ימים' : 'חודש'}</div>
                {getRenewalDate() && <div style={{ color: '#FF0080', fontSize: 12, marginTop: 8, fontWeight: 500 }}>חידוש: {getRenewalDate()}</div>}
              </div>

              {/* Videos left — same value as the top banner (DB-backed). */}
              <div style={glassCard}>
                <div style={{ fontSize: 12, color: '#52525b', marginBottom: 8, fontWeight: 500 }}>סרטונים נותרו</div>
                <div style={{ fontSize: 42, fontWeight: 900, background: 'linear-gradient(135deg, #FF0080, #FF0080)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1 }}>{quotaRemaining}</div>
                <div style={{ color: '#52525b', fontSize: 12, marginTop: 8 }}>מתוך {planTotal}</div>
              </div>

              {/* Videos created this period — from users.videos_used_this_period,
                  not savedEdits.length (which is lifetime history). */}
              <div style={glassCard}>
                <div style={{ fontSize: 12, color: '#52525b', marginBottom: 8, fontWeight: 500 }}>נוצרו {quotaTier === 'trial' ? 'בניסוי' : 'החודש'}</div>
                <div style={{ fontSize: 42, fontWeight: 900, color: '#F5F5F4', lineHeight: 1 }}>{videosUsedThisPeriod}</div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 100, height: 6, overflow: 'hidden' }}>
                    <div style={{ background: 'linear-gradient(90deg, #FF0080, #FF0080)', height: '100%', width: `${progressPercent}%`, borderRadius: 100, transition: 'width 0.5s ease', boxShadow: '0 0 10px rgba(255,0,128,0.4)' }} />
                  </div>
                </div>
              </div>

              {/* Lifetime total — surfaces savedEdits.length without
                  conflating it with the current-period quota. */}
              <div style={glassCard}>
                <div style={{ fontSize: 12, color: '#52525b', marginBottom: 8, fontWeight: 500 }}>סך הכל אי-פעם</div>
                <div style={{ fontSize: 42, fontWeight: 900, color: '#a1a1aa', lineHeight: 1 }}>{savedEdits.length}</div>
                <div style={{ color: '#52525b', fontSize: 12, marginTop: 8 }}>סרטונים בהיסטוריה</div>
              </div>
            </div>

            {/* Create Video CTA */}
            <button onClick={() => window.location.href = '/studio'} style={{ ...glassCard, width: '100%', padding: '24px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', border: '1px solid rgba(255,0,128,0.2)', background: 'rgba(255,0,128,0.04)', marginBottom: 24, textAlign: 'right', fontFamily: 'Heebo,sans-serif' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#F5F5F4', marginBottom: 4 }}>צור סרטון UGC חדש</div>
                <div style={{ fontSize: 13, color: '#52525b' }}>Agent AI יוצר 4 סצנות מחוברות עם קריינות עברית</div>
              </div>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #FF0080, #FF0080)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: GLOW, flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" style={{ transform: 'scaleX(-1)', transformOrigin: 'center' }} /></svg>
              </div>
            </button>

            {/* Video History — shows saved edits as cards */}
            <div style={glassCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#F5F5F4' }}>היסטוריית סרטונים</h3>
                <span style={{ fontSize: 12, color: '#3f3f46' }}>{savedEdits.length} סרטונים</span>
              </div>
              {savedEdits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#27272a" strokeWidth="1.5" style={{ marginBottom: 12 }}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                  <p style={{ color: '#3f3f46', fontSize: 14 }}>עדיין לא יצרת סרטונים</p>
                  <p style={{ color: '#27272a', fontSize: 12, marginTop: 4 }}>לחץ על "צור סרטון" כדי להתחיל</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                  {savedEdits.map((edit, i) => {
                    const d = edit.edit_data || {}
                    const thumb = d.thumbnail || d.frames?.[0] || null
                    const isBusiness = d.video_type === 'business' || d.mode === 'business'
                    const cardLabel = isBusiness
                      ? `🏪 ${d.business_name || 'סרטון עסק'}`
                      : `🎬 ${d.product_name || `סרטון ${i + 1}`}`
                    return (
                      <div key={edit.id || i} style={{ background: 'rgba(255,255,255,0.02)', border: BORDER, borderRadius: 14, overflow: 'hidden', transition: 'all 200ms ease' }}>
                        {/* Thumbnail */}
                        <div style={{ aspectRatio: '9/16', maxHeight: 200, background: '#111', position: 'relative', overflow: 'hidden' }}>
                          {thumb ? (
                            <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#27272a" strokeWidth="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                            </div>
                          )}
                          <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '2px 6px', fontSize: 10, color: '#fff', fontWeight: 600 }}>20s</div>
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', padding: '16px 10px 8px' }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F5F4', direction: 'rtl', fontFamily: 'Heebo,sans-serif' }}>{cardLabel}</div>
                          </div>
                        </div>
                        {/* Info + buttons */}
                        <div style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: '#52525b' }}>{edit.created_at ? new Date(edit.created_at).toLocaleDateString('he-IL') : ''}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                              <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>שמור</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { const params = new URLSearchParams({ editId: edit.id }); window.location.href = `/studio?${params}` }}
                              style={{ flex: 1, padding: '7px 0', background: 'rgba(255,0,128,0.08)', border: '1px solid rgba(255,0,128,0.25)', borderRadius: 8, color: '#FF0080', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'Heebo,sans-serif' }}>
                              המשך עריכה
                            </button>
                            {d.videos?.[0] && (
                              <button onClick={() => { window.location.href = `/studio?editId=${edit.id}&autoExport=true` }}
                                style={{ flex: 1, padding: '7px 0', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, color: '#22c55e', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'Heebo,sans-serif', textAlign: 'center' }}>
                                הורד MP4
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* No subscription */
          <>
            <div style={{ textAlign: 'center', marginBottom: 40, padding: '20px 0' }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(255,0,128,0.08)', border: '1px solid rgba(255,0,128,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF0080" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: '#F5F5F4', marginBottom: 8 }}>אין לך מנוי פעיל</h2>
              <p style={{ color: '#52525b', fontSize: 15 }}>בחר תוכנית כדי להתחיל ליצור סרטוני UGC מדהימים</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {[
                { key: 'trial', name: 'ניסוי', price: 20, videos: 1, period: '3 ימים', highlight: false },
                { key: 'basic', name: 'Basic', price: 299, videos: 4, period: 'חודש', highlight: true },
                { key: 'pro', name: 'Pro', price: 499, videos: 8, period: 'חודש', highlight: false },
              ].map(p => (
                <div key={p.key} style={{ ...glassCard, padding: 28, textAlign: 'center', position: 'relative', border: p.highlight ? '1.5px solid rgba(255,0,128,0.4)' : BORDER, background: p.highlight ? 'rgba(255,0,128,0.06)' : CARD_BG }}>
                  {p.highlight && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg, #FF0080, #FF0080)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 16px', borderRadius: 100, boxShadow: GLOW }}>הכי פופולרי</div>}
                  <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8, marginTop: p.highlight ? 8 : 0, color: '#e4e4e7' }}>{p.name}</div>
                  <div style={{ fontSize: 36, fontWeight: 900, background: 'linear-gradient(135deg, #FF0080, #FF0080)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 4 }}>&#8362;{p.price}</div>
                  <div style={{ color: '#52525b', fontSize: 13, marginBottom: 20 }}>/ {p.period}</div>
                  <div style={{ color: '#71717a', fontSize: 14, marginBottom: 24 }}>{p.videos} {p.videos === 1 ? 'סרטון' : 'סרטונים'}</div>
                  <button onClick={() => setContactMsg(p.key)} style={{ width: '100%', padding: 14, background: p.highlight ? 'linear-gradient(135deg, #FF0080, #FF0080)' : 'transparent', border: p.highlight ? 'none' : '1px solid rgba(255,0,128,0.3)', borderRadius: 12, color: '#fff', fontFamily: 'Heebo,sans-serif', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: p.highlight ? GLOW : 'none', transition: 'all 300ms ease' }}>
                    בחר תוכנית
                  </button>
                  {contactMsg === p.key && (
                    <div style={{ marginTop: 12, background: 'rgba(255,0,128,0.06)', border: '1px solid rgba(255,0,128,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#FF0080' }}>
                      צור קשר לרכישה
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

const BG = '#0A0908'
const CARD_BG = 'rgba(255,255,255,0.03)'
const BORDER = '1px solid rgba(255,255,255,0.08)'
const BLUR = 'blur(12px)'
const GLOW = '0 0 30px rgba(255,0,128,0.3)'
const glassCard = { background: CARD_BG, backdropFilter: BLUR, WebkitBackdropFilter: BLUR, border: BORDER, borderRadius: 16, padding: 24 }
const ctaBtn = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'linear-gradient(135deg, #FF0080, #FF0080)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'Heebo,sans-serif', boxShadow: GLOW, transition: 'all 300ms ease' }
