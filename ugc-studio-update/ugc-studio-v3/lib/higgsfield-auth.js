// In-process refresh of Higgsfield access tokens via the device-flow
// /refresh grant. Replaces the manual "paste new HIGGSFIELD_TOKEN into
// Railway every hour" cycle.
//
// Token sources, in order of precedence:
//   1. In-process cache (this module's `mutableRefreshToken`)
//   2. Supabase `app_secrets` row (key='higgsfield_refresh_token') —
//      survives container restarts so a rotation by Higgsfield on one
//      deploy is still valid after the next deploy
//   3. process.env.HIGGSFIELD_REFRESH_TOKEN — bootstrap fallback only
//   4. process.env.HIGGSFIELD_TOKEN — legacy 1-hour token (last resort)
//
// On every successful refresh that returns a rotated refresh_token we
// UPSERT it back into app_secrets so subsequent deploys read the latest
// value rather than the (now-revoked) env value.
//
// Surface:
//   getValidAccessToken() → Promise<string>
//
// Two concurrent callers that both miss the cache share a single
// /refresh round-trip via the in-flight `refreshing` promise.

import { getSupabaseAdmin } from './quota.js'

const REFRESH_ENDPOINT = 'https://fnf-device-auth.higgsfield.ai/refresh'
const REFRESH_TIMEOUT_MS = 30_000
// Re-mint the access token a bit before it actually expires so a slow
// MCP request can't be killed mid-flight by a token that ages out
// while the request is in transit.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

const SECRET_KEY_REFRESH_TOKEN = 'higgsfield_refresh_token'

let cachedToken = null
let expiresAt = 0          // epoch ms; 0 means "never minted"
let refreshing = null      // Promise<string> | null
let lastRefreshAt = 0      // epoch ms; 0 means "never refreshed"
let mutableRefreshToken = null  // overrides env when server rotates the refresh_token mid-process
let dbBootstrapped = false      // whether we've attempted the one-time DB read for the refresh_token

// Load the latest refresh_token from app_secrets. Returns null if Supabase
// isn't configured, the row doesn't exist, or the read fails — caller falls
// back to env.
async function loadStoredRefreshToken() {
  const sb = getSupabaseAdmin()
  if (!sb) return null
  try {
    const { data, error } = await sb
      .from('app_secrets')
      .select('value')
      .eq('key', SECRET_KEY_REFRESH_TOKEN)
      .maybeSingle()
    if (error) {
      console.warn('[HiggsfieldAuth] DB read failed:', error.message)
      return null
    }
    return data?.value || null
  } catch (e) {
    console.warn('[HiggsfieldAuth] DB read exception:', e.message)
    return null
  }
}

// Persist a rotated refresh_token to app_secrets. Awaited so the caller
// finishes the request with a guaranteed-durable token, but failures only
// log — a DB blip shouldn't fail the user's video generation.
async function persistRefreshToken(token) {
  const sb = getSupabaseAdmin()
  if (!sb) return
  try {
    const { error } = await sb
      .from('app_secrets')
      .upsert(
        { key: SECRET_KEY_REFRESH_TOKEN, value: token, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
    if (error) {
      console.warn('[HiggsfieldAuth] DB write failed:', error.message)
    } else {
      console.log('[HiggsfieldAuth] rotated refresh_token persisted to DB')
    }
  } catch (e) {
    console.warn('[HiggsfieldAuth] DB write exception:', e.message)
  }
}

export async function getValidAccessToken() {
  // One-time bootstrap from the DB so a rotation written on a previous
  // deploy is picked up before we trust the (possibly stale) env value.
  if (!dbBootstrapped) {
    dbBootstrapped = true
    const stored = await loadStoredRefreshToken()
    if (stored) {
      mutableRefreshToken = stored
      console.log('[HiggsfieldAuth] loaded refresh_token from DB')
    }
  }

  const refreshToken = mutableRefreshToken || process.env.HIGGSFIELD_REFRESH_TOKEN

  if (!refreshToken) {
    const legacy = process.env.HIGGSFIELD_TOKEN
    if (!legacy) {
      throw new Error(
        '[HiggsfieldAuth] neither app_secrets row, HIGGSFIELD_REFRESH_TOKEN, nor HIGGSFIELD_TOKEN is set'
      )
    }
    console.warn(
      '[HiggsfieldAuth] no refresh_token available, falling back to HIGGSFIELD_TOKEN (will expire in ~1 hour)'
    )
    return legacy
  }

  const now = Date.now()

  if (cachedToken && expiresAt > now + EXPIRY_BUFFER_MS) {
    const remaining = Math.floor((expiresAt - now) / 1000)
    console.log(`[HiggsfieldAuth] using cached token (expires in ${remaining}s)`)
    return cachedToken
  }

  if (refreshing) {
    return refreshing
  }

  refreshing = doRefresh(refreshToken).finally(() => {
    refreshing = null
  })
  return refreshing
}

async function doRefresh(refreshToken) {
  const sinceLast = lastRefreshAt
    ? Math.floor((Date.now() - lastRefreshAt) / 1000) + 's'
    : 'never'
  console.log(`[HiggsfieldAuth] refresh attempt - elapsed since last: ${sinceLast}`)

  let res, text, data
  try {
    res = await fetch(REFRESH_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS)
    })
    text = await res.text()
    try { data = JSON.parse(text) } catch { data = null }
  } catch (e) {
    throw new Error(`[HiggsfieldAuth] network error calling /refresh: ${e.message}`)
  }

  if (!res.ok || !data?.access_token) {
    const detail = typeof data?.detail === 'string' ? data.detail : null
    if (res.status === 401 && detail === 'invalid_refresh_token') {
      throw new Error(
        '[HiggsfieldAuth] refresh_token invalid/expired/revoked. ' +
        'Run: node scripts/get-higgsfield-token-device.mjs ' +
        'and update Railway HIGGSFIELD_REFRESH_TOKEN.'
      )
    }
    throw new Error(
      `[HiggsfieldAuth] /refresh HTTP ${res.status}: ${detail || text.slice(0, 200)}`
    )
  }

  cachedToken = data.access_token
  expiresAt = Date.now() + (data.expires_in * 1000)
  lastRefreshAt = Date.now()

  console.log(
    `[HiggsfieldAuth] refresh successful - new token expires in ${data.expires_in}s`
  )

  if (data.refresh_token && data.refresh_token !== refreshToken) {
    mutableRefreshToken = data.refresh_token
    console.log('[HiggsfieldAuth] refresh_token rotated - new token cached in memory')
    // Persist the rotation so the next deploy / cold start picks up the
    // fresh value instead of the now-revoked one in the env var.
    await persistRefreshToken(data.refresh_token)
  }

  return cachedToken
}
