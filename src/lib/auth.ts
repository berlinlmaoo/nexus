import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from '@/auth.config'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { canonicalEmail } from '@/lib/email-auth'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth')

const resolvedSecret =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? authConfig.secret

/**
 * Same config object passed to NextAuth (mutated by setEnvDefaults).
 * Used by the App Route POST handler to call `Auth(req, config)` without
 * next-auth’s `reqWithEnvURL()` wrapper, which can drop credentials POST bodies.
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
        console.log("Authorize attempt:", { email: credentials?.email })
        const rawEmail = credentials?.email
        const rawPassword = credentials?.password
        const email =
          typeof rawEmail === 'string'
            ? canonicalEmail(rawEmail)
            : canonicalEmail(String(rawEmail ?? ''))
        const password =
          typeof rawPassword === 'string'
            ? rawPassword
            : String(rawPassword ?? '')

        if (!email || !password) {
          console.log("Missing email or password")
          return null
        }

        try {
          let user = await prisma.user.findUnique({ where: { email } })
          if (!user) {
            console.log("User not found by unique email:", email)
            try {
              user = await prisma.user.findFirst({
                where: { email: { equals: email, mode: 'insensitive' } },
              })
            } catch {
              /* case-insensitive mode unavailable or DB error — unique lookup already failed */
            }
          }

          if (!user) {
            console.log("User totally not found:", email)
            return null
          }
          if (!user.password) {
            console.log("User has no password set:", email)
            return null
          }

          const isPasswordValid = await bcrypt.compare(password, user.password)
          console.log("Password check result:", isPasswordValid)

          if (!isPasswordValid) {
            return null
          }

          console.log("Login successful for:", user.email)
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.avatar,
          }
        } catch (e) {
          console.error("Authorize error:", e)
          log.error('credentials authorize failed', { error: String(e) })
          return null
        }
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
            select: { avatar: true, name: true },
          })
          if (dbUser) {
            token.picture = dbUser.avatar
            token.name = dbUser.name
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
