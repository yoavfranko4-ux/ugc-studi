// scripts/get-higgsfield-token.mjs
//
// Performs the OAuth 2.0 Authorization Code + PKCE flow against Higgsfield's
// Clerk-backed authorization server and saves a bearer access_token (plus
// refresh_token and the registered client_id) to .higgsfield-token.json.
//
// All endpoints are discovered dynamically from the well-known docs published
// by Higgsfield — nothing is hardcoded except the discovery URL itself.
//
// Usage:
//   node scripts/get-higgsfield-token.mjs
//   node scripts/get-higgsfield-token.mjs --register-new       # force fresh DCR
//   node scripts/get-higgsfield-token.mjs --no-scope           # omit `scope` param
//   node scripts/get-higgsfield-token.mjs --scopes "a b c"     # custom scopes
//   node scripts/get-higgsfield-token.mjs --client-id <id>     # reuse a known client_id without DCR
//
// Default scope is `offline_access` only — Clerk DCR clients with
// token_endpoint_auth_method=none are not authorized to request `openid`,
// `profile`, or `email` even though the AS metadata advertises them. We do
// not need identity claims for MCP usage; we only need a bearer token, which
// `offline_access` is enough to issue (plus it gives us a refresh_token).
//
// What it does:
//   1.  GET https://mcp.higgsfield.ai/.well-known/oauth-protected-resource
//   2.  GET <auth_server>/.well-known/oauth-authorization-server
//   3.  Reuse client_id from .higgsfield-token.json or run Dynamic Client
//       Registration (POST /oauth/register).
//   4.  Generate PKCE verifier + S256 challenge + state.
//   5.  Boot a local HTTP listener on http://localhost:8888/callback.
//   6.  Open the user's browser to the authorize URL (with PKCE params).
//   7.  Receive ?code=... on the callback, validate state, shut down server.
//   8.  POST <token_endpoint> grant_type=authorization_code (form-encoded).
//   9.  Save access_token + refresh_token + client_id + expiry metadata to
//       .higgsfield-token.json. Print copy-paste instructions for Railway.
//
// SECURITY: .higgsfield-token.json contains a bearer access_token AND a long-
// lived refresh_token. Add it to .gitignore.

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { exec } from 'node:child_process'

const MCP_RESOURCE = 'https://mcp.higgsfield.ai'
const PROTECTED_RESOURCE_DISCOVERY = `${MCP_RESOURCE}/.well-known/oauth-protected-resource`

const REDIRECT_HOST = 'localhost'
const REDIRECT_PORT = 8888
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}/callback`

const TOKEN_FILE = path.resolve(process.cwd(), '.higgsfield-token.json')

// Parse argv: support both flags ("--no-scope") and value flags
// ("--scopes <value>", "--client-id <value>"). Values can also be passed with
// = ("--scopes=offline_access").
const argv = process.argv.slice(2)
const flagSet = new Set()
const flagVal = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) continue
  const eq = a.indexOf('=')
  if (eq !== -1) {
    flagVal[a.slice(2, eq)] = a.slice(eq + 1)
  } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
    flagVal[a.slice(2)] = argv[++i]
  } else {
    flagSet.add(a.slice(2))
  }
}
const FORCE_REGISTER = flagSet.has('register-new')
const NO_SCOPE = flagSet.has('no-scope')
const CLI_SCOPES = flagVal['scopes']
const CLI_CLIENT_ID = flagVal['client-id']

const DEFAULT_SCOPE = 'offline_access'

// ---------- helpers ----------

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function makePkcePair() {
  const verifier = b64url(crypto.randomBytes(64))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function makeState() {
  return b64url(crypto.randomBytes(32))
}

async function getJson(url, opts = {}) {
  const res = await fetch(url, opts)
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = null }
  return { ok: res.ok, status: res.status, data, text, headers: res.headers }
}

function openInBrowser(url) {
  const platform = process.platform
  let cmd
  if (platform === 'win32') {
    // start "" "url" — empty title arg avoids cmd treating quoted url as title.
    cmd = `start "" "${url}"`
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`
  } else {
    cmd = `xdg-open "${url}"`
  }
  exec(cmd, (err) => {
    if (err) {
      console.warn(`⚠️  Could not auto-open browser (${err.message}).`)
      console.warn('   Open this URL manually:\n   ' + url)
    }
  })
}

function loadTokenFile() {
  if (!fs.existsSync(TOKEN_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch (e) {
    console.warn(`⚠️  ${TOKEN_FILE} exists but is not valid JSON — ignoring (${e.message})`)
    return null
  }
}

function saveTokenFile(obj) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 })
}

// ---------- step 1+2: discovery ----------

async function discover() {
  console.log(`→ Fetching ${PROTECTED_RESOURCE_DISCOVERY}`)
  const r1 = await getJson(PROTECTED_RESOURCE_DISCOVERY)
  if (!r1.ok || !r1.data) {
    throw new Error(`Protected-resource discovery failed: HTTP ${r1.status} ${r1.text.slice(0, 200)}`)
  }
  const authServers = r1.data.authorization_servers || []
  const pkceServer =
    r1.data.higgsfield_auth_hints?.options?.find(o => o.flow === 'authorization_code_pkce')
      ?.authorization_server || authServers[0]
  if (!pkceServer) {
    throw new Error('No authorization_code_pkce authorization server in discovery doc')
  }
  console.log(`  authorization_server: ${pkceServer}`)
  console.log(`  scopes_supported:     ${(r1.data.scopes_supported || []).join(' ')}`)

  const asMetadataUrl = `${pkceServer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`
  console.log(`→ Fetching ${asMetadataUrl}`)
  const r2 = await getJson(asMetadataUrl)
  if (!r2.ok || !r2.data) {
    throw new Error(`AS metadata fetch failed: HTTP ${r2.status} ${r2.text.slice(0, 200)}`)
  }
  const md = r2.data
  for (const k of ['authorization_endpoint', 'token_endpoint']) {
    if (!md[k]) throw new Error(`AS metadata is missing ${k}`)
  }
  if (!(md.code_challenge_methods_supported || []).includes('S256')) {
    throw new Error('AS does not advertise S256 PKCE support')
  }
  if (!(md.grant_types_supported || []).includes('authorization_code')) {
    throw new Error('AS does not advertise authorization_code grant')
  }

  console.log(`  authorization_endpoint: ${md.authorization_endpoint}`)
  console.log(`  token_endpoint:         ${md.token_endpoint}`)
  console.log(`  registration_endpoint:  ${md.registration_endpoint || '(none — DCR not advertised)'}`)
  console.log(`  AS scopes_supported:    ${(md.scopes_supported || []).join(' ') || '(none)'}`)
  console.log(`  AS claims_supported:    ${(md.claims_supported || []).join(' ') || '(none)'}`)
  console.log(`  grant_types_supported:  ${(md.grant_types_supported || []).join(' ')}`)
  console.log(`  auth methods:           ${(md.token_endpoint_auth_methods_supported || []).join(' ')}`)
  console.log('  NOTE: AS metadata advertises tenant-level scopes; DCR public clients')
  console.log('        (token_endpoint_auth_method=none) are usually restricted to a subset.')
  console.log('        Identity scopes (openid/profile/email) commonly fail for DCR clients.')

  return {
    resourceMetadata: r1.data,
    asMetadata: md
  }
}

// ---------- step 3: DCR or reuse ----------

async function ensureClientId({ asMetadata, existing }) {
  if (CLI_CLIENT_ID && !FORCE_REGISTER) {
    console.log(`→ Using --client-id from CLI: ${CLI_CLIENT_ID}`)
    return CLI_CLIENT_ID
  }
  if (!FORCE_REGISTER && existing?.client_id && existing?.token_endpoint === asMetadata.token_endpoint) {
    console.log(`→ Reusing client_id from ${TOKEN_FILE}: ${existing.client_id}`)
    return existing.client_id
  }
  if (FORCE_REGISTER) {
    console.log('→ --register-new flag set — running DCR even though a client_id is on file')
  }
  if (!asMetadata.registration_endpoint) {
    throw new Error('No registration_endpoint advertised — cannot run DCR. ' +
      'You will need to obtain a client_id out-of-band and pass it via --client-id.')
  }

  const dcrBody = {
    client_name: 'Yotzr Server-side MCP Client',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native'
  }

  console.log(`→ POST ${asMetadata.registration_endpoint} (Dynamic Client Registration)`)
  const r = await getJson(asMetadata.registration_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify(dcrBody)
  })
  if (!r.ok || !r.data?.client_id) {
    throw new Error(`DCR failed: HTTP ${r.status} ${r.text.slice(0, 400)}`)
  }
  const clientId = r.data.client_id
  console.log(`  client_id: ${clientId}`)

  // Persist the client_id IMMEDIATELY, before we attempt the OAuth flow that
  // may fail (e.g., scope rejection). Without this, every flow failure costs
  // us a fresh DCR registration and pollutes Higgsfield's tenant.
  const stub = {
    ...(existing || {}),
    client_id: clientId,
    token_endpoint: asMetadata.token_endpoint,
    authorization_endpoint: asMetadata.authorization_endpoint,
    registration_endpoint: asMetadata.registration_endpoint,
    redirect_uri: REDIRECT_URI,
    resource: MCP_RESOURCE,
    _stub_saved_at: Date.now()
  }
  saveTokenFile(stub)
  console.log(`  client_id stub saved to ${TOKEN_FILE} (so it survives flow failures)`)
  return clientId
}

// ---------- step 4–7: PKCE + browser + callback ----------

function waitForCallback({ expectedState }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('Not found')
        return
      }
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description') || ''

      const finish = (statusCode, html) => {
        res.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html)
        // close after the response flushes
        setTimeout(() => server.close(), 100)
      }

      if (error) {
        finish(400, `<h1>Authorization failed</h1><p>${error}: ${errorDescription}</p><p>You can close this tab.</p>`)
        return reject(new Error(`OAuth error from authorization server: ${error} ${errorDescription}`))
      }
      if (!code) {
        finish(400, `<h1>Missing code</h1><p>You can close this tab.</p>`)
        return reject(new Error('Callback received but ?code is missing'))
      }
      if (state !== expectedState) {
        finish(400, `<h1>State mismatch</h1><p>Possible CSRF — aborting.</p>`)
        return reject(new Error(`State mismatch: got ${state}, expected ${expectedState}`))
      }
      finish(200, `<h1>✅ Higgsfield authorization complete</h1><p>You can close this tab and return to the terminal.</p>`)
      resolve(code)
    })

    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(new Error(`Port ${REDIRECT_PORT} is already in use. Close the process holding it and re-run, or change REDIRECT_PORT (note: would require fresh DCR via --register-new since redirect_uris are bound to the registered client).`))
      } else {
        reject(e)
      }
    })

    server.listen(REDIRECT_PORT, REDIRECT_HOST, () => {
      console.log(`→ Local callback listener up on ${REDIRECT_URI}`)
    })

    setTimeout(() => {
      try { server.close() } catch {}
      reject(new Error('Timed out waiting for browser callback (5 minutes)'))
    }, 5 * 60 * 1000)
  })
}

async function runAuthCodeFlow({ asMetadata, clientId, scope }) {
  const { verifier, challenge } = makePkcePair()
  const state = makeState()

  const authorizeUrl = new URL(asMetadata.authorization_endpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('state', state)
  if (scope) authorizeUrl.searchParams.set('scope', scope)

  console.log('')
  console.log('→ Opening browser for Higgsfield login...')
  console.log('   (if it does not open automatically, copy this URL into your browser:)')
  console.log('   ' + authorizeUrl.toString())
  console.log('')

  const callbackPromise = waitForCallback({ expectedState: state })
  openInBrowser(authorizeUrl.toString())
  const code = await callbackPromise
  console.log('→ Authorization code received.')

  const tokenForm = new URLSearchParams()
  tokenForm.set('grant_type', 'authorization_code')
  tokenForm.set('code', code)
  tokenForm.set('redirect_uri', REDIRECT_URI)
  tokenForm.set('client_id', clientId)
  tokenForm.set('code_verifier', verifier)

  console.log(`→ POST ${asMetadata.token_endpoint} (exchanging code for tokens)`)
  const r = await getJson(asMetadata.token_endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'accept': 'application/json'
    },
    body: tokenForm.toString()
  })
  if (!r.ok || !r.data?.access_token) {
    throw new Error(`Token exchange failed: HTTP ${r.status} ${r.text.slice(0, 400)}`)
  }
  return r.data
}

// ---------- main ----------

async function main() {
  console.log('=== Higgsfield OAuth Bearer Token Bootstrap ===')
  console.log('')

  const { resourceMetadata, asMetadata } = await discover()

  // Scope decision tree:
  //   --no-scope          → omit the scope param entirely (Clerk applies its
  //                         default for the registered client)
  //   --scopes "<value>"  → exactly what the user passed (string of
  //                         space-separated tokens)
  //   (default)           → "offline_access". This is the minimum we need:
  //                         it gives us an access_token (the bearer) AND a
  //                         refresh_token, with no identity claims that
  //                         Clerk's DCR policy refuses to grant.
  let scope
  if (NO_SCOPE) {
    scope = null
    console.log('  scope: (omitted — --no-scope)')
  } else if (CLI_SCOPES) {
    scope = CLI_SCOPES.trim()
    console.log(`  scope: ${scope}  (from --scopes)`)
  } else {
    scope = DEFAULT_SCOPE
    console.log(`  scope: ${scope}  (default — minimum required for refresh_token)`)
    console.log('         pass --scopes "<value>" or --no-scope to override.')
  }
  console.log('')

  const existing = loadTokenFile()
  const clientId = await ensureClientId({ asMetadata, existing })

  const tokenResponse = await runAuthCodeFlow({ asMetadata, clientId, scope })

  const issuedAt = Date.now()
  const record = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || null,
    token_type: tokenResponse.token_type || 'Bearer',
    expires_in: tokenResponse.expires_in || null,
    scope: tokenResponse.scope || scope || null,
    issued_at: issuedAt,
    expires_at: tokenResponse.expires_in ? issuedAt + tokenResponse.expires_in * 1000 : null,
    client_id: clientId,
    authorization_endpoint: asMetadata.authorization_endpoint,
    token_endpoint: asMetadata.token_endpoint,
    registration_endpoint: asMetadata.registration_endpoint || null,
    redirect_uri: REDIRECT_URI,
    resource: MCP_RESOURCE
  }
  saveTokenFile(record)

  const exp = record.expires_at ? new Date(record.expires_at).toISOString() : '(unknown)'

  console.log('')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('✅ SUCCESS — Higgsfield bearer token acquired')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('')
  console.log('access_token (first 24 chars):  ' + record.access_token.slice(0, 24) + '...')
  console.log('refresh_token present:          ' + (record.refresh_token ? 'yes' : 'NO (re-auth required when this expires)'))
  console.log('token_type:                     ' + record.token_type)
  console.log('expires_at:                     ' + exp)
  console.log('saved to:                       ' + TOKEN_FILE)
  console.log('')
  console.log('⚠️  The file .higgsfield-token.json contains sensitive credentials.')
  console.log('⚠️  Add it to .gitignore RIGHT NOW if it is not already ignored.')
  console.log('')
  console.log('───────────────────────────────────────────────────────────────')
  console.log('Next steps')
  console.log('───────────────────────────────────────────────────────────────')
  console.log('')
  console.log('1) Sanity-check the token works server-side:')
  console.log('')
  console.log('     $env:HIGGSFIELD_TOKEN="' + record.access_token + '"')
  console.log('     $env:ANTHROPIC_API_KEY="<your-anthropic-key>"')
  console.log('     node scripts/test-higgsfield-token.js')
  console.log('')
  console.log('2) Add the token to Railway → Variables:')
  console.log('')
  console.log('     HIGGSFIELD_TOKEN = ' + record.access_token.slice(0, 24) + '...')
  console.log('     (paste the full value from .higgsfield-token.json access_token)')
  console.log('')
  console.log('3) When the token expires (≈ ' + exp + '), refresh it WITHOUT redoing OAuth:')
  console.log('')
  console.log('     node scripts/refresh-higgsfield-token.mjs')
  console.log('')
  console.log('   Then update Railway with the new access_token from .higgsfield-token.json.')
  console.log('')
  console.log('4) If the refresh_token itself ever expires or is revoked, re-run:')
  console.log('')
  console.log('     node scripts/get-higgsfield-token.mjs')
  console.log('')
  console.log('   (or with --register-new if you want a brand-new OAuth client too)')
  console.log('')
}

main().catch((e) => {
  console.error('')
  console.error('❌ FAILED:', e.message)
  process.exit(1)
})
