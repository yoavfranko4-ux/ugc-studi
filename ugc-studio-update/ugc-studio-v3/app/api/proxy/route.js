import { getCached, setCached, warmCache, stats as cacheStats } from '../../../lib/video-cache.js'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req) {
  const url = new URL(req.url).searchParams.get('url')
  const startTime = Date.now()
  const short = url ? (url.length > 80 ? url.slice(0, 80) + '…' : url) : '(no url)'
  console.log(`[Proxy] START ${short}`)

  if (!url) {
    console.warn('[Proxy] missing url param')
    return new Response('Missing url', { status: 400 })
  }

  const rangeHeader = req.headers.get('range')

  try {
    // -------- Cache fast path (non-Range requests only) ------------------
    // Range requests bypass the cache — browsers issue those during seeking
    // and we don't want to slice into a Buffer on the hot path. The initial
    // full-video request (what makes the UI feel slow) always comes without
    // a Range header, and that's exactly what we cache.
    if (!rangeHeader) {
      const hit = getCached(url)
      if (hit) {
        console.log(`[Proxy] CACHE HIT ${short} (${(hit.buf.byteLength / 1024 / 1024).toFixed(1)}MB, stats=${JSON.stringify(cacheStats())})`)
        return new Response(hit.buf, {
          status: 200,
          headers: {
            'Content-Type': hit.contentType || 'video/mp4',
            'Content-Length': String(hit.buf.byteLength),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*',
            'X-Proxy-Cache': 'HIT',
          },
        })
      }
    }

    // -------- Range path: stream directly, don't cache -------------------
    if (rangeHeader) {
      console.log(`[Proxy] forwarding Range: ${rangeHeader} (bypassing cache)`)
      const fetchStart = Date.now()
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { Range: rangeHeader },
      })
      const headersMs = Date.now() - fetchStart
      console.log(`[Proxy] Range response in ${headersMs}ms, status=${res.status}, content-length=${res.headers.get('content-length')}, content-range=${res.headers.get('content-range')}`)
      if (!res.ok && res.status !== 206) {
        return new Response(`Upstream HTTP ${res.status}`, { status: 502 })
      }
      const outHeaders = {
        'Content-Type': res.headers.get('content-type') || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Cache': 'BYPASS',
      }
      const cl = res.headers.get('content-length')
      if (cl) outHeaders['Content-Length'] = cl
      const cr = res.headers.get('content-range')
      if (cr) outHeaders['Content-Range'] = cr
      return new Response(res.body, { status: res.status, headers: outHeaders })
    }

    // -------- Cache miss: fetch + buffer + cache + serve -----------------
    // warmCache() dedupes concurrent requests for the same URL onto a single
    // in-flight Promise. Result is the Buffer, already stored in the LRU.
    console.log(`[Proxy] CACHE MISS ${short} — warming…`)
    const fetchStart = Date.now()
    const buf = await warmCache(url, { timeoutMs: 30000 })
    if (!buf) {
      console.error(`[Proxy] warmCache returned null for ${short}`)
      return new Response('Upstream fetch failed', { status: 502 })
    }
    const hit = getCached(url) // for content-type
    const contentType = hit?.contentType || 'video/mp4'
    console.log(`[Proxy] DONE ${short} total=${Date.now() - startTime}ms (warm=${Date.now() - fetchStart}ms, ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB)`)
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buf.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Cache': 'MISS',
      },
    })
  } catch (err) {
    const elapsed = Date.now() - startTime
    const isTimeout = err?.name === 'TimeoutError' || /timeout/i.test(err?.message || '')
    console.error(`[Proxy] ERROR ${short} after ${elapsed}ms:`, err.message, isTimeout ? '(TIMEOUT)' : '')
    return new Response(JSON.stringify({ error: err.message }), {
      status: isTimeout ? 504 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
