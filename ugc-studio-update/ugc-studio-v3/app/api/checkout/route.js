import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const PLANS = {
  trial: { amount: 20,  name: 'ניסיון 3 ימים', description: 'Yotzr Trial - 3 days, 1 video' },
  basic: { amount: 299, name: 'מנוי בייסיק',    description: 'Yotzr Basic - 4 videos/month' },
  pro:   { amount: 499, name: 'מנוי פרו',       description: 'Yotzr Pro - 8 videos/month' },
}

function resolveBaseUrl(req) {
  const host = req.headers.get('host') || ''
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  if (host.includes('yotzr.com')) return 'https://yotzr.com'
  if (host) return `${proto}://${host}`
  return 'https://ugc-studi-production.up.railway.app'
}

async function getUserHint(req) {
  try {
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return null
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) return null
    const sb = createClient(url, anon)
    const { data } = await sb.auth.getUser(token)
    if (data?.user) return { id: data.user.id, email: data.user.email }
  } catch {}
  return null
}

export async function POST(req) {
  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { planType } = body || {}
  const plan = PLANS[planType]
  if (!plan) {
    return NextResponse.json({ success: false, error: 'Invalid plan' }, { status: 400 })
  }

  const apiUrl = process.env.PAYPLUS_API_URL
  const apiKey = process.env.PAYPLUS_API_KEY
  const secretKey = process.env.PAYPLUS_SECRET_KEY
  const terminalUid = process.env.PAYPLUS_TERMINAL_UID
  if (!apiUrl || !apiKey || !secretKey || !terminalUid) {
    return NextResponse.json({ success: false, error: 'PayPlus not configured' }, { status: 500 })
  }

  const base = resolveBaseUrl(req)
  const user = await getUserHint(req)

  const payload = {
    payment_page_uid: terminalUid,
    amount: plan.amount,
    currency_code: 'ILS',
    sendEmailApproval: true,
    sendEmailFailure: false,
    refURL_success: `${base}/checkout/success?plan=${planType}`,
    refURL_failure: `${base}/checkout/failed?plan=${planType}`,
    refURL_cancel: `${base}/`,
    refURL_callback: `${base}/api/payplus-webhook`,
    charge_method: 1,
    language: 'he',
    more_info: planType,
    more_info_1: user?.id || user?.email || '',
    create_token: false,
    items: [
      {
        name: plan.name,
        quantity: 1,
        price: plan.amount,
        vat_type: 1,
      },
    ],
  }

  try {
    const res = await fetch(`${apiUrl}/PaymentPages/generateLink`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: JSON.stringify({ api_key: apiKey, secret_key: secretKey }),
      },
      body: JSON.stringify(payload),
    })

    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = null }

    if (!res.ok || !json) {
      console.error('[checkout] PayPlus HTTP error', res.status, text?.slice(0, 500))
      return NextResponse.json({ success: false, error: `PayPlus HTTP ${res.status}` }, { status: 502 })
    }

    const status = json?.results?.status
    const link = json?.data?.payment_page_link
    if (status !== 'success' || !link) {
      const msg = json?.results?.description || json?.results?.message || 'PayPlus did not return a payment link'
      console.error('[checkout] PayPlus error', JSON.stringify(json).slice(0, 800))
      return NextResponse.json({ success: false, error: msg }, { status: 502 })
    }

    return NextResponse.json({ success: true, url: link })
  } catch (err) {
    console.error('[checkout] exception', err)
    return NextResponse.json({ success: false, error: err.message || 'Unknown error' }, { status: 500 })
  }
}
