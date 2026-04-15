import { execFile, execSync } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir, readFile, rm } from 'fs/promises'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const ffmpegStaticPath = require('ffmpeg-static')

// Force use of the SYSTEM ffmpeg (nixpacks `ffmpeg-full`) which is built with libass, libfribidi,
// and libfreetype — required for Hebrew subtitle burn-in via the `subtitles=` filter.
// ffmpeg-static lacks those libs. We only fall back to it if nothing else exists.
function resolveFfmpegPath() {
  // 1. `which ffmpeg` — works when PATH points at the nix profile
  try {
    const w = execSync('which ffmpeg', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    if (w && fs.existsSync(w)) return w
  } catch {}
  // 2. Standard UNIX locations
  for (const p of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/run/current-system/sw/bin/ffmpeg', '/root/.nix-profile/bin/ffmpeg']) {
    if (fs.existsSync(p)) return p
  }
  // 3. Scan /nix/store for an ffmpeg binary (nixpacks installs it there)
  try {
    const found = execSync("find /nix/store -maxdepth 4 -type f -name ffmpeg 2>/dev/null | head -1", { encoding: 'utf8', shell: '/bin/sh' }).trim()
    if (found && fs.existsSync(found)) return found
  } catch {}
  // 4. Last resort — bundled static binary (no libass)
  return ffmpegStaticPath
}
const ffmpegPath = resolveFfmpegPath()
console.log('[Export] Resolved ffmpeg binary:', ffmpegPath, '(ffmpeg-static =', ffmpegStaticPath, ')')

// Log ffmpeg version + libass availability ONCE at module load
try {
  const ver = execSync(`"${ffmpegPath}" -version 2>&1 | head -3`, { encoding: 'utf8', shell: '/bin/sh', stdio: ['pipe', 'pipe', 'ignore'] })
  console.log('[Export] ffmpeg version:\n' + ver)
} catch (e) { console.warn('[Export] Could not run ffmpeg -version:', e.message) }

// === Embedded font (checked into repo at public/fonts/) ===
// libass loads this directly via fontsdir= — bypasses fontconfig entirely,
// so it works regardless of whether DejaVu/Noto are installed at the OS level.
const EMBEDDED_FONT_DIR    = path.join(process.cwd(), 'public', 'fonts')
const EMBEDDED_FONT_FILE   = path.join(EMBEDDED_FONT_DIR, 'NotoSansHebrew-Bold.ttf')
const EMBEDDED_FONT_FAMILY = 'Noto Sans Hebrew'

console.log('[Export] Embedded font dir:', EMBEDDED_FONT_DIR)
console.log('[Export] Embedded font file:', EMBEDDED_FONT_FILE, 'exists:', fs.existsSync(EMBEDDED_FONT_FILE))

const hebrewFontPath = fs.existsSync(EMBEDDED_FONT_FILE) ? EMBEDDED_FONT_FILE : null

const execFileAsync = promisify(execFile)

// Reverse a Hebrew string so drawtext (which lacks BiDi/libass) renders it visually right-to-left.
// Hack for pure-Hebrew short phrases; not linguistically correct for mixed content, but readable.
function reverseIfHebrew(text) {
  if (!text) return text
  if (!/[\u0590-\u05FF]/.test(text)) return text
  return text.split('').reverse().join('')
}

// Escape a string value for use inside an ffmpeg filter_complex argument
function escapeFilterValue(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

// Format seconds → SRT timestamp (HH:MM:SS,mmm)
function fmtSrtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

// Format seconds → ASS timestamp (H:MM:SS.cc — centiseconds)
function fmtAssTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.round((sec - Math.floor(sec)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// Build an ASS (Advanced SubStation Alpha) subtitle file. libass + libfribidi handle
// the Hebrew RTL shaping correctly, so we pass logical-order text straight through.
function buildAssFile(subtitles, wordTimestamps, fontFamily) {
  const fam = fontFamily || 'DejaVu Sans'
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fam},56,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,30,30,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const events = []
  const escapeAss = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\N').replace(/\{/g, '\\{').replace(/\}/g, '\\}')

  if (Array.isArray(wordTimestamps) && wordTimestamps.length) {
    // Group ~3 words per caption segment for readable word-level timing
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

export const runtime = 'nodejs'
export const maxDuration = 240   // 4 normalize passes + 1 concat — bumped from 120

export async function POST(req) {
  const jobDir = path.join('/tmp', `export-${randomUUID()}`)

  try {
    const body = await req.json()
    const { videoClipsB64, videoUrls, audioBase64, audioFormat, subtitles, wordTimestamps, bgMusic, bgMusicUrl, subtitleStyle } = body

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
      // Log base64 payload lengths BEFORE decoding so we can tell whether the
      // client sent bad data (short/empty string) vs. valid base64 that
      // decodes to a corrupt MP4.
      videoClipsB64.forEach((b64, i) => {
        const len = b64?.length ?? 0
        console.log(`[Export] videoClipsB64[${i}] base64 length: ${len} chars` + (len === 0 ? ' (EMPTY)' : ''))
      })
      for (let i = 0; i < videoClipsB64.length; i++) {
        if (!videoClipsB64[i]) {
          console.warn(`[Export] videoClipsB64[${i}] is empty — will be filled with black placeholder in Step 1`)
          continue
        }
        const clipPath = path.join(jobDir, `clip${i}.mp4`)
        const buf = Buffer.from(videoClipsB64[i], 'base64')
        await writeFile(clipPath, buf)
        clipPaths[i] = clipPath
        console.log(`[Export] Clip ${i} on disk: ${buf.length} bytes (${(buf.length / 1024 / 1024).toFixed(2)}MB)`)
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
    // Keep positional slots — an empty/missing slot gets a black placeholder
    // in Step 1 instead of being silently dropped. This way clip indices stay
    // aligned with subtitles/wordTimestamps that key off scene position.
    const expectedCount = hasB64Clips ? videoClipsB64.length : videoUrls.length
    const validClipPaths = []
    for (let i = 0; i < expectedCount; i++) validClipPaths[i] = clipPaths[i] || null
    if (!validClipPaths.some(Boolean)) throw new Error('No clips written successfully')

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

    // Load background music. For relative paths (e.g. "/music/track1.mp3") we read
    // the file off local disk from public/. Absolute http(s) URLs still fetch.
    let musicPath = null
    if (bgMusic && bgMusic !== 'none' && bgMusicUrl) {
      try {
        let musicBuf = null
        const isHttp = /^https?:\/\//i.test(bgMusicUrl)
        if (!isHttp) {
          // Relative path → resolve against public/
          const rel = bgMusicUrl.replace(/^\/+/, '')
          const diskPath = path.join(process.cwd(), 'public', rel)
          const exists = fs.existsSync(diskPath)
          console.log('[Export] music local lookup:', bgMusicUrl, '→', diskPath, 'exists:', exists)
          if (exists) {
            const stats = fs.statSync(diskPath)
            console.log('[Export] music file size on disk:', stats.size, 'bytes')
            musicBuf = await readFile(diskPath)
          } else {
            console.warn('[Export] music file NOT FOUND on disk:', diskPath)
          }
        } else {
          const resp = await fetch(bgMusicUrl)
          if (resp.ok) {
            musicBuf = Buffer.from(await resp.arrayBuffer())
            console.log('[Export] music downloaded:', musicBuf.length, 'bytes from', bgMusicUrl)
          } else {
            console.warn('[Export] music fetch HTTP', resp.status, 'for', bgMusicUrl)
          }
        }

        if (musicBuf) {
          const musicRaw = path.join(jobDir, 'music_raw.mp3')
          await writeFile(musicRaw, musicBuf)
          console.log('[Export] music raw written:', musicBuf.length, 'bytes')
          // Convert to AAC too for consistency
          const musicConv = path.join(jobDir, 'music.m4a')
          try {
            await execFileAsync(ffmpegPath, ['-y', '-i', musicRaw, '-vn', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', musicConv], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 })
            musicPath = musicConv
            console.log('[Export] music.m4a ready at', musicConv)
          } catch (me) {
            console.warn('[Export] music AAC conversion failed, using raw:', me.stderr?.slice(-300) || me.message)
            musicPath = musicRaw
          }
        }
      } catch (e) { console.warn('[Export] music load failed:', e.message) }
    }

    // =============================================================
    // TWO-STEP encode: (1) normalize each clip individually, (2) concat demuxer + audio mix.
    // Avoids timebase/tbn errors from filter_complex concat on variable-framerate Kling MP4s.
    // =============================================================
    const outputPath = path.join(jobDir, 'output.mp4')

    // --- Step 1: normalize every clip to identical codec/fps/size/pix_fmt (no subtitles) ---
    // Subtitle burn-in happens in Step 2 via libass (system ffmpeg-full has libass + libfribidi for Hebrew RTL).
    const normalizedPaths = []
    const totalDuration = validClipPaths.length * 5

    const MIN_CLIP_BYTES = 50 * 1024 // 50KB — anything smaller is almost certainly a corrupt MP4
    for (let i = 0; i < validClipPaths.length; i++) {
      let inPath = validClipPaths[i]
      const normPath = path.join(jobDir, `norm_${i}.mp4`)

      // Log incoming clip size and replace missing/empty/corrupt clips with a
      // 5-second black placeholder so FFmpeg doesn't crash on "speed=N/A, 0KiB".
      let inSize = 0
      if (inPath) {
        try { inSize = fs.statSync(inPath).size } catch { inSize = 0 }
        console.log(`[Export] Step 1: clip ${i} input size: ${inSize} bytes (${(inSize / 1024).toFixed(1)}KB)`)
      } else {
        console.warn(`[Export] Step 1: clip ${i} slot is missing (never written)`)
      }

      const needsPlaceholder = !inPath || inSize < MIN_CLIP_BYTES
      if (needsPlaceholder) {
        const reason = !inPath
          ? 'missing slot'
          : inSize === 0
            ? 'zero bytes on disk'
            : `only ${(inSize / 1024).toFixed(1)}KB (<50KB threshold)`
        console.warn(`[Export] Clip ${i} ${reason} — substituting 5-second black placeholder`)
        const blackPath = path.join(jobDir, `black_${i}.mp4`)
        const blackArgs = [
          '-y',
          '-f', 'lavfi', '-i', 'color=c=black:s=720x1280:r=24',
          '-t', '5',
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-an',
          blackPath
        ]
        try {
          await execFileAsync(ffmpegPath, blackArgs, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 })
          inPath = blackPath
          const blackSize = fs.statSync(blackPath).size
          console.log(`[Export] Black placeholder for clip ${i} written: ${blackSize} bytes → ${blackPath}`)
        } catch (blackErr) {
          console.error(`[Export] Failed to build black placeholder for clip ${i}:`, blackErr.stderr?.slice(-400) || blackErr.message)
          throw new Error(`Clip ${i} is invalid and black placeholder generation failed`)
        }
      }

      const vfChain = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1'

      const normArgs = [
        '-y', '-i', inPath,
        '-vf', vfChain,
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

    // --- Build ASS subtitle file (libass + libfribidi handle Hebrew RTL properly) ---
    let assPath = null
    const hasSubs = (Array.isArray(wordTimestamps) && wordTimestamps.length) || (Array.isArray(subtitles) && subtitles.length)
    if (hasSubs) {
      const assContent = buildAssFile(subtitles || [], wordTimestamps || null, EMBEDDED_FONT_FAMILY)
      assPath = path.join(jobDir, 'subs.ass')
      await writeFile(assPath, assContent, 'utf8')
      console.log('[Export] ASS written to', assPath, '(font family:', EMBEDDED_FONT_FAMILY, ')')
      console.log('[Export] ASS content:\n' + assContent)
    } else {
      console.log('[Export] No subtitles payload — skipping subtitle burn-in')
    }

    // --- Step 2: concat demuxer + audio mix (video stream-copied — subtitles already burned) ---
    const listPath = path.join(jobDir, 'list.txt')
    const listContent = normalizedPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
    await writeFile(listPath, listContent)
    console.log('[Export] list.txt content:\n' + listContent)

    const finalArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]

    // Audio inputs (after the concat demuxer at input 0)
    let voiceInputIdx = -1, musicInputIdx = -1, nextIdx = 1
    if (voicePath) { finalArgs.push('-i', voicePath); voiceInputIdx = nextIdx++ }
    if (musicPath) { finalArgs.push('-i', musicPath); musicInputIdx = nextIdx }

    // Video chain — apply ASS subtitles filter. libass loads the embedded font directly from
    // public/fonts/ via fontsdir= — no fontconfig required.
    let videoChain = null
    if (assPath) {
      const fontsDirArg = fs.existsSync(EMBEDDED_FONT_DIR) ? `:fontsdir='${escapeFilterValue(EMBEDDED_FONT_DIR)}'` : ''
      videoChain = `[0:v]subtitles='${escapeFilterValue(assPath)}'${fontsDirArg}[outv]`
    }

    let audioChain = null
    if (voicePath && musicPath) {
      audioChain = `[${voiceInputIdx}:a]volume=1.0,apad=whole_dur=${totalDuration},aresample=44100[va];[${musicInputIdx}:a]volume=0.15,aloop=loop=-1:size=2000000000,aresample=44100[ma];[va][ma]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[aout]`
    } else if (voicePath) {
      audioChain = `[${voiceInputIdx}:a]apad=whole_dur=${totalDuration},aresample=44100[aout]`
    } else if (musicPath) {
      audioChain = `[${musicInputIdx}:a]volume=0.15,aloop=loop=-1:size=2000000000,aresample=44100[aout]`
    }

    const filterParts = []
    if (videoChain) filterParts.push(videoChain)
    if (audioChain) filterParts.push(audioChain)
    if (filterParts.length) finalArgs.push('-filter_complex', filterParts.join(';'))

    finalArgs.push('-map', videoChain ? '[outv]' : '0:v:0')
    if (audioChain) finalArgs.push('-map', '[aout]')
    else finalArgs.push('-an')

    // If subtitles applied, must re-encode video (libass overlay). Otherwise stream-copy.
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
      '-t', String(totalDuration),           // explicit 20s cap (no -shortest)
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
      throw new Error(`Concat failed (code ${execErr.code}): ${execErr.stderr?.slice(-400) || execErr.message}`)
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
