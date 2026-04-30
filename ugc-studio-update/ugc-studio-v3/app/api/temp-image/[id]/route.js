// GET /api/temp-image/[id] — serves an image previously stashed in the
// in-memory cache by lib/image-cache.js. Used so the Higgsfield MCP server
// can fetch reference images by HTTPS URL instead of forcing us to embed
// 100K+ base64 bytes into the Anthropic prompt (which trips the 200K-token
// per-message limit).

import { getTempImage } from '../../../../lib/image-cache.js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req, { params }) {
  const { id } = await params
  const entry = getTempImage(id)
  if (!entry) {
    return new Response('Not found', { status: 404 })
  }
  return new Response(entry.buf, {
    status: 200,
    headers: {
      'Content-Type': entry.contentType || 'image/jpeg',
      // Short cache — Higgsfield only fetches once per job; we don't want
      // CDNs holding stale bytes after the in-memory entry expires.
      'Cache-Control': 'public, max-age=60',
      'Content-Length': String(entry.buf.length),
    },
  })
}
