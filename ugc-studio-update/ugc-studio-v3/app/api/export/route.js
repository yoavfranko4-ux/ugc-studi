import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// FFmpeg is at this fixed path in Railway (from debug endpoint)
const FFMPEG_PATH = '/app/node_modules/ffmpeg-static/ffmpeg';

async function getFfmpeg() {
  try {
    await execAsync(`chmod +x "${FFMPEG_PATH}"`);
    const { stdout } = await execAsync(`"${FFMPEG_PATH}" -version 2>&1 | head -1`);
    console.log('FFmpeg OK:', stdout.trim());
    return FFMPEG_PATH;
  } catch(e) {
    console.error('FFmpeg at fixed path failed:', e.message);
    throw new Error('FFmpeg not available: ' + e.message);
  }
}

export async function POST(req) {
  const { videoUrls, audioBase64, musicUrl, subtitles, sceneDurations = [5,5,5,5] } = await req.json();

  const tmp = tmpdir();
  const ts = Date.now();
  const toDelete = [];

  try {
    const ffmpeg = await getFfmpeg();

    const videoFiles = [];
    for (let i = 0; i < videoUrls.length; i++) {
      if (!videoUrls[i]) continue;
      const p = join(tmp, `vid_${ts}_${i}.mp4`);
      const buf = await (await fetch(videoUrls[i])).arrayBuffer();
      await writeFile(p, Buffer.from(buf));
      toDelete.push(p);
      videoFiles.push({ path: p, index: i, duration: sceneDurations[i] || 5 });
    }
    if (videoFiles.length === 0) return Response.json({ error: 'No videos' }, { status: 400 });

    let audioPath = null;
    if (audioBase64) {
      audioPath = join(tmp, `audio_${ts}.mp3`);
      await writeFile(audioPath, Buffer.from(audioBase64, 'base64'));
      toDelete.push(audioPath);
    }

    let musicPath = null;
    if (musicUrl) {
      try {
        const buf = await (await fetch(musicUrl)).arrayBuffer();
        musicPath = join(tmp, `music_${ts}.mp3`);
        await writeFile(musicPath, Buffer.from(buf));
        toDelete.push(musicPath);
      } catch(e) { console.log('Music failed:', e.message); }
    }

    const concatPath = join(tmp, `concat_${ts}.txt`);
    await writeFile(concatPath, videoFiles.map(v => `file '${v.path}'`).join('\n'));
    toDelete.push(concatPath);

    const outputPath = join(tmp, `output_${ts}.mp4`);
    toDelete.push(outputPath);

    const drawTexts = [];
    let timeOffset = 0;
    videoFiles.forEach((v) => {
      const sub = subtitles?.[v.index];
      const dur = v.duration;
      if (sub && sub.trim()) {
        const words = sub.trim().split(' ');
        const mid = Math.ceil(words.length / 2);
        const parts = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
        const halfDur = dur / 2;
        parts.forEach((part, pi) => {
          if (!part) return;
          const startT = timeOffset + pi * halfDur;
          const endT = startT + halfDur - 0.1;
          const escaped = part.replace(/'/g,'\u2019').replace(/:/g,'\\:').replace(/\[/g,'\\[').replace(/\]/g,'\\]');
          drawTexts.push(`drawtext=text='${escaped}':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h-110:box=1:boxcolor=black@0.75:boxborderw=12:enable='between(t,${startT},${endT})'`);
        });
      }
      timeOffset += dur;
    });

    const vfBase = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`;
    const vfChain = drawTexts.length > 0 ? `${vfBase},${drawTexts.join(',')}` : vfBase;

    let cmd;
    if (audioPath && musicPath) {
      cmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${concatPath}" -i "${audioPath}" -i "${musicPath}" -filter_complex "[0:v]${vfChain}[v];[1:a]volume=1.0[a1];[2:a]volume=0.15,aloop=loop=-1:size=2e+09[a2];[a1][a2]amix=inputs=2:duration=first[a]" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest "${outputPath}"`;
    } else if (audioPath) {
      cmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${concatPath}" -i "${audioPath}" -filter_complex "[0:v]${vfChain}[v]" -map "[v]" -map 1:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest "${outputPath}"`;
    } else {
      cmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${concatPath}" -vf "${vfChain}" -c:v libx264 -preset fast -crf 23 "${outputPath}"`;
    }

    console.log('Running FFmpeg...');
    await execAsync(cmd, { timeout: 300000 });

    const outputBuf = await readFile(outputPath);
    return new Response(JSON.stringify({ videoBase64: outputBuf.toString('base64') }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('Export error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  } finally {
    for (const f of toDelete) unlink(f).catch(()=>{});
  }
}
