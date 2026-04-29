// scripts/refresh-higgsfield-token.mjs
//
// Use the saved refresh_token in .higgsfield-token.json to obtain a fresh
// access_token from Higgsfield's Clerk-backed authorization server. No
// browser, no PKCE — just a refresh_token grant.
//
// Run this when the access_token has expired (or is close to expiry):
//
//     node scripts/refresh-higgsfield-token.mjs
//
// On success, the file is rewritten with the new access_token (and the new
// refresh_token if Clerk rotated it), and the new value is printed for you
// to paste into Railway → Variables → HIGGSFIELD_TOKEN.
//
// If the refresh_token itself has expired or been revoked, this will fail —
// in that case run scripts/get-higgsfield-token.mjs to redo the OAuth flow.

import fs from 'node:fs'
import path from 'node:path'

const TOKEN_FILE = path.resolve(process.cwd(), '.higgsfield-token.json')

function loadTokenFile() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`${TOKEN_FILE} does not exist. Run scripts/get-higgsfield-token.mjs first.`)
  }
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch (e) {
    throw new Error(`${TOKEN_FILE} is not valid JSON: ${e.message}`)
  }
  for (const k of ['refresh_token', 'client_id', 'token_endpoint']) {
    if (!raw[k]) {
      throw new Error(`${TOKEN_FILE} is missing "${k}". Re-run scripts/get-higgsfield-token.mjs.`)
    }
  }
  return raw
}

function saveTokenFile(obj) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
}

async function main() {
  console.log('=== Higgsfield Token Refresh ===')
  console.log('')

  const existing = loadTokenFile()
  console.log(`→ Refreshing token via ${existing.token_endpoint}`)
  console.log(`  client_id: ${existing.client_id}`)

  const form = new URLSearchParams()
  form.set('grant_type', 'refresh_token')
  form.set('refresh_token', existing.refresh_token)
  form.set('client_id', existing.client_id)
  // Optional but safe — request the same scopes we originally got.
  if (existing.scope) form.set('scope', existing.scope)

  const res = await fetch(existing.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'accept': 'application/json'
    },
    body: form.toString()
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }

  if (!res.ok || !data?.access_token) {
    console.error(`❌ Refresh failed: HTTP ${res.status}`)
    console.error('   ' + text.slice(0, 500))
    console.error('')
    console.error('If this says "invalid_grant" or "token expired", the refresh_token itself is no longer usable.')
    console.error('Run scripts/get-higgsfield-token.mjs to redo the full OAuth flow.')
    process.exit(1)
  }

  const issuedAt = Date.now()
  const record = {
    ...existing,
    access_token: data.access_token,
    // Clerk MAY rotate the refresh_token — if so, store the new one. Otherwise
    // keep the existing one (refresh_token rotation is implementation-defined).
    refresh_token: data.refresh_token || existing.refresh_token,
    token_type: data.token_type || existing.token_type || 'Bearer',
    expires_in: data.expires_in || existing.expires_in || null,
    scope: data.scope || existing.scope,
    issued_at: issuedAt,
    expires_at: data.expires_in ? issuedAt + data.expires_in * 1000 : null
  }
  saveTokenFile(record)

  const exp = record.expires_at ? new Date(record.expires_at).toISOString() : '(unknown)'
  const rotated = data.refresh_token && data.refresh_token !== existing.refresh_token

  console.log('')
  console.log('✅ Token refreshed')
  console.log('  new access_token (first 24): ' + record.access_token.slice(0, 24) + '...')
  console.log('  refresh_token rotated:       ' + (rotated ? 'yes (new one saved)' : 'no (kept existing)'))
  console.log('  expires_at:                  ' + exp)
  console.log('  saved to:                    ' + TOKEN_FILE)
  console.log('')
  console.log('Update Railway → Variables → HIGGSFIELD_TOKEN with the new access_token from the file.')
}

main().catch((e) => {
  console.error('')
  console.error('❌ FAILED:', e.message)
  process.exit(1)
})
