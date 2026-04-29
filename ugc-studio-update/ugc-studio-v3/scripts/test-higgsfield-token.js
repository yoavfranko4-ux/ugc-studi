// scripts/test-higgsfield-token.js
//
// Sanity-check that HIGGSFIELD_TOKEN works for server-side MCP usage.
// Asks Claude (via the Anthropic Messages API + Higgsfield MCP connector) to
// call ONE cheap, read-only tool — `balance` — and print the result.
//
// Usage:
//   $env:HIGGSFIELD_TOKEN="..."
//   $env:ANTHROPIC_API_KEY="..."
//   node scripts/test-higgsfield-token.js
//
// Exit codes:
//   0  → token works, balance returned
//   1  → env vars missing
//   2  → Anthropic API HTTP error
//   3  → MCP connector / authorization error
//   4  → balance tool not invoked / no result
//
// This script does NOT generate any video, so it costs only a handful of
// Claude tokens (roughly $0.001) and 0 Higgsfield credits.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA = 'mcp-client-2025-04-04'

const MCP_SERVER_URL = 'https://mcp.higgsfield.ai/mcp'
const MCP_SERVER_NAME = 'higgsfield'

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

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

console.log('--- Higgsfield MCP token sanity check ---')
console.log(`ANTHROPIC_API_KEY: ${anthropicKey.slice(0, 10)}... (${anthropicKey.length} chars)`)
console.log(`HIGGSFIELD_TOKEN:  ${higgsfieldToken.slice(0, 10)}... (${higgsfieldToken.length} chars)`)
console.log(`MCP server:        ${MCP_SERVER_URL}`)
console.log(`Model:             ${CLAUDE_MODEL}`)
console.log('')

const body = {
  model: CLAUDE_MODEL,
  max_tokens: 1024,
  mcp_servers: [
    {
      type: 'url',
      url: MCP_SERVER_URL,
      name: MCP_SERVER_NAME,
      authorization_token: higgsfieldToken
    }
  ],
  system:
    'You have access to the Higgsfield MCP server. Call ONLY the `balance` tool ' +
    '(no other tools, no video generation). Then reply in plain text with the ' +
    'remaining credits / balance number you got back, on a single line prefixed ' +
    'exactly with `BALANCE:`. If the tool errors, reply with `BALANCE_ERROR: <reason>`.',
  messages: [
    {
      role: 'user',
      content: 'Check my Higgsfield balance.'
    }
  ]
}

console.log('Sending request to Anthropic API...')
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
    signal: AbortSignal.timeout(2 * 60 * 1000)
  })
} catch (e) {
  fail(2, `fetch failed: ${e.message}`)
}

const text = await res.text()
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

let data
try {
  data = JSON.parse(text)
} catch {
  fail(2, `Anthropic returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`)
}

console.log(`Response: HTTP ${res.status} in ${elapsed}s`)

if (!res.ok) {
  console.error('Body:', JSON.stringify(data, null, 2).slice(0, 1500))
  fail(2, `Anthropic API HTTP ${res.status}`)
}

if (data?.usage) {
  console.log(
    `Tokens: in=${data.usage.input_tokens} out=${data.usage.output_tokens} ≈ $` +
      (
        (data.usage.input_tokens / 1_000_000) * 3 +
        (data.usage.output_tokens / 1_000_000) * 15
      ).toFixed(5)
  )
}

console.log(`stop_reason: ${data?.stop_reason}`)
console.log('')

const blocks = Array.isArray(data?.content) ? data.content : []

let mcpAuthError = null
let toolCalled = false
let toolResultText = ''
let assistantText = ''

for (const block of blocks) {
  if (block?.type === 'text' && typeof block.text === 'string') {
    assistantText += block.text + '\n'
  }
  if (block?.type === 'mcp_tool_use') {
    toolCalled = true
    console.log(
      `🔧 Tool called: ${block.server_name || '?'}.${block.name || '?'}`
    )
  }
  if (block?.type === 'mcp_tool_result') {
    const inner = Array.isArray(block.content)
      ? block.content
          .map((c) => (typeof c === 'string' ? c : c?.text || ''))
          .join('\n')
      : ''
    toolResultText += inner + '\n'
    if (block.is_error) {
      const lower = inner.toLowerCase()
      if (
        /unauthor|forbidden|invalid token|401|403|authentication/.test(lower)
      ) {
        mcpAuthError = inner
      }
      console.log(`⚠️  Tool returned error: ${inner.slice(0, 300)}`)
    } else {
      console.log(`📦 Tool result: ${inner.slice(0, 300)}`)
    }
  }
}

console.log('')
console.log('--- Assistant text ---')
console.log(assistantText.trim() || '(no text)')
console.log('----------------------')

if (mcpAuthError) {
  fail(
    3,
    `Higgsfield MCP rejected the token (auth error). Token is not valid for server-side MCP usage. Detail: ${mcpAuthError.slice(0, 300)}`
  )
}

const balanceMatch = assistantText.match(/BALANCE:\s*(.+)/i)
const errorMatch = assistantText.match(/BALANCE_ERROR:\s*(.+)/i)

if (balanceMatch) {
  ok(`HIGGSFIELD_TOKEN works. Balance: ${balanceMatch[1].trim()}`)
}
if (errorMatch) {
  fail(3, `balance tool errored: ${errorMatch[1].trim()}`)
}

if (!toolCalled) {
  fail(
    4,
    'Claude did not invoke the `balance` tool. The MCP connector may not have ' +
      'loaded — check that the server URL and token are correct and that the ' +
      'mcp-client-2025-04-04 beta is enabled on your Anthropic account.'
  )
}

if (toolResultText.trim()) {
  ok(
    'Tool was called and returned data, but assistant text did not contain BALANCE:. Raw result above. Token appears to work.'
  )
}

fail(4, 'No conclusive balance result. See response dump above.')
