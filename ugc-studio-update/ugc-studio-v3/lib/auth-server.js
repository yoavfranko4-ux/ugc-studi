// Server-side auth helper. Resolves a Supabase JWT (sent as
// `Authorization: Bearer <token>`) into the authenticated user.
//
// Returns { user, error } where `error` is one of:
//   'no_token'        — header missing or empty
//   'not_configured'  — Supabase env vars not set
//   'invalid_token'   — Supabase rejected the token
//
// MUST be called from server-side code only (uses the anon key from env).

import { createClient } from '@supabase/supabase-js'

let _anonClient = null
function getAnonClient() {
  if (_anonClient) return _anonClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !anonKey) return null
  _anonClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _anonClient
}

export async function getUserFromRequest(request) {
  const authHeader = request?.headers?.get?.('authorization')
    || request?.headers?.get?.('Authorization')
    || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return { user: null, error: 'no_token' }
  const token = match[1].trim()
  if (!token) return { user: null, error: 'no_token' }

  const client = getAnonClient()
  if (!client) return { user: null, error: 'not_configured' }

  try {
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) return { user: null, error: 'invalid_token' }
    return { user: data.user, error: null }
  } catch (e) {
    console.error('[auth-server] getUserFromRequest exception:', e?.message)
    return { user: null, error: 'invalid_token' }
  }
}

export default null
