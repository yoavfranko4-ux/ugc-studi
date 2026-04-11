import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

export async function middleware(req) {
  const res = NextResponse.next()

  const pathname = req.nextUrl.pathname

  // דפים פתוחים לכולם
  if (pathname === '/' ||
      pathname === '/login' ||
      pathname === '/pricing' ||
      pathname.startsWith('/_next') ||
      pathname.startsWith('/api')) {
    return res
  }

  const supabase = createMiddlewareClient({ req, res })
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // הגנה על admin
  if (pathname.startsWith('/admin')) {
    if (session.user.email !== 'yoavfranko34@gmail.com') {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
