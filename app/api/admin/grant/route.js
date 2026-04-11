import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const ADMIN_EMAIL = 'yoavfranko34@gmail.com'

const PLANS = {
  trial: { videos: 1, days: 3 },
  basic: { videos: 4, days: 30 },
  pro:   { videos: 8, days: 30 },
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey)
}

/**
 * Verify the requesting user is the admin.
 * Uses Supabase auth to check the user's session.
 */
async function verifyAdmin(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return { authorized: false, error: 'Auth not configured' }

  // Extract token from Authorization header or cookie
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return { authorized: false, error: 'Authentication required' }
  }

  const supabase = createClient(url, anonKey)
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return { authorized: false, error: 'Invalid session' }
  }

  if (user.email !== ADMIN_EMAIL) {
    return { authorized: false, error: 'Forbidden — admin access only' }
  }

  return { authorized: true, user }
}

// GET — list all users with their subscriptions
export async function GET(req) {
  // Auth check
  const auth = await verifyAdmin(req)
  if (!auth.authorized) {
    const status = auth.error === 'Forbidden — admin access only' ? 403 : 401
    return NextResponse.json({ error: auth.error }, { status })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })

  // List users
  const { data: { users }, error: usersErr } = await supabase.auth.admin.listUsers()
  if (usersErr) return NextResponse.json({ error: usersErr.message }, { status: 500 })

  // Get all subscriptions
  const { data: subs } = await supabase.from('subscriptions').select('*')
  const subsMap = {}
  if (subs) {
    for (const s of subs) {
      subsMap[s.user_id] = s
    }
  }

  const result = users.map(u => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    subscription: subsMap[u.id] ? {
      plan: subsMap[u.id].plan,
      status: subsMap[u.id].status,
      videos_used: subsMap[u.id].videos_used || 0,
      videos_total: PLANS[subsMap[u.id].plan]?.videos || 0,
      created_at: subsMap[u.id].created_at,
    } : null,
  }))

  return NextResponse.json({ users: result })
}

// POST — grant subscription to a user
export async function POST(req) {
  // Auth check
  const auth = await verifyAdmin(req)
  if (!auth.authorized) {
    const status = auth.error === 'Forbidden — admin access only' ? 403 : 401
    return NextResponse.json({ error: auth.error }, { status })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 })

  const { userId, plan } = await req.json()

  if (!userId || !plan || !PLANS[plan]) {
    return NextResponse.json({ error: 'Missing userId or invalid plan' }, { status: 400 })
  }

  // Upsert subscription — replace existing or create new
  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      plan,
      status: 'active',
      videos_used: 0,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
