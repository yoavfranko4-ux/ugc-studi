import { execFile, execSync, spawn } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, readFile, rm, copyFile } from 'fs/promises'
import fs from 'fs'
import { randomUUID, createHash } from 'crypto'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const ffmpegStaticPath = require('ffmpeg-static')

// Force use of the SYSTEM ffmpeg (nixpacks `ffmpeg-full`) which is built with libass, libfribidi,
// and libfreetype — required for Hebrew subtitle burn-in via the `subtitles=` filter.
// ffmpeg-static lacks those libs. We only fall back to it if nothing else exists.
function resolveFfmpegPath() {
  try {
    const w = execSync('which ffmpeg', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (w && fs.existsSync(w)) return w
  } catch {}
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/run/current-system/sw/bin/ffmpeg', '/root/.nix-profile/bin/ffmpeg']) {
    if (fs.existsSync(p)) return p
  }
  try {
    const found = execSync("find /nix/store -maxdepth 4 -type f -name ffmpeg 2>/dev/null | head -1", { encoding: 'utf8', shell: '/bin/sh' }).trim()
    if (found && fs.existsSync(found)) return found
  } catch {}
  return ffmpegStaticPath
}

function resolveFfprobePath(ffmpegBin) {
  // ffprobe is typically next to ffmpeg
  const sibling = ffmpegBin.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
  if (sibling !== ffmpegBin && fs.existsSync(sibling)) return sibling
  try {
    const w = execSync('which ffprobe', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (w && fs.existsSync(w)) return w
  } catch {}
  for (const p of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/run/current-system/sw/bin/ffprobe', '/root/.nix-profile/bin/ffprobe']) {
    if (fs.existsSync(p)) return p
  }
  return null
}

const ffmpegPath = resolveFfmpegPath()
const ffprobePath = resolveFfprobePath(ffmpegPath)
console.log('[Export] Resolved ffmpeg binary:', ffmpegPath, '(ffmpeg-static =', ffmpegStaticPath, ')')
console.log('[Export] Resolved ffprobe binary:', ffprobePath || '(none — will skip fast-path probe)')

try {
  const ver = execSync(`"${ffmpegPath}" -version 2>&1 | head -3`, { encoding: 'utf8', shell: '/bin/sh', stdio: ['pipe', 'pipe', 'ignore'] })
  console.log('[Export] ffmpeg version:\n' + ver)
} catch (e) { console.warn('[Export] Could not run ffmpeg -version:', e.message) }

// === Embedded font (checked into repo at public/fonts/) ===
const EMBEDDED_FONT_DIR    = path.join(process.cwd(), 'public', 'fonts')
const EMBEDDED_FONT_FILE   = path.join(EMBEDDED_FONT_DIR, 'NotoSansHebrew-Bold.ttf')
const EMBEDDED_FONT_FAMILY = 'Noto Sans Hebrew'

console.log('[Export] Embedded font dir:', EMBEDDED_FONT_DIR)
console.log('[Export] Embedded font file:', EMBEDDED_FONT_FILE, 'exists:', fs.existsSync(EMBEDDED_FONT_FILE))

// === Normalized clip cache ===
// Re-exporting the same project shouldn't re-normalize the same source clip.
// Key = sha256 of (source URL OR first-16KB+size of raw bytes) + target params.
const NORMALIZE_CACHE_DIR = path.join('/tmp', 'ugc-norm-cache')
try { fs.mkdirSync(NORMALIZE_CACHE_DIR, { recursive: true }) } catch {}
// Basic LRU-ish eviction — purge cache entries older than 24h on module load.
try {
  const now = Date.now()
  for (const f of fs.readdirSync(NORMALIZE_CACHE_DIR)) {
    const p = path.join(NORMALIZE_CACHE_DIR, f)
    try {
      const st = fs.statSync(p)
      if (now - st.mtimeMs > 24 * 3600 * 1000) fs.unlinkSync(p)
    } catch {}
  }
} catch {}

const execFileAsync = promisify(execFile)

// === Cleanup orphan temp folders from previous crashed jobs (on module load) ===
try {
  const now = Date.now()
  const tmpDir = '/tmp'
  if (fs.existsSync(tmpDir)) {
    for (const f of fs.readdirSync(tmpDir)) {
      if (!f.startsWith('export-')) continue
      const p = path.join(tmpDir, f)
      try {
        const st = fs.statSync(p)
        if (now - st.mtimeMs > 3600 * 1000) {
          fs.rmSync(p, { recursive: true, force: true })
          console.log('[Export] Cleaned orphan temp folder:', p)
        }
      } catch {}
    }
  }
} catch (e) { console.warn('[Export] Orphan cleanup failed:', e.message) }

// === Module-level export lock — prevent concurrent exports from OOMing Railway ===
let exportInProgress = false

// Run an ffmpeg command and stream -progress pipe:1 output for server-side monitoring.
function runFfmpegWithProgress(args, label, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [...args, '-progress', 'pipe:1', '-nostats'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let lastLoggedFrame = 0
    const to = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      reject(new Error(`[${label}] ffmpeg timed out after ${timeout}ms`))
    }, timeout)

    proc.stdout.on('data', chunk => {
      // -progress pipe:1 emits key=value lines per ~100ms block.
      const s = chunk.toString()
      const frameMatch = s.match(/frame=(\d+)/)
      if (frameMatch) {
        const frame = parseInt(frameMatch[1], 10)
        if (frame - lastLoggedFrame >= 24 * 5) { // log every ~5s of output video
          lastLoggedFrame = frame
          const speedMatch = s.match(/speed=([\d.]+)x/)
          console.log(`[${label}] progress: frame=${frame}${speedMatch ? ` speed=${speedMatch[1]}x` : ''}`)
        }
      }
    })
    proc.stderr.on('data', c => { stderr += c.toString() })
    proc.on('error', err => { clearTimeout(to); reject(err) })
    proc.on('close', code => {
      clearTimeout(to)
      if (code === 0) resolve({ stderr })
      else {
        const err = new Error(`[${label}] ffmpeg exited with code ${code}: ${stderr.slice(-400)}`)
        err.code = code
        err.stderr = stderr
        reject(err)
      }
    })
  })
}

// Escape a string value for use inside an ffmpeg filter_complex argument
function escapeFilterValue(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

function fmtAssTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.round((sec - Math.floor(sec)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function buildAssFile(subtitles, wordTimestamps, fontFamily, playResX = 720, playResY = 1280, fontSize = 56) {
  const fam = fontFamily || 'DejaVu Sans'
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fam},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,30,30,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const events = []
  const escapeAss = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\N').replace(/\{/g, '\\{').replace(/\}/g, '\\}')

  if (Array.isArray(wordTimestamps) && wordTimestamps.length) {
    const GROUP = 3
    for (let i = 0; i < wordTimestamps.length; i += GROUP) {
      const group = wordTimestamps.slice(i, i + GROUP)
      const text = group.map(w => w.word).join(' ').trim()
      if (!text) continue
      const start = Number(group[0].start) || 0
      const end = Number(group[group.length - 1].end) || (start + 1)
      events.push(`Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Default,,0,0,0,,${escapeAss(text)}`)
    }
  } else if (Array.isArray(subtitles)) {
    for (const sub of subtitles) {
      const text = (sub?.text || '').trim()
      if (!text) continue
      const start = Number(sub.start) || 0
      const end = start + (Number(sub.duration) || 5)
      events.push(`Dialogue: 0,${fmtAssTime(start)},${fmtAssTime(end)},Default,,0,0,0,,${escapeAss(text)}`)
    }
  }
  return header + events.join('\n') + '\n'
}

// Probe a clip with ffprobe. Returns null if probe fails or ffprobe unavailable.
// Now also returns duration (seconds) so we can reject clips with duration=0
// before throwing them at the libx264 encoder.
async function probeClip(filePath) {
  if (!ffprobePath || !filePath) return null
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt,duration:format=duration,format_name',
      '-of', 'json',
      filePath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 })
    const parsed = JSON.parse(stdout)
    const info = parsed.streams?.[0]
    const fmt = parsed.format || {}
    if (!info) return null
    const [num, den] = String(info.r_frame_rate || '0/1').split('/').map(Number)
    const duration = Number(info.duration || fmt.duration || 0)
    return {
      codec: info.codec_name,
      width: info.width,
      height: info.height,
      fps: den > 0 ? num / den : 0,
      pix_fmt: info.pix_fmt,
      duration: Number.isFinite(duration) ? duration : 0,
      container: fmt.format_name || null,
    }
  } catch (e) {
    const stderr = e.stderr ? String(e.stderr).slice(-500) : ''
    console.warn('[Export] probeClip failed for', filePath, ':', e.message)
    if (stderr) console.warn('[Export] probeClip stderr:', stderr)
    // Attach stderr to the error path for caller introspection
    return null
  }
}

// Probe that returns the stderr on failure so callers can log the real reason.
async function probeClipVerbose(filePath) {
  if (!ffprobePath || !filePath) return { probe: null, stderr: '(ffprobe unavailable)' }
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt,duration:format=duration,format_name',
      '-of', 'json',
      filePath,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 })
    const parsed = JSON.parse(stdout)
    const info = parsed.streams?.[0]
    const fmt = parsed.format || {}
    if (!info) return { probe: null, stderr: '(no video stream)' }
    const [num, den] = String(info.r_frame_rate || '0/1').split('/').map(Number)
    const duration = Number(info.duration || fmt.duration || 0)
    return {
      probe: {
        codec: info.codec_name,
        width: info.width,
        height: info.height,
        fps: den > 0 ? num / den : 0,
        pix_fmt: info.pix_fmt,
        duration: Number.isFinite(duration) ? duration : 0,
        container: fmt.format_name || null,
      },
      stderr: '',
    }
  } catch (e) {
    return { probe: null, stderr: (e.stderr ? String(e.stderr) : e.message || 'unknown') }
  }
}

// Read the first 32 bytes of a file and identify the container.
// Returns { hex, magic } where magic is 'mp4'|'webm'|'html'|'unknown'.
function inspectFileMagic(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(32)
    const read = fs.readSync(fd, buf, 0, 32, 0)
    fs.closeSync(fd)
    const slice = buf.slice(0, read)
    const hex = slice.toString('hex')
    const ascii = slice.toString('latin1').toLowerCase()
    // MP4: bytes 4..7 == "ftyp"
    if (read >= 8 && slice.slice(4, 8).toString('latin1') === 'ftyp') {
      return { hex, magic: 'mp4', ftyp: slice.slice(8, 12).toString('latin1').trim() }
    }
    // WebM/Matroska EBML: 1A 45 DF A3
    if (read >= 4 && slice[0] === 0x1A && slice[1] === 0x45 && slice[2] === 0xDF && slice[3] === 0xA3) {
      return { hex, magic: 'webm' }
    }
    // Common error cases: HTML error page, JSON error body
    if (ascii.includes('<!doctype') || ascii.includes('<html') || ascii.startsWith('<')) {
      return { hex, magic: 'html' }
    }
    if (ascii.startsWith('{') || ascii.startsWith('[')) {
      return { hex, magic: 'json' }
    }
    return { hex, magic: 'unknown' }
  } catch (e) {
    return { hex: '', magic: 'error', error: e.message }
  }
}

// Resolve an NB frame reference (http URL OR data: URI) to a local PNG/JPG file.
// Returns the path, or null on failure.
async function materializeNbFrame(ref, outPath) {
  if (!ref || typeof ref !== 'string') return null
  try {
    if (ref.startsWith('data:')) {
      const comma = ref.indexOf(',')
      if (comma < 0) return null
      const meta = ref.slice(5, comma)
      const isBase64 = /;base64/i.test(meta)
      const payload = ref.slice(comma + 1)
      const buf = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'latin1')
      if (buf.length < 100) return null
      await writeFile(outPath, buf)
      return outPath
    }
    if (/^https?:\/\//i.test(ref)) {
      const resp = await fetch(ref)
      if (!resp.ok) return null
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length < 100) return null
      await writeFile(outPath, buf)
      return outPath
    }
    return null
  } catch (e) {
    console.warn('[Export] materializeNbFrame failed:', e.message)
    return null
  }
}

function clipsAllMatch(probes, targetW, targetH, targetFps) {
  if (!probes.length || !probes.every(Boolean)) return false
  return probes.every(p => (
    p.codec === 'h264' &&
    p.width === targetW &&
    p.height === targetH &&
    p.pix_fmt === 'yuv420p' &&
    Math.abs(p.fps - targetFps) < 0.5
  ))
}

function hashBytesForCache(buf) {
  // Use first 16KB + size — way faster than hashing whole file, still unique enough for normalize cache.
  const head = buf.slice(0, Math.min(16384, buf.length))
  return createHash('sha256').update(head).update(String(buf.length)).digest('hex').slice(0, 32)
}

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req) {
  console.log('[Memory:export]', JSON.stringify(process.memoryUsage()))

  // Reject concurrent exports — two at once overwhelms Railway memory.
  if (exportInProgress) {
    return Response.json(
      { error: 'ייצוא אחר רץ כעת, נסה בעוד דקה' },
      { status: 429 },
    )
  }
  exportInProgress = true

  const jobDir = path.join('/tmp', `export-${randomUUID()}`)
  const startedAt = Date.now()

  try {
    const body = await req.json()
    const {
      videoClipsB64,
      videoUrls,
      nbFrameUrls,   // NEW: per-scene NB frame URLs / data: URIs — used as visual fallback
      audioBase64,
      audioFormat,
      subtitles,
      wordTimestamps,
      bgMusic,
      bgMusicUrl,
      subtitleStyle,
      fastExport,
    } = body

    const hasB64Clips = Array.isArray(videoClipsB64) && videoClipsB64.some(Boolean)
    const hasUrls = Array.isArray(videoUrls) && videoUrls.some(Boolean)
    if (!hasB64Clips && !hasUrls) {
      return Response.json({ error: 'No video clips provided' }, { status: 400 })
    }

    // === Incoming payload logging ===
    console.log('[Export] === Incoming payload ===')
    console.log('[Export] videoClipsB64 count:', Array.isArray(videoClipsB64) ? videoClipsB64.length : 'NOT ARRAY')
    if (Array.isArray(videoClipsB64)) {
      videoClipsB64.forEach((b64, i) => {
        const len = b64?.length ?? 0
        console.log(`[Export]   videoClipsB64[${i}] base64 length: ${len} chars${len === 0 ? ' (EMPTY)' : ''}`)
      })
    }
    console.log('[Export] videoUrls count:', Array.isArray(videoUrls) ? videoUrls.length : 'NOT ARRAY')
    if (Array.isArray(videoUrls)) {
      videoUrls.forEach((u, i) => console.log(`[Export]   videoUrls[${i}]:`, u || '(null)'))
    }
    console.log('[Export] nbFrameUrls count:', Array.isArray(nbFrameUrls) ? nbFrameUrls.length : 'NOT ARRAY')
    if (Array.isArray(nbFrameUrls)) {
      nbFrameUrls.forEach((u, i) => {
        const kind = !u ? '(null)' : u.startsWith('data:') ? `data: URI (${u.length} chars)` : u.slice(0, 80)
        console.log(`[Export]   nbFrameUrls[${i}]:`, kind)
      })
    }
    console.log('[Export] audioBase64:', audioBase64 ? `${audioBase64.length} chars (${audioFormat})` : '(none)')
    console.log('[Export] subtitles:', Array.isArray(subtitles) ? subtitles.length : '(none)')
    console.log('[Export] wordTimestamps:', Array.isArray(wordTimestamps) ? wordTimestamps.length : '(none)')

    // Target encode params
    const TARGET_W   = fastExport ? 540 : 720
    const TARGET_H   = fastExport ? 960 : 1280
    const TARGET_FPS = 24
    const PRESET     = 'ultrafast'
    const CRF        = '28'
    const FONT_SIZE  = fastExport ? 42 : 56

    console.log('[Export] FFmpeg path:', ffmpegPath, '| fastExport:', !!fastExport, '| target:', `${TARGET_W}x${TARGET_H}@${TARGET_FPS}`)
    await mkdir(jobDir, { recursive: true })

    // -----------------------------------------------------------
    // 1. Materialize clips onto disk — prefer URL download (parallel)
    //    over base64 decode. Falls back to base64 per-index on failure.
    // -----------------------------------------------------------
    const expectedCount = Math.max(
      Array.isArray(videoUrls) ? videoUrls.length : 0,
      Array.isArray(videoClipsB64) ? videoClipsB64.length : 0,
    )
    const clipPaths = new Array(expectedCount).fill(null)
    const clipSources = new Array(expectedCount).fill(null)  // for cache keying: URL if we have it

    await Promise.all(Array.from({ length: expectedCount }, async (_, i) => {
      const url = Array.isArray(videoUrls) ? videoUrls[i] : null
      const b64 = Array.isArray(videoClipsB64) ? videoClipsB64[i] : null
      const clipPath = path.join(jobDir, `clip${i}.mp4`)

      // PRIMARY: base64 (client always sends this from the in-memory blob — reliable, no CDN expiry).
      if (b64 && b64.length > 0) {
        const buf = Buffer.from(b64, 'base64')
        if (buf.length > 0) {
          await writeFile(clipPath, buf)
          const diskSize = fs.statSync(clipPath).size
          const magic = inspectFileMagic(clipPath)
          clipPaths[i] = clipPath
          clipSources[i] = { type: 'bytes', key: hashBytesForCache(buf) }
          console.log(`[Export] Clip ${i} from base64: base64_chars=${b64.length}, decoded_bytes=${buf.length}, disk_size=${diskSize}, magic=${magic.magic}${magic.ftyp ? ` (ftyp=${magic.ftyp})` : ''}, first32=${magic.hex}`)
          // Free the base64 string — it's now on disk, no need to hold 10-13MB per clip in RAM.
          if (Array.isArray(videoClipsB64)) videoClipsB64[i] = null
          return
        }
        console.warn(`[Export] Clip ${i} base64 decoded to 0 bytes — trying URL fallback`)
      }

      // FALLBACK: HTTP URL (fal.ai/Kling — often expired by now)
      if (url && typeof url === 'string') {
        try {
          const resp = await fetch(url)
          const ct = resp.headers?.get?.('content-type') || '(no content-type)'
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer())
            await writeFile(clipPath, buf)
            const diskSize = fs.statSync(clipPath).size
            const magic = inspectFileMagic(clipPath)
            console.log(`[Export] Clip ${i} URL download: content-type=${ct}, bytes=${buf.length}, magic=${magic.magic}${magic.ftyp ? ` (ftyp=${magic.ftyp})` : ''}, first32=${magic.hex}`)
            // Content verification — a valid video must be mp4/webm and ≥ 50KB
            const ctOk = /^video\//i.test(ct) || /^application\/octet-stream/i.test(ct)
            const magicOk = magic.magic === 'mp4' || magic.magic === 'webm'
            if (!magicOk || diskSize < 50 * 1024) {
              console.warn(`[Export] Clip ${i} failed download verification: size=${diskSize}, content-type=${ct}, magic=${magic.magic} — will fall back to NB frame`)
              return
            }
            if (!ctOk) console.warn(`[Export] Clip ${i} content-type suspicious (${ct}) but magic bytes are ${magic.magic} — accepting`)
            clipPaths[i] = clipPath
            clipSources[i] = { type: 'url', key: createHash('sha256').update(url).digest('hex').slice(0, 32) }
            return
          }
          console.warn(`[Export] Clip ${i} URL HTTP ${resp.status} content-type=${ct} — no valid source`)
        } catch (e) {
          console.warn(`[Export] Clip ${i} URL fetch failed (${e.message}) — no valid source`)
        }
      }
      console.warn(`[Export] Clip ${i} has NO valid source (b64=${b64?.length || 0} chars, url=${url || 'null'})`)
    }))

    if (!clipPaths.some(Boolean)) throw new Error('No clips materialized successfully')

    // All large base64 strings have been written to disk and nulled — ask V8 to GC now.
    try { global.gc?.() } catch {}

    // -----------------------------------------------------------
    // 2. Fallback clip generators:
    //    - makeStaticFrameVideo(i): produce a 5s static video from the NB frame
    //      for scene i. Preferred fallback — user sees the product image,
    //      not a black screen.
    //    - makeBlackPlaceholder(i): last-resort pure-black clip used only when
    //      even the NB frame cannot be materialized.
    // -----------------------------------------------------------
    const MIN_CLIP_BYTES = 50 * 1024

    async function makeStaticFrameVideo(i, tag = 'nb') {
      const frameRef = Array.isArray(nbFrameUrls) ? nbFrameUrls[i] : null
      if (!frameRef) return null
      const ext = frameRef.startsWith('data:image/jpeg') || frameRef.toLowerCase().includes('.jpg') ? 'jpg' : 'png'
      const framePath = path.join(jobDir, `frame_${tag}_${i}.${ext}`)
      const resolved = await materializeNbFrame(frameRef, framePath)
      if (!resolved) {
        console.warn(`[Export] makeStaticFrameVideo[${i}] — could not materialize NB frame`)
        return null
      }
      const frameSize = fs.statSync(resolved).size
      console.log(`[Export] makeStaticFrameVideo[${i}] frame file: ${frameSize} bytes`)
      const outPath = path.join(jobDir, `static_${tag}_${i}.mp4`)
      const args = [
        '-y',
        '-threads', '1',
        '-loop', '1',
        '-framerate', String(TARGET_FPS),
        '-i', resolved,
        '-t', '5',
        '-c:v', 'libx264',
        '-preset', PRESET,
        '-pix_fmt', 'yuv420p',
        '-vf', `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},setsar=1`,
        '-max_muxing_queue_size', '1024',
        '-movflags', '+faststart',
        '-an',
        outPath,
      ]
      try {
        await execFileAsync(ffmpegPath, args, { timeout: 25000, maxBuffer: 10 * 1024 * 1024 })
        const sz = fs.statSync(outPath).size
        console.log(`[Export] makeStaticFrameVideo[${i}] → ${outPath} (${sz} bytes)`)
        // Delete the intermediate still-frame file — we only need the mp4 now.
        try { fs.unlinkSync(resolved) } catch {}
        return outPath
      } catch (err) {
        console.error(`[Export] makeStaticFrameVideo[${i}] FAILED:`, (err.stderr || err.message || '').slice(-500))
        try { fs.unlinkSync(resolved) } catch {}
        return null
      }
    }

    async function makeBlackPlaceholder(i, tag = 'ph') {
      const p = path.join(jobDir, `black_${tag}_${i}.mp4`)
      await execFileAsync(ffmpegPath, [
        '-y',
        '-threads', '1',
        '-f', 'lavfi', '-i', `color=c=black:s=${TARGET_W}x${TARGET_H}:r=${TARGET_FPS}`,
        '-t', '5',
        '-c:v', 'libx264', '-preset', PRESET, '-crf', CRF,
        '-pix_fmt', 'yuv420p',
        '-max_muxing_queue_size', '1024',
        '-movflags', '+faststart', '-an',
        p,
      ], { timeout: 20000, maxBuffer: 10 * 1024 * 1024 })
      return p
    }

    // Prefer NB frame static video; fall back to pure black only if NB frame
    // is also unavailable. Returns { path, kind: 'nb' | 'black' }.
    async function makeFallbackClip(i, tag = 'fb') {
      const nb = await makeStaticFrameVideo(i, tag)
      if (nb) return { path: nb, kind: 'nb' }
      console.warn(`[Export] Clip ${i} NB frame unavailable — using pure-black fallback (last resort)`)
      return { path: await makeBlackPlaceholder(i, tag), kind: 'black' }
    }

    // -----------------------------------------------------------
    // 3. Validate raw clips: size check → ffprobe (duration > 0, has video
    //    stream, recognized codec). Any clip that fails is replaced with the
    //    NB frame static video (preferred) or pure-black (last resort).
    //    We also decide normalize-vs-skip here so we don't run libx264 on
    //    a source ffprobe already marked as broken.
    // -----------------------------------------------------------
    let nbFallbackCount = 0
    let blackFallbackCount = 0
    const fallbackKinds = new Array(expectedCount).fill(null) // null | 'nb' | 'black'
    const preProbes = new Array(expectedCount).fill(null)

    // Sequential validation (was Promise.all) — reduces peak memory from
    // spawning N ffmpeg fallback processes at once.
    const validPaths = new Array(clipPaths.length).fill(null)
    for (let i = 0; i < clipPaths.length; i++) {
      const p = clipPaths[i]
      let size = 0
      if (p) { try { size = fs.statSync(p).size } catch {} }
      console.log(`[Export] Raw clip ${i} on disk: ${size} bytes (${(size / 1024).toFixed(1)}KB)`)

      // Stage 1: hard size/missing check — only fall back when BOTH the file
      // is (effectively) missing AND well below the plausible-video threshold.
      const HARD_MIN_BYTES = 50 * 1024 // < 50KB = almost certainly not a video
      if (!p || size < HARD_MIN_BYTES) {
        console.warn(`[Export] Clip ${i} ${!p ? 'missing' : `only ${size}B (< ${HARD_MIN_BYTES}B)`} — using NB-frame fallback`)
        const fb = await makeFallbackClip(i, 'size')
        fallbackKinds[i] = fb.kind
        if (fb.kind === 'nb') nbFallbackCount++; else blackFallbackCount++
        validPaths[i] = fb.path
        continue
      }

      // Stage 2: magic bytes — if they're valid (ftyp for mp4, EBML for webm),
      // the file is structurally OK even if ffprobe stumbles on something.
      const magic = inspectFileMagic(p)
      const magicValid = magic.magic === 'mp4' || magic.magic === 'webm'
      console.log(`[Export] Clip ${i} magic=${magic.magic}${magic.ftyp ? ` (ftyp ${magic.ftyp})` : ''}`)

      // Stage 3: ffprobe (now with real stderr + 30s timeout inside probeClipVerbose)
      const { probe, stderr: probeStderr } = await probeClipVerbose(p)
      preProbes[i] = probe

      if (!probe) {
        // Show the actual ffprobe error so we can diagnose these cases.
        console.error(`[Export] Clip ${i} ffprobe stderr:`, (probeStderr || '').slice(-500))
        // Don't fail on ffprobe alone if magic bytes are valid and size is reasonable —
        // ffprobe can fail on timeouts, odd stream metadata, etc, but the file is fine.
        if (magicValid && size >= 100 * 1024) {
          console.warn(`[Export] Clip ${i} ffprobe FAILED but magic=${magic.magic} and size=${size}B — letting normalize try directly.`)
          validPaths[i] = p
          continue
        }
        console.warn(`[Export] Clip ${i} ffprobe FAILED and magic/size insufficient (magic=${magic.magic}, size=${size}) — using NB-frame fallback.`)
        const fb = await makeFallbackClip(i, 'probefail')
        fallbackKinds[i] = fb.kind
        if (fb.kind === 'nb') nbFallbackCount++; else blackFallbackCount++
        validPaths[i] = fb.path
        continue
      }

      console.log(`[Export] Clip ${i} ffprobe: duration=${probe.duration?.toFixed?.(2) ?? '?'}s, codec=${probe.codec}, pix_fmt=${probe.pix_fmt}, dimensions=${probe.width}x${probe.height}, fps=${probe.fps.toFixed(2)}, container=${probe.container}`)

      const codecOk = /^(h264|hevc|vp8|vp9|av1|mpeg4)$/i.test(probe.codec || '')
      const dimsOk  = probe.width > 0 && probe.height > 0
      const durOk   = !probe.duration || probe.duration > 0.1  // if duration is unknown we'll still try
      if (!codecOk || !dimsOk || !durOk) {
        // Again, if magic bytes say the container is valid, give normalize a shot
        // before falling back — ffprobe's "broken stream" can be a false positive.
        if (magicValid && size >= 100 * 1024) {
          console.warn(`[Export] Clip ${i} ffprobe looked broken (codec=${probe.codec}, ${probe.width}x${probe.height}, dur=${probe.duration}) but magic=${magic.magic} — letting normalize try directly.`)
          validPaths[i] = p
          continue
        }
        console.warn(`[Export] Clip ${i} ffprobe shows broken stream (codec=${probe.codec}, ${probe.width}x${probe.height}, dur=${probe.duration}) — using NB-frame fallback`)
        const fb = await makeFallbackClip(i, 'probebad')
        fallbackKinds[i] = fb.kind
        if (fb.kind === 'nb') nbFallbackCount++; else blackFallbackCount++
        validPaths[i] = fb.path
        continue
      }
      validPaths[i] = p
    }

    const totalFallbacks = nbFallbackCount + blackFallbackCount
    if (blackFallbackCount === expectedCount) {
      // Only abort if NOTHING rendered — not even the NB frames worked.
      throw new Error(`הייצוא נכשל: כל הקליפים והפריימים חסרים (${blackFallbackCount}/${expectedCount}). צור סרטון חדש.`)
    }
    if (totalFallbacks > 0) {
      console.warn(`[Export] ⚠️ Fallbacks: ${nbFallbackCount} NB-frame static + ${blackFallbackCount} pure-black (of ${expectedCount} clips)`)
    }

    const totalDuration = validPaths.length * 5

    // -----------------------------------------------------------
    // 4. Final probe on the validPaths (may be original clips OR fallback
    //    videos). If everything matches target params we can skip normalize.
    // -----------------------------------------------------------
    const probes = await Promise.all(validPaths.map(probeClip))
    probes.forEach((p, i) => console.log(`[Export] probe[${i}] (after fallback):`, p ? `${p.codec} ${p.width}x${p.height}@${p.fps.toFixed(2)} ${p.pix_fmt}` : '(unavailable)'))
    const canSkipNormalize = clipsAllMatch(probes, TARGET_W, TARGET_H, TARGET_FPS)
    console.log('[Export] canSkipNormalize:', canSkipNormalize)

    // -----------------------------------------------------------
    // 4. If normalize is needed, do it in PARALLEL (one ffmpeg per clip).
    //    Normalize cache is DISABLED while debugging the black-screen bug —
    //    it could serve a stale broken output from a previous run.
    // -----------------------------------------------------------
    const DISABLE_NORMALIZE_CACHE = true
    let normalizedPaths = validPaths
    if (!canSkipNormalize) {
      const paramTag = `${TARGET_W}x${TARGET_H}_${TARGET_FPS}`
      // Sequential (was Promise.all) — running N ffmpeg libx264 encodes in
      // parallel is what OOMs Railway. One at a time uses ~1/N the peak RAM.
      const outPaths = new Array(validPaths.length).fill(null)
      for (let i = 0; i < validPaths.length; i++) {
        const inPath = validPaths[i]
        const src = clipSources[i]
        const cacheFile = (!DISABLE_NORMALIZE_CACHE && src?.key)
          ? path.join(NORMALIZE_CACHE_DIR, `${src.key}_${paramTag}.mp4`)
          : null

        if (cacheFile && fs.existsSync(cacheFile)) {
          const stats = fs.statSync(cacheFile)
          const cacheProbe = await probeClip(cacheFile)
          if (stats.size > MIN_CLIP_BYTES && cacheProbe && cacheProbe.width === TARGET_W && cacheProbe.height === TARGET_H) {
            console.log(`[Export] norm[${i}] cache HIT — reusing ${cacheFile} (${stats.size} bytes, probe OK)`)
            try { fs.utimesSync(cacheFile, new Date(), new Date()) } catch {}
            outPaths[i] = cacheFile
            continue
          }
          console.warn(`[Export] norm[${i}] cache entry invalid — re-encoding (${stats.size}B, probe=${JSON.stringify(cacheProbe)})`)
        }

        const normPath = path.join(jobDir, `norm_${i}.mp4`)
        const vfChain = `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},setsar=1`
        const normArgs = [
          '-y',
          '-threads', '1',
          '-err_detect', 'ignore_err',
          '-fflags', '+discardcorrupt+genpts',
          '-avoid_negative_ts', 'make_zero',
          '-i', inPath,
          '-vf', vfChain,
          '-r', String(TARGET_FPS),
          '-t', '5',
          '-pix_fmt', 'yuv420p',
          '-c:v', 'libx264',
          '-preset', PRESET,
          '-crf', CRF,
          '-max_muxing_queue_size', '1024',
          '-movflags', '+faststart',
          '-an',
          normPath,
        ]
        console.log(`[Export] norm[${i}] encoding → ${normPath}`)
        console.log(`[Export] norm[${i}] args:`, JSON.stringify(normArgs))
        try {
          const r = await execFileAsync(ffmpegPath, normArgs, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 })
          const stderrTail = (r.stderr || '').split('\n').slice(-8).join('\n')
          console.log(`[Export] norm[${i}] stderr tail:\n${stderrTail}`)
        } catch (err) {
          const stderrStr = err.stderr || ''
          const tail = stderrStr.slice(-800)
          console.error(`[Export] norm[${i}] FAILED (code ${err.code}). stderr tail:\n${tail}`)
          const errLine = stderrStr
            .split('\n')
            .filter(l => l.trim() && !/^frame=|^size=|^bitrate=/.test(l))
            .slice(-1)[0] || '(no error line)'
          console.error(`[Export] norm[${i}] best-guess error line: ${errLine}`)
          console.warn(`[Export] norm[${i}] → falling back to NB-frame static video`)
          const fb = await makeFallbackClip(i, 'normfail')
          if (fb.kind === 'nb') nbFallbackCount++; else blackFallbackCount++
          fallbackKinds[i] = fb.kind
          outPaths[i] = fb.path
          // Delete the source clip now that we've given up on it.
          if (inPath && inPath !== fb.path) { try { fs.unlinkSync(inPath) } catch {} }
          continue
        }

        const sz = fs.statSync(normPath).size
        console.log(`[Export] norm[${i}] output size: ${sz} bytes (${(sz / 1024).toFixed(1)}KB)`)

        const probe = await probeClip(normPath)
        if (!probe || probe.width <= 0 || probe.height <= 0) {
          console.warn(`[Export] norm[${i}] output looks broken (probe=${JSON.stringify(probe)}) — falling back to NB-frame static video`)
          try { fs.unlinkSync(normPath) } catch {}
          const fb = await makeFallbackClip(i, 'normbroken')
          if (fb.kind === 'nb') nbFallbackCount++; else blackFallbackCount++
          fallbackKinds[i] = fb.kind
          outPaths[i] = fb.path
          if (inPath && inPath !== fb.path) { try { fs.unlinkSync(inPath) } catch {} }
          continue
        }

        if (cacheFile) {
          try { await copyFile(normPath, cacheFile) } catch (e) { console.warn('[Export] cache write failed:', e.message) }
        }
        // Delete the raw source clip — normalized output is what we concat.
        if (inPath && inPath !== normPath) { try { fs.unlinkSync(inPath) } catch {} }
        outPaths[i] = normPath
      }
      normalizedPaths = outPaths
      // Normalize step done — give V8 a hint before the final pass.
      try { global.gc?.() } catch {}
    }

    // === Post-normalize validation — probe every clip that will go into the concat
    const postProbes = await Promise.all(normalizedPaths.map(probeClip))
    postProbes.forEach((p, i) => {
      const size = fs.existsSync(normalizedPaths[i]) ? fs.statSync(normalizedPaths[i]).size : 0
      console.log(`[Export] post-normalize[${i}]: ${size}B, probe=${p ? `${p.codec} ${p.width}x${p.height}@${p.fps.toFixed(2)}` : 'PROBE FAILED'}`)
    })
    const badNormalized = postProbes.map((p, i) => (!p || p.width <= 0 || p.height <= 0) ? i : -1).filter(i => i >= 0)
    if (badNormalized.length === normalizedPaths.length) {
      throw new Error(`הייצוא נכשל: כל הקליפים פגומים אחרי נרמול (${badNormalized.length}). צור סרטון חדש.`)
    }

    // -----------------------------------------------------------
    // 5. Voice audio (WAV preferred — raw PCM, no decoder risk)
    // -----------------------------------------------------------
    let voicePath = null
    if (audioBase64) {
      const fmt = audioFormat === 'wav' ? 'wav' : 'mp3'
      const rawPath = path.join(jobDir, `voice.${fmt}`)
      const audioBuf = Buffer.from(audioBase64, 'base64')
      await writeFile(rawPath, audioBuf)
      console.log(`[Export] voice.${fmt} on disk: ${audioBuf.length} bytes`)

      if (fmt === 'wav') {
        voicePath = rawPath
      } else {
        // MP3 → AAC pre-conversion (legacy path — bypasses ffmpeg-static MP3 decoder bugs)
        const convertedPath = path.join(jobDir, 'voice_converted.m4a')
        try {
          await execFileAsync(ffmpegPath, [
            '-y', '-i', rawPath,
            '-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
            convertedPath,
          ], { maxBuffer: 10 * 1024 * 1024, timeout: 25000 })
          voicePath = convertedPath
        } catch (convErr) {
          console.warn('[Export] voice MP3→AAC conversion failed, using raw:', convErr.message)
          voicePath = rawPath
        }
      }
    }

    // -----------------------------------------------------------
    // 6. Background music
    // -----------------------------------------------------------
    let musicPath = null
    if (bgMusic && bgMusic !== 'none' && bgMusicUrl) {
      try {
        let musicBuf = null
        const isHttp = /^https?:\/\//i.test(bgMusicUrl)
        if (!isHttp) {
          const rel = bgMusicUrl.replace(/^\/+/, '')
          const diskPath = path.join(process.cwd(), 'public', rel)
          if (fs.existsSync(diskPath)) musicBuf = await readFile(diskPath)
          else console.warn('[Export] music file not found:', diskPath)
        } else {
          const resp = await fetch(bgMusicUrl)
          if (resp.ok) musicBuf = Buffer.from(await resp.arrayBuffer())
          else console.warn('[Export] music fetch HTTP', resp.status)
        }
        if (musicBuf) {
          const musicRaw = path.join(jobDir, 'music_raw.mp3')
          await writeFile(musicRaw, musicBuf)
          // Skip pre-conversion — the final filter_complex re-encodes audio anyway.
          musicPath = musicRaw
        }
      } catch (e) { console.warn('[Export] music load failed:', e.message) }
    }

    // -----------------------------------------------------------
    // 7. Build ASS subtitle file
    // -----------------------------------------------------------
    let assPath = null
    const hasSubs = (Array.isArray(wordTimestamps) && wordTimestamps.length) || (Array.isArray(subtitles) && subtitles.length)
    if (hasSubs) {
      const assContent = buildAssFile(subtitles || [], wordTimestamps || null, EMBEDDED_FONT_FAMILY, TARGET_W, TARGET_H, FONT_SIZE)
      assPath = path.join(jobDir, 'subs.ass')
      await writeFile(assPath, assContent, 'utf8')
      console.log('[Export] ASS written to', assPath)
    }

    // -----------------------------------------------------------
    // 8. FINAL PASS — one ffmpeg invocation does everything.
    //    Clips in `normalizedPaths` always share codec/res/fps/pix_fmt
    //    (either via parallel normalize or via ffprobe fast-path), so we
    //    ALWAYS use the concat demuxer here. If no subtitles are needed
    //    the video stream is copied without re-encode (fastest path).
    // -----------------------------------------------------------
    const outputPath = path.join(jobDir, 'output.mp4')
    const finalArgs = ['-y', '-threads', '1']

    const listPath = path.join(jobDir, 'list.txt')
    const listContent = normalizedPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
    await writeFile(listPath, listContent)
    finalArgs.push('-f', 'concat', '-safe', '0', '-i', listPath)

    // Audio inputs after the concat demuxer input (always idx 0)
    let voiceInputIdx = -1, musicInputIdx = -1, nextIdx = 1
    if (voicePath) { finalArgs.push('-i', voicePath); voiceInputIdx = nextIdx++ }
    if (musicPath) { finalArgs.push('-i', musicPath); musicInputIdx = nextIdx }

    // Build filter_complex (video subtitles + audio mix)
    const filterParts = []
    let videoOutLabel = null  // set when we route video through a filter
    if (assPath) {
      const fontsDirArg = fs.existsSync(EMBEDDED_FONT_DIR) ? `:fontsdir='${escapeFilterValue(EMBEDDED_FONT_DIR)}'` : ''
      filterParts.push(`[0:v]subtitles='${escapeFilterValue(assPath)}'${fontsDirArg}[outv]`)
      videoOutLabel = 'outv'
    }

    let audioOutLabel = null
    if (voicePath && musicPath) {
      filterParts.push(`[${voiceInputIdx}:a]volume=1.0,apad=whole_dur=${totalDuration},aresample=44100[va]`)
      filterParts.push(`[${musicInputIdx}:a]volume=0.15,aloop=loop=-1:size=2000000000,aresample=44100[ma]`)
      filterParts.push(`[va][ma]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[aout]`)
      audioOutLabel = 'aout'
    } else if (voicePath) {
      filterParts.push(`[${voiceInputIdx}:a]apad=whole_dur=${totalDuration},aresample=44100[aout]`)
      audioOutLabel = 'aout'
    } else if (musicPath) {
      filterParts.push(`[${musicInputIdx}:a]volume=0.15,aloop=loop=-1:size=2000000000,aresample=44100[aout]`)
      audioOutLabel = 'aout'
    }

    if (filterParts.length) finalArgs.push('-filter_complex', filterParts.join(';'))

    // Map video
    if (videoOutLabel) finalArgs.push('-map', `[${videoOutLabel}]`)
    else finalArgs.push('-map', '0:v:0')

    // Map audio
    if (audioOutLabel) finalArgs.push('-map', `[${audioOutLabel}]`)
    else finalArgs.push('-an')

    // Stream-copy video when there are no subtitles (biggest single win on the happy path)
    if (!assPath) {
      finalArgs.push('-c:v', 'copy')
    } else {
      finalArgs.push(
        '-c:v', 'libx264',
        '-preset', PRESET,
        '-tune', 'zerolatency',
        '-crf', CRF,
        '-r', String(TARGET_FPS),
        '-pix_fmt', 'yuv420p',
      )
    }

    // Audio codec
    if (audioOutLabel) {
      finalArgs.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2')
    }

    finalArgs.push(
      '-max_muxing_queue_size', '1024',
      '-movflags', '+faststart',
      '-t', String(totalDuration),
      outputPath,
    )

    console.log('[Export] ===== Final ffmpeg command =====')
    console.log(`[Export] "${ffmpegPath}" ${finalArgs.map(a => a.includes(' ') || a.includes(';') ? `'${a}'` : a).join(' ')}`)
    console.log('[Export] Final pass args (JSON):', JSON.stringify(finalArgs))
    const finalStart = Date.now()
    try {
      const { stderr } = await runFfmpegWithProgress(finalArgs, 'final', { timeout: 150000 })
      console.log('[Export] Final pass stderr (tail):', (stderr || '').slice(-1200))
    } catch (err) {
      console.error('[Export] Final pass FAILED:', err.stderr?.slice(-800) || err.message)
      throw new Error(`Final ffmpeg pass failed: ${err.stderr?.slice(-400) || err.message}`)
    }
    console.log(`[Export] Final pass took ${Date.now() - finalStart}ms`)

    // -----------------------------------------------------------
    // 9. Probe final output — sanity check we actually have video frames.
    //    If the output has no video stream or zero duration, we have
    //    produced a black/broken MP4 and should fail loudly.
    // -----------------------------------------------------------
    const outProbe = await probeClip(outputPath)
    console.log('[Export] OUTPUT probe:', outProbe ? `${outProbe.codec} ${outProbe.width}x${outProbe.height}@${outProbe.fps.toFixed(2)} ${outProbe.pix_fmt}` : 'PROBE FAILED')
    if (!outProbe || outProbe.width <= 0 || outProbe.height <= 0) {
      throw new Error('הייצוא נכשל: הפלט אינו מכיל וידאו תקין. צור סרטון חדש.')
    }

    // -----------------------------------------------------------
    // 10. Return the MP4 as a stream (don't hold the whole file in RAM)
    // -----------------------------------------------------------
    const outputSize = fs.statSync(outputPath).size
    const totalMs = Date.now() - startedAt
    console.log(`[Export] DONE — ${(outputSize / 1024 / 1024).toFixed(1)}MB in ${totalMs}ms (normalize-skipped: ${canSkipNormalize}, fastExport: ${!!fastExport}, nbFallbacks: ${nbFallbackCount}, blackFallbacks: ${blackFallbackCount}, fallbackKinds: ${JSON.stringify(fallbackKinds)})`)

    // Stream the file — clean up jobDir after the stream finishes.
    const nodeStream = fs.createReadStream(outputPath)
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(chunk))
        nodeStream.on('end', () => {
          controller.close()
          rm(jobDir, { recursive: true, force: true }).catch(() => {})
        })
        nodeStream.on('error', (err) => {
          controller.error(err)
          rm(jobDir, { recursive: true, force: true }).catch(() => {})
        })
      },
      cancel() {
        try { nodeStream.destroy() } catch {}
        rm(jobDir, { recursive: true, force: true }).catch(() => {})
      },
    })

    // Release the lock — the stream now owns the temp dir cleanup.
    exportInProgress = false

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="ugc-video.mp4"',
        'Content-Length': String(outputSize),
        'X-Export-Ms': String(totalMs),
        'X-Normalize-Skipped': String(canSkipNormalize),
      },
    })
  } catch (e) {
    console.error('[Export] Error:', e.message)
    rm(jobDir, { recursive: true, force: true }).catch(() => {})
    // Detect SIGKILL / OOM kills so the UI can surface a clearer message.
    const msg = String(e.message || '')
    const stderr = String(e.stderr || '')
    const looksLikeKill =
      /SIGKILL|signal 9|killed|code null/i.test(msg) ||
      /SIGKILL|signal 9|killed/i.test(stderr) ||
      e.code === null ||
      e.signal === 'SIGKILL'
    const userMessage = looksLikeKill
      ? 'השרת נפל, נסה שוב בעוד דקה'
      : e.message
    exportInProgress = false
    return Response.json({ error: userMessage }, { status: looksLikeKill ? 503 : 500 })
  } finally {
    // Safety net — if we somehow returned without clearing the lock, clear it now.
    // (The happy path clears it just before returning so the stream doesn't hold it.)
    if (exportInProgress) exportInProgress = false
  }
}
