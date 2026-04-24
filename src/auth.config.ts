import type { NextAuthConfig } from 'next-auth'

const trustHost = (process.env.AUTH_TRUST_HOST ?? 'true').toLowerCase() !== 'false'
const useSecureCookies =
  process.env.NODE_ENV === 'production' ||
  (process.env.NEXTAUTH_URL?.startsWith('https://') ?? false)

/**
 * Edge-safe auth config (no Prisma / Node-only modules).
 * Used by `middleware.ts`. Session JWT is still verified with AUTH_SECRET.
 *
 * `secret` must be set here (not only via setEnvDefaults) so the Edge middleware
 * bundle inlines it; otherwise assertConfig fails with MissingSecret → ?error=Configuration.
 */
export const authConfig = {
  trustHost,
  useSecureCookies,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [],
  session: {
    strategy: 'jwt' as const,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.name = user.name
        token.email = user.email
        token.picture = user.image
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        // Prefer `id` (set on sign-in); fall back to JWT `sub` so API routes see a stable user id.
        const id =
          (token.id as string | undefined) ??
          (typeof token.sub === 'string' ? token.sub : undefined)
        session.user.id = id ?? ''
        session.user.name = token.name as string
        session.user.email = token.email as string
        session.user.image = (token.picture as string) || null
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    // Send auth failures to our app page so users see real UI (not /api/auth/error 500).
    error: '/login',
  },
} satisfies NextAuthConfig
