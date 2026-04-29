import sharp from 'sharp';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SRC_DIR = 'C:\\Users\\franko\\Pictures\\‏‏תיקיה חדשה';
const DST_DIR = 'C:\\Users\\franko\\ugc-studi\\ugc-studio-update\\ugc-studio-v3\\public\\avatars';

const files = [
  ['avatar-1.jpg.png', 'avatar-1.jpg'],
  ['avatar-2.jpg.png', 'avatar-2.jpg'],
  ['avatar-3.jpg.png', 'avatar-3.jpg'],
  ['avatar-4.jpg.png', 'avatar-4.jpg'],
  ['avatar-5.jpg.png', 'avatar-5.jpg'],
  ['avatar-6.jpg.png', 'avatar-6.jpg'],
];

for (const [src, dst] of files) {
  const srcPath = join(SRC_DIR, src);
  const dstPath = join(DST_DIR, dst);
  const buf = await readFile(srcPath);
  const meta = await sharp(buf).metadata();
  const out = await sharp(buf)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  await writeFile(dstPath, out);
  const verify = await sharp(out).metadata();
  const s = await stat(dstPath);
  console.log(`${dst}: src=${meta.format} ${meta.width}x${meta.height} -> jpeg ${verify.width}x${verify.height}, ${(s.size/1024).toFixed(1)} KB`);
}
