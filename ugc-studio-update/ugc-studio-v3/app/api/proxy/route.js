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
  if (rangeHeader) console.log(`[Proxy] forwarding Range: ${rangeHeader}`)

  try {
    const upstreamHeaders = {}
    if (rangeHeader) upstreamHeaders['Range'] = rangeHeader

    const fetchStart = Date.now()
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      headers: upstreamHeaders,
    })
    const headersMs = Date.now() - fetchStart
    const ct = res.headers.get('content-type') || '(none)'
    const cl = res.headers.get('content-length') || '(none)'
    const cr = res.headers.get('content-range') || '(none)'
    console.log(`[Proxy] fetch response received in ${headersMs}ms, status=${res.status}, content-type=${ct}, content-length=${cl}, content-range=${cr}`)

    if (!res.ok && res.status !== 206) {
      console.error(`[Proxy] upstream bad status ${res.status} after ${headersMs}ms for ${short}`)
      return new Response(`Upstream HTTP ${res.status}`, { status: 502 })
    }

    const outHeaders = {
      'Content-Type': ct !== '(none)' ? ct : 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    }
    if (cl !== '(none)') outHeaders['Content-Length'] = cl
    if (cr !== '(none)') outHeaders['Content-Range'] = cr

    const response = new Response(res.body, {
      status: res.status,
      headers: outHeaders,
    })

    console.log(`[Proxy] DONE ${short} total=${Date.now() - startTime}ms (headers=${headersMs}ms, streaming body to client…)`)
    return response
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
