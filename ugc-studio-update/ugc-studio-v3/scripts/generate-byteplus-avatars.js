#!/usr/bin/env node
// One-shot script: generate the 6 avatars defined in avatars-prompts.json
// using BytePlus ModelArk Seedream 4.5, then save each to
// public/avatars/avatar-{id}.jpg (resized to 1024px wide, JPEG quality 85).
//
// Usage:
//   ARK_API_KEY=... ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3 \
//     node scripts/generate-byteplus-avatars.js
//
// On Windows PowerShell:
//   $env:ARK_API_KEY="..."; $env:ARK_BASE_URL="..."; node scripts/generate-byteplus-avatars.js
//
// If a .env / .env.local file exists in the project root, those vars are
// loaded automatically (no dotenv dependency).

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'public', 'avatars')
const PROMPTS_FILE = path.join(ROOT, 'avatars-prompts.json')

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

const SEEDREAM_MODEL = 'seedream-4-5-250828'
const RETRY_DELAYS_MS = [1000, 3000, 8000]

async function generateImage(prompt) {
  const apiKey = process.env.ARK_API_KEY
  const baseUrl = (process.env.ARK_BASE_URL || '').replace(/\/+$/, '')
  if (!apiKey || !baseUrl) {
    throw new Error('ARK_API_KEY and ARK_BASE_URL must be set in env')
  }
  const url = `${baseUrl}/images/generations`
  const body = {
    model: SEEDREAM_MODEL,
    prompt,
    size: '1024x1024',
    response_format: 'url'
  }
  let lastErr
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      console.log(`  [Seedream] attempt ${attempt + 1} → ${url}`)
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
      if (res.ok) {
        const imgUrl = data?.data?.[0]?.url || data?.images?.[0]?.url || data?.url
        if (imgUrl) return imgUrl
        console.error('  [Seedream] OK but no url:', text.slice(0, 200))
        lastErr = new Error('no url in response')
      } else {
        console.error(`  [Seedream] HTTP ${res.status}: ${text.slice(0, 200)}`)
        lastErr = new Error(`HTTP ${res.status}`)
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break
      }
    } catch (e) {
      console.error(`  [Seedream] exception: ${e.message}`)
      lastErr = e
    }
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay) await new Promise(r => setTimeout(r, delay))
  }
  throw lastErr || new Error('Seedream failed after retries')
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

async function main() {
  loadDotenv()

  if (!fs.existsSync(PROMPTS_FILE)) {
    console.error(`avatars-prompts.json not found at ${PROMPTS_FILE}`)
    process.exit(1)
  }
  if (!process.env.ARK_API_KEY || !process.env.ARK_BASE_URL) {
    console.error('Missing ARK_API_KEY or ARK_BASE_URL — set them in env or .env.local')
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const { avatars } = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'))
  if (!Array.isArray(avatars) || avatars.length === 0) {
    console.error('No avatars in avatars-prompts.json')
    process.exit(1)
  }

  console.log(`Generating ${avatars.length} avatars via BytePlus Seedream 4.5...\n`)

  const results = []
  for (const a of avatars) {
    const outPath = path.join(OUT_DIR, `avatar-${a.id}.jpg`)
    console.log(`→ Avatar ${a.id} (${a.name})`)
    try {
      const imgUrl = await generateImage(a.prompt)
      console.log(`  generated: ${imgUrl.slice(0, 80)}...`)
      await downloadAndSave(imgUrl, outPath)
      console.log(`  ✓ saved → ${path.relative(ROOT, outPath)}`)
      results.push({ id: a.id, name: a.name, ok: true, file: outPath })
    } catch (e) {
      console.error(`  ✗ failed: ${e.message}`)
      results.push({ id: a.id, name: a.name, ok: false, error: e.message })
    }
    console.log()
  }

  const ok = results.filter(r => r.ok)
  const failed = results.filter(r => !r.ok)
  console.log('───────────────────────────────────')
  console.log(`Summary: ${ok.length}/${results.length} succeeded`)
  if (ok.length) {
    console.log('Created:')
    for (const r of ok) console.log(`  - avatar-${r.id}.jpg (${r.name})`)
  }
  if (failed.length) {
    console.log('Failed:')
    for (const r of failed) console.log(`  - ${r.name} (id ${r.id}): ${r.error}`)
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
