import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Prisma } from '@/generated/prisma'
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { canonicalEmail } from '@/lib/email-auth'
import { registerSchema, validateBody } from '@/lib/validations'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/** Prisma 7 + bundlers can duplicate the error class; use `code` + `meta` duck-typing. */
function prismaKnownRequestMeta(error: unknown): {
  code: string
  target?: string[]
} | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const fields = (error.meta as { target?: string[] })?.target
    return { code: error.code, target: fields }
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const meta = (error as { meta?: { target?: string[] } }).meta
    return {
      code: (error as { code: string }).code,
      target: meta?.target,
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 5 registrations per 15 minutes per IP
    const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 5, windowSeconds: 900 })
    if (!allowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(registerSchema, body)
    if (!validation.success) return validation.error

    const { name, password } = validation.data
    const email = canonicalEmail(validation.data.email)

    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    })

    // Auto-create or join the default workspace "PATS Group"
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
        userId: user.id,
        workspaceId: workspace.id,
        role: 'MEMBER',
      },
    })

    await logAudit({
      action: 'create',
      entityType: 'user',
      entityId: user.id,
      entityName: name,
      userId: user.id,
      request,
    })

    // Return user without password
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pw, ...userWithoutPassword } = user

    return NextResponse.json(userWithoutPassword, { status: 201 })
  } catch (error) {
    console.error('Registration error:', error)

    const known = prismaKnownRequestMeta(error)
    if (known) {
      if (known.code === 'P2002' && known.target?.includes('email')) {
        return NextResponse.json(
          { error: 'User with this email already exists' },
          { status: 409 }
        )
      }
      if (
        known.code === 'P1001' ||
        known.code === 'P1010' ||
        known.code === 'P1000'
      ) {
        return NextResponse.json(
          {
            error:
              'Cannot reach the database. Start PostgreSQL and set DATABASE_URL in .env (then run npx prisma db push).',
          },
          { status: 503 }
        )
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
