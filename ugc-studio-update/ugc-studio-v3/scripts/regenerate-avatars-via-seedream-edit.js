#!/usr/bin/env node
// Regenerate the 6 existing avatars in public/avatars/ via BytePlus Seedream
// Edit (image-to-image). The prompt asks for "same person, same pose, same
// outfit, same hair, same expression, same lighting" — the goal is a
// Seedream-trusted version of each Nano-Banana avatar so that Seedance 2.0
// (BytePlus) accepts them as reference frames without face-trust failures.
//
// The original Nano-Banana avatars are backed up to public/avatars/old-nb/
// before being overwritten.
//
// Usage:
//   ARK_API_KEY=... [ARK_BASE_URL=...] node scripts/regenerate-avatars-via-seedream-edit.js
//   ARK_API_KEY=... node scripts/regenerate-avatars-via-seedream-edit.js --only=1
//   ARK_API_KEY=... node scripts/regenerate-avatars-via-seedream-edit.js --only=1,2,3
//
// Windows cmd:
//   set ARK_API_KEY=... && set ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3 && node scripts/regenerate-avatars-via-seedream-edit.js --only=1
//
// If a .env / .env.local file exists in the project root, those vars are
// loaded automatically (no dotenv dependency).

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.resolve(__dirname, '..')
const AVATARS_DIR = path.join(ROOT, 'public', 'avatars')
// Two backup roots:
//   old-nb/        — original Nano-Banana avatars (created on first run)
//   old-realistic/ — photorealistic Seedream 5.0 avatars from the prior pass
// We pick the destination at runtime: if the target name is unused at the
// destination, that's where the current src goes. This way you can re-run
// the script for different style passes without overwriting earlier backups.
const BACKUP_DIR_NB = path.join(AVATARS_DIR, 'old-nb')
const BACKUP_DIR_REALISTIC = path.join(AVATARS_DIR, 'old-realistic')

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3'

// Dola-Seedream-5.0-lite — confirmed working i2i model on this account.
const MODEL_CANDIDATES = [
  'seedream-5-0-260128'
]

const EDIT_PROMPT =
  'Transform into a high-quality 3D animated character render in the style ' +
  'of a Pixar/Disney movie. Maintain the same general appearance: same hair ' +
  'color, same outfit colors, same body type, same approximate pose. The ' +
  'result should be CLEARLY STYLIZED - smooth 3D shading, soft cartoon-like ' +
  'features, slightly oversized expressive eyes, polished CGI aesthetic. ' +
  'NOT photorealistic. Like a character from Toy Story, Encanto, or modern ' +
  'Pixar animation. Clean studio lighting, dark gradient background.'

const RETRY_DELAYS_MS = [1000, 3000, 8000]

function loadDotenv() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(ROOT, name)
    if (!fs.existsSync(p)) continue
    const txt = fs.readFileSync(p, 'utf8')
    for (const rawLine of txt.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (process.env[key] == null) process.env[key] = val
    }
  }
}

function parseArgs(argv) {
  const out = { only: null }
  for (const a of argv.slice(2)) {
    const m = a.match(/^--only=(.+)$/)
    if (m) {
      out.only = m[1].split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean)
    }
  }
  return out
}

function imageToDataUrl(filePath) {
  const buf = fs.readFileSync(filePath)
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const mime = ext === 'png' ? 'image/png' :
               ext === 'webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function callSeedreamEdit(model, dataUrl) {
  const apiKey = process.env.ARK_API_KEY
  const baseUrl = (process.env.ARK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const url = `${baseUrl}/images/generations`
  // Seedream 5.0 requires output size >= 3,686,400 pixels (1920×1920).
  // Use 2048×2048 (~4.2M px); we downscale to 1024 wide via sharp on save.
  const body = {
    model,
    prompt: EDIT_PROMPT,
    image: [dataUrl],
    size: '2048x2048',
    response_format: 'url'
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ok: res.ok, status: res.status, data, text }
}

async function generateEditedImage(dataUrl) {
  let lastErr
  for (const model of MODEL_CANDIDATES) {
    let modelHardFailed = false
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        console.log(`  [Seedream Edit] model=${model} attempt=${attempt + 1}`)
        const { ok, status, data, text } = await callSeedreamEdit(model, dataUrl)
        if (ok) {
          const imgUrl = data?.data?.[0]?.url || data?.images?.[0]?.url || data?.url
          if (imgUrl) return { url: imgUrl, model }
          console.error('  [Seedream Edit] OK but no url:', text.slice(0, 200))
          lastErr = new Error('no url in response')
        } else {
          console.error(`  [Seedream Edit] HTTP ${status}: ${text.slice(0, 240)}`)
          lastErr = new Error(`HTTP ${status}: ${text.slice(0, 200)}`)
          // Hard 4xx (other than rate limit) — stop retrying this model and
          // fall through to the next candidate.
          if (status >= 400 && status < 500 && status !== 429) {
            modelHardFailed = true
            break
          }
        }
      } catch (e) {
        console.error(`  [Seedream Edit] exception: ${e.message}`)
        lastErr = e
      }
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay) await new Promise(r => setTimeout(r, delay))
    }
    if (modelHardFailed) {
      console.warn(`  [Seedream Edit] model ${model} rejected payload — trying next candidate`)
      continue
    }
  }
  throw lastErr || new Error('Seedream Edit failed for all model candidates')
}

async function downloadAndSave(imageUrl, outPath) {
  const res = await fetch(imageUrl)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await sharp(buf)
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(outPath)
}

function fileSize(p) {
  try { return fs.statSync(p).size } catch { return 0 }
}

async function processOne(id) {
  const srcPath = path.join(AVATARS_DIR, `avatar-${id}.jpg`)
  if (!fs.existsSync(srcPath)) {
    throw new Error(`source not found: ${srcPath}`)
  }

  // Pick a backup destination that doesn't already hold this avatar id.
  // Order: old-nb (originals) → old-realistic (photorealistic Seedream) →
  // skip if both exist. That way the first stylize run preserves the
  // photorealistic intermediate, and re-running again won't clobber either.
  let backupPath = null
  let backupLabel = null
  const nbCandidate = path.join(BACKUP_DIR_NB, `avatar-${id}.jpg`)
  const realisticCandidate = path.join(BACKUP_DIR_REALISTIC, `avatar-${id}.jpg`)
  if (!fs.existsSync(nbCandidate)) {
    backupPath = nbCandidate
    backupLabel = 'old-nb'
  } else if (!fs.existsSync(realisticCandidate)) {
    backupPath = realisticCandidate
    backupLabel = 'old-realistic'
  }

  const oldSize = fileSize(srcPath)
  console.log(`→ avatar-${id}.jpg (${oldSize} bytes)`)

  const dataUrl = imageToDataUrl(srcPath)
  const { url: imgUrl, model } = await generateEditedImage(dataUrl)
  console.log(`  generated via ${model}: ${imgUrl.slice(0, 80)}...`)

  if (backupPath) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true })
    fs.copyFileSync(srcPath, backupPath)
    console.log(`  backup → ${path.relative(ROOT, backupPath)} (${backupLabel})`)
  } else {
    console.log(`  backup skipped — both old-nb/ and old-realistic/ already hold avatar-${id}.jpg`)
  }

  await downloadAndSave(imgUrl, srcPath)
  const newSize = fileSize(srcPath)
  console.log(`  ✓ saved → ${path.relative(ROOT, srcPath)} (${oldSize} → ${newSize} bytes)`)
  return { id, ok: true, model, oldSize, newSize, file: srcPath, backup: backupPath, backupLabel }
}

async function main() {
  loadDotenv()

  if (!process.env.ARK_API_KEY) {
    console.error('Missing ARK_API_KEY in env')
    process.exit(1)
  }
  if (!process.env.ARK_BASE_URL) {
    console.log(`ARK_BASE_URL not set — using default ${DEFAULT_BASE_URL}`)
  }

  const args = parseArgs(process.argv)
  const ids = args.only || [1, 2, 3, 4, 5, 6]

  console.log(`Regenerating ${ids.length} avatar(s) via BytePlus Seedream Edit: ${ids.join(', ')}`)
  console.log(`Backup dirs: ${path.relative(ROOT, BACKUP_DIR_NB)}/ (originals), ${path.relative(ROOT, BACKUP_DIR_REALISTIC)}/ (photorealistic prior pass)\n`)

  const results = []
  for (const id of ids) {
    try {
      const r = await processOne(id)
      results.push(r)
    } catch (e) {
      console.error(`  ✗ avatar-${id} failed: ${e.message}`)
      results.push({ id, ok: false, error: e.message })
    }
    console.log()
  }

  const ok = results.filter(r => r.ok)
  const failed = results.filter(r => !r.ok)
  console.log('───────────────────────────────────')
  console.log(`Summary: ${ok.length}/${results.length} succeeded`)
  if (ok.length) {
    console.log('Updated:')
    for (const r of ok) {
      const backupNote = r.backup ? ` [backup: ${r.backupLabel}]` : ' [no backup — both dirs full]'
      console.log(`  - avatar-${r.id}.jpg via ${r.model} (${r.oldSize} → ${r.newSize} bytes)${backupNote}`)
    }
  }
  if (failed.length) {
    console.log('Failed:')
    for (const r of failed) console.log(`  - avatar-${r.id}: ${r.error}`)
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
