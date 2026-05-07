// In-process refresh of Higgsfield access tokens via the device-flow
// /refresh grant. Replaces the manual "paste new HIGGSFIELD_TOKEN into
// Railway every hour" cycle.
//
// Required env: HIGGSFIELD_REFRESH_TOKEN — the 7-day refresh token from
// scripts/get-higgsfield-token-device.mjs. Backwards-compatible
// fallback: if HIGGSFIELD_REFRESH_TOKEN is unset, returns
// HIGGSFIELD_TOKEN directly (legacy 1-hour token).
//
// Surface:
//   getValidAccessToken() → Promise<string>
//
// Caching is module-scope (persists for the life of the Node process —
// fine on Railway, where the same instance handles many requests).
// Two concurrent callers that both miss the cache share a single
// /refresh round-trip via the in-flight `refreshing` promise.

const REFRESH_ENDPOINT = 'https://fnf-device-auth.higgsfield.ai/refresh'
const REFRESH_TIMEOUT_MS = 30_000
// Re-mint the access token a bit before it actually expires so a slow
// MCP request can't be killed mid-flight by a token that ages out
// while the request is in transit.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

let cachedToken = null
let expiresAt = 0          // epoch ms; 0 means "never minted"
let refreshing = null      // Promise<string> | null
let lastRefreshAt = 0      // epoch ms; 0 means "never refreshed"

export async function getValidAccessToken() {
  const refreshToken = process.env.HIGGSFIELD_REFRESH_TOKEN

  if (!refreshToken) {
    const legacy = process.env.HIGGSFIELD_TOKEN
    if (!legacy) {
      throw new Error(
        '[HiggsfieldAuth] neither HIGGSFIELD_REFRESH_TOKEN nor HIGGSFIELD_TOKEN is set'
      )
    }
    console.warn(
      '[HiggsfieldAuth] no HIGGSFIELD_REFRESH_TOKEN, falling back to HIGGSFIELD_TOKEN (will expire in ~1 hour)'
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
    console.warn(
      `[HiggsfieldAuth] refresh_token rotated by server - update Railway env: ${data.refresh_token}`
    )
  }

  return cachedToken
}
