import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

const publicPaths = ['/', '/pricing', '/login']

export async function middleware(req) {
  const path = req.nextUrl.pathname

  // Public paths — skip auth check entirely
  if (publicPaths.some(p => path === p)) {
    return NextResponse.next()
  }

  // Protected paths — check session
  if (path.startsWith('/dashboard') || path.startsWith('/studio')) {
    try {
      const res = NextResponse.next()
      const supabase = createMiddlewareClient({ req, res })
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        return NextResponse.redirect(new URL('/login', req.url))
      }

      return res
    } catch (e) {
      console.error('Middleware auth error:', e.message)
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
