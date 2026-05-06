// scripts/get-higgsfield-token-device.mjs
//
// OAuth 2.0 Device Authorization Grant (RFC 8628) against Higgsfield's
// own auth server at fnf-device-auth.higgsfield.ai. This is the same flow
// the official `higgsfield` CLI uses (https://github.com/higgsfield-ai/cli).
//
// This is "Plan B" — we use it instead of the Clerk-backed PKCE flow in
// scripts/get-higgsfield-token.mjs. The token issued here is intended for
// the Higgsfield REST API (https://fnf.higgsfield.ai). It is NOT guaranteed
// to work against the MCP server (https://mcp.higgsfield.ai/mcp) — that's
// the test we're about to run by pasting the access_token into Railway as
// HIGGSFIELD_TOKEN and seeing whether existing MCP code still works.
//
// Usage:
//   node scripts/get-higgsfield-token-device.mjs
//
// Flow (no PKCE, no localhost listener, no client_id):
//   1. POST /authorize → { device_code, verification_uri, expires_in, interval }
//   2. Print verification_uri, open browser to it.
//   3. Poll POST /token { device_code } every <interval>s until:
//        - 200 + access_token → done
//        - 400 detail=authorization_pending → keep polling
//        - 400 detail=slow_down → bump interval and keep polling
//        - 400 detail=expired_token → device_code is dead, bail
//        - 400 detail=access_denied → user rejected, bail
//   4. Save the full TokenResponse to .higgsfield-token-device.json (in
//      whatever directory the script is run from). This is a SEPARATE file
//      from .higgsfield-token.json (used by the older PKCE flow), so the two
//      tokens coexist and you can fall back to the PKCE one if needed.
//
// SECURITY: .higgsfield-token-device.json contains a bearer access_token AND
// a long-lived refresh_token. The repo's root .gitignore covers it as an
// explicit entry; double-check before committing anything.

import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'

const AUTH_BASE = 'https://fnf-device-auth.higgsfield.ai'
const AUTHORIZE_ENDPOINT = `${AUTH_BASE}/authorize`
const TOKEN_ENDPOINT = `${AUTH_BASE}/token`

// Note the filename: device-flow tokens live in .higgsfield-token-device.json
// while the older Clerk/PKCE flow uses .higgsfield-token.json. Two files, two
// flows — they don't overwrite each other.
const TOKEN_FILE = path.resolve(process.cwd(), '.higgsfield-token-device.json')

const PER_CALL_TIMEOUT_MS = 30_000
// RFC 8628: polling MUST stop when the device_code expires. We also impose
// a hard 15-minute ceiling regardless of what expires_in claims, so a
// misbehaving server can't hold the script forever.
const ABSOLUTE_TIMEOUT_MS = 15 * 60 * 1000

// ---------- helpers ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS)
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }
  return { ok: res.ok, status: res.status, data, text }
}

function openInBrowser(url) {
  const platform = process.platform
  let cmd
  if (platform === 'win32') {
    // Empty title arg ("") avoids cmd treating the quoted URL as a window title.
    cmd = `start "" "${url}"`
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`
  } else {
    cmd = `xdg-open "${url}"`
  }
  exec(cmd, (err) => {
    if (err) {
      console.warn(`⚠️  Could not auto-open browser (${err.message}).`)
      console.warn('   Please open the URL above manually.')
    }
  })
}

function saveTokenFile(obj) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
}

function fmtElapsed(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`
}

// ---------- step 1: authorize ----------

async function requestDeviceCode() {
  console.log(`→ POST ${AUTHORIZE_ENDPOINT}`)
  const r = await postJson(AUTHORIZE_ENDPOINT, {})
  if (!r.ok || !r.data) {
    throw new Error(`/authorize failed: HTTP ${r.status} ${r.text.slice(0, 300)}`)
  }
  for (const k of ['device_code', 'verification_uri', 'expires_in', 'interval']) {
    if (r.data[k] === undefined || r.data[k] === null) {
      throw new Error(`/authorize response missing "${k}". Body: ${r.text.slice(0, 300)}`)
    }
  }
  return r.data
}

// ---------- step 2-4: poll for token ----------

async function pollForToken({ device_code, interval, expires_in, startedAt }) {
  // Stop polling at whichever comes first: server's expires_in, our hard cap.
  const serverDeadline = startedAt + expires_in * 1000
  const hardDeadline = startedAt + ABSOLUTE_TIMEOUT_MS
  const deadline = Math.min(serverDeadline, hardDeadline)

  let currentInterval = interval
  let pollCount = 0

  while (Date.now() < deadline) {
    await sleep(currentInterval * 1000)
    pollCount++

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
    // \r overwrites the same line on each poll for clean live feedback.
    process.stdout.write(
      `\r  polling /token … attempt ${pollCount}, ${fmtElapsed(elapsedSec)} elapsed   `
    )

    let r
    try {
      r = await postJson(TOKEN_ENDPOINT, { device_code })
    } catch (e) {
      // Network blip — keep polling unless we're past the deadline.
      process.stdout.write(`\n  (network: ${e.message} — retrying)\n`)
      continue
    }

    if (r.ok && r.data?.access_token) {
      process.stdout.write('\n')
      return r.data
    }

    const detail = typeof r.data?.detail === 'string' ? r.data.detail : null

    if (r.status === 400 && detail === 'authorization_pending') {
      continue
    }
    if (r.status === 400 && detail === 'slow_down') {
      currentInterval = currentInterval + 5
      process.stdout.write(`\n  server asked us to slow down — bumping interval to ${currentInterval}s\n`)
      continue
    }

    process.stdout.write('\n')
    if (r.status === 400 && detail === 'expired_token') {
      throw new Error(
        `device_code expired or never existed. Re-run this script to get a new one.`
      )
    }
    if (r.status === 400 && detail === 'access_denied') {
      throw new Error(
        `User denied authorization in the browser. Re-run if this was an accident.`
      )
    }
    // Anything else — surface raw payload.
    const shown = detail ?? r.text.slice(0, 300)
    throw new Error(`/token failed: HTTP ${r.status} — ${shown}`)
  }

  throw new Error(
    `Timed out waiting for browser approval after ${fmtElapsed(Math.round((Date.now() - startedAt) / 1000))}.`
  )
}

// ---------- main ----------

async function main() {
  console.log('=== Higgsfield Device-Flow Token Bootstrap ===')
  console.log(`    auth server: ${AUTH_BASE}`)
  console.log(`    token file:  ${TOKEN_FILE}`)
  console.log('')

  const startedAt = Date.now()
  const auth = await requestDeviceCode()
  console.log('')
  console.log('🔑 Open this URL in your browser:')
  console.log('')
  console.log('   ' + auth.verification_uri)
  console.log('')
  console.log('   Then authorize the app.')
  console.log('')
  console.log(`   Waiting... (polling every ${auth.interval}s, expires in ${fmtElapsed(auth.expires_in)})`)
  console.log('')

  openInBrowser(auth.verification_uri)

  const tokenResponse = await pollForToken({
    device_code: auth.device_code,
    interval: auth.interval,
    expires_in: auth.expires_in,
    startedAt
  })

  for (const k of ['access_token', 'refresh_token', 'expires_in', 'refresh_expires_in']) {
    if (tokenResponse[k] === undefined) {
      throw new Error(`/token success response missing "${k}". Body: ${JSON.stringify(tokenResponse).slice(0, 300)}`)
    }
  }

  const obtainedAt = new Date()
  const expiresAt = new Date(obtainedAt.getTime() + tokenResponse.expires_in * 1000)
  const refreshExpiresAt = new Date(obtainedAt.getTime() + tokenResponse.refresh_expires_in * 1000)

  const record = {
    flow: 'device',
    auth_server: AUTH_BASE,
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    token_type: tokenResponse.token_type || 'Bearer',
    expires_in: tokenResponse.expires_in,
    refresh_expires_in: tokenResponse.refresh_expires_in,
    obtained_at: obtainedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    refresh_expires_at: refreshExpiresAt.toISOString()
  }
  saveTokenFile(record)

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('✅ Token obtained successfully!')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  access_token (first 24): ' + record.access_token.slice(0, 24) + '...')
  console.log('  expires_at:              ' + record.expires_at)
  console.log('  refresh_expires_at:      ' + record.refresh_expires_at)
  console.log('  refresh_token saved:     yes')
  console.log('  saved to:                ' + TOKEN_FILE)
  console.log('')
  console.log('⚠️  ' + TOKEN_FILE)
  console.log('⚠️  contains sensitive credentials. Repo .gitignore covers it,')
  console.log('⚠️  but never paste its contents anywhere public.')
  console.log('')
  console.log('───────────────────────────────────────────────────────────────')
  console.log('📋 Copy this for Railway → Variables → HIGGSFIELD_TOKEN:')
  console.log('───────────────────────────────────────────────────────────────')
  console.log(record.access_token)
  console.log('───────────────────────────────────────────────────────────────')
  console.log('')
  console.log('When this access_token expires, refresh WITHOUT redoing OAuth:')
  console.log('')
  console.log('     node scripts/refresh-higgsfield-token-device.mjs')
  console.log('')
}

main().catch((e) => {
  console.error('')
  console.error('❌ FAILED:', e.message)
  process.exit(1)
})
