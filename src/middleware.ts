import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Lightweight middleware that checks for session cookie presence.
 * Full JWT validation happens in API routes via auth() from src/lib/auth.ts.
 * This avoids the dual-NextAuth-instance problem where edge middleware
 * and Node runtime use different JWT configs.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — always allow
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/invite') ||
    pathname.startsWith('/f/') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/forms') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  // Check for session cookie (next-auth.session-token or __Secure- variant)
  const hasSession =
    request.cookies.has('authjs.session-token') ||
    request.cookies.has('__Secure-authjs.session-token') ||
    request.cookies.has('next-auth.session-token') ||
    request.cookies.has('__Secure-next-auth.session-token')

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api/auth|api/forms/.*/submit|api/forms/.*/public|_next/static|_next/image|favicon.ico|login|register|invite|f/).*)',
  ],
}
