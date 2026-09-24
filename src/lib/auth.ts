import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authConfig } from '@/auth.config'
import { logAudit } from '@/lib/audit'
import { createLogger } from '@/lib/logger'
import { verifyCredentialUser } from '@/lib/credentials-auth'
import prisma from '@/lib/prisma'
import { isDeletedAccountEmail } from '@/lib/account-deletion'

const log = createLogger('auth')

const resolvedSecret =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? authConfig.secret

/**
 * Same config object passed to NextAuth (mutated by setEnvDefaults).
 * Used by the App Route POST handler to call `Auth(req, config)` without
 * next-auth's `reqWithEnvURL()` wrapper, which can drop credentials POST bodies.
 */
export const nexusNextAuthConfig = {
  ...authConfig,
  secret: resolvedSecret,
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const result = await verifyCredentialUser(credentials?.email, credentials?.password)
        return result?.user ?? null
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }: { user: { id?: string; name?: string | null } }) {
      if (user.id) {
        await logAudit({
          action: 'login',
          entityType: 'user',
          entityId: user.id,
          entityName: user.name || undefined,
          userId: user.id,
          metadata: { provider: 'credentials' },
        })
      }
      return true
    },
    async jwt({ token, user }: { token: Record<string, unknown>; user?: { id?: string; name?: string | null; email?: string | null; image?: string | null } }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.email = user.email
        token.picture = user.image
      }
      if (!token.id && typeof token.sub === 'string') {
        token.id = token.sub
      }
      if (token.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { avatar: true, name: true, email: true },
          })
          // Sessions are stateless JWTs (web cookie and the iOS app's Keychain copy alike), so
          // deleting an account cannot revoke them. Returning null here makes auth() answer
          // "signed out" and clears the cookie, on the very next request.
          if (dbUser && isDeletedAccountEmail(dbUser.email)) {
            return null
          }
          if (dbUser) {
            token.picture = dbUser.avatar
            token.name = dbUser.name
            // Refreshed like the name: after a change of email the session otherwise kept the old
            // address until the next sign-in, and everything reading session.user.email used it.
            token.email = dbUser.email
          }
        } catch (e) {
          log.error('jwt refresh from DB failed', { error: String(e) })
        }
      }
      return token
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(nexusNextAuthConfig)
