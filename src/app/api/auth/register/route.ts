import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { OtpPurpose, Prisma } from '@/generated/prisma'
import prisma from '@/lib/prisma'
import { canonicalEmail } from '@/lib/email-auth'
import { registerSchema, validateBody } from '@/lib/validations'
import { checkRateLimit, checkRateLimitByKey, rateLimitResponse } from '@/lib/rate-limit'
import {
  OTP_EXPIRES_IN_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  getEmailOtp,
  isOtpResendCoolingDown,
  secondsUntil,
  upsertEmailOtp,
} from '@/lib/auth-otp'
import { sendEmail, signupOtpEmail } from '@/lib/email'

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
    // Rate limit: 5 registration OTP requests per 15 minutes per IP
    const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 5, windowSeconds: 900 })
    if (!allowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(registerSchema, body)
    if (!validation.success) return validation.error

    const { name, password } = validation.data
    const email = canonicalEmail(validation.data.email)

    const emailLimit = checkRateLimitByKey(`otp:signup:request:${request.nextUrl.pathname}`, email, {
      limit: 3,
      windowSeconds: 900,
    })
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.resetAt)

    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      )
    }

    const pendingVerification = await getEmailOtp(email, OtpPurpose.SIGNUP)
    if (
      pendingVerification &&
      !pendingVerification.consumedAt &&
      isOtpResendCoolingDown(pendingVerification.resendAvailableAt)
    ) {
      return NextResponse.json(
        {
          error: 'Please wait before requesting another verification code.',
          retryAfterSeconds: secondsUntil(pendingVerification.resendAvailableAt),
        },
        { status: 429 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const { code, verification } = await upsertEmailOtp({
      email,
      purpose: OtpPurpose.SIGNUP,
      name,
      passwordHash: hashedPassword,
    })

    const emailSent = await sendEmail({
      ...signupOtpEmail({
        recipientName: name,
        otpCode: code,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      }),
      to: email,
    })

    if (!emailSent) {
      await prisma.emailOtpVerification.delete({
        where: {
          email_purpose: {
            email,
            purpose: OtpPurpose.SIGNUP,
          },
        },
      }).catch(() => null)

      return NextResponse.json(
        {
          error:
            'Verification email could not be delivered. Configure SMTP or Mailpit before requesting access.',
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        email,
        expiresInSeconds: OTP_EXPIRES_IN_MINUTES * 60,
        resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        verificationId: verification.id,
      },
      { status: 200 }
    )
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
