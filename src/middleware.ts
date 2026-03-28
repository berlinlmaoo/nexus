import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'

const { auth } = NextAuth(authConfig)

export { auth as middleware }

export const config = {
  matcher: [
    '/((?!api/auth|api/forms/.*/submit|api/forms/.*/public|_next/static|_next/image|favicon.ico|login|register|invite|f/).*)',
  ],
}
