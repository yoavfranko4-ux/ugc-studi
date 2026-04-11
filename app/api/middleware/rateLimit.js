import { RateLimiterMemory } from 'rate-limiter-flexible'

// 10 requests per minute per IP for general API routes
const generalLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
})

// 5 requests per minute per IP for login/auth routes
const authLimiter = new RateLimiterMemory({
  points: 5,
  duration: 60,
})

function getClientIp(req) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real
  return '127.0.0.1'
}

/**
 * Check rate limit for a request.
 * @param {Request} req - The incoming request
 * @param {'general' | 'auth'} type - Which limiter to use
 * @returns {Response|null} Returns a 429 Response if rate limited, null if OK
 */
export async function checkRateLimit(req, type = 'general') {
  const ip = getClientIp(req)
  const limiter = type === 'auth' ? authLimiter : generalLimiter

  try {
    await limiter.consume(ip)
    return null // OK
  } catch (rejRes) {
    const retryAfter = Math.ceil(rejRes.msBeforeNext / 1000) || 60
    return Response.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limiter._points),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(retryAfter),
        },
      }
    )
  }
}
