import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const PLAN_DAYS = { trial: 3, basic: 30, pro: 30 }

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey)
}

async function parsePayload(req) {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try { return await req.json() } catch { return null }
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    try {
      const form = await req.formData()
      const obj = {}
      for (const [k, v] of form.entries()) obj[k] = v
      return obj
    } catch { return null }
  }
  try {
    const text = await req.text()
    if (!text) return {}
    try { return JSON.parse(text) } catch {
      const params = new URLSearchParams(text)
      const obj = {}
      for (const [k, v] of params.entries()) obj[k] = v
      return obj
    }
  } catch {
    return null
  }
}

async function verifyTransaction(uid) {
  const apiUrl = process.env.PAYPLUS_API_URL
  const apiKey = process.env.PAYPLUS_API_KEY
  const secretKey = process.env.PAYPLUS_SECRET_KEY
  if (!apiUrl || !apiKey || !secretKey || !uid) return null
  try {
    const res = await fetch(`${apiUrl}/Transactions/ApprovalNumber`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
      },
      body: JSON.stringify({ related_transactions: true, transaction_uid: uid }),
    })
    const text = await res.text()
    try { return JSON.parse(text) } catch { return null }
  } catch (err) {
    console.error('[payplus-webhook] verify error', err)
    return null
  }
}

async function findUserIdByEmail(supabase, email) {
  if (!email) return null
  try {
    let page = 1
    while (page <= 5) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return null
      const match = data?.users?.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
      if (match) return match.id
      if (!data?.users?.length || data.users.length < 1000) break
      page++
    }
  } catch {}
  return null
}

async function handle(req) {
  const body = (await parsePayload(req)) || {}
  console.log('[payplus-webhook] received', JSON.stringify(body).slice(0, 800))

  const data = body?.data && typeof body.data === 'object' ? body.data : body
  const transactionType = data?.type || data?.transaction_type || body?.type
  const status = data?.status_code || data?.status || body?.status
  const planType = data?.more_info || body?.more_info
  const userHint = data?.more_info_1 || body?.more_info_1
  const email = data?.customer_email || data?.email || body?.customer_email || body?.email
  const txUid = data?.transaction_uid || data?.uid || body?.transaction_uid

  const isApproved =
    status === '000' ||
    status === 0 ||
    (typeof status === 'string' && status.toLowerCase() === 'approved') ||
    (transactionType && String(transactionType).toLowerCase() === 'charge' && !status)

  if (!isApproved) {
    console.log('[payplus-webhook] non-approved event, ack only', { status, transactionType })
    return NextResponse.json({ ok: true })
  }

  if (txUid) {
    const verify = await verifyTransaction(txUid)
    const verifyStatus = verify?.results?.status
    if (verify && verifyStatus && verifyStatus !== 'success') {
      console.warn('[payplus-webhook] verify did not return success', verifyStatus)
      return NextResponse.json({ ok: true })
    }
  }

  if (!planType || !PLAN_DAYS[planType]) {
    console.warn('[payplus-webhook] missing/invalid planType', planType)
    return NextResponse.json({ ok: true })
  }

  const supabase = getSupabaseAdmin()
  if (!supabase) {
    console.error('[payplus-webhook] Supabase not configured')
    return NextResponse.json({ ok: true })
  }

  let userId = null
  if (userHint && /^[0-9a-f-]{36}$/i.test(String(userHint))) {
    userId = userHint
  } else if (userHint && String(userHint).includes('@')) {
    userId = await findUserIdByEmail(supabase, String(userHint))
  }
  if (!userId && email) {
    userId = await findUserIdByEmail(supabase, String(email))
  }

  if (!userId) {
    console.warn('[payplus-webhook] could not resolve user', { userHint, email })
    return NextResponse.json({ ok: true })
  }

  const days = PLAN_DAYS[planType]
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const { error: subError } = await supabase
    .from('subscriptions')
    .upsert({
      user_id: userId,
      plan: planType,
      status: 'active',
      videos_used: 0,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
  if (subError) {
    console.error('[payplus-webhook] subscriptions upsert failed', subError.message)
  }

  try {
    await supabase
      .from('users')
      .update({
        subscription_tier: planType,
        subscription_expires_at: expiresAt,
        videos_used_this_period: 0,
      })
      .eq('id', userId)
  } catch (err) {
    console.warn('[payplus-webhook] users update skipped', err?.message)
  }

  console.log('[payplus-webhook] activated', { userId, planType, expiresAt })
  return NextResponse.json({ ok: true })
}

export async function POST(req) {
  try {
    return await handle(req)
  } catch (err) {
    console.error('[payplus-webhook] unhandled', err)
    return NextResponse.json({ ok: true })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}
