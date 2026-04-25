// Seedance 2.0 image-to-video integration with native lipsync support.
//
// Replaces the previous Kling 3.0 pipeline. Key differences:
//   - 8-second duration (vs Kling's 5s) — single-take 4-scene video totals
//     ~32s of footage to cover the joined Hebrew voiceover.
//   - Native lipsync via the `audio_url` input. When the scene is a
//     speaking scene (1 and 4), pass the per-scene ElevenLabs MP3 URL and
//     Seedance moves the avatar's lips with the Hebrew speech. For silent
//     scenes (2 product-only, 3 silent action) we omit audio_url so the
//     mouth stays closed.
//   - Natural-language prompt style instead of Kling's stacked
//     physics/lock blocks. Templates live in this module so the script
//     generator doesn't have to think about video-model-specific phrasing.

import { fal } from '@fal-ai/client'
import { execFile, execSync } from 'child_process'
import { promisify } from 'util'
import { writeFile, readFile, mkdir, rm } from 'fs/promises'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import { getActorDisplayName } from './script-pipeline.js'

const require = createRequire(import.meta.url)
let ffmpegStaticPath = null
try { ffmpegStaticPath = require('ffmpeg-static') } catch {}
const execFileAsync = promisify(execFile)

function resolveFfprobePath() {
  try {
    const w = execSync('which ffprobe', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (w && fs.existsSync(w)) return w
  } catch {}
  for (const p of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/run/current-system/sw/bin/ffprobe', '/root/.nix-profile/bin/ffprobe']) {
    if (fs.existsSync(p)) return p
  }
  try {
    const found = execSync("find /nix/store -maxdepth 4 -type f -name ffprobe 2>/dev/null | head -1", { encoding: 'utf8', shell: '/bin/sh' }).trim()
    if (found && fs.existsSync(found)) return found
  } catch {}
  return null
}
const ffprobePath = resolveFfprobePath()

// Seedance defaults to an 8-second clip per scene. Total 4-scene footage
// is ~32s; ElevenLabs joined voiceover lands around 18-22s, so the editor
// either trims or letterboxes the final composition.
export const SCENE_DURATIONS = [8, 8, 8, 8]
export const SEEDANCE_ENDPOINT = 'bytedance/seedance-2.0/fast/image-to-video'

// PRODUCT_LOCK markers — appended to scene prompts that show the product so
// Seedance preserves identity from the reference NB frame. Same intent as
// the old Kling product-lock, just in natural language for Seedance.
export const PRODUCT_LOCK = (
  'The product preserves its exact appearance from the reference frame — '
  + 'same shape, color, logo, text, and material throughout the clip. '
  + 'Do not morph the product into a similar-but-different item.'
)

export const KIPPAH_LOCK = (
  'The kippah stays firmly on the head with its embroidered design and color '
  + 'visible and unchanged in every frame.'
)

function isKippahProduct(productName) {
  if (!productName) return false
  const n = productName.toLowerCase()
  return /כיפה|כיפות|יארמולקה|kipah|yarmulke/.test(n)
}

// Build a per-scene Seedance prompt in natural language.
//
//   opts:
//     sceneIdx     — 0..3
//     actorId      — 'daniel' | 'noa' | 'maya' | null (custom upload)
//     productName  — Hebrew/English product name (used in prompt + locks)
//     hebrewLine   — the Hebrew script line for this scene (for speaking scenes)
//     videoType    — 'ugc' | 'business'
//     businessName — for business mode scene 4 success-context
//
// Returns the natural-language Seedance prompt string.
export function buildSeedancePrompt(opts) {
  const {
    sceneIdx,
    actorId = null,
    productName = '',
    hebrewLine = '',
    videoType = 'ugc',
    businessName = '',
  } = opts || {}

  const actor = getActorDisplayName(actorId)
  const productLock = isKippahProduct(productName)
    ? `${PRODUCT_LOCK} ${KIPPAH_LOCK}`
    : PRODUCT_LOCK

  if (videoType === 'business') {
    return buildBusinessSeedancePrompt({ sceneIdx, actor, businessName, productLock })
  }

  // UGC mode
  switch (sceneIdx) {
    case 0: {
      // Speaking — pain
      return (
        `${actor} in a casual selfie video, speaking directly to camera with a natural frustrated expression. `
        + `Visible emotion of mild pain or frustration about an everyday struggle. `
        + `Lips move naturally with the Hebrew speech "${hebrewLine}". `
        + `Indoor home setting, soft natural light, iPhone front camera handheld feel. `
        + `Real human texture, not AI. No product visible.`
      )
    }
    case 1: {
      // Product only
      return (
        `Close-up product shot of ${productName}. Subtle motion — slight rotation or gentle pull-focus. `
        + `Natural surface lighting from a window, the product fills the frame on a real home surface. `
        + `No people in frame, no hands, no face. ${productLock}`
      )
    }
    case 2: {
      // Silent action — using/wearing/holding the product
      return (
        `${actor} using ${productName} with focused concentration. Mouth closed, no speaking, no dialogue. `
        + `Hands engaged with the product, fingers anchored to it with a natural grip. `
        + `Natural home setting, captured as if mid-action — authentic and unposed. `
        + `${productLock}`
      )
    }
    case 3: {
      // Speaking — CTA
      return (
        `${actor} in a casual selfie, speaking to camera with a satisfied confident expression. `
        + `Same indoor setting as scene 1. Lips move naturally with the Hebrew speech "${hebrewLine}". `
        + `Warm closed-lip-to-half-smile, eye contact with the lens. Authentic iPhone selfie feel. `
        + `${productLock}`
      )
    }
    default:
      return ''
  }
}

function buildBusinessSeedancePrompt({ sceneIdx, actor, businessName, productLock }) {
  switch (sceneIdx) {
    case 0:
      return `${actor} as the silent owner/employee of ${businessName || 'the business'}, calm and confident at the start of the workday. Mouth closed, natural breathing motion, handheld documentary feel.`
    case 1:
      return `Extreme close-up of hands working — tools and materials in focused motion. No face visible, no full person. Cinematic shallow depth of field, warm natural light. ${productLock}`
    case 2:
      return `${actor} performing the core service of ${businessName || 'the business'} with focused concentration. Mouth closed, no speaking. Hands engaged with tools or product. Authentic documentary feel. ${productLock}`
    case 3:
      return `${actor} in the success moment of ${businessName || 'the business'} — workspace alive with customers visible in soft-focus background, ${businessName || 'the business'} signage visible. Warm closed-lip smile, quiet pride. Contextual lighting from the venue. ${productLock}`
    default:
      return ''
  }
}

// Validate a generated Seedance video URL end-to-end (MP4 magic + ffprobe
// decode). Identical to the previous Kling validator — Seedance returns
// MP4s in the same shape.
export async function validateVideo(url) {
  if (!url || typeof url !== 'string') return { valid: false, reason: 'no url' }
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-65535' },
      signal: AbortSignal.timeout(10000),
    }).catch(err => ({ _fetchErr: err }))

    if (res?._fetchErr) return { valid: false, reason: `fetch error: ${res._fetchErr.message}` }
    if (!res.ok && res.status !== 206) return { valid: false, reason: `status ${res.status}` }

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length < 12) return { valid: false, reason: `file too small (${buffer.length}B)` }
    const ftyp = buffer.slice(4, 8).toString('ascii')
    if (ftyp !== 'ftyp') return { valid: false, reason: `not MP4 (got "${ftyp}")` }

    const contentRange = res.headers.get('content-range') || ''
    const totalFromRange = Number((contentRange.match(/\/(\d+)$/) || [])[1] || 0)
    let totalSize = totalFromRange
    if (!totalSize) {
      const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).catch(() => null)
      totalSize = Number(head?.headers?.get?.('content-length') || 0)
    }
    if (totalSize > 0 && totalSize < 500 * 1024) {
      return { valid: false, reason: `size too small (${totalSize}B, < 500KB)` }
    }

    if (!ffprobePath) {
      return { valid: true, reason: 'magic-bytes only (no ffprobe)', size: totalSize }
    }
    try {
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,codec_name,width,height,duration:format=duration',
        '-of', 'json',
        url,
      ], { timeout: 15000, maxBuffer: 1024 * 1024 })
      const data = JSON.parse(stdout)
      const videoStream = data.streams?.find(s => s.codec_type === 'video')
      if (!videoStream) return { valid: false, reason: 'no video stream' }
      const w = Number(videoStream.width || 0)
      const h = Number(videoStream.height || 0)
      if (w < 100 || h < 100) return { valid: false, reason: `invalid dimensions ${w}x${h}` }
      const dur = Number(videoStream.duration || data.format?.duration || 0)
      if (dur > 0 && dur < 1) return { valid: false, reason: `duration too short (${dur}s)` }
      return { valid: true, width: w, height: h, duration: dur, codec: videoStream.codec_name, size: totalSize }
    } catch (e) {
      const stderr = e.stderr ? String(e.stderr).slice(-300) : ''
      return { valid: false, reason: `ffprobe failed: ${e.message} ${stderr}` }
    }
  } catch (e) {
    return { valid: false, reason: `validator crashed: ${e.message}` }
  }
}

// Fallback: turn a NanoBanana still frame into an 8s 720x1280 MP4 via
// ffmpeg-static and upload to fal.storage. Used when all 3 Seedance
// attempts fail for a scene — the editor still gets a clip to work with.
export async function frameToStaticVideo(frameUrl, durationSec = 8) {
  if (!frameUrl) return null
  if (!ffmpegStaticPath || !fs.existsSync(ffmpegStaticPath)) {
    console.warn('[frameToStaticVideo] ffmpeg-static not available')
    return null
  }
  const tmpDir = path.join('/tmp', `frame2vid-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })
  const inPath = path.join(tmpDir, 'frame.png')
  const outPath = path.join(tmpDir, 'scene.mp4')
  try {
    let frameBuf
    if (frameUrl.startsWith('data:')) {
      const b64 = frameUrl.split(',')[1] || ''
      frameBuf = Buffer.from(b64, 'base64')
    } else {
      const resp = await fetch(frameUrl)
      if (!resp.ok) throw new Error(`frame fetch HTTP ${resp.status}`)
      frameBuf = Buffer.from(await resp.arrayBuffer())
    }
    await writeFile(inPath, frameBuf)

    const args = [
      '-y', '-loop', '1', '-i', inPath,
      '-t', String(durationSec),
      '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1',
      '-r', '24',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath,
    ]
    await execFileAsync(ffmpegStaticPath, args, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 })
    const stats = fs.statSync(outPath)
    if (stats.size < 10 * 1024) throw new Error('generated mp4 too small')

    const mp4Buf = await readFile(outPath)
    let uploadedUrl = null
    try {
      const blob = new Blob([mp4Buf], { type: 'video/mp4' })
      uploadedUrl = await fal.storage.upload(blob)
    } catch (upErr) {
      console.warn('[frameToStaticVideo] fal.storage upload failed:', upErr.message)
      const b64 = mp4Buf.toString('base64')
      uploadedUrl = `data:video/mp4;base64,${b64}`
    }
    return uploadedUrl
  } catch (e) {
    console.error('[frameToStaticVideo] failed:', e.message)
    return null
  } finally {
    rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Single Seedance call.
//
//   opts:
//     prompt       — natural-language scene prompt (from buildSeedancePrompt)
//     imageUrl     — NB still-frame URL (the visual seed)
//     audioUrl     — optional MP3/WAV URL. When set, Seedance lipsyncs the
//                    avatar's mouth to this audio (used for speaking scenes).
//     duration     — '8' (default — Seedance expects a string)
//     resolution   — '720p' (default)
//     aspectRatio  — '9:16' (default — vertical UGC)
//     pollInterval — fal.subscribe poll interval (ms)
//
// Returns Seedance's video URL on success, null on failure.
async function callSeedance(opts) {
  const {
    prompt,
    imageUrl,
    audioUrl,
    duration = '8',
    resolution = '720p',
    aspectRatio = '9:16',
    pollInterval = 5000,
  } = opts

  const input = {
    prompt,
    image_url: imageUrl,
    duration,
    resolution,
    aspect_ratio: aspectRatio,
    generate_audio: false, // we provide the audio (or scene is silent)
  }
  if (audioUrl) input.audio_url = audioUrl

  console.log('[Seedance] request:', JSON.stringify({
    promptPreview: prompt?.slice(0, 200),
    imageUrl: imageUrl?.slice(0, 100),
    audioUrl: audioUrl?.slice(0, 100) || null,
    duration,
    resolution,
    aspectRatio,
  }))

  const result = await fal.subscribe(SEEDANCE_ENDPOINT, { input, pollInterval })
  const videoUrl = result.data.video?.url || null
  console.log('[Seedance] response:', JSON.stringify({
    url: videoUrl?.slice(0, 100),
    content_type: result.data.video?.content_type,
    file_size: result.data.video?.file_size,
    duration: result.data.video?.duration,
    width: result.data.video?.width,
    height: result.data.video?.height,
  }))
  return videoUrl
}

// Run a single scene through Seedance with up to 3 retries + ffprobe
// validation. On final failure, fall back to the static-frame video.
export async function generateSeedanceVideo(opts) {
  const { sceneIdx, prompt, imageUrl, audioUrl, label = `scene ${(opts.sceneIdx ?? 0) + 1}` } = opts
  if (!imageUrl) {
    console.warn(`[Seedance] ${label}: no image url, returning null`)
    return { videoUrl: null, source: 'none' }
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Seedance] ${label}: attempt ${attempt}/3`)
      const videoUrl = await callSeedance({ prompt, imageUrl, audioUrl })
      if (!videoUrl) {
        console.warn(`[Seedance] ${label}: attempt ${attempt} returned no url`)
      } else {
        const v = await validateVideo(videoUrl)
        if (v.valid) {
          console.log(`[Seedance] ${label}: OK on attempt ${attempt} — ${v.width}x${v.height}, ${v.duration}s, ${v.size}B`)
          return { videoUrl, source: 'seedance' }
        }
        console.warn(`[Seedance] ${label}: attempt ${attempt} failed validation: ${v.reason}`)
      }
    } catch (e) {
      const status = e.status || e.statusCode || 'unknown'
      const body = e.body || e.message || String(e)
      console.error(`[Seedance] ${label}: attempt ${attempt} ERROR — status: ${status}, body:`, JSON.stringify(body).slice(0, 600))
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000))
  }

  // Fall back to a static-frame MP4 so the editor still has a clip.
  console.warn(`[Seedance] ${label}: all 3 attempts failed — falling back to static frame video`)
  const staticUrl = await frameToStaticVideo(imageUrl, SCENE_DURATIONS[sceneIdx] || 8)
  if (staticUrl) return { videoUrl: staticUrl, source: 'static' }
  return { videoUrl: null, source: 'none' }
}
