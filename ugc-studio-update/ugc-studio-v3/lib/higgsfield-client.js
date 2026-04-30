// Higgsfield MCP client — Seedance 2.0 video generation.
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
// The HTTP plumbing, pause_turn continuation loop, token accounting, and
// VIDEO_URL extraction live in lib/_anthropic-mcp-shared.js — shared with
// lib/marketing-studio-client.js so a fix to either flows to both.
//
// Required env:
//   - ANTHROPIC_API_KEY  (already set for the rest of route.js)
//   - HIGGSFIELD_TOKEN   (Higgsfield Personal Access Token / OAuth token —
//                         passed through to the MCP server as
//                         `authorization_token` on every request)

import {
  MCP_SERVER_URL,
  MCP_SERVER_NAME,
  CLAUDE_MODEL,
  MAX_TOKENS_PER_TURN,
  getMcpConfig,
  isMcpConfigured,
  summarizeUsage,
  logTokenUsage,
  extractVideoUrl,
  extractError,
  callAnthropicWithPauseTurn
} from './_anthropic-mcp-shared.js'

// Each scene gets its own 20-minute window. Higgsfield queue + render is
// usually 5–10 min; 20 min covers the long tail without holding the whole job
// hostage. The four scenes run in parallel from route.js, so wallclock for the
// full job is bounded by the slowest scene, not the sum.
const SCENE_TIMEOUT_MS = 20 * 60 * 1000

// Single 15-second video render takes longer than a 5s scene (more frames +
// often deeper queue position). 45 min covers the worst case without
// abandoning a job that is actually about to finish.
const FULL_VIDEO_TIMEOUT_MS = 45 * 60 * 1000

// Hard rule that keeps prepending no matter what wrappedKlingPrompt contains.
// The first generation drifted into a talking-head clip; this is the belt-and-
// suspenders fix to make sure every Seedance prompt starts with the lip-lock.
const NO_LIP_PREFIX =
  'ABSOLUTE RULE: The person never opens their mouth. Lips stay completely sealed throughout the entire clip. No talking, no singing, no mouth movement at all. Voiceover is added externally — the visual must be silent. All emotion is conveyed only through the eyes, eyebrows, and CLOSED-MOUTH micro-expressions. '

export function isHiggsfieldConfigured() {
  return isMcpConfigured()
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

  const { higgsfieldToken } = getMcpConfig()

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_PER_TURN,
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

  console.log(
    `[Higgsfield] dispatching scene: refs=${cleanImageUrls.length} duration=${duration}s promptPreview="${prompt.slice(0, 80).replace(/\s+/g, ' ')}..."`
  )

  const { data, elapsed } = await callAnthropicWithPauseTurn({
    body,
    timeoutMs: SCENE_TIMEOUT_MS,
    provider: 'Higgsfield',
    label: 'scene'
  })

  const usage = summarizeUsage(data?.usage)
  logTokenUsage('Higgsfield', `scene (${elapsed}s)`, usage)
  const usageWithElapsed = usage ? { ...usage, elapsed_s: Number(elapsed) } : null

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

// generateFullVideo — single-call replacement for the per-scene loop. Sends
// ONE merged 15-second prompt with 3 internal beats and both reference images
// (avatar + product) instead of four parallel 5-second calls. This avoids both
// the Anthropic 30K-tok/min rate limit (4 concurrent calls were tripping it)
// and the "copyright restrictions" rejections we saw when four nearly
// identical prompts hit content moderation in the same minute.
//
// Same return shape as generateVideo so callers stay simple.
export async function generateFullVideo({ prompt, imageUrls = [], duration = 15 } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('generateFullVideo: prompt must be a non-empty string')
  }
  const cleanImageUrls = (imageUrls || []).filter(
    (u) => typeof u === 'string' && u.length > 0
  )

  const { higgsfieldToken } = getMcpConfig()

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_PER_TURN,
    mcp_servers: [
      {
        type: 'url',
        url: MCP_SERVER_URL,
        name: MCP_SERVER_NAME,
        authorization_token: higgsfieldToken
      }
    ],
    system: buildSystemPrompt(),
    // No NO_LIP_PREFIX wrap here — the merged prompt built in route.js
    // already declares the lip-lock once, cleanly, near the top. Wrapping
    // again would duplicate the rule and re-trigger the moderation flag we
    // saw with the 4-call layout.
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

  console.log(
    `[Higgsfield] dispatching full video: refs=${cleanImageUrls.length} duration=${duration}s promptLen=${prompt.length} promptPreview="${prompt.slice(0, 100).replace(/\s+/g, ' ')}..."`
  )

  const { data, elapsed } = await callAnthropicWithPauseTurn({
    body,
    timeoutMs: FULL_VIDEO_TIMEOUT_MS,
    provider: 'Higgsfield',
    label: 'full video'
  })

  const usage = summarizeUsage(data?.usage)
  logTokenUsage('Higgsfield', `full video (${elapsed}s)`, usage)
  const usageWithElapsed = usage ? { ...usage, elapsed_s: Number(elapsed) } : null

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

  console.log(`[Higgsfield] full video OK in ${elapsed}s → ${videoUrl.slice(0, 100)}`)
  return { videoUrl, usage: usageWithElapsed }
}

// uploadToHiggsfield — resolves any input shape into a fetchable HTTPS URL.
// http(s) URLs pass through unchanged; relative paths get the deploy origin
// prepended; data: URIs (custom user uploads from /api/upload) are stashed
// in the in-process image cache and returned as /api/temp-image/<id> URLs.
//
// Why we no longer pass data: URIs through to the prompt: Anthropic counts
// the user-message text against the 200K-token input limit, and a single
// 1MP base64-encoded image is ~150K chars ≈ 50-100K tokens. Two reference
// images (avatar + product) blew past 200K and got rejected with HTTP 400.
// By converting data: URIs to URLs upfront, the prompt only carries small
// strings and the MCP `media_upload` tool fetches the actual bytes from us.
import { dataUriToPublicUrl } from './image-cache.js'

export async function uploadToHiggsfield(input, opts = {}) {
  if (!input || typeof input !== 'string') {
    throw new Error('uploadToHiggsfield: input must be a non-empty string')
  }
  if (input.startsWith('http://') || input.startsWith('https://')) return input
  if (input.startsWith('data:')) {
    const url = dataUriToPublicUrl(input, opts.baseUrl)
    if (url && url.startsWith('http')) return url
    // Fallback — should never trigger, but keeps the old behavior so a
    // malformed data: URI doesn't take down the whole flow.
    return input
  }
  if (input.startsWith('/')) {
    const base =
      opts.baseUrl ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      'https://ugc-studi-production.up.railway.app'
    return `${base.replace(/\/+$/, '')}${input}`
  }
  return input
}
