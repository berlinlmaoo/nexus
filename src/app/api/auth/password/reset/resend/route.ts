import { NextRequest, NextResponse } from "next/server"
import { OtpPurpose } from "@/generated/prisma"
import prisma from "@/lib/prisma"
import { canonicalEmail } from "@/lib/email-auth"
import { resendPasswordResetSchema, validateBody } from "@/lib/validations"
import { checkRateLimit, checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  OTP_EXPIRES_IN_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  getEmailOtp,
  isOtpResendCoolingDown,
  secondsUntil,
  upsertEmailOtp,
} from "@/lib/auth-otp"
import { passwordResetOtpEmail, sendEmail } from "@/lib/email"

export async function POST(request: NextRequest) {
  try {
    const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 5, windowSeconds: 900 })
    if (!allowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(resendPasswordResetSchema, body)
    if (!validation.success) return validation.error

    const email = canonicalEmail(validation.data.email)
    const emailLimit = checkRateLimitByKey(`otp:password-reset:resend:${request.nextUrl.pathname}`, email, {
      limit: 3,
      windowSeconds: 900,
    })
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.resetAt)

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { name: true },
    })

    const pendingVerification = await getEmailOtp(email, OtpPurpose.PASSWORD_RESET)
    if (
      pendingVerification &&
      !pendingVerification.consumedAt &&
      isOtpResendCoolingDown(pendingVerification.resendAvailableAt)
    ) {
      return NextResponse.json(
        {
          error: "Please wait before requesting another verification code.",
          retryAfterSeconds: secondsUntil(pendingVerification.resendAvailableAt),
        },
        { status: 429 }
      )
    }

    if (!user) {
      return NextResponse.json(
        {
          ok: true,
          email,
          expiresInSeconds: OTP_EXPIRES_IN_MINUTES * 60,
          resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        },
        { status: 200 }
      )
    }

    const { code } = await upsertEmailOtp({
      email,
      purpose: OtpPurpose.PASSWORD_RESET,
    })

    await sendEmail({
      ...passwordResetOtpEmail({
        recipientName: user.name,
        otpCode: code,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      }),
      to: email,
    })

    return NextResponse.json(
      {
        ok: true,
        email,
        expiresInSeconds: OTP_EXPIRES_IN_MINUTES * 60,
        resendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("Password reset resend error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
