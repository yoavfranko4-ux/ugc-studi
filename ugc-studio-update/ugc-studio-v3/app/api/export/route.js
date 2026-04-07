import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(req) {
  const { videoUrls, audioBase64, musicUrl, subtitles, sceneDuration = 5 } = await req.json();

  const tmp = tmpdir();
  const ts = Date.now();
  const toDelete = [];

  try {
    // 1. Download videos
    const videoFiles = [];
    for (let i = 0; i < videoUrls.length; i++) {
      if (!videoUrls[i]) continue;
      const p = join(tmp, `vid_${ts}_${i}.mp4`);
      const buf = await (await fetch(videoUrls[i])).arrayBuffer();
      await writeFile(p, Buffer.from(buf));
      toDelete.push(p);
      videoFiles.push({ path: p, index: i });
    }
    if (videoFiles.length === 0) return Response.json({ error: 'No videos' }, { status: 400 });

    // 2. Write audio
    let audioPath = null;
    if (audioBase64) {
      audioPath = join(tmp, `audio_${ts}.mp3`);
      await writeFile(audioPath, Buffer.from(audioBase64, 'base64'));
      toDelete.push(audioPath);
    }

    // 3. Download music
    let musicPath = null;
    if (musicUrl) {
      try {
        const buf = await (await fetch(musicUrl)).arrayBuffer();
        musicPath = join(tmp, `music_${ts}.mp3`);
        await writeFile(musicPath, Buffer.from(buf));
        toDelete.push(musicPath);
      } catch(e) { console.log('Music download failed:', e.message); }
    }

    // 4. Concat list
    const concatPath = join(tmp, `concat_${ts}.txt`);
    await writeFile(concatPath, videoFiles.map(v => `file '${v.path}'`).join('\n'));
    toDelete.push(concatPath);

    const outputPath = join(tmp, `output_${ts}.mp4`);
    toDelete.push(outputPath);

    // 5. Build subtitle drawtext filters
    const drawTexts = [];
    if (subtitles && subtitles.length > 0) {
      videoFiles.forEach((v, idx) => {
        const sub = subtitles[v.index];
        if (!sub || !sub.trim()) return;
        const startTime = idx * sceneDuration;
        const endTime = startTime + sceneDuration - 0.1;

        // Split into max 2 lines
        const words = sub.trim().split(' ');
        const lines = [];
        let current = '';
        for (const w of words) {
          if ((current + ' ' + w).trim().length > 20 && current) {
            lines.push(current.trim());
            current = w;
            if (lines.length >= 2) break;
          } else { current = (current + ' ' + w).trim(); }
        }
        if (current && lines.length < 2) lines.push(current.trim());

        const yPositions = lines.length === 2 ? ['h-140', 'h-90'] : ['h-115'];
        lines.forEach((line, li) => {
          const escaped = line
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\u2019")
            .replace(/:/g, '\\:')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]');
          drawTexts.push(
            `drawtext=text='${escaped}':fontsize=30:fontcolor=white:x=(w-text_w)/2:y=${yPositions[li]}:box=1:boxcolor=black@0.7:boxborderw=10:enable='between(t,${startTime},${endTime})'`
          );
        });
      });
    }

    const vfChain = drawTexts.length > 0
      ? `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,${drawTexts.join(',')}`
      : `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`;

    // 6. Build FFmpeg command
    let cmd;
    if (audioPath && musicPath) {
      cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -i "${audioPath}" -i "${musicPath}" ` +
        `-filter_complex "[0:v]${vfChain}[v];[1:a]volume=1.0[a1];[2:a]volume=0.15,aloop=loop=-1:size=2e+09[a2];[a1][a2]amix=inputs=2:duration=first[a]" ` +
        `-map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest "${outputPath}"`;
    } else if (audioPath) {
      cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -i "${audioPath}" ` +
        `-filter_complex "[0:v]${vfChain}[v]" ` +
        `-map "[v]" -map 1:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest "${outputPath}"`;
    } else {
      cmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" ` +
        `-vf "${vfChain}" ` +
        `-c:v libx264 -preset fast -crf 23 "${outputPath}"`;
    }

    console.log('Running FFmpeg...');
    await execAsync(cmd, { timeout: 300000 });

    // 7. Read output and return as base64
    const outputBuf = await readFile(outputPath);
    const base64 = outputBuf.toString('base64');

    return new Response(
      JSON.stringify({ videoBase64: base64 }),
      { headers: { 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    console.error('Export error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  } finally {
    for (const f of toDelete) {
      unlink(f).catch(() => {});
    }
  }
}
