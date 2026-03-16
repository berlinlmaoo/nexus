export { auth as middleware } from '@/lib/auth'

export const config = {
  matcher: [
    '/((?!api/auth|api/forms/.*/submit|api/forms/.*/public|_next/static|_next/image|favicon.ico|login|register|invite|f/).*)',
  ],
}
