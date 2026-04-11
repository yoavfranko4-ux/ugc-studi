import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

const publicPaths = ['/', '/pricing', '/login']

export async function middleware(req) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  const path = req.nextUrl.pathname

  // Public paths — allow everyone
  if (publicPaths.some(p => path === p)) {
    return res
  }

  // Protected paths — redirect to login if not authenticated
  if (path.startsWith('/dashboard') || path.startsWith('/studio')) {
    if (!session) {
      const loginUrl = new URL('/login', req.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
