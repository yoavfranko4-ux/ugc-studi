import { execFile, execSync } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, readFile, rm } from 'fs/promises'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const ffmpegStaticPath = require('ffmpeg-static')

// Prefer a system ffmpeg (via nixpacks.toml / apt) — typically built WITH libass,
// which enables the `subtitles=` filter for Hebrew subtitle burn-in.
// Fall back to ffmpeg-static if no system binary is found.
function resolveFfmpegPath() {
  try {
    const which = execSync('which ffmpeg', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (which && fs.existsSync(which)) return which
  } catch {}
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (fs.existsSync(p)) return p
  }
  return ffmpegStaticPath
}
const ffmpegPath = resolveFfmpegPath()
console.log('[Export] Resolved ffmpeg binary:', ffmpegPath)

const execFileAsync = promisify(execFile)

// Format seconds → SRT timestamp (HH:MM:SS,mmm)
function fmtSrtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

export const runtime = 'nodejs'
export const maxDuration = 240   // 4 normalize passes + 1 concat — bumped from 120

export async function POST(req) {
  const jobDir = path.join('/tmp', `export-${randomUUID()}`)

  try {
    const body = await req.json()
    const { videoClipsB64, videoUrls, audioBase64, audioFormat, subtitles, bgMusic, bgMusicUrl, subtitleStyle } = body

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
    //    Preferred path: client sends audioFormat='wav' (raw PCM) — FFmpeg reads it flawlessly.
    //    Legacy path: MP3 — we pre-convert to AAC to dodge ffmpeg-static MP3 decoder bugs.
    let voicePath = null
    if (audioBase64) {
      const fmt = audioFormat === 'wav' ? 'wav' : 'mp3'
      const ext = fmt
      console.log('[Export] audioBase64 encoded string length:', audioBase64.length, 'chars (format=' + fmt + ')')
      const rawPath = path.join(jobDir, `voice.${ext}`)
      const audioBuf = Buffer.from(audioBase64, 'base64')
      console.log('[Export] audioBuf decoded length:', audioBuf.length, 'bytes')
      await writeFile(rawPath, audioBuf)
      try {
        const diskStats = fs.statSync(rawPath)
        console.log(`[Export] voice.${ext} on disk:`, diskStats.size, 'bytes')
      } catch (e) { console.warn(`[Export] statSync voice.${ext} failed:`, e.message) }

      // Probe via ffmpeg -i
      try {
        const probeRes = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', rawPath, '-f', 'null', '-'], { maxBuffer: 4 * 1024 * 1024 }).catch(e => ({ stderr: e.stderr || e.message }))
        console.log(`[Export] ffmpeg probe voice.${ext}:`, (probeRes.stderr || '').slice(-1200))
      } catch (e) { console.warn('[Export] probe failed:', e.message) }

      if (fmt === 'wav') {
        // WAV is raw PCM — use directly, no pre-conversion needed
        voicePath = rawPath
        console.log('[Export] Using WAV voice directly — no pre-conversion')
      } else {
        // MP3 legacy path — pre-convert to AAC
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
          voicePath = rawPath
        }
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

    // =============================================================
    // TWO-STEP encode: (1) normalize each clip individually, (2) concat demuxer + audio mix.
    // Avoids timebase/tbn errors from filter_complex concat on variable-framerate Kling MP4s.
    // =============================================================
    const outputPath = path.join(jobDir, 'output.mp4')

    // --- Step 1: normalize every clip to identical codec/fps/size/pix_fmt ---
    const normalizedPaths = []
    for (let i = 0; i < validClipPaths.length; i++) {
      const inPath = validClipPaths[i]
      const normPath = path.join(jobDir, `norm_${i}.mp4`)
      const normArgs = [
        '-y', '-i', inPath,
        '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1',
        '-r', '24',
        '-fps_mode', 'cfr',
        '-vsync', 'cfr',
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-profile:v', 'high',
        '-level', '4.0',
        '-video_track_timescale', '24000',
        '-movflags', '+faststart',
        '-an',
        normPath
      ]
      console.log(`[Export] Step 1: Normalizing clip ${i} -> norm_${i}.mp4`)
      console.log(`[Export] Normalize args[${i}]:`, JSON.stringify(normArgs))
      try {
        const r = await execFileAsync(ffmpegPath, normArgs, { timeout: 60000, maxBuffer: 20 * 1024 * 1024 })
        console.log(`[Export] norm_${i} stderr FULL:\n${r.stderr || '(empty)'}`)
        const sz = fs.statSync(normPath).size
        console.log(`[Export] norm_${i}.mp4 size:`, sz, 'bytes')
        normalizedPaths.push(normPath)
      } catch (err) {
        console.error(`[Export] Normalization clip ${i} FAILED. Exit code:`, err.code)
        console.error(`[Export] Normalize stderr FULL:\n${err.stderr || '(no stderr)'}`)
        console.error(`[Export] Normalize stdout FULL:\n${err.stdout || '(no stdout)'}`)
        throw new Error(`Normalize clip ${i} failed (code ${err.code}): ${err.stderr?.slice(-400) || err.message}`)
      }
    }

    // --- Build SRT subtitles file (UTF-8) from the subtitles array ---
    // subtitles: Array<{ text, start (sec), duration (sec) }>
    const totalDuration = validClipPaths.length * 5   // 5s per clip — matches client's subtitle schedule
    let srtPath = null
    if (Array.isArray(subtitles) && subtitles.length) {
      const srtLines = []
      let idx = 1
      for (const sub of subtitles) {
        const text = (sub?.text || '').trim()
        if (!text) continue
        const start = Number(sub.start) || 0
        const end = start + (Number(sub.duration) || 5)
        srtLines.push(String(idx++))
        srtLines.push(`${fmtSrtTime(start)} --> ${fmtSrtTime(end)}`)
        srtLines.push(text)
        srtLines.push('')
      }
      if (srtLines.length) {
        srtPath = path.join(jobDir, 'subs.srt')
        await writeFile(srtPath, srtLines.join('\n'), 'utf8')
        console.log('[Export] SRT written to', srtPath)
        console.log('[Export] SRT content:\n' + srtLines.join('\n'))
      }
    }

    // --- Step 2: concat demuxer + optional subtitle burn-in + audio mix ---
    const listPath = path.join(jobDir, 'list.txt')
    const listContent = normalizedPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
    await writeFile(listPath, listContent)
    console.log('[Export] list.txt content:\n' + listContent)

    const finalArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]

    // Audio inputs (after the concat demuxer at input 0)
    let voiceInputIdx = -1, musicInputIdx = -1, nextIdx = 1
    if (voicePath) { finalArgs.push('-i', voicePath); voiceInputIdx = nextIdx++ }
    if (musicPath) { finalArgs.push('-i', musicPath); musicInputIdx = nextIdx }

    // Build filter_complex — video chain (with subtitles if available) + audio mix
    const escapeForFilter = (p) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
    const videoChain = srtPath
      // force_style uses ASS style codes — white text, black outline, bottom-center, bold
      ? `[0:v]subtitles='${escapeForFilter(srtPath)}':force_style='FontName=DejaVu Sans,FontSize=22,Bold=1,PrimaryColour=&HFFFFFFFF,OutlineColour=&HFF000000,BackColour=&H00000000,Outline=3,Shadow=1,Alignment=2,MarginV=90'[outv]`
      : null

    let audioChain = null
    if (voicePath && musicPath) {
      audioChain = `[${voiceInputIdx}:a]volume=1.0,apad=whole_dur=${totalDuration},aresample=44100[va];[${musicInputIdx}:a]volume=0.15,aloop=loop=-1:size=2000000000,aresample=44100[ma];[va][ma]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[aout]`
    } else if (voicePath) {
      audioChain = `[${voiceInputIdx}:a]apad=whole_dur=${totalDuration},aresample=44100[aout]`
    } else if (musicPath) {
      audioChain = `[${musicInputIdx}:a]volume=0.4,aloop=loop=-1:size=2000000000,aresample=44100[aout]`
    }

    const filterParts = []
    if (videoChain) filterParts.push(videoChain)
    if (audioChain) filterParts.push(audioChain)
    if (filterParts.length) finalArgs.push('-filter_complex', filterParts.join(';'))

    // Mapping
    if (videoChain) finalArgs.push('-map', '[outv]')
    else finalArgs.push('-map', '0:v:0')
    if (audioChain) finalArgs.push('-map', '[aout]')
    else finalArgs.push('-an')

    // Encoding — if we applied subtitles, must re-encode video; otherwise stream-copy is fine
    if (videoChain) {
      finalArgs.push(
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-r', '24',
        '-pix_fmt', 'yuv420p',
      )
    } else {
      finalArgs.push('-c:v', 'copy')
    }

    finalArgs.push(
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      // Explicit duration cap — NO -shortest (which clipped to voice length = 15s instead of 20s)
      '-t', String(totalDuration),
      outputPath
    )

    console.log('[Export] Step 2 concat args:', JSON.stringify(finalArgs))

    try {
      const { stdout, stderr } = await execFileAsync(ffmpegPath, finalArgs, {
        timeout: 90000,
        maxBuffer: 20 * 1024 * 1024
      })
      console.log('[Export] Concat stdout FULL:\n' + (stdout || '(empty)'))
      console.log('[Export] Concat stderr FULL:\n' + (stderr || '(empty)'))
    } catch (execErr) {
      console.error('[Export] Concat FAILED. Exit code:', execErr.code)
      console.error('[Export] Concat stderr FULL:\n' + (execErr.stderr || '(no stderr)'))
      console.error('[Export] Concat stdout FULL:\n' + (execErr.stdout || '(no stdout)'))

      // Fallback: if subtitles filter failed (libass missing), retry WITHOUT subtitles so user still gets a video
      if (srtPath && /subtitles|libass|No such filter/i.test(String(execErr.stderr || ''))) {
        console.warn('[Export] Subtitle burn-in failed — retrying without subtitles as fallback')
        const fallbackArgs = finalArgs.filter((a, i) => {
          // Drop the -filter_complex value (subtitle) but keep audio filter; simplest: rerun with no video filter
          return true
        })
        // Rebuild from scratch without videoChain
        const fb = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]
        if (voicePath) fb.push('-i', voicePath)
        if (musicPath) fb.push('-i', musicPath)
        if (audioChain) fb.push('-filter_complex', audioChain, '-map', '0:v:0', '-map', '[aout]')
        else fb.push('-map', '0:v:0', '-an')
        fb.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
                '-movflags', '+faststart', '-t', String(totalDuration), outputPath)
        console.log('[Export] Fallback args:', JSON.stringify(fb))
        try {
          const r = await execFileAsync(ffmpegPath, fb, { timeout: 90000, maxBuffer: 20 * 1024 * 1024 })
          console.log('[Export] Fallback concat stderr FULL:\n' + (r.stderr || '(empty)'))
        } catch (fbErr) {
          console.error('[Export] Fallback ALSO failed:', fbErr.stderr || fbErr.message)
          throw new Error(`Concat failed (code ${execErr.code}): ${execErr.stderr?.slice(-400) || execErr.message}`)
        }
      } else {
        throw new Error(`Concat failed (code ${execErr.code}): ${execErr.stderr?.slice(-400) || execErr.message}`)
      }
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
