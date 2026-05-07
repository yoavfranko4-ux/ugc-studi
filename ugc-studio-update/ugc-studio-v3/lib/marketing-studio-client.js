// Marketing Studio MCP client — Higgsfield's `marketing_studio_video` model.
//
// This is the higher-quality UGC path. Sibling of lib/higgsfield-client.js
// (which uses `seedance_2_0`). Both clients share HTTP plumbing, pause_turn
// continuation, token accounting, and VIDEO_URL extraction via
// lib/_anthropic-mcp-shared.js.
//
// Surface:
//   generateMarketingStudioVideo({ avatarUrl, productUrl, prompt, duration })
//     → { videoUrl, usage }
//
// Why two reference URLs (avatar + product) instead of a generic imageUrls
// array: marketing_studio_video's UGC mode is built around exactly these two
// inputs (subject + product). Forcing the call site to label them removes a
// whole class of "Image 1 vs Image 2" ordering bugs in the prompt.
//
// Required env (same as higgsfield-client.js):
//   - ANTHROPIC_API_KEY
//   - HIGGSFIELD_TOKEN

import {
  MCP_SERVER_URL,
  MCP_SERVER_NAME,
  CLAUDE_MODEL,
  MAX_TOKENS_PER_TURN,
  isMcpConfigured,
  summarizeUsage,
  logTokenUsage,
  extractVideoUrl,
  extractError,
  callAnthropicWithPauseTurn
} from './_anthropic-mcp-shared.js'
import { getValidAccessToken } from './higgsfield-auth.js'

// 30 minutes — Marketing Studio renders are typically 5-15 min. 30 min is
// the user-requested upper bound; longer than that and we'd rather fail and
// fall back to Seedance than keep a Yotzr job hostage.
const FULL_VIDEO_TIMEOUT_MS = 30 * 60 * 1000

// Heartbeat cadence — Railway logs need a periodic line so a 10-15 min wait
// looks like progress, not a hang. Matches the test script.
const HEARTBEAT_MS = 30_000

// Belt-and-suspenders lip-lock prefix. The merged 15s prompt built in
// route.js already declares the lip-lock once, but if a caller hands us a
// raw prompt without it we prepend the rule so generate_video never drifts
// into a talking-head clip. Skipped when the prompt already starts with
// "ABSOLUTE RULE" to avoid duplication (which we saw trip moderation in
// the old 4-call layout).
const NO_LIP_PREFIX =
  'ABSOLUTE RULE: The person never opens their mouth. Lips stay completely sealed throughout the entire clip. No talking, no singing, no mouth movement at all. Voiceover is added externally — the visual must be silent. All emotion is conveyed only through the eyes, eyebrows, and CLOSED-MOUTH micro-expressions. '

// Marketing Studio mode slugs. Mirrored from
// scripts/_skills-import/higgsfield-generate/references/marketing-modes.md.
// TODO: fix slugs - tutorial→ugc_how_to, hyper_motion→product_showcase
// (per official Higgsfield skill, references/marketing-modes.md)
export const MODES = Object.freeze([
  'ugc',
  'tutorial',
  'ugc_unboxing',
  'hyper_motion',
  'product_review',
  'tv_spot',
  'wild_card',
  'ugc_virtual_try_on',
  'virtual_try_on'
])

const MODE_DESCRIPTIONS = {
  ugc:                'Default. Casual, organic, presenter-led',
  tutorial:           'How-to / step-by-step demonstration',
  ugc_unboxing:       "'Just got this in the mail' reveal energy",
  hyper_motion:       'Clean polished product highlight',
  product_review:     'Presenter giving honest opinion',
  tv_spot:            'Broadcast-style commercial',
  wild_card:          'Experimental, model picks the vibe',
  ugc_virtual_try_on: 'Trying on clothing — UGC vibe',
  virtual_try_on:     'Trying on clothing — polished'
}

export function isMarketingStudioConfigured() {
  return isMcpConfigured()
}

function buildSystemPrompt() {
  return [
    'You are a video-generation orchestrator following the Higgsfield Marketing Studio Director skill (UGC preset). You have access to the Higgsfield MCP server, which exposes `media_upload`, `generate_video`, and `job_display` (among other tools).',
    '',
    '=== Marketing Studio Director — UGC preset rules ===',
    'Authentic phone-shot UGC look. The video MUST follow these constraints:',
    '  - Single continuous handheld take, selfie angle by default, eye-level.',
    '  - Phone-native framing — feels like a real iPhone selfie, not a polished ad.',
    '  - Real-world environment, natural and imperfect light (no studio lighting, no color grading).',
    '  - Avatar addresses the camera with natural gestures; product is held in frame and clearly visible.',
    '  - 15 seconds maximum (HARD CAP — the platform enforces this).',
    '  - 4 implicit beats expressed through emotion shifts and micro-movements, NOT through hard cuts. The cut feel comes from the prompt structure; the camera stays continuous.',
    '  - One idea per video, ~20-25 words of actual visual description per beat.',
    '  - NO age descriptors. Never write "boy", "girl", "child", "young", "teen", "kid" or similar. Describe the person by visible traits only (e.g. "the woman in the reference image").',
    '  - Casual, conversational delivery — never staged, never commercial-y.',
    '',
    '=== Tool plan (execute in order, no skips) ===',
    '  1. Upload BOTH reference image URLs (avatar first, product second) via `media_upload` and collect the resulting media ids. Use the URLs exactly as the user provides them.',
    '  2. Call `generate_video` with these EXACT params:',
    '       model: "marketing_studio_video"',
    '       mode: "UGC"',
    '       duration: <user-requested seconds, default 15 — never above 15>',
    '       resolution: "720p"',
    '       aspect_ratio: "9:16"',
    '       prompt: <the user-provided prompt, unchanged>',
    '       medias: [',
    '         { value: <avatar media_id>,  role: "image" },',
    '         { value: <product media_id>, role: "image" }',
    '       ]',
    '  3. Poll the job (use `job_display`, or `show_generations` if needed) until the status is `completed`, `succeeded`, or `failed`. Do NOT stop early. Keep polling until a final status is reached.',
    '  4. Return ONLY the final video URL on its own line, prefixed exactly with `VIDEO_URL:` (e.g. `VIDEO_URL: https://...`). If generation fails, return `VIDEO_ERROR: <reason>` instead. No other commentary.',
    '',
    '=== Critical content rules ===',
    'These are baked into the user prompt already, but if for any reason the user prompt does not contain a lip-lock instruction, prepend one before calling `generate_video`:',
    '  - The person\'s mouth NEVER opens. Lips stay completely sealed for the entire clip.',
    '  - NO talking, NO singing, NO mouth movement. The audio track will be added externally; the visual must be silent.',
    '  - All emotion comes from the eyes, eyebrows, and closed-mouth expressions only.',
    '',
    'Do not ask the user clarifying questions. Do not narrate your steps. Do not call any other generation models. Just execute and return the final URL.'
  ].join('\n')
}

function buildUserMessage({ avatarUrl, productUrl, prompt, duration }) {
  const promptWithLock = prompt.startsWith('ABSOLUTE RULE')
    ? prompt
    : NO_LIP_PREFIX + prompt
  const lines = [
    `Generate a ${duration}-second 9:16 720p Marketing Studio UGC video.`,
    '',
    'Reference images (upload BOTH via media_upload first, in this order, then pass them as `medias` to generate_video with role="image"):',
    `  1. Avatar (subject):  ${avatarUrl}`,
    `  2. Product:           ${productUrl}`,
    '',
    'generate_video params (use EXACTLY these values):',
    '  model: marketing_studio_video',
    '  mode: UGC',
    `  duration: ${duration}`,
    '  resolution: 720p',
    '  aspect_ratio: 9:16',
    '  generate_audio: false',
    '  medias: [{ value: <avatar media_id>, role: "image" }, { value: <product media_id>, role: "image" }]',
    '',
    'Prompt for generate_video:',
    promptWithLock
  ]
  return lines.join('\n')
}

export async function generateMarketingStudioVideo({
  avatarUrl,
  productUrl,
  prompt,
  duration = 15,
  mode = 'ugc'
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('generateMarketingStudioVideo: prompt must be a non-empty string')
  }
  if (!avatarUrl || typeof avatarUrl !== 'string') {
    throw new Error('generateMarketingStudioVideo: avatarUrl must be a non-empty string')
  }
  if (!productUrl || typeof productUrl !== 'string') {
    throw new Error('generateMarketingStudioVideo: productUrl must be a non-empty string')
  }
  if (!MODES.includes(mode)) {
    throw new Error(
      `generateMarketingStudioVideo: invalid mode "${mode}". Allowed: ${MODES.join(', ')}`
    )
  }

  const higgsfieldToken = await getValidAccessToken()

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
        content: buildUserMessage({ avatarUrl, productUrl, prompt, duration })
      }
    ]
  }

  console.log(
    `[MarketingStudio] Full ${duration}s video: 2 refs, prompt length=${prompt.length}`
  )
  console.log(
    `[MarketingStudio] dispatching: model=marketing_studio_video mode=UGC res=720p ratio=9:16 duration=${duration}s avatar=${avatarUrl.slice(0, 80)} product=${productUrl.slice(0, 80)}`
  )

  const { data, elapsed } = await callAnthropicWithPauseTurn({
    body,
    timeoutMs: FULL_VIDEO_TIMEOUT_MS,
    provider: 'MarketingStudio',
    label: 'full video',
    heartbeatMs: HEARTBEAT_MS
  })

  const usage = summarizeUsage(data?.usage)
  logTokenUsage('MarketingStudio', `full video (${elapsed}s)`, usage)
  const usageWithElapsed = usage ? { ...usage, elapsed_s: Number(elapsed) } : null

  const claudeError = extractError(data?.content)
  if (claudeError) {
    throw new Error(`Marketing Studio generation reported failure: ${claudeError}`)
  }

  const videoUrl = extractVideoUrl(data?.content)
  if (!videoUrl) {
    const dump = JSON.stringify(data?.content || data || {}).slice(0, 600)
    console.error(
      `[MarketingStudio] no VIDEO_URL in response after ${elapsed}s. stop_reason=${data?.stop_reason}. content preview: ${dump}`
    )
    throw new Error('Marketing Studio returned no video URL')
  }

  console.log(`[MarketingStudio] full video OK in ${elapsed}s → ${videoUrl.slice(0, 100)}`)
  return { videoUrl, usage: usageWithElapsed }
}
