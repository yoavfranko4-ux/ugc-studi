import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, readFile, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'
export const maxDuration = 120

// Generate ASS subtitle file content from subtitles array
// Replicates the editor's word-level timing: split into 3-word segments,
// show 2 lines at a time, advance based on timePerLine = sceneDuration / numSegments
function generateAssFile(subtitles) {
  const header = `[Script Info]
Title: UGC Studio Export
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,36,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,30,30,190,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  // Format time as H:MM:SS.CC (ASS centisecond format)
  function formatTime(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const cs = Math.round((seconds % 1) * 100)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
  }

  // Split text into 3-word segments (same as client splitSubtitle)
  function splitText(text) {
    if (!text) return []
    const words = text.split(/\s+/).filter(Boolean)
    const lines = []
    for (let i = 0; i < words.length; i += 3) {
      lines.push(words.slice(i, i + 3).join(' '))
    }
    return lines
  }

  let events = ''
  for (const sub of subtitles) {
    if (!sub.text) continue
    const sceneStart = sub.start || 0
    const sceneDuration = sub.duration || 5
    const segments = splitText(sub.text)
    if (segments.length === 0) continue

    const timePerSegment = sceneDuration / segments.length

    // Show 2 lines at a time, advancing per segment (matches editor behavior)
    for (let i = 0; i < segments.length; i++) {
      const lineStart = sceneStart + i * timePerSegment
      const lineEnd = sceneStart + (i + 1) * timePerSegment
      // Combine current line + next line with \N (ASS newline)
      const visibleLines = segments.slice(i, i + 2).join('\\N')
      events += `Dialogue: 0,${formatTime(lineStart)},${formatTime(lineEnd)},Default,,0,0,0,,${visibleLines}\n`
    }
  }

  return header + events
}

export async function POST(req) {
  const jobDir = path.join('/tmp', `export-${randomUUID()}`)

  try {
    const body = await req.json()
    const { videoClipsB64, videoUrls, audioBase64, subtitles, bgMusic, subtitleStyle } = body

    // Accept either base64 clips (preferred, avoids expired URLs) or URLs (legacy)
    const hasB64Clips = videoClipsB64?.length > 0
    const hasUrls = videoUrls?.length > 0 && videoUrls.some(Boolean)
    if (!hasB64Clips && !hasUrls) {
      return Response.json({ error: 'No video clips provided' }, { status: 400 })
    }

    console.log('[Export] FFmpeg path:', ffmpegPath)

    await mkdir(jobDir, { recursive: true })

    // 1. Write video clips to /tmp
    const clipPaths = []
    if (hasB64Clips) {
      // Write base64 clips directly — no network fetch needed
      console.log('[Export] Writing', videoClipsB64.length, 'base64 clips...')
      for (let i = 0; i < videoClipsB64.length; i++) {
        if (!videoClipsB64[i]) continue
        const clipPath = path.join(jobDir, `clip${i}.mp4`)
        const buf = Buffer.from(videoClipsB64[i], 'base64')
        await writeFile(clipPath, buf)
        clipPaths[i] = clipPath
        console.log(`[Export] Clip ${i}: ${(buf.length / 1024 / 1024).toFixed(1)}MB`)
      }
    } else {
      // Legacy: download from URLs
      console.log('[Export] Downloading', videoUrls.length, 'clips from URLs...')
      await Promise.all(videoUrls.filter(Boolean).map(async (url, i) => {
        const clipPath = path.join(jobDir, `clip${i}.mp4`)
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`Failed to download clip ${i}: HTTP ${resp.status}`)
        const buf = Buffer.from(await resp.arrayBuffer())
        await writeFile(clipPath, buf)
        clipPaths[i] = clipPath
        console.log(`[Export] Clip ${i}: ${(buf.length / 1024 / 1024).toFixed(1)}MB`)
      }))
    }
    const validClipPaths = clipPaths.filter(Boolean)
    if (validClipPaths.length === 0) throw new Error('No clips written successfully')

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

    // 4. Generate ASS subtitle file (supports Hebrew/RTL natively)
    const outputPath = path.join(jobDir, 'output.mp4')
    let assPath = null
    if (subtitles?.length && subtitles.some(s => s.text)) {
      assPath = path.join(jobDir, 'subs.ass')
      const assContent = generateAssFile(subtitles)
      await writeFile(assPath, assContent, 'utf-8')
      console.log('[Export] ASS subtitle file written')
    }

    // 5. Build FFmpeg command
    let inputArgs = ['-f', 'concat', '-safe', '0', '-i', listPath]
    let mapArgs = []

    if (voicePath) {
      inputArgs.push('-i', voicePath)
    }

    // Video filter: scale to 720x1280 cover mode, then burn ASS subtitles
    let videoFilter = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280'
    if (assPath) {
      // ASS filter needs the path escaped for FFmpeg filter syntax
      const escapedAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:')
      videoFilter += `,ass='${escapedAssPath}'`
    }

    let filterComplex = ''
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

    console.log('[Export] Running FFmpeg with execFile...')
    console.log('[Export] Args:', ffmpegArgs.join(' ').slice(0, 300))

    const { stdout, stderr } = await execFileAsync(ffmpegPath, ffmpegArgs, { timeout: 90000, maxBuffer: 10 * 1024 * 1024 })
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
