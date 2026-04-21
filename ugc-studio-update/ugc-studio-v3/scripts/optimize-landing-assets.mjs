// One-shot landing-asset optimizer.
//  - Imports 6 frame PNGs from Pictures\ugs exm → landing-assets/frames/frame-0X.{webp,jpg}
//  - Regenerates avatars (avatar-*.png) as .webp + .jpg; drops the .png
//  - Regenerates products (icecream/kipa/teeth) as .webp + .jpg; drops
//    any stray original format.
// Target: max width 1000px, quality 85.
// Run: `node scripts/optimize-landing-assets.mjs` from v3 root.

import sharp from 'sharp'
import { readdir, mkdir, unlink, stat, access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

const PROJECT_ROOT = process.cwd()
const FRAME_SOURCE_DIR = 'C:\\Users\\franko\\Pictures\\ugs exm'
const PUB = path.join(PROJECT_ROOT, 'public', 'landing-assets')
const FRAMES_DST = path.join(PUB, 'frames')

const MAX_WIDTH = 1000
const QUALITY = 85

async function fileExists(p) {
  try { await access(p, constants.F_OK); return true } catch { return false }
}

async function sizeKB(p) {
  try { return Math.round((await stat(p)).size / 1024) } catch { return null }
}

async function convert(srcPath, dstBaseNoExt, { deleteSource = false } = {}) {
  const webpOut = `${dstBaseNoExt}.webp`
  const jpgOut = `${dstBaseNoExt}.jpg`
  const beforeKB = await sizeKB(srcPath)

  // Read to buffer so src and dst can collide (e.g. product-kipa.webp → itself).
  const buf = await readFile(srcPath)
  const pipeline = sharp(buf).resize({ width: MAX_WIDTH, withoutEnlargement: true })

  await pipeline.clone().webp({ quality: QUALITY }).toFile(webpOut)
  await pipeline.clone().jpeg({ quality: QUALITY, mozjpeg: true }).toFile(jpgOut)

  const webpKB = await sizeKB(webpOut)
  const jpgKB = await sizeKB(jpgOut)

  if (deleteSource && path.resolve(srcPath) !== path.resolve(webpOut) && path.resolve(srcPath) !== path.resolve(jpgOut)) {
    await unlink(srcPath)
  }

  return { src: path.basename(srcPath), beforeKB, webpKB, jpgKB }
}

async function main() {
  const report = []

  // --- FRAMES ---
  await mkdir(FRAMES_DST, { recursive: true })
  const frameFiles = (await readdir(FRAME_SOURCE_DIR))
    .filter(f => /\.png$/i.test(f))
    .sort()                                    // timestamp-prefixed → chronological
  console.log(`[frames] importing ${frameFiles.length} PNGs from ${FRAME_SOURCE_DIR}`)
  for (let i = 0; i < frameFiles.length; i++) {
    const src = path.join(FRAME_SOURCE_DIR, frameFiles[i])
    const out = path.join(FRAMES_DST, `frame-${String(i + 1).padStart(2, '0')}`)
    const r = await convert(src, out, { deleteSource: false })
    report.push({ name: `frame-${String(i + 1).padStart(2, '0')}`, ...r })
  }

  // --- AVATARS ---
  for (const name of ['avatar-noa', 'avatar-daniel', 'avatar-maya']) {
    const srcPng = path.join(PUB, `${name}.png`)
    if (!(await fileExists(srcPng))) { console.warn(`[avatars] missing ${srcPng}`); continue }
    const out = path.join(PUB, name)
    const r = await convert(srcPng, out, { deleteSource: true })
    report.push({ name, ...r })
  }

  // --- PRODUCTS ---
  // icecream (.png), kipa (.webp), teeth (.jpg) — unify to both formats.
  const productSources = {
    'product-icecream': 'product-icecream.png',
    'product-kipa': 'product-kipa.webp',
    'product-teeth': 'product-teeth.jpg',
  }
  for (const [name, srcFile] of Object.entries(productSources)) {
    const src = path.join(PUB, srcFile)
    if (!(await fileExists(src))) { console.warn(`[products] missing ${src}`); continue }
    const out = path.join(PUB, name)
    // We output to {name}.webp and {name}.jpg. If src is exactly one of those
    // filenames, convert() will overwrite in place (both formats regenerated).
    // Delete source PNG afterwards so only .webp+.jpg remain.
    const deleteSource = /\.png$/i.test(srcFile)
    const r = await convert(src, out, { deleteSource })
    report.push({ name, ...r })
  }

  console.log('\n=== Report (KB) ===')
  console.log('name                  before   webp   jpg   savings%')
  for (const row of report) {
    const minAfter = Math.min(row.webpKB ?? Infinity, row.jpgKB ?? Infinity)
    const savings = row.beforeKB ? Math.round((1 - minAfter / row.beforeKB) * 100) : 0
    console.log(
      `${row.name.padEnd(22)} ${String(row.beforeKB).padStart(6)} ${String(row.webpKB).padStart(6)} ${String(row.jpgKB).padStart(5)} ${String(savings).padStart(7)}%`
    )
  }
}

main().catch(e => { console.error(e); process.exit(1) })
