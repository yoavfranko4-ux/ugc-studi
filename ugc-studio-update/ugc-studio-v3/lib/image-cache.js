// In-process image cache used to give data: URIs a fetchable public URL.
//
// Why this exists: the Anthropic Messages API counts the entire user-message
// text against the input-token budget. When a data: URI (typically 100-200K
// base64 chars for a 1MP image) gets embedded as a line in the prompt the
// request blows past the 200K-token limit. The Higgsfield MCP's media_upload
// tool accepts public URLs, so the cleanest fix is to host the image
// ourselves and pass a small URL string through the prompt instead.
//
// The cache is in-memory and process-local. That's fine on Railway because
// the same Next.js process that stores the image also serves the GET — the
// request that triggered the cache write (POST /api/agent) blocks until the
// Higgsfield MCP has finished fetching the URL, so the entry is alive for
// the entire window where it could be needed.

import { randomUUID } from 'crypto'

const cache = new Map() // id → { buf, contentType, expiresAt }
const TTL_MS = 10 * 60 * 1000 // 10 min — covers the longest Higgsfield render queue
const MAX_ENTRIES = 200 // evict oldest if we somehow blow past this

export function storeTempImage(buf, contentType) {
  if (cache.size >= MAX_ENTRIES) {
    // Drop oldest. Map preserves insertion order, so the first key is oldest.
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
  const id = randomUUID()
  cache.set(id, { buf, contentType, expiresAt: Date.now() + TTL_MS })
  return id
}

export function getTempImage(id) {
  const entry = cache.get(id)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(id)
    return null
  }
  return entry
}

// Convert a data: URI to a fetchable public URL by stashing the bytes in the
// in-memory cache and returning a /api/temp-image/<id> URL. Returns the
// original input unchanged if it isn't a base64 data: URI we can parse.
export function dataUriToPublicUrl(input, baseUrl) {
  if (typeof input !== 'string' || !input.startsWith('data:')) return input
  const m = input.match(/^data:([^;]+);base64,([\s\S]+)$/)
  if (!m) return input
  const contentType = m[1] || 'application/octet-stream'
  const buf = Buffer.from(m[2], 'base64')
  if (!buf || buf.length === 0) return input
  const id = storeTempImage(buf, contentType)
  const base = (baseUrl || process.env.NEXT_PUBLIC_BASE_URL || 'https://ugc-studi-production.up.railway.app').replace(/\/+$/, '')
  return `${base}/api/temp-image/${id}`
}
