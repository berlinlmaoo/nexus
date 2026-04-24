import { NextRequest, NextResponse } from "next/server"
import { OtpPurpose } from "@/generated/prisma"
import prisma from "@/lib/prisma"
import { canonicalEmail } from "@/lib/email-auth"
import { logAudit } from "@/lib/audit"
import { verifySignupOtpSchema, validateBody } from "@/lib/validations"
import { checkRateLimit, checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  OTP_MAX_VERIFY_ATTEMPTS,
  getEmailOtp,
  hashOtpCode,
  isOtpExpired,
} from "@/lib/auth-otp"
import { ensureUserInPrimaryWorkspaceTeam } from "@/lib/primary-team"
import { syncTeamMemberAccess } from "@/lib/team-sync"

export async function POST(request: NextRequest) {
  try {
    const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 10, windowSeconds: 900 })
    if (!allowed) return rateLimitResponse(resetAt)

    const body = await request.json()
    const validation = validateBody(verifySignupOtpSchema, body)
    if (!validation.success) return validation.error

    const email = canonicalEmail(validation.data.email)
    const emailLimit = checkRateLimitByKey(`otp:signup:verify:${request.nextUrl.pathname}`, email, {
      limit: 10,
      windowSeconds: 900,
    })
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.resetAt)

    const pendingVerification = await getEmailOtp(email, OtpPurpose.SIGNUP)

    if (!pendingVerification || pendingVerification.consumedAt) {
      return NextResponse.json(
        { error: "No pending verification found for this email." },
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

    const codeHash = hashOtpCode(email, OtpPurpose.SIGNUP, validation.data.code)
    if (codeHash !== pendingVerification.codeHash) {
      const updated = await prisma.emailOtpVerification.update({
        where: {
          email_purpose: {
            email,
            purpose: OtpPurpose.SIGNUP,
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

    if (!pendingVerification.name || !pendingVerification.passwordHash) {
      return NextResponse.json(
        { error: "Registration session is incomplete. Please start again." },
        { status: 400 }
      )
    }

    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    })
    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      )
    }

    const { user, primaryTeamId } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name: pendingVerification.name!,
          email,
          password: pendingVerification.passwordHash!,
        },
      })

      await tx.emailOtpVerification.update({
        where: {
          email_purpose: {
            email,
            purpose: OtpPurpose.SIGNUP,
          },
        },
        data: {
          consumedAt: new Date(),
          userId: createdUser.id,
        },
      })

      const { team } = await ensureUserInPrimaryWorkspaceTeam(tx, createdUser.id)
      return { user: createdUser, primaryTeamId: team.id }
    })

    await syncTeamMemberAccess(primaryTeamId, user.id)

    await logAudit({
      action: "create",
      entityType: "user",
      entityId: user.id,
      entityName: user.name,
      userId: user.id,
      request,
      metadata: { via: "signup_otp" },
    })

    const { password: _pw, ...userWithoutPassword } = user
    return NextResponse.json(userWithoutPassword, { status: 201 })
  } catch (error) {
    console.error("Signup OTP verification error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
