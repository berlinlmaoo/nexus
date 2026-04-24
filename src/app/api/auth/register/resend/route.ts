import { NextRequest, NextResponse } from "next/server"
import { OtpPurpose } from "@/generated/prisma"
import prisma from "@/lib/prisma"
import { canonicalEmail } from "@/lib/email-auth"
import { resendSignupOtpSchema, validateBody } from "@/lib/validations"
import { checkRateLimit, checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  OTP_EXPIRES_IN_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  getEmailOtp,
  isOtpResendCoolingDown,
  secondsUntil,
  upsertEmailOtp,
} from "@/lib/auth-otp"
import { sendEmail, signupOtpEmail } from "@/lib/email"

export async function POST(request: NextRequest) {
  try {
    const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 5, windowSeconds: 900 })
    if (!allowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(resendSignupOtpSchema, body)
    if (!validation.success) return validation.error

    const email = canonicalEmail(validation.data.email)
    const emailLimit = checkRateLimitByKey(`otp:signup:resend:${request.nextUrl.pathname}`, email, {
      limit: 3,
      windowSeconds: 900,
    })
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.resetAt)

    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    })
    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      )
    }

    const pendingVerification = await getEmailOtp(email, OtpPurpose.SIGNUP)
    if (
      !pendingVerification ||
      pendingVerification.consumedAt ||
      !pendingVerification.name ||
      !pendingVerification.passwordHash
    ) {
      return NextResponse.json(
        { error: "No pending registration found for this email." },
        { status: 404 }
      )
    }

    if (isOtpResendCoolingDown(pendingVerification.resendAvailableAt)) {
      return NextResponse.json(
        {
          error: "Please wait before requesting another verification code.",
          retryAfterSeconds: secondsUntil(pendingVerification.resendAvailableAt),
        },
        { status: 429 }
      )
    }

    const { code } = await upsertEmailOtp({
      email,
      purpose: OtpPurpose.SIGNUP,
      name: pendingVerification.name,
      passwordHash: pendingVerification.passwordHash,
    })

    const emailSent = await sendEmail({
      ...signupOtpEmail({
        recipientName: pendingVerification.name,
        otpCode: code,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES,
      }),
      to: email,
    })

    if (!emailSent) {
      return NextResponse.json(
        {
          error:
            "Verification email could not be delivered. Configure SMTP or Mailpit before requesting access.",
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
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("Signup OTP resend error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
