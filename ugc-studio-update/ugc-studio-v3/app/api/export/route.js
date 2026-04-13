import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, readFile, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import path from 'path'

const execAsync = promisify(exec)

export const maxDuration = 120

// Find ffmpeg binary — try system path first, then ffmpeg-static
async function findFfmpeg() {
  try {
    const { stdout } = await execAsync('which ffmpeg')
    const p = stdout.trim()
    if (p) return p
  } catch {}
  try {
    const mod = await import('ffmpeg-static')
    if (mod.default) return mod.default
  } catch {}
  return 'ffmpeg' // hope it's on PATH
}

// Escape text for FFmpeg drawtext filter (handle special chars + Hebrew)
function escapeDrawtext(text) {
  if (!text) return ''
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\\\'")
    .replace(/:/g, '\\\\:')
    .replace(/%/g, '%%')
    .replace(/\n/g, '')
}

export async function POST(req) {
  const jobDir = path.join('/tmp', `export-${randomUUID()}`)

  try {
    const body = await req.json()
    const { videoUrls, audioBase64, subtitles, bgMusic, subtitleStyle } = body

    if (!videoUrls?.length || !videoUrls.some(Boolean)) {
      return Response.json({ error: 'No video URLs provided' }, { status: 400 })
    }

    const ffmpeg = await findFfmpeg()
    console.log('[Export] FFmpeg path:', ffmpeg)

    await mkdir(jobDir, { recursive: true })

    // 1. Download all video clips in parallel
    console.log('[Export] Downloading', videoUrls.length, 'clips...')
    const clipPaths = []
    await Promise.all(videoUrls.filter(Boolean).map(async (url, i) => {
      const clipPath = path.join(jobDir, `clip${i}.mp4`)
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`Failed to download clip ${i}: HTTP ${resp.status}`)
      const buf = Buffer.from(await resp.arrayBuffer())
      await writeFile(clipPath, buf)
      clipPaths[i] = clipPath
      console.log(`[Export] Clip ${i}: ${(buf.length / 1024 / 1024).toFixed(1)}MB`)
    }))
    const validClipPaths = clipPaths.filter(Boolean)
    if (validClipPaths.length === 0) throw new Error('No clips downloaded successfully')

    // 2. Write voiceover audio if provided
    let voicePath = null
    if (audioBase64) {
      voicePath = path.join(jobDir, 'voice.mp3')
      const audioBuf = Buffer.from(audioBase64, 'base64')
      await writeFile(voicePath, audioBuf)
      console.log(`[Export] Voiceover: ${(audioBuf.length / 1024).toFixed(0)}KB`)
    }

    // 3. Write concat list file
    const listPath = path.join(jobDir, 'list.txt')
    const listContent = validClipPaths.map(p => `file '${p}'`).join('\n')
    await writeFile(listPath, listContent)

    // 4. Build FFmpeg command
    const outputPath = path.join(jobDir, 'output.mp4')

    // Build subtitle drawtext filter chain
    let subtitleFilter = ''
    if (subtitles?.length) {
      const drawtexts = subtitles.map((sub) => {
        if (!sub.text) return null
        const escaped = escapeDrawtext(sub.text)
        const start = sub.start || 0
        const end = start + (sub.duration || 5)
        return `drawtext=text='${escaped}':fontsize=28:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.85:enable='between(t\\,${start}\\,${end})'`
      }).filter(Boolean)
      if (drawtexts.length) {
        subtitleFilter = drawtexts.join(',')
      }
    }

    // Build filter_complex
    let filterComplex = ''
    let inputArgs = ['-f', 'concat', '-safe', '0', '-i', listPath]
    let mapArgs = []

    if (voicePath) {
      inputArgs.push('-i', voicePath)
    }

    // Video filter: scale to 720x1280, crop to fill (cover mode), add subtitles
    let videoFilter = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280'
    if (subtitleFilter) {
      videoFilter += ',' + subtitleFilter
    }

    if (voicePath) {
      filterComplex = `[0:v]${videoFilter}[v];[1:a]volume=0.85[a]`
      mapArgs = ['-map', '[v]', '-map', '[a]']
    } else {
      filterComplex = `[0:v]${videoFilter}[v]`
      mapArgs = ['-map', '[v]', '-an']
    }

    const ffmpegArgs = [
      '-y',
      ...inputArgs,
      '-filter_complex', filterComplex,
      ...mapArgs,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-r', '24',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-shortest',
      outputPath
    ]

    const cmd = `${ffmpeg} ${ffmpegArgs.map(a => `'${a}'`).join(' ')}`
    console.log('[Export] Running FFmpeg...')
    console.log('[Export] Command:', cmd.slice(0, 300))

    const { stdout, stderr } = await execAsync(cmd, { timeout: 90000, maxBuffer: 10 * 1024 * 1024 })
    if (stderr) console.log('[Export] FFmpeg stderr (last 500):', stderr.slice(-500))

    // 5. Read output and return as MP4
    const outputBuf = await readFile(outputPath)
    console.log(`[Export] Output: ${(outputBuf.length / 1024 / 1024).toFixed(1)}MB`)

    // 6. Cleanup
    rm(jobDir, { recursive: true, force: true }).catch(() => {})

    return new Response(outputBuf, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': 'attachment; filename="ugc-video.mp4"',
        'Content-Length': String(outputBuf.length),
      }
    })

  } catch (e) {
    console.error('[Export] Error:', e.message)
    // Cleanup on error
    rm(jobDir, { recursive: true, force: true }).catch(() => {})
    return Response.json({ error: e.message }, { status: 500 })
  }
}
