import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, readFile, rm } from 'fs/promises'
import fs from 'fs'
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
    const { videoClipsB64, videoUrls, audioBase64, subtitles, bgMusic, bgMusicUrl, subtitleStyle } = body

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

    // 2. Write voiceover audio if provided — with debug + AAC pre-conversion to avoid MP3 decode issues
    let voicePath = null
    if (audioBase64) {
      console.log('[Export] audioBase64 encoded string length:', audioBase64.length, 'chars')
      const rawPath = path.join(jobDir, 'voice.mp3')
      const audioBuf = Buffer.from(audioBase64, 'base64')
      console.log('[Export] audioBuf decoded length:', audioBuf.length, 'bytes')
      await writeFile(rawPath, audioBuf)
      try {
        const diskStats = fs.statSync(rawPath)
        console.log('[Export] voice.mp3 on disk:', diskStats.size, 'bytes')
      } catch (e) { console.warn('[Export] statSync voice.mp3 failed:', e.message) }

      // Probe the MP3 via `ffmpeg -i` (no ffprobe available) — non-zero exit is expected
      try {
        const probeRes = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', rawPath, '-f', 'null', '-'], { maxBuffer: 4 * 1024 * 1024 }).catch(e => ({ stderr: e.stderr || e.message }))
        console.log('[Export] ffmpeg probe voice.mp3:', (probeRes.stderr || '').slice(-1200))
      } catch (e) { console.warn('[Export] probe failed:', e.message) }

      // Pre-convert to AAC/m4a — bypasses ffmpeg-static MP3 decoder bugs that produce 0 audio frames
      const convertedPath = path.join(jobDir, 'voice_converted.m4a')
      try {
        const convRes = await execFileAsync(ffmpegPath, [
          '-y', '-i', rawPath,
          '-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          convertedPath
        ], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
        const convStats = fs.statSync(convertedPath)
        console.log('[Export] voice_converted.m4a:', convStats.size, 'bytes')
        console.log('[Export] Converter stderr tail:', convRes.stderr?.slice(-400) || '(empty)')
        voicePath = convertedPath
      } catch (convErr) {
        console.error('[Export] Voice AAC conversion FAILED:', convErr.stderr?.slice(-800) || convErr.message)
        // Fall back to raw mp3 and hope for the best
        voicePath = rawPath
      }
    }

    // Download background music if URL provided
    let musicPath = null
    if (bgMusic && bgMusic !== 'none' && bgMusicUrl) {
      try {
        const resp = await fetch(bgMusicUrl)
        if (resp.ok) {
          const musicBuf = Buffer.from(await resp.arrayBuffer())
          const musicRaw = path.join(jobDir, 'music_raw.mp3')
          await writeFile(musicRaw, musicBuf)
          console.log('[Export] music downloaded:', musicBuf.length, 'bytes from', bgMusicUrl)
          // Convert to AAC too for consistency
          const musicConv = path.join(jobDir, 'music.m4a')
          try {
            await execFileAsync(ffmpegPath, ['-y', '-i', musicRaw, '-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', musicConv], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
            musicPath = musicConv
          } catch (me) {
            console.warn('[Export] music AAC conversion failed, using raw:', me.stderr?.slice(-300) || me.message)
            musicPath = musicRaw
          }
        } else {
          console.warn('[Export] music fetch HTTP', resp.status)
        }
      } catch (e) { console.warn('[Export] music download failed:', e.message) }
    }

    // 3. Build FFmpeg args using filter_complex concat filter (re-encodes, avoids H264 bitstream issues)
    const outputPath = path.join(jobDir, 'output.mp4')
    const n = validClipPaths.length

    const ffmpegArgs = ['-y']

    // Add each clip as a separate input
    for (const cp of validClipPaths) {
      ffmpegArgs.push('-i', cp)
    }

    // Audio inputs
    const voiceIdx = voicePath ? n : -1
    const musicIdx = musicPath ? (voicePath ? n + 1 : n) : -1
    if (voicePath) ffmpegArgs.push('-i', voicePath)
    if (musicPath) ffmpegArgs.push('-i', musicPath)

    // Build filter_complex: scale each clip to 720x1280 cover, then concat (video only)
    const scaleFilter = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1'
    const scaledStreams = validClipPaths.map((_, i) => `[${i}:v]${scaleFilter}[v${i}]`).join(';')
    const concatInputs = validClipPaths.map((_, i) => `[v${i}]`).join('')
    let filterComplex = `${scaledStreams};${concatInputs}concat=n=${n}:v=1:a=0[outv]`

    // Audio mixing: voice at full volume + music at 15% (looped), mix, duration=first (= voice length)
    let audioMapLabel = null
    if (voicePath && musicPath) {
      filterComplex += `;[${voiceIdx}:a]volume=1.0,aresample=44100[va];[${musicIdx}:a]volume=0.15,aloop=loop=-1:size=2000000000,aresample=44100[ma];[va][ma]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[aout]`
      audioMapLabel = '[aout]'
    } else if (voicePath) {
      filterComplex += `;[${voiceIdx}:a]aresample=44100[aout]`
      audioMapLabel = '[aout]'
    } else if (musicPath) {
      filterComplex += `;[${musicIdx}:a]volume=0.4,aresample=44100[aout]`
      audioMapLabel = '[aout]'
    }

    ffmpegArgs.push('-filter_complex', filterComplex, '-map', '[outv]')
    if (audioMapLabel) {
      ffmpegArgs.push('-map', audioMapLabel)
    } else {
      ffmpegArgs.push('-an')
    }

    // Output encoding
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-r', '24',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
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
