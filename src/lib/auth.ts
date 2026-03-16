import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'

const authConfig: NextAuthConfig = {
  trustHost: true,
  useSecureCookies: false,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const email = credentials.email as string
        const password = credentials.password as string

        if (!email.endsWith('@patsgroup.id')) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email },
        })

        if (!user || !user.password) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(password, user.password)

        if (!isPasswordValid) {
          return null
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const email = user.email
        if (!email || !email.endsWith('@patsgroup.id')) {
          return false
        }

        // Check if user exists, if not auto-create
        let dbUser = await prisma.user.findUnique({
          where: { email },
        })

        if (!dbUser) {
          // Auto-create user on first Google login
          dbUser = await prisma.user.create({
            data: {
              name: user.name || email.split('@')[0],
              email,
              avatar: user.image || null,
            },
          })

          // Auto-join the default workspace
          let workspace = await prisma.workspace.findUnique({
            where: { slug: 'pats-group' },
          })

          if (!workspace) {
            workspace = await prisma.workspace.create({
              data: {
                name: 'PATS Group',
                slug: 'pats-group',
                description: 'Default workspace for PATS Group',
              },
            })
          }

          await prisma.workspaceMember.create({
            data: {
              userId: dbUser.id,
              workspaceId: workspace.id,
              role: 'MEMBER',
            },
          })
        }

        // Link account if not already linked
        const existingAccount = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
        })

        if (!existingAccount) {
          await prisma.account.create({
            data: {
              userId: dbUser.id,
              type: account.type,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              refresh_token: account.refresh_token,
              access_token: account.access_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
              session_state: account.session_state as string | undefined,
            },
          })
        }

        // Update avatar from Google if not set
        if (!dbUser.avatar && user.image) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { avatar: user.image },
          })
        }

        // Log Google login
        logAudit({ action: "login", entityType: "user", entityId: dbUser.id, entityName: dbUser.name, userId: dbUser.id, metadata: { provider: "google" } })
      } else {
        // Log credentials login
        if (user.id) {
          logAudit({ action: "login", entityType: "user", entityId: user.id, entityName: user.name || undefined, userId: user.id, metadata: { provider: "credentials" } })
        }
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        // For Google provider, look up the actual DB user ID
        if (account?.provider === 'google' && user.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true, name: true, avatar: true },
          })
          if (dbUser) {
            token.id = dbUser.id
            token.name = dbUser.name
            token.picture = dbUser.avatar
          }
        } else {
          token.id = user.id
          token.name = user.name
          token.email = user.email
          token.picture = user.image
        }
      }
      // Always refresh avatar from DB
      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { avatar: true, name: true },
        })
        if (dbUser) {
          token.picture = dbUser.avatar
          token.name = dbUser.name
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.name = token.name as string
        session.user.email = token.email as string
        session.user.image = (token.picture as string) || null
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
