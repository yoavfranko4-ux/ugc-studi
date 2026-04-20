import { execFile, execSync } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

// Resolve ffmpeg / ffprobe the same way the export route does.
function resolveFfmpeg() {
  try {
    const w = execSync('which ffmpeg', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (w && fs.existsSync(w)) return w
  } catch {}
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/run/current-system/sw/bin/ffmpeg', '/root/.nix-profile/bin/ffmpeg']) {
    if (fs.existsSync(p)) return p
  }
  try {
    return require('ffmpeg-static')
  } catch { return null }
}

function resolveFfprobe(ffmpegBin) {
  if (ffmpegBin) {
    const sibling = ffmpegBin.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
    if (sibling !== ffmpegBin && fs.existsSync(sibling)) return sibling
  }
  try {
    const w = execSync('which ffprobe', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (w && fs.existsSync(w)) return w
  } catch {}
  for (const p of ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/run/current-system/sw/bin/ffprobe', '/root/.nix-profile/bin/ffprobe']) {
    if (fs.existsSync(p)) return p
  }
  return null
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/debug/ffprobe
// Runs ffprobe against a generated known-good mp4 so we can see exactly why
// ffprobe fails in this deployment environment. Returns full stdout + stderr.
export async function GET() {
  const ffmpegPath = resolveFfmpeg()
  const ffprobePath = resolveFfprobe(ffmpegPath)
  const out = {
    ffmpegPath,
    ffprobePath,
    ffmpegExists: ffmpegPath ? fs.existsSync(ffmpegPath) : false,
    ffprobeExists: ffprobePath ? fs.existsSync(ffprobePath) : false,
  }

  // Step 1: `ffprobe -version`
  if (ffprobePath) {
    try {
      const r = await execFileAsync(ffprobePath, ['-version'], { timeout: 8000 })
      out.version = { stdout: r.stdout, stderr: r.stderr }
    } catch (e) {
      out.version = {
        error: e.message,
        code: e.code,
        signal: e.signal,
        stderr: (e.stderr || '').slice(-800),
        stdout: (e.stdout || '').slice(-800),
      }
    }
  } else {
    out.version = { error: 'ffprobe binary not resolved' }
  }

  // Step 2: generate a small known-good mp4 with ffmpeg, then ffprobe it.
  const tmp = path.join('/tmp', `ffprobe-test-${Date.now()}.mp4`)
  if (ffmpegPath) {
    try {
      await execFileAsync(ffmpegPath, [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=red:s=320x240:r=24:d=1',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        tmp,
      ], { timeout: 20000 })
      out.testFile = { path: tmp, size: fs.statSync(tmp).size }
    } catch (e) {
      out.testFile = {
        error: 'ffmpeg-generate failed',
        message: e.message,
        stderr: (e.stderr || '').slice(-800),
      }
    }
  }

  // Step 3: ffprobe the test file (full JSON + stderr).
  if (ffprobePath && fs.existsSync(tmp)) {
    try {
      const r = await execFileAsync(ffprobePath, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height,r_frame_rate,pix_fmt,duration:format=duration,format_name',
        '-of', 'json',
        tmp,
      ], { timeout: 15000 })
      out.probeKnownGood = { stdout: r.stdout, stderr: r.stderr }
    } catch (e) {
      out.probeKnownGood = {
        error: e.message,
        code: e.code,
        signal: e.signal,
        stderr: (e.stderr || '').slice(-800),
        stdout: (e.stdout || '').slice(-800),
      }
    }
  }

  // Step 4: ffprobe with -v debug — maximum verbosity to see what it hates.
  if (ffprobePath && fs.existsSync(tmp)) {
    try {
      const r = await execFileAsync(ffprobePath, ['-v', 'debug', tmp], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 })
      out.probeVerbose = { stdout: (r.stdout || '').slice(0, 2000), stderr: (r.stderr || '').slice(-2000) }
    } catch (e) {
      out.probeVerbose = {
        error: e.message,
        stderr: (e.stderr || '').slice(-2000),
        stdout: (e.stdout || '').slice(-2000),
      }
    }
  }

  // Clean up.
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch {}

  return Response.json(out)
}
