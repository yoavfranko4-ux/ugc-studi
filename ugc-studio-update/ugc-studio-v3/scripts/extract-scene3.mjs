// Extract "scene 3" still frames from the 3 product videos (avatar + product
// both visible) and optimize them for the hero animation result card.
// Writes public/landing-assets/scene3-{icecream,kipa,teeth}.{jpg,webp}
// at max-width 1000px, quality 85.

import { execFileSync } from 'node:child_process'
import { readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const FFMPEG = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe')
const PUB = path.resolve('public/landing-assets')

const TARGETS = [
  { product: 'icecream', timestamp: '00:00:16' },
  { product: 'kipa',     timestamp: '00:00:16' },
  { product: 'teeth',    timestamp: '00:00:16' },
]

const MAX_WIDTH = 1000
const QUALITY = 85

async function extract({ product, timestamp }) {
  const src = path.join(PUB, `video-${product}.mp4`)
  const rawJpg = path.join(PUB, `scene3-${product}.raw.jpg`)
  const outJpg = path.join(PUB, `scene3-${product}.jpg`)
  const outWebp = path.join(PUB, `scene3-${product}.webp`)

  console.log(`[${product}] ffmpeg -ss ${timestamp}`)
  execFileSync(FFMPEG, [
    '-ss', timestamp,
    '-i', src,
    '-vframes', '1',
    '-q:v', '2',
    '-y',
    rawJpg,
  ], { stdio: ['ignore', 'ignore', 'ignore'] })

  const buf = await readFile(rawJpg)
  const pipeline = sharp(buf).resize({ width: MAX_WIDTH, withoutEnlargement: true })
  await pipeline.clone().jpeg({ quality: QUALITY, mozjpeg: true }).toFile(outJpg)
  await pipeline.clone().webp({ quality: QUALITY }).toFile(outWebp)
  await unlink(rawJpg)

  const jpgKB = Math.round((await stat(outJpg)).size / 1024)
  const webpKB = Math.round((await stat(outWebp)).size / 1024)
  return { product, timestamp, jpgKB, webpKB }
}

const report = []
for (const t of TARGETS) report.push(await extract(t))

console.log('\n=== Report ===')
console.log('product   timestamp  jpgKB  webpKB')
for (const r of report) {
  console.log(`${r.product.padEnd(9)} ${r.timestamp.padEnd(10)} ${String(r.jpgKB).padStart(5)}  ${String(r.webpKB).padStart(6)}`)
}
