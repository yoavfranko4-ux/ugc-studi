// scripts/test-higgsfield-generate-actual-video.js
//
// Diagnostic: does Higgsfield's MCP connector actually work end-to-end through
// the Anthropic Messages API (mcp-client-2025-04-04 beta), or does it only
// work for fast read-only tools like `balance` and fall over on the long
// `generate_video` poll?
//
// Why this exists:
//   - test-higgsfield-token.js confirms `balance` works (returns credits).
//   - Production (Yotzr) calls fail with "Connection error" during
//     generate_video. Yesterday a video DID generate via claude.ai's chat
//     surface (Higgsfield job 350cecad), so the token + MCP server are
//     known good.
//   - Hypothesis: the long poll inside generate_video (5–10 min Higgsfield
//     queue + render) doesn't survive the MCP connector beta when called
//     server-side from the Anthropic API. Short tool calls do.
//
// What it tests:
//   ONE generate_video call, simplest possible inputs, no references, 5s
//   clip, 9:16, seedance_2_0. If THIS works, the bug is in our route.js or
//   our prompts. If it fails the same way Yotzr does, the bug is in the
//   connector layer itself.
//
// Usage:
//   $env:HIGGSFIELD_TOKEN="..."
//   $env:ANTHROPIC_API_KEY="..."
//   node scripts/test-higgsfield-generate-actual-video.js
//
// Exit codes:
//   0  → video URL returned
//   1  → env vars missing
//   2  → Anthropic API HTTP error / connection error (the suspected failure mode)
//   3  → Higgsfield reported a generation failure
//   4  → Tool was never called
//   5  → Tool was called but no VIDEO_URL surfaced (timeout / partial result)

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA = 'mcp-client-2025-04-04'

const MCP_SERVER_URL = 'https://mcp.higgsfield.ai/mcp'
const MCP_SERVER_NAME = 'higgsfield'

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

// 30 minutes — matches the user's request and is well above Higgsfield's
// usual 5–10 min render time.
const TIMEOUT_MS = 30 * 60 * 1000

function fail(code, msg) {
  console.error(`\n❌ ${msg}`)
  process.exit(code)
}

function ok(msg) {
  console.log(`\n✅ ${msg}`)
  process.exit(0)
}

const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
const higgsfieldToken = process.env.HIGGSFIELD_TOKEN || ''

if (!anthropicKey) fail(1, 'ANTHROPIC_API_KEY is not set')
if (!higgsfieldToken) fail(1, 'HIGGSFIELD_TOKEN is not set')

console.log('--- Higgsfield MCP generate_video end-to-end test ---')
console.log(`ANTHROPIC_API_KEY: ${anthropicKey.slice(0, 10)}... (${anthropicKey.length} chars)`)
console.log(`HIGGSFIELD_TOKEN:  ${higgsfieldToken.slice(0, 10)}... (${higgsfieldToken.length} chars)`)
console.log(`MCP server:        ${MCP_SERVER_URL}`)
console.log(`Model:             ${CLAUDE_MODEL}`)
console.log(`Timeout:           ${TIMEOUT_MS / 1000}s (${TIMEOUT_MS / 60000} min)`)
console.log('')

// Heartbeat so a long hang is visible in the terminal — otherwise a
// "Connection error" looks identical to "still polling".
const heartbeat = setInterval(() => {
  const elapsed = ((Date.now() - heartbeatStart) / 1000).toFixed(0)
  console.log(`[heartbeat] still waiting on Anthropic API... ${elapsed}s elapsed`)
}, 30_000)
const heartbeatStart = Date.now()

const body = {
  model: CLAUDE_MODEL,
  max_tokens: 4096,
  mcp_servers: [
    {
      type: 'url',
      url: MCP_SERVER_URL,
      name: MCP_SERVER_NAME,
      authorization_token: higgsfieldToken
    }
  ],
  system: [
    'You have access to the Higgsfield MCP server. Generate ONE short test video.',
    '',
    'Steps:',
    '  1. Call `generate_video` with: model=seedance_2_0, duration=5, aspect_ratio=9:16, resolution=720p, prompt as given by the user. NO reference images / media ids.',
    '  2. Poll the job (use whichever status tool the MCP exposes — typically `show_generations` or `job_display`) until it is completed/succeeded or failed. Do not stop early.',
    '  3. When done, reply with EXACTLY one line:',
    '       VIDEO_URL: <https url to the mp4>',
    '     If generation fails, reply with EXACTLY one line:',
    '       VIDEO_ERROR: <reason from Higgsfield>',
    '',
    'No commentary, no explanations, no other tools. If a tool errors, surface the raw error inside VIDEO_ERROR.'
  ].join('\n'),
  messages: [
    {
      role: 'user',
      content:
        'Generate a 5-second 9:16 720p test video with Higgsfield Seedance 2.0. ' +
        'Prompt: "test video, simple scene, person waving". ' +
        'No reference images.'
    }
  ]
}

console.log('Sending request to Anthropic API (this will block until the MCP poll finishes or times out)...')
const t0 = Date.now()

let res
try {
  res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_BETA,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
} catch (e) {
  clearInterval(heartbeat)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  // This is the exact failure mode we're hunting. Print everything.
  console.error('\n--- fetch threw before getting an HTTP response ---')
  console.error(`elapsed:  ${elapsed}s`)
  console.error(`name:     ${e?.name}`)
  console.error(`message:  ${e?.message}`)
  console.error(`code:     ${e?.code || '(none)'}`)
  console.error(`cause:    ${e?.cause ? JSON.stringify(e.cause, Object.getOwnPropertyNames(e.cause)) : '(none)'}`)
  if (e?.stack) console.error(`stack:\n${e.stack}`)
  fail(2, `Anthropic API connection error: ${e?.name || 'Error'}: ${e?.message || e}`)
}

clearInterval(heartbeat)

const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\nGot HTTP response after ${elapsed}s: status ${res.status}`)

const text = await res.text()
let data
try {
  data = JSON.parse(text)
} catch {
  fail(2, `Anthropic returned non-JSON (HTTP ${res.status}, ${text.length} bytes): ${text.slice(0, 800)}`)
}

if (!res.ok) {
  console.error('\n--- Anthropic API error body ---')
  console.error(JSON.stringify(data, null, 2).slice(0, 4000))
  fail(2, `Anthropic API HTTP ${res.status}: ${data?.error?.message || data?.error || 'see body above'}`)
}

if (data?.usage) {
  const inTok = data.usage.input_tokens || 0
  const outTok = data.usage.output_tokens || 0
  const cost = (inTok / 1_000_000) * 3 + (outTok / 1_000_000) * 15
  console.log(`Tokens: in=${inTok} out=${outTok} ≈ $${cost.toFixed(4)}`)
}
console.log(`stop_reason: ${data?.stop_reason}`)
console.log(`content blocks: ${Array.isArray(data?.content) ? data.content.length : 0}`)
console.log('')

const blocks = Array.isArray(data?.content) ? data.content : []

let toolCalls = 0
let toolErrors = 0
let assistantText = ''
const toolResultTexts = []

for (const block of blocks) {
  if (block?.type === 'text' && typeof block.text === 'string') {
    assistantText += block.text + '\n'
  }
  if (block?.type === 'mcp_tool_use') {
    toolCalls++
    console.log(`🔧 Tool call: ${block.server_name || '?'}.${block.name || '?'} input=${JSON.stringify(block.input || {}).slice(0, 300)}`)
  }
  if (block?.type === 'mcp_tool_result') {
    const inner = Array.isArray(block.content)
      ? block.content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('\n')
      : ''
    toolResultTexts.push(inner)
    if (block.is_error) {
      toolErrors++
      console.log(`⚠️  Tool error: ${inner.slice(0, 500)}`)
    } else {
      console.log(`📦 Tool result: ${inner.slice(0, 500)}`)
    }
  }
}

console.log('')
console.log('--- Assistant text ---')
console.log(assistantText.trim() || '(no text)')
console.log('----------------------')
console.log(`Tool calls: ${toolCalls}, tool errors: ${toolErrors}`)
console.log(`Total elapsed: ${elapsed}s`)

const urlMatch = assistantText.match(/VIDEO_URL:\s*(https?:\/\/\S+)/i)
const errorMatch = assistantText.match(/VIDEO_ERROR:\s*(.+)/i)

if (urlMatch) {
  ok(`generate_video succeeded end-to-end. Video URL: ${urlMatch[1].replace(/[)>\].,;'"]+$/, '')}`)
}

if (errorMatch) {
  fail(3, `Higgsfield reported failure: ${errorMatch[1].trim()}`)
}

// Fallback: any mp4 URL we can find anywhere (text or tool results).
const fallbackHaystack = assistantText + '\n' + toolResultTexts.join('\n')
const mp4Match = fallbackHaystack.match(/https?:\/\/\S+\.mp4(?:\?\S*)?/i)
if (mp4Match) {
  ok(`generate_video produced a video URL (fallback regex). URL: ${mp4Match[0].replace(/[)>\].,;'"]+$/, '')}`)
}

if (toolCalls === 0) {
  fail(4, 'Claude never invoked any MCP tool. The connector likely failed silently — check the response dump above.')
}

console.error('\n--- Full response dump (truncated) ---')
console.error(JSON.stringify(data, null, 2).slice(0, 4000))
fail(5, 'Tool was called but no VIDEO_URL surfaced. See dump above. Likely the polling timed out or the MCP connector dropped before the job finished.')
