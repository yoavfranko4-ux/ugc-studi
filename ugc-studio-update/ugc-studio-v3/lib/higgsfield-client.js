// Higgsfield MCP client — replaces BytePlus Seedance for video generation.
//
// Architecture: instead of calling Higgsfield's REST API directly (no public
// REST yet), we go through Anthropic's Messages API with the Higgsfield MCP
// server attached as an `mcp_servers` connector. Claude (Sonnet) receives the
// prompt + reference image URLs, calls the MCP tools `media_upload` and
// `generate_video`, polls the job, and returns the final video URL. The
// client surface here matches the old BytePlus client (`generateVideo({
// prompt, imageUrls, duration }) → { videoUrl }`) so route.js drops in
// without any other changes to the pipeline.
//
// Required env:
//   - ANTHROPIC_API_KEY  (already set for the rest of route.js)
//   - HIGGSFIELD_TOKEN   (Higgsfield Personal Access Token / OAuth token —
//                         passed through to the MCP server as
//                         `authorization_token` on every request)

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
// MCP connector beta header — required while mcp_servers is in beta.
const ANTHROPIC_BETA = 'mcp-client-2025-04-04'

const MCP_SERVER_URL = 'https://mcp.higgsfield.ai/mcp'
const MCP_SERVER_NAME = 'higgsfield'

// Sonnet 4 — fast enough for tool orchestration, cheap enough that a 4-scene
// job stays well under a dollar in tokens. Opus is overkill for what is
// essentially a tool-calling loop.
const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

// Each scene gets its own 20-minute window. Higgsfield queue + render is
// usually 5–10 min; 20 min covers the long tail without holding the whole job
// hostage. The four scenes run in parallel from route.js, so wallclock for the
// full job is bounded by the slowest scene, not the sum.
const SCENE_TIMEOUT_MS = 20 * 60 * 1000

// Pricing for token-cost logging (USD per 1M tokens, Sonnet 4 list price).
// Update if the model id changes. Used only for log messages — no business
// logic depends on these.
const PRICE_INPUT_PER_MTOK = 3.0
const PRICE_OUTPUT_PER_MTOK = 15.0

// Hard rule that keeps prepending no matter what wrappedKlingPrompt contains.
// The first generation drifted into a talking-head clip; this is the belt-and-
// suspenders fix to make sure every Seedance prompt starts with the lip-lock.
const NO_LIP_PREFIX =
  'ABSOLUTE RULE: The person never opens their mouth. Lips stay completely sealed throughout the entire clip. No talking, no singing, no mouth movement at all. Voiceover is added externally — the visual must be silent. All emotion is conveyed only through the eyes, eyebrows, and CLOSED-MOUTH micro-expressions. '

export function isHiggsfieldConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY && process.env.HIGGSFIELD_TOKEN)
}

function getConfig() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
  const higgsfieldToken = process.env.HIGGSFIELD_TOKEN || ''
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY must be set')
  if (!higgsfieldToken) throw new Error('HIGGSFIELD_TOKEN must be set')
  return { anthropicKey, higgsfieldToken }
}

function buildSystemPrompt() {
  return [
    'You are a video-generation orchestrator. You have access to the Higgsfield MCP server, which exposes `media_upload` and `generate_video` (among other tools).',
    '',
    'Your job, for every user message, is:',
    '  1. Upload each reference image URL the user provides via `media_upload` and collect the resulting media ids.',
    '  2. Call `generate_video` with model `seedance_2_0`, resolution 720p, aspect ratio 9:16, duration matching the user\'s requested seconds (default 5), the user\'s prompt as the text prompt, and the uploaded media ids as reference frames.',
    '  3. Poll the job (using whichever status/show tool the MCP exposes — typically `show_generations` or `job_display`) until status is `completed`, `succeeded`, or `failed`.',
    '  4. Return ONLY the final video URL on its own line, prefixed exactly with `VIDEO_URL:` (e.g. `VIDEO_URL: https://...`). If generation fails, return `VIDEO_ERROR: <reason>` instead. No other commentary.',
    '',
    'CRITICAL CONTENT RULES — these must be enforced in the prompt you pass to `generate_video`, on top of whatever the user sent:',
    '  - The person\'s mouth NEVER opens. Lips stay completely sealed for the entire clip.',
    '  - NO talking, NO singing, NO mouth movement. The audio track will be added externally; the visual must be silent.',
    '  - All emotion comes from the eyes, eyebrows, and closed-mouth expressions only.',
    'If the user prompt does not already contain a lip-lock instruction, prepend one before calling `generate_video`.',
    '',
    'Do not ask the user clarifying questions. Do not narrate your steps. Just execute and return the final URL.'
  ].join('\n')
}

function buildUserMessage({ prompt, imageUrls, duration }) {
  const promptWithLock = prompt.startsWith('ABSOLUTE RULE')
    ? prompt
    : NO_LIP_PREFIX + prompt
  const lines = [
    `Generate a ${duration}-second 9:16 720p video using Higgsfield Seedance 2.0.`,
    '',
    'Reference images (upload all of these via media_upload first, then pass them as reference frames to generate_video):',
    ...imageUrls.map((u, i) => `  ${i + 1}. ${u}`),
    '',
    'Prompt for generate_video:',
    promptWithLock
  ]
  return lines.join('\n')
}

function summarizeUsage(usage) {
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

function logTokenUsage(label, summary) {
  if (!summary) return
  console.log(
    `[Higgsfield] ${label} tokens: in=${summary.input_tokens} out=${summary.output_tokens} cache_read=${summary.cache_read_input_tokens} cache_create=${summary.cache_creation_input_tokens} ≈ $${summary.cost_usd.toFixed(4)}`
  )
}

// Walk every text-bearing block in Claude's response (top-level text, plus
// any text inside mcp_tool_result content arrays) and look for the
// VIDEO_URL: marker the system prompt asked Claude to emit.
function extractVideoUrl(content) {
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

function extractError(content) {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      const m = block.text.match(/VIDEO_ERROR:\s*(.+)/i)
      if (m) return m[1].trim()
    }
  }
  return null
}

// generateVideo — drop-in replacement for byteplusGenerateVideo. Same input
// shape and same `{ videoUrl }` return shape so route.js doesn't need to know
// it switched providers.
export async function generateVideo({ prompt, imageUrls = [], duration = 5 } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('generateVideo: prompt must be a non-empty string')
  }
  const cleanImageUrls = (imageUrls || []).filter(
    (u) => typeof u === 'string' && u.length > 0
  )

  const { anthropicKey, higgsfieldToken } = getConfig()

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
    system: buildSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: buildUserMessage({
          prompt,
          imageUrls: cleanImageUrls,
          duration
        })
      }
    ]
  }

  const t0 = Date.now()
  console.log(
    `[Higgsfield] dispatching scene: refs=${cleanImageUrls.length} duration=${duration}s promptPreview="${prompt.slice(0, 80).replace(/\s+/g, ' ')}..."`
  )

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
      signal: AbortSignal.timeout(SCENE_TIMEOUT_MS)
    })
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    if (e?.name === 'TimeoutError' || /aborted/i.test(e?.message || '')) {
      throw new Error(
        `Higgsfield scene timed out after ${elapsed}s (limit ${SCENE_TIMEOUT_MS / 1000}s)`
      )
    }
    throw new Error(`Higgsfield request failed: ${e.message}`)
  }

  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  if (!res.ok) {
    console.error(
      `[Higgsfield] Anthropic API HTTP ${res.status} after ${elapsed}s: ${text.slice(0, 400)}`
    )
    throw new Error(
      `Anthropic API HTTP ${res.status}: ${text.slice(0, 200)}`
    )
  }

  const usage = summarizeUsage(data?.usage)
  logTokenUsage(`scene (${elapsed}s)`, usage)
  const usageWithElapsed = usage ? { ...usage, elapsed_s: Number(elapsed) } : null

  if (data?.stop_reason === 'error' || data?.type === 'error') {
    const msg = data?.error?.message || data?.error || 'unknown error'
    throw new Error(`Higgsfield/Claude error: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }

  const claudeError = extractError(data?.content)
  if (claudeError) {
    throw new Error(`Higgsfield generation reported failure: ${claudeError}`)
  }

  const videoUrl = extractVideoUrl(data?.content)
  if (!videoUrl) {
    const dump = JSON.stringify(data?.content || data || {}).slice(0, 600)
    console.error(
      `[Higgsfield] no VIDEO_URL in response after ${elapsed}s. stop_reason=${data?.stop_reason}. content preview: ${dump}`
    )
    throw new Error('Higgsfield returned no video URL')
  }

  console.log(`[Higgsfield] scene OK in ${elapsed}s → ${videoUrl.slice(0, 100)}`)
  return { videoUrl, usage: usageWithElapsed }
}

// uploadToHiggsfield — pass-through resolver matching the byteplus client's
// uploadToByteplusFiles. Higgsfield's MCP `media_upload` accepts public URLs
// directly, so all we need to do here is normalize relative paths to absolute
// https URLs. data: URIs are returned as-is and Claude will hand them to
// media_upload (which accepts inline base64).
export async function uploadToHiggsfield(input, opts = {}) {
  if (!input || typeof input !== 'string') {
    throw new Error('uploadToHiggsfield: input must be a non-empty string')
  }
  if (input.startsWith('http://') || input.startsWith('https://')) return input
  if (input.startsWith('data:')) return input
  if (input.startsWith('/')) {
    const base =
      opts.baseUrl ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      'https://ugc-studi-production.up.railway.app'
    return `${base.replace(/\/+$/, '')}${input}`
  }
  return input
}
