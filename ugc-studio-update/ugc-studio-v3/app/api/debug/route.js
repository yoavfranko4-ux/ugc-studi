import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export async function GET() {
  const results = {};
  
  try { const { stdout } = await execAsync('which ffmpeg'); results.which = stdout.trim(); } catch(e) { results.which = e.message; }
  try { const { stdout } = await execAsync('find /nix -name ffmpeg -type f 2>/dev/null | head -3'); results.nix = stdout.trim(); } catch(e) { results.nix = e.message; }
  try { const { stdout } = await execAsync('ls /usr/bin/ffmpeg 2>/dev/null'); results.usr = stdout.trim(); } catch(e) { results.usr = 'not found'; }
  try { const m = (await import('ffmpeg-static')).default; results.static = m; } catch(e) { results.static = e.message; }
  try { const { stdout } = await execAsync('find / -name ffmpeg -type f 2>/dev/null | head -5'); results.find = stdout.trim(); } catch(e) { results.find = e.message; }

  return Response.json(results);
}
