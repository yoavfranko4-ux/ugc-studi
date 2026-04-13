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

export async function POST(req) {
  const jobDir = path.join('/tmp', `export-${randomUUID()}`)

  try {
    const body = await req.json()
    const { videoClipsB64, videoUrls, audioBase64, subtitles, bgMusic, subtitleStyle } = body

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
    console.log('[Export] Concat list:', listContent)

    // 4. Build FFmpeg args — simple concat + scale + audio, NO subtitles
    // (ffmpeg-static doesn't include libass; subtitles handled client-side)
    const outputPath = path.join(jobDir, 'output.mp4')
    const videoFilter = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280'

    const ffmpegArgs = ['-y']

    // Input: concatenated video
    ffmpegArgs.push('-f', 'concat', '-safe', '0', '-i', listPath)

    // Input: voiceover audio (if available)
    if (voicePath) {
      ffmpegArgs.push('-i', voicePath)
    }

    // Filter + mapping
    if (voicePath) {
      ffmpegArgs.push(
        '-filter_complex', `[0:v]${videoFilter}[v];[1:a]volume=0.85[a]`,
        '-map', '[v]', '-map', '[a]'
      )
    } else {
      ffmpegArgs.push(
        '-vf', videoFilter,
        '-an'
      )
    }

    // Output encoding
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-r', '24',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-shortest',
      outputPath
    )

    console.log('[Export] FFmpeg args:', JSON.stringify(ffmpegArgs))

    try {
      const { stdout, stderr } = await execFileAsync(ffmpegPath, ffmpegArgs, {
        timeout: 90000,
        maxBuffer: 10 * 1024 * 1024
      })
      console.log('[Export] FFmpeg stdout:', stdout?.slice(-200) || '(empty)')
      console.log('[Export] FFmpeg stderr:', stderr?.slice(-1000) || '(empty)')
    } catch (execErr) {
      // execFile rejects on non-zero exit — log full stderr before rethrowing
      console.error('[Export] FFmpeg FAILED. Exit code:', execErr.code)
      console.error('[Export] FFmpeg stderr FULL:', execErr.stderr?.slice(-2000) || '(no stderr)')
      console.error('[Export] FFmpeg stdout:', execErr.stdout?.slice(-500) || '(no stdout)')
      throw new Error(`FFmpeg failed (code ${execErr.code}): ${execErr.stderr?.slice(-300) || execErr.message}`)
    }

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
    rm(jobDir, { recursive: true, force: true }).catch(() => {})
    return Response.json({ error: e.message }, { status: 500 })
  }
}
