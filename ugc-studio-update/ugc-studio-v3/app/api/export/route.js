import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const FFMPEG = '/app/node_modules/ffmpeg-static/ffmpeg';

function toSrtTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function buildSrt(subtitles, sceneDurations, videoFiles) {
  const entries = [];
  let idx = 1;
  let timeOffset = 0;
  videoFiles.forEach((v) => {
    const sub = subtitles?.[v.index];
    const dur = v.duration;
    if (sub && sub.trim()) {
      const words = sub.trim().split(' ');
      const mid = Math.ceil(words.length / 2);
      const part1 = words.slice(0, mid).join(' ');
      const part2 = words.slice(mid).join(' ');
      const half = dur / 2;
      entries.push(`${idx++}\n${toSrtTime(timeOffset)} --> ${toSrtTime(timeOffset + half - 0.1)}\n${part1}\n`);
      if (part2) {
        entries.push(`${idx++}\n${toSrtTime(timeOffset + half)} --> ${toSrtTime(timeOffset + dur - 0.1)}\n${part2}\n`);
      }
    }
    timeOffset += dur;
  });
  return entries.join('\n');
}

export async function POST(req) {
  const { videoUrls, audioBase64, musicUrl, subtitles, sceneDurations = [5,5,5,5] } = await req.json();

  const tmp = tmpdir();
  const ts = Date.now();
  const toDelete = [];

  try {
    // chmod ffmpeg
    try { await execAsync(`chmod +x "${FFMPEG}"`); } catch {}

    // 1. Download videos
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

    // 2. Audio
    let audioPath = null;
    if (audioBase64) {
      audioPath = join(tmp, `audio_${ts}.mp3`);
      await writeFile(audioPath, Buffer.from(audioBase64, 'base64'));
      toDelete.push(audioPath);
    }

    // 3. Music
    let musicPath = null;
    if (musicUrl) {
      try {
        const buf = await (await fetch(musicUrl)).arrayBuffer();
        musicPath = join(tmp, `music_${ts}.mp3`);
        await writeFile(musicPath, Buffer.from(buf));
        toDelete.push(musicPath);
      } catch(e) { console.log('Music failed:', e.message); }
    }

    // 4. Concat list
    const concatPath = join(tmp, `concat_${ts}.txt`);
    await writeFile(concatPath, videoFiles.map(v => `file '${v.path}'`).join('\n'));
    toDelete.push(concatPath);

    // 5. SRT subtitles file
    const srtContent = buildSrt(subtitles, sceneDurations, videoFiles);
    const srtPath = join(tmp, `subs_${ts}.srt`);
    await writeFile(srtPath, srtContent, 'utf8');
    toDelete.push(srtPath);
    console.log('SRT content:', srtContent.slice(0, 200));

    const outputPath = join(tmp, `output_${ts}.mp4`);
    toDelete.push(outputPath);

    // 6. Scale only (no subtitles burned in via drawtext — use separate pass or overlay)
    const vf = `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`;

    let cmd;
    if (audioPath && musicPath) {
      cmd = `"${FFMPEG}" -y -f concat -safe 0 -i "${concatPath}" -i "${audioPath}" -i "${musicPath}" ` +
        `-filter_complex "[0:v]${vf}[v];[1:a]volume=1.0[a1];[2:a]volume=0.15,aloop=loop=-1:size=2e+09[a2];[a1][a2]amix=inputs=2:duration=first[a]" ` +
        `-map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest "${outputPath}"`;
    } else if (audioPath) {
      cmd = `"${FFMPEG}" -y -f concat -safe 0 -i "${concatPath}" -i "${audioPath}" ` +
        `-filter_complex "[0:v]${vf}[v]" ` +
        `-map "[v]" -map 1:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest "${outputPath}"`;
    } else {
      cmd = `"${FFMPEG}" -y -f concat -safe 0 -i "${concatPath}" -vf "${vf}" -c:v libx264 -preset fast -crf 23 "${outputPath}"`;
    }

    console.log('Running FFmpeg...');
    const { stderr } = await execAsync(cmd, { timeout: 300000 });
    if (stderr) console.log('FFmpeg stderr (last 300):', stderr.slice(-300));

    const outputBuf = await readFile(outputPath);
    // Return video + srt separately so client can show subtitles
    return new Response(JSON.stringify({
      videoBase64: outputBuf.toString('base64'),
      srt: srtContent
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('Export error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  } finally {
    for (const f of toDelete) unlink(f).catch(()=>{});
  }
}
