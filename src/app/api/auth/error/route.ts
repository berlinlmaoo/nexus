export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from 'next/server'

/**
 * NextAuth may send users here on auth failures. The default handler can 500.
 * Redirect to our login page so users always see app UI + messages.
 */
export function GET(request: NextRequest) {
  const err = request.nextUrl.searchParams.get('error') ?? 'Configuration'
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('error', err)
  return NextResponse.redirect(url)
}
