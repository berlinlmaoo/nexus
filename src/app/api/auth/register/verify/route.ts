export const dynamic = "force-dynamic"

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
import { randomUUID } from "crypto"

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

    // Where this person lands. Every signup used to be dropped straight into the primary
    // workspace, so anyone who found the sign-up page ended up inside the company's data with no
    // invitation of any kind. Now they either present a code for a workspace that already exists,
    // or they get one of their own and touch nobody else's.
    const rawCode = typeof body?.workspaceCode === "string" ? body.workspaceCode : ""
    // People retype these off a screen, so spacing, dashes and case are theirs to get wrong.
    const joinCode = rawCode.replace(/[\s-]/g, "").toUpperCase()
    const joinTarget = joinCode
      ? await prisma.workspace.findUnique({ where: { joinCode }, select: { id: true, name: true } })
      : null
    if (joinCode && !joinTarget) {
      return NextResponse.json({ error: "That workspace code is not valid." }, { status: 400 })
    }

    const { user } = await prisma.$transaction(async (tx) => {
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

      if (joinTarget) {
        // Joining by code makes you staff. Nothing here may hand out authority: a code is proof
        // that someone told you where to go, not proof of who you are.
        await tx.workspaceMember.create({
          data: { userId: createdUser.id, workspaceId: joinTarget.id, role: "STAFF" },
        })
      } else {
        // No code: their own workspace, which they own. Slug has to be unique, and two people
        // called Budi signing up on the same day is not an error worth failing a signup over.
        const base =
          createdUser.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace"
        const suffix = Math.random().toString(36).slice(2, 8)
        const created = await tx.workspace.create({
          data: {
            name: `${createdUser.name}'s workspace`,
            slug: `${base}-${suffix}`,
            description: null,
            joinCode: randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
          },
          select: { id: true },
        })
        await tx.workspaceMember.create({
          data: { userId: createdUser.id, workspaceId: created.id, role: "ONE_ABOVE_ALL" },
        })
      }
      return { user: createdUser }
    })

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
