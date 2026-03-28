import { handlers, nexusNextAuthConfig } from '@/lib/auth'
import NextAuth from 'next-auth'

export const GET = handlers.GET

/**
 * Custom POST handler to preserve credentials body.
 * The standard handlers.POST uses reqWithEnvURL() which can
 * drop the POST body for credentials sign-in.
 */
export async function POST(req: Request) {
  const { handlers: h } = NextAuth(nexusNextAuthConfig)
  return h.POST(req)
}
