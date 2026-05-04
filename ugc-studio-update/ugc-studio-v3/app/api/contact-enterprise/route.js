import { NextResponse } from 'next/server'

// POST /api/contact-enterprise — public lead-capture for the Enterprise tier.
// No auth: prospects fill the form before signing up. Sales gets the lead via
// console log (Vercel/Netlify log drains). Wire to email/CRM later.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_LEN = 4000

function clean(value) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, MAX_LEN)
}

export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const name = clean(body?.name)
  const email = clean(body?.email)
  const phone = clean(body?.phone)
  const company = clean(body?.company)
  const message = clean(body?.message)

  if (!name || !email || !phone) {
    return NextResponse.json({ error: 'name, email, and phone are required' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid email format' }, { status: 400 })
  }
  const phoneDigits = phone.replace(/\D/g, '')
  if (phoneDigits.length < 10) {
    return NextResponse.json({ error: 'phone must contain at least 10 digits' }, { status: 400 })
  }

  console.log('[Contact-Enterprise]', JSON.stringify({
    name, email, phone, company, message,
    receivedAt: new Date().toISOString(),
  }))

  return NextResponse.json({
    success: true,
    message: 'תודה! ניצור איתך קשר תוך 24 שעות.',
  })
}
