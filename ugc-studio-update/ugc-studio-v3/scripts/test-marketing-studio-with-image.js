// scripts/test-marketing-studio-with-image.js
//
// Test: can we get a Marketing Studio quality video by passing reference
// images directly via `medias`, instead of going through a product/avatar
// entity (URL fetch flow)?
//
// Flow:
//   Phase 1 (Claude / Higgsfield MCP):
//     media_upload(files=[woman, bottle])  →  presigned upload URLs + media_ids
//   Local:
//     PUT each image's bytes to its presigned URL
//   Phase 2 (Claude / Higgsfield MCP):
//     media_confirm(media_ids)
//     generate_video(model='marketing_studio_video', mode='UGC',
//                    medias=[{value:woman_id,role:image},{value:bottle_id,role:image}],
//                    duration=15, resolution='720p', aspect_ratio='9:16')
//     poll job_display → VIDEO_URL
//
// Why two phases:
//   media_upload returns a presigned URL; the actual byte PUT must happen
//   outside the MCP/Anthropic call. Claude has no PUT capability through MCP.
//
// Usage:
//   $env:HIGGSFIELD_TOKEN="..."
//   $env:ANTHROPIC_API_KEY="..."
//   node scripts/test-marketing-studio-with-image.js
//
// Exit codes:
//   0  → video URL returned
//   1  → env vars missing / image files missing
//   2  → Anthropic API HTTP / connection error
//   3  → Higgsfield reported a generation failure
//   4  → Tool was never called
//   5  → Tool called but no VIDEO_URL surfaced (timeout / partial result)
//   6  → Phase 1 did not surface UPLOAD_URLS
//   7  → S3 PUT failed

import fs from 'node:fs'
import path from 'node:path'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA = 'mcp-client-2025-04-04'

const MCP_SERVER_URL = 'https://mcp.higgsfield.ai/mcp'
const MCP_SERVER_NAME = 'higgsfield'

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

// 30 minutes — generate_video on marketing_studio_video can take a while.
const TIMEOUT_MS = 30 * 60 * 1000
const PHASE1_TIMEOUT_MS = 2 * 60 * 1000

// Local image paths (override via env vars if needed).
const WOMAN_PATH = process.env.WOMAN_IMAGE || 'C:\\Users\\franko\\higgsfield-test\\woman.jpg'
const BOTTLE_PATH = process.env.BOTTLE_IMAGE || 'C:\\Users\\franko\\higgsfield-test\\bottle.jpg'

const VIDEO_PROMPT = [
  'Create a 15-second UGC perfume video using marketing_studio_video model.',
  'The video shows an Israeli woman (reference image 1) using a Shemesh perfume (reference image 2).',
  '4 beats with hard cuts:',
  '- Beat 1 (0-4s): Woman holds empty perfume bottle, disappointed',
  '- Beat 2 (4-7s): Product hero shot of Shemesh bottle alone, no person',
  '- Beat 3 (7-11s): Woman sprays Shemesh on wrist, smells, eyes close in pleasant surprise',
  '- Beat 4 (11-15s): Woman holds Shemesh close to chest, confident smile',
  'NO LIP MOVEMENT - lips closed throughout (voiceover added externally).',
  'Authentic UGC iPhone selfie style.'
].join('\n')

function fail(code, msg) {
  console.error(`\n❌ ${msg}`)
  process.exit(code)
}
function ok(msg) {
  console.log(`\n✅ ${msg}`)
  process.exit(0)
}

// ---- Pre-flight checks ----------------------------------------------------

const anthropicKey = process.env.ANTHROPIC_API_KEY || ''
const higgsfieldToken = process.env.HIGGSFIELD_TOKEN || ''

if (!anthropicKey) fail(1, 'ANTHROPIC_API_KEY is not set')
if (!higgsfieldToken) fail(1, 'HIGGSFIELD_TOKEN is not set')

for (const p of [WOMAN_PATH, BOTTLE_PATH]) {
  if (!fs.existsSync(p)) {
    fail(
      1,
      `Image file not found: ${p}\n` +
        `   Override paths via env: $env:WOMAN_IMAGE=... ; $env:BOTTLE_IMAGE=...`
    )
  }
}

const womanBytes = fs.readFileSync(WOMAN_PATH)
const bottleBytes = fs.readFileSync(BOTTLE_PATH)
const womanFilename = path.basename(WOMAN_PATH)
const bottleFilename = path.basename(BOTTLE_PATH)

function inferContentType(filename) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

const womanContentType = inferContentType(womanFilename)
const bottleContentType = inferContentType(bottleFilename)

console.log('--- Marketing Studio with reference images (no product entity) ---')
console.log(`ANTHROPIC_API_KEY: ${anthropicKey.slice(0, 10)}... (${anthropicKey.length} chars)`)
console.log(`HIGGSFIELD_TOKEN:  ${higgsfieldToken.slice(0, 10)}... (${higgsfieldToken.length} chars)`)
console.log(`Woman image:  ${WOMAN_PATH} (${womanBytes.length} bytes, ${womanContentType})`)
console.log(`Bottle image: ${BOTTLE_PATH} (${bottleBytes.length} bytes, ${bottleContentType})`)
console.log(`MCP server:   ${MCP_SERVER_URL}`)
console.log(`Model:        ${CLAUDE_MODEL}`)
console.log(`Phase 2 timeout: ${TIMEOUT_MS / 60000} min`)
console.log('')

// ---- Phase 1: get presigned upload URLs -----------------------------------

console.log('=== Phase 1: media_upload (get presigned URLs) ===')

const phase1System = [
  'You have access to the Higgsfield MCP server.',
  '',
  'Call `media_upload` ONCE with these exact arguments:',
  '  {',
  '    "files": [',
  `      { "filename": "${womanFilename}",  "content_type": "${womanContentType}" },`,
  `      { "filename": "${bottleFilename}", "content_type": "${bottleContentType}" }`,
  '    ]',
  '  }',
  '',
  'The tool returns presigned upload URLs and media IDs for both files. Reply with EXACTLY one line, prefixed `UPLOAD_URLS:`, containing a single JSON object in this shape:',
  '  UPLOAD_URLS: {"woman":{"media_id":"...","upload_url":"..."},"bottle":{"media_id":"...","upload_url":"..."}}',
  '',
  `Match by filename: the entry with filename ${womanFilename} is "woman", the entry with filename ${bottleFilename} is "bottle".`,
  'No other tools. No commentary. If media_upload errors, reply with `UPLOAD_ERROR: <reason>`.'
].join('\n')

const phase1Body = {
  model: CLAUDE_MODEL,
  max_tokens: 2048,
  mcp_servers: [
    {
      type: 'url',
      url: MCP_SERVER_URL,
      name: MCP_SERVER_NAME,
      authorization_token: higgsfieldToken
    }
  ],
  system: phase1System,
  messages: [
    {
      role: 'user',
      content: `Get presigned upload URLs for ${womanFilename} and ${bottleFilename}.`
    }
  ]
}

const t1 = Date.now()
let phase1Res
try {
  phase1Res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_BETA,
      'content-type': 'application/json'
    },
    body: JSON.stringify(phase1Body),
    signal: AbortSignal.timeout(PHASE1_TIMEOUT_MS)
  })
} catch (e) {
  fail(2, `Phase 1 fetch failed: ${e?.name}: ${e?.message}`)
}

const phase1Text = await phase1Res.text()
let phase1Data
try {
  phase1Data = JSON.parse(phase1Text)
} catch {
  fail(2, `Phase 1 non-JSON (HTTP ${phase1Res.status}): ${phase1Text.slice(0, 600)}`)
}
if (!phase1Res.ok) {
  console.error(JSON.stringify(phase1Data, null, 2).slice(0, 2000))
  fail(2, `Phase 1 Anthropic HTTP ${phase1Res.status}`)
}
console.log(`Phase 1: HTTP ${phase1Res.status} in ${((Date.now() - t1) / 1000).toFixed(1)}s, stop_reason=${phase1Data?.stop_reason}`)

let phase1Assistant = ''
for (const block of phase1Data?.content || []) {
  if (block?.type === 'text') phase1Assistant += block.text + '\n'
  if (block?.type === 'mcp_tool_use') {
    console.log(`🔧 ${block.server_name}.${block.name} input=${JSON.stringify(block.input || {}).slice(0, 300)}`)
  }
  if (block?.type === 'mcp_tool_result') {
    const inner = Array.isArray(block.content)
      ? block.content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('\n')
      : ''
    if (block.is_error) console.log(`⚠️  Tool error: ${inner.slice(0, 500)}`)
    else console.log(`📦 Tool result: ${inner.slice(0, 500)}`)
  }
}
console.log('--- Phase 1 assistant text ---')
console.log(phase1Assistant.trim() || '(no text)')
console.log('------------------------------')

const uploadUrlsMatch = phase1Assistant.match(/UPLOAD_URLS:\s*(\{[\s\S]+?\})\s*$/m)
const uploadErrorMatch = phase1Assistant.match(/UPLOAD_ERROR:\s*(.+)/i)
if (uploadErrorMatch) fail(3, `media_upload errored: ${uploadErrorMatch[1].trim()}`)
if (!uploadUrlsMatch) fail(6, 'Phase 1: no UPLOAD_URLS line in assistant text. See dump above.')

let uploads
try {
  uploads = JSON.parse(uploadUrlsMatch[1])
} catch (e) {
  fail(6, `Phase 1: UPLOAD_URLS payload not valid JSON: ${e.message}`)
}
const womanUpload = uploads?.woman
const bottleUpload = uploads?.bottle
if (!womanUpload?.media_id || !womanUpload?.upload_url) fail(6, 'Phase 1: missing woman.media_id/upload_url')
if (!bottleUpload?.media_id || !bottleUpload?.upload_url) fail(6, 'Phase 1: missing bottle.media_id/upload_url')

console.log(`✓ woman  media_id=${womanUpload.media_id}`)
console.log(`✓ bottle media_id=${bottleUpload.media_id}`)

// ---- Local: PUT bytes to presigned URLs -----------------------------------

console.log('\n=== Local: PUT image bytes to presigned URLs ===')

async function putBytes(label, url, bytes, contentType) {
  const t = Date.now()
  let res
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: bytes,
      signal: AbortSignal.timeout(2 * 60 * 1000)
    })
  } catch (e) {
    fail(7, `PUT ${label} failed: ${e?.name}: ${e?.message}`)
  }
  const elapsed = ((Date.now() - t) / 1000).toFixed(1)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    fail(7, `PUT ${label} HTTP ${res.status} in ${elapsed}s: ${body.slice(0, 400)}`)
  }
  console.log(`✓ PUT ${label}: HTTP ${res.status} in ${elapsed}s (${bytes.length} bytes)`)
}

await putBytes('woman', womanUpload.upload_url, womanBytes, womanContentType)
await putBytes('bottle', bottleUpload.upload_url, bottleBytes, bottleContentType)

// ---- Phase 2: confirm + generate + poll -----------------------------------

console.log('\n=== Phase 2: media_confirm + generate_video + poll ===')

const phase2System = [
  'You have access to the Higgsfield MCP server. Generate ONE Marketing Studio video.',
  '',
  'Steps (in order, no skips):',
  '',
  `  1. Call \`media_confirm\` with: { "type": "image", "media_ids": ["${womanUpload.media_id}", "${bottleUpload.media_id}"] }`,
  '',
  '  2. Call `generate_video` with EXACTLY this params object:',
  '       {',
  '         "model": "marketing_studio_video",',
  `         "prompt": ${JSON.stringify(VIDEO_PROMPT)},`,
  '         "medias": [',
  `           { "value": "${womanUpload.media_id}",  "role": "image" },`,
  `           { "value": "${bottleUpload.media_id}", "role": "image" }`,
  '         ],',
  '         "mode": "UGC",',
  '         "duration": 15,',
  '         "resolution": "720p",',
  '         "aspect_ratio": "9:16"',
  '       }',
  '     The first reference image is the woman (subject). The second is the Shemesh perfume bottle (product).',
  '',
  '  3. Poll the job until it is completed/succeeded or failed. Use `job_display` (or `show_generations` if needed) with the job_id returned by generate_video. Do NOT stop early. Keep polling until the job has a final status.',
  '',
  '  4. When done, reply with EXACTLY one line:',
  '       VIDEO_URL: <https url to the mp4>',
  '     If generation fails, reply with EXACTLY one line:',
  '       VIDEO_ERROR: <reason from Higgsfield>',
  '',
  'No commentary, no extra tools, no other models. If a tool errors, surface the raw error text inside VIDEO_ERROR.'
].join('\n')

const phase2Body = {
  model: CLAUDE_MODEL,
  max_tokens: 8192,
  mcp_servers: [
    {
      type: 'url',
      url: MCP_SERVER_URL,
      name: MCP_SERVER_NAME,
      authorization_token: higgsfieldToken
    }
  ],
  system: phase2System,
  messages: [
    {
      role: 'user',
      content:
        'Confirm the two uploaded images, generate the 15s UGC perfume video, poll until done, and return the VIDEO_URL.'
    }
  ]
}

const heartbeatStart = Date.now()
const heartbeat = setInterval(() => {
  const elapsed = ((Date.now() - heartbeatStart) / 1000).toFixed(0)
  console.log(`[heartbeat] phase 2 still waiting on Anthropic API... ${elapsed}s elapsed`)
}, 30_000)

const t2 = Date.now()
let phase2Res
try {
  phase2Res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_BETA,
      'content-type': 'application/json'
    },
    body: JSON.stringify(phase2Body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
} catch (e) {
  clearInterval(heartbeat)
  const elapsed = ((Date.now() - t2) / 1000).toFixed(1)
  console.error('\n--- Phase 2 fetch threw before HTTP response ---')
  console.error(`elapsed:  ${elapsed}s`)
  console.error(`name:     ${e?.name}`)
  console.error(`message:  ${e?.message}`)
  console.error(`code:     ${e?.code || '(none)'}`)
  console.error(`cause:    ${e?.cause ? JSON.stringify(e.cause, Object.getOwnPropertyNames(e.cause)) : '(none)'}`)
  if (e?.stack) console.error(`stack:\n${e.stack}`)
  fail(2, `Phase 2 Anthropic API connection error: ${e?.name || 'Error'}: ${e?.message || e}`)
}
clearInterval(heartbeat)

const elapsed = ((Date.now() - t2) / 1000).toFixed(1)
console.log(`\nPhase 2: HTTP ${phase2Res.status} in ${elapsed}s`)

const phase2Text = await phase2Res.text()
let phase2Data
try {
  phase2Data = JSON.parse(phase2Text)
} catch {
  fail(2, `Phase 2 non-JSON (HTTP ${phase2Res.status}, ${phase2Text.length} bytes): ${phase2Text.slice(0, 800)}`)
}
if (!phase2Res.ok) {
  console.error(JSON.stringify(phase2Data, null, 2).slice(0, 4000))
  fail(2, `Phase 2 Anthropic HTTP ${phase2Res.status}: ${phase2Data?.error?.message || ''}`)
}

if (phase2Data?.usage) {
  const inTok = phase2Data.usage.input_tokens || 0
  const outTok = phase2Data.usage.output_tokens || 0
  const cost = (inTok / 1_000_000) * 3 + (outTok / 1_000_000) * 15
  console.log(`Tokens: in=${inTok} out=${outTok} ≈ $${cost.toFixed(4)}`)
}
console.log(`stop_reason: ${phase2Data?.stop_reason}`)
console.log(`content blocks: ${Array.isArray(phase2Data?.content) ? phase2Data.content.length : 0}`)
console.log('')

let toolCalls = 0
let toolErrors = 0
let assistantText = ''
const toolResultTexts = []

for (const block of phase2Data?.content || []) {
  if (block?.type === 'text' && typeof block.text === 'string') {
    assistantText += block.text + '\n'
  }
  if (block?.type === 'mcp_tool_use') {
    toolCalls++
    console.log(`🔧 ${block.server_name || '?'}.${block.name || '?'} input=${JSON.stringify(block.input || {}).slice(0, 400)}`)
  }
  if (block?.type === 'mcp_tool_result') {
    const inner = Array.isArray(block.content)
      ? block.content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('\n')
      : ''
    toolResultTexts.push(inner)
    if (block.is_error) {
      toolErrors++
      console.log(`⚠️  Tool error: ${inner.slice(0, 600)}`)
    } else {
      console.log(`📦 Tool result: ${inner.slice(0, 600)}`)
    }
  }
}

console.log('')
console.log('--- Phase 2 assistant text ---')
console.log(assistantText.trim() || '(no text)')
console.log('------------------------------')
console.log(`Tool calls: ${toolCalls}, tool errors: ${toolErrors}`)

const urlMatch = assistantText.match(/VIDEO_URL:\s*(https?:\/\/\S+)/i)
const errorMatch = assistantText.match(/VIDEO_ERROR:\s*(.+)/i)

if (urlMatch) {
  ok(`Marketing Studio video generated. VIDEO_URL: ${urlMatch[1].replace(/[)>\].,;'"]+$/, '')}`)
}
if (errorMatch) {
  fail(3, `Higgsfield reported failure: ${errorMatch[1].trim()}`)
}

const fallbackHaystack = assistantText + '\n' + toolResultTexts.join('\n')
const mp4Match = fallbackHaystack.match(/https?:\/\/\S+\.mp4(?:\?\S*)?/i)
if (mp4Match) {
  ok(`Video URL found via fallback regex: ${mp4Match[0].replace(/[)>\].,;'"]+$/, '')}`)
}

if (toolCalls === 0) {
  fail(4, 'Claude never invoked any MCP tool in phase 2. See dump above.')
}

console.error('\n--- Phase 2 full response dump (truncated) ---')
console.error(JSON.stringify(phase2Data, null, 2).slice(0, 4000))
fail(5, 'Tool was called but no VIDEO_URL surfaced. Likely the polling timed out or the MCP connector dropped before the job finished.')
