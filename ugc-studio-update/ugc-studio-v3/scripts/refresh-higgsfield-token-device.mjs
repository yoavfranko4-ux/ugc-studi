// scripts/refresh-higgsfield-token-device.mjs
//
// Use the saved refresh_token in .higgsfield-token-device.json to obtain a
// fresh access_token from Higgsfield's device-flow auth server. No browser,
// no polling — just a refresh_token grant.
//
// Run this when the access_token has expired (or is close to expiry):
//
//     node scripts/refresh-higgsfield-token-device.mjs
//
// On success the file is rewritten with the new access_token and (if the
// server rotated it) the new refresh_token, and the new access_token is
// printed for you to paste into Railway → Variables → HIGGSFIELD_TOKEN.
//
// If the refresh_token itself has expired or been revoked, this will fail —
// run scripts/get-higgsfield-token-device.mjs to redo the device flow.
//
// This script ONLY works with files written by get-higgsfield-token-device.mjs
// (it expects flow="device" in .higgsfield-token-device.json). To refresh a
// PKCE/Clerk token (.higgsfield-token.json) use scripts/refresh-higgsfield-token.mjs.

import fs from 'node:fs'
import path from 'node:path'

const AUTH_BASE = 'https://fnf-device-auth.higgsfield.ai'
const REFRESH_ENDPOINT = `${AUTH_BASE}/refresh`

// Device-flow tokens live in .higgsfield-token-device.json (the older PKCE
// flow uses .higgsfield-token.json). This script only touches the former.
const TOKEN_FILE = path.resolve(process.cwd(), '.higgsfield-token-device.json')
const PER_CALL_TIMEOUT_MS = 30_000

function loadTokenFile() {
  if (!fs.existsSync(TOKEN_FILE)) {
    const msg =
      `${TOKEN_FILE} does not exist.\n` +
      `\n` +
      `Run the device-flow bootstrap first:\n` +
      `\n` +
      `    node scripts/get-higgsfield-token-device.mjs\n`
    throw new Error(msg)
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch (e) {
    throw new Error(`${TOKEN_FILE} is not valid JSON: ${e.message}`)
  }
  if (raw.flow !== 'device') {
    throw new Error(
      `${TOKEN_FILE} was not created by get-higgsfield-token-device.mjs ` +
      `(flow=${JSON.stringify(raw.flow)}). To refresh a PKCE/Clerk token use ` +
      `scripts/refresh-higgsfield-token.mjs. To switch to device flow run ` +
      `scripts/get-higgsfield-token-device.mjs.`
    )
  }
  if (!raw.refresh_token) {
    throw new Error(
      `${TOKEN_FILE} has no refresh_token. Re-run scripts/get-higgsfield-token-device.mjs.`
    )
  }
  return raw
}

function saveTokenFile(obj) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
}

async function main() {
  console.log('=== Higgsfield Device-Flow Token Refresh ===')
  console.log('')

  const existing = loadTokenFile()
  console.log(`→ POST ${REFRESH_ENDPOINT}`)

  let res, text, data
  try {
    res = await fetch(REFRESH_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify({ refresh_token: existing.refresh_token }),
      signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS)
    })
    text = await res.text()
    try { data = JSON.parse(text) } catch { data = null }
  } catch (e) {
    throw new Error(`Network error calling /refresh: ${e.message}`)
  }

  if (!res.ok || !data?.access_token) {
    const detail = typeof data?.detail === 'string' ? data.detail : null

    if (res.status === 401 && detail === 'invalid_refresh_token') {
      console.error('')
      console.error('❌ Refresh failed: refresh_token is invalid, expired, or revoked.')
      console.error('')
      console.error('   The saved refresh_token is no longer accepted by the server.')
      console.error('   Run the full device flow again:')
      console.error('')
      console.error('       node scripts/get-higgsfield-token-device.mjs')
      console.error('')
      process.exit(1)
    }

    console.error(`❌ Refresh failed: HTTP ${res.status}`)
    if (detail) {
      console.error(`   detail: ${detail}`)
    } else {
      console.error('   ' + text.slice(0, 500))
    }
    console.error('')
    console.error('If this keeps happening, run scripts/get-higgsfield-token-device.mjs to redo the device flow.')
    process.exit(1)
  }

  for (const k of ['access_token', 'refresh_token', 'expires_in', 'refresh_expires_in']) {
    if (data[k] === undefined) {
      throw new Error(`/refresh response missing "${k}". Body: ${text.slice(0, 300)}`)
    }
  }

  const obtainedAt = new Date()
  const expiresAt = new Date(obtainedAt.getTime() + data.expires_in * 1000)
  const refreshExpiresAt = new Date(obtainedAt.getTime() + data.refresh_expires_in * 1000)
  const rotated = data.refresh_token !== existing.refresh_token

  const record = {
    ...existing,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type || existing.token_type || 'Bearer',
    expires_in: data.expires_in,
    refresh_expires_in: data.refresh_expires_in,
    obtained_at: obtainedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    refresh_expires_at: refreshExpiresAt.toISOString()
  }
  saveTokenFile(record)

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('✅ Token refreshed')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  new access_token (first 24): ' + record.access_token.slice(0, 24) + '...')
  console.log('  refresh_token rotated:       ' + (rotated ? 'yes (new one saved)' : 'no (kept existing)'))
  console.log('  expires_at:                  ' + record.expires_at)
  console.log('  refresh_expires_at:          ' + record.refresh_expires_at)
  console.log('  saved to:                    ' + TOKEN_FILE)
  console.log('')
  console.log('───────────────────────────────────────────────────────────────')
  console.log('📋 Copy this for Railway → Variables → HIGGSFIELD_TOKEN:')
  console.log('───────────────────────────────────────────────────────────────')
  console.log(record.access_token)
  console.log('───────────────────────────────────────────────────────────────')
  console.log('')
}

main().catch((e) => {
  console.error('')
  console.error('❌ FAILED:', e.message)
  process.exit(1)
})
