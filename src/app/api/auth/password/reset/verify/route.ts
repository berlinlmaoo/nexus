import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { OtpPurpose } from "@/generated/prisma"
import prisma from "@/lib/prisma"
import { canonicalEmail } from "@/lib/email-auth"
import { logAudit } from "@/lib/audit"
import { verifyPasswordResetSchema, validateBody } from "@/lib/validations"
import { checkRateLimit, checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  OTP_MAX_VERIFY_ATTEMPTS,
  getEmailOtp,
  hashOtpCode,
  isOtpExpired,
} from "@/lib/auth-otp"

export async function POST(request: NextRequest) {
  try {
    const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 10, windowSeconds: 900 })
    if (!allowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(verifyPasswordResetSchema, body)
    if (!validation.success) return validation.error

    const email = canonicalEmail(validation.data.email)
    const emailLimit = checkRateLimitByKey(`otp:password-reset:verify:${request.nextUrl.pathname}`, email, {
      limit: 10,
      windowSeconds: 900,
    })
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.resetAt)

    const pendingVerification = await getEmailOtp(email, OtpPurpose.PASSWORD_RESET)
    if (!pendingVerification || pendingVerification.consumedAt) {
      return NextResponse.json(
        { error: "No active password reset session found. Request a new code to continue." },
        { status: 404 }
      )
    }

    if (isOtpExpired(pendingVerification.expiresAt)) {
      return NextResponse.json(
        { error: "Verification code has expired. Request a new code to continue." },
        { status: 410 }
      )
    }

    if (pendingVerification.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      return NextResponse.json(
        { error: "Verification attempts exceeded. Request a new code to continue." },
        { status: 429 }
      )
    }

    const codeHash = hashOtpCode(email, OtpPurpose.PASSWORD_RESET, validation.data.code)
    if (codeHash !== pendingVerification.codeHash) {
      const updated = await prisma.emailOtpVerification.update({
        where: {
          email_purpose: {
            email,
            purpose: OtpPurpose.PASSWORD_RESET,
          },
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      })

      const attemptsRemaining = Math.max(0, OTP_MAX_VERIFY_ATTEMPTS - updated.attempts)
      return NextResponse.json(
        {
          error:
            attemptsRemaining > 0
              ? "Verification code is incorrect."
              : "Verification attempts exceeded. Request a new code to continue.",
          attemptsRemaining,
        },
        { status: attemptsRemaining > 0 ? 400 : 429 }
      )
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, name: true, email: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: "No operative account found for this email." },
        { status: 404 }
      )
    }

    const hashedPassword = await bcrypt.hash(validation.data.password, 12)

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      })

      await tx.emailOtpVerification.update({
        where: {
          email_purpose: {
            email,
            purpose: OtpPurpose.PASSWORD_RESET,
          },
        },
        data: {
          consumedAt: new Date(),
          userId: user.id,
          passwordHash: null,
          name: null,
        },
      })
    })

    await logAudit({
      action: "update",
      entityType: "user_password",
      entityId: user.id,
      entityName: user.name,
      userId: user.id,
      request,
      metadata: { via: "password_reset_otp" },
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error("Password reset verification error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
