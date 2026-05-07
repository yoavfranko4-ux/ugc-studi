// Shared internals for Anthropic Messages API + Higgsfield MCP video clients.
//
// Both lib/higgsfield-client.js (Seedance 2.0 path) and
// lib/marketing-studio-client.js (Marketing Studio UGC path) talk to the same
// Anthropic Messages API with the Higgsfield MCP server attached as an
// `mcp_servers` connector. The HTTP plumbing, pause_turn continuation loop,
// token accounting, and VIDEO_URL extraction are identical between them — only
// the system prompt and the model the orchestrator picks differ.
//
// Keeping the plumbing here means a fix in one place (e.g. an Anthropic API
// version bump or a new pause_turn quirk) flows to both clients automatically.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
// MCP connector beta header — required while mcp_servers is in beta.
const ANTHROPIC_BETA = 'mcp-client-2025-04-04'

const MCP_SERVER_URL = 'https://mcp.higgsfield.ai/mcp'
const MCP_SERVER_NAME = 'higgsfield'

// Sonnet 4 — fast enough for tool orchestration, cheap enough that a single
// 15s job stays well under a dollar in tokens. Opus is overkill for what is
// essentially a tool-calling loop.
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

// Higher per-turn budget — the polling loop can emit several tool_use /
// tool_result blocks plus the final text. 4096 tokens was leaving us at
// stop_reason=pause_turn before Claude got to write VIDEO_URL, even though
// Higgsfield had already returned the finished video.
const MAX_TOKENS_PER_TURN = 16384

// Cap on pause_turn continuations. With MCP polling, Anthropic can pause
// Claude's turn while a tool is still running and ask the caller to resume.
// Each resume re-sends the conversation with the assistant's partial content
// appended. 10 continuations is well above what a single Higgsfield render
// needs (typically 2-4 turns) and bounds wallclock + cost.
const MAX_PAUSE_TURN_CONTINUATIONS = 10

// Pricing for token-cost logging (USD per 1M tokens, Sonnet 4 list price).
// Update if the model id changes. Used only for log messages.
const PRICE_INPUT_PER_MTOK = 3.0
const PRICE_OUTPUT_PER_MTOK = 15.0

export {
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
  ANTHROPIC_BETA,
  MCP_SERVER_URL,
  MCP_SERVER_NAME,
  CLAUDE_MODEL,
  MAX_TOKENS_PER_TURN,
  MAX_PAUSE_TURN_CONTINUATIONS
}

export function getMcpConfig() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
  const higgsfieldToken = process.env.HIGGSFIELD_TOKEN || ''
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY must be set')
  // higgsfieldToken is no longer required here — clients fetch a fresh
  // token via lib/higgsfield-auth.js (refresh_token grant). The legacy
  // field is still returned so any non-migrated caller keeps working.
  return { anthropicKey, higgsfieldToken }
}

export function isMcpConfigured() {
  return !!(
    process.env.ANTHROPIC_API_KEY &&
    (process.env.HIGGSFIELD_TOKEN || process.env.HIGGSFIELD_REFRESH_TOKEN)
  )
}

export function summarizeUsage(usage) {
  if (!usage) return null
  const inTok = usage.input_tokens || 0
  const outTok = usage.output_tokens || 0
  const cacheRead = usage.cache_read_input_tokens || 0
  const cacheCreate = usage.cache_creation_input_tokens || 0
  const cost =
    (inTok / 1_000_000) * PRICE_INPUT_PER_MTOK +
    (outTok / 1_000_000) * PRICE_OUTPUT_PER_MTOK
  return {
    input_tokens: inTok,
    output_tokens: outTok,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
    cost_usd: cost
  }
}

export function logTokenUsage(provider, label, summary) {
  if (!summary) return
  console.log(
    `[${provider}] ${label} tokens: in=${summary.input_tokens} out=${summary.output_tokens} cache_read=${summary.cache_read_input_tokens} cache_create=${summary.cache_creation_input_tokens} ≈ $${summary.cost_usd.toFixed(4)}`
  )
}

// Walk every text-bearing block in Claude's response (top-level text, plus
// any text inside mcp_tool_result content arrays) and look for the
// VIDEO_URL: marker the system prompt asked Claude to emit.
export function extractVideoUrl(content) {
  if (!Array.isArray(content)) return null
  const collectStrings = (block) => {
    if (!block) return []
    if (typeof block === 'string') return [block]
    if (block.type === 'text' && typeof block.text === 'string') return [block.text]
    if (block.type === 'mcp_tool_result' && Array.isArray(block.content)) {
      return block.content.flatMap(collectStrings)
    }
    return []
  }
  const texts = content.flatMap(collectStrings)
  for (const t of texts) {
    const m = t.match(/VIDEO_URL:\s*(https?:\/\/\S+)/i)
    if (m) return m[1].replace(/[)>\].,;'"]+$/, '')
  }
  // Fallback: any https://...mp4 URL anywhere in Claude's text output.
  for (const t of texts) {
    const m = t.match(/https?:\/\/\S+\.mp4(?:\?\S*)?/i)
    if (m) return m[0].replace(/[)>\].,;'"]+$/, '')
  }
  return null
}

export function extractError(content) {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      const m = block.text.match(/VIDEO_ERROR:\s*(.+)/i)
      if (m) return m[1].trim()
    }
  }
  return null
}

// One-shot Anthropic call that transparently follows pause_turn until Claude
// either finishes (end_turn / tool_use exhaustion) or we hit the cap. Returns
// a synthetic `data` object whose `content` array is the concatenation of
// every assistant turn — so extractVideoUrl / extractError see the whole
// conversation, not just the last fragment.
//
// Options:
//   body         — the Anthropic Messages API body (model, mcp_servers, system,
//                  messages, max_tokens). messages[] is rewritten on each turn
//                  to append the previous assistant turn for pause_turn.
//   timeoutMs    — per-turn fetch timeout (the whole call can run longer if
//                  pause_turn continuations chain).
//   provider     — short tag for log lines (e.g. 'Higgsfield', 'MarketingStudio').
//   label        — short tag for which call this is (e.g. 'scene', 'full video').
//   heartbeatMs  — if > 0, log a "still waiting" line every heartbeatMs while a
//                  single fetch is in flight. Cleared between turns.
export async function callAnthropicWithPauseTurn({
  body,
  timeoutMs,
  provider = 'Higgsfield',
  label,
  heartbeatMs = 0
}) {
  const { anthropicKey } = getMcpConfig()
  let messages = body.messages
  let lastData = null
  let totalInput = 0
  let totalOutput = 0
  let totalCacheRead = 0
  let totalCacheCreate = 0
  const accumulatedAssistantContent = []
  const t0 = Date.now()

  for (let turn = 0; turn <= MAX_PAUSE_TURN_CONTINUATIONS; turn++) {
    const reqBody = { ...body, messages }
    let heartbeat = null
    if (heartbeatMs > 0) {
      const turnStart = Date.now()
      heartbeat = setInterval(() => {
        const totalElapsed = ((Date.now() - t0) / 1000).toFixed(0)
        const turnElapsed = ((Date.now() - turnStart) / 1000).toFixed(0)
        console.log(
          `[${provider}] ${label} turn ${turn + 1} heartbeat: ${turnElapsed}s on this turn, ${totalElapsed}s total`
        )
      }, heartbeatMs)
    }
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
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (e) {
      if (heartbeat) clearInterval(heartbeat)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      if (e?.name === 'TimeoutError' || /aborted/i.test(e?.message || '')) {
        throw new Error(
          `${provider} ${label} timed out after ${elapsed}s (limit ${timeoutMs / 1000}s)`
        )
      }
      throw new Error(`${provider} ${label} request failed: ${e.message}`)
    }
    if (heartbeat) clearInterval(heartbeat)

    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
    const elapsedSoFar = ((Date.now() - t0) / 1000).toFixed(1)

    if (!res.ok) {
      console.error(
        `[${provider}] ${label} Anthropic API HTTP ${res.status} after ${elapsedSoFar}s (turn ${turn + 1}): ${text.slice(0, 400)}`
      )
      throw new Error(
        `Anthropic API HTTP ${res.status}: ${text.slice(0, 200)}`
      )
    }

    if (data?.usage) {
      totalInput += data.usage.input_tokens || 0
      totalOutput += data.usage.output_tokens || 0
      totalCacheRead += data.usage.cache_read_input_tokens || 0
      totalCacheCreate += data.usage.cache_creation_input_tokens || 0
    }

    lastData = data
    const stopReason = data?.stop_reason
    const blocks = Array.isArray(data?.content) ? data.content : []
    console.log(
      `[${provider}] ${label} turn ${turn + 1}: stop_reason=${stopReason}, content_blocks=${blocks.length}, elapsed=${elapsedSoFar}s`
    )

    if (data?.stop_reason === 'error' || data?.type === 'error') {
      const msg = data?.error?.message || data?.error || 'unknown error'
      throw new Error(
        `${provider}/Claude error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`
      )
    }

    accumulatedAssistantContent.push(...blocks)

    if (stopReason !== 'pause_turn') {
      break
    }

    // pause_turn → resume by appending Claude's partial assistant turn and
    // re-sending. No new user message is required.
    messages = [...messages, { role: 'assistant', content: blocks }]

    if (turn === MAX_PAUSE_TURN_CONTINUATIONS) {
      console.warn(
        `[${provider}] ${label} hit MAX_PAUSE_TURN_CONTINUATIONS=${MAX_PAUSE_TURN_CONTINUATIONS}; bailing out and returning whatever we have`
      )
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const mergedUsage = {
    input_tokens: totalInput,
    output_tokens: totalOutput,
    cache_read_input_tokens: totalCacheRead,
    cache_creation_input_tokens: totalCacheCreate
  }
  return {
    data: {
      ...lastData,
      content: accumulatedAssistantContent,
      usage: mergedUsage
    },
    elapsed
  }
}
