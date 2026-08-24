// Self-service email change — step 1: send a 6-digit code to the NEW address to prove the user owns
// it. Nothing changes until /api/user/email/verify succeeds. Must be logged in.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { OtpPurpose } from "@/generated/prisma"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { canonicalEmail } from "@/lib/email-auth"
import { logAudit } from "@/lib/audit"
import { checkRateLimit, checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  OTP_EXPIRES_IN_MINUTES,
  getEmailOtp,
  isOtpResendCoolingDown,
  secondsUntil,
  upsertEmailOtp,
} from "@/lib/auth-otp"
import { emailChangeOtpEmail, sendEmail } from "@/lib/email"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 5, windowSeconds: 900 })
  if (!allowed) return rateLimitResponse(resetAt)

  const body = await request.json().catch(() => ({}))
  const newEmail = canonicalEmail(typeof body?.email === "string" ? body.email : "")
  if (!EMAIL_RE.test(newEmail)) return NextResponse.json({ error: "Masukin alamat email yang valid." }, { status: 400 })

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, name: true } })
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (canonicalEmail(me.email) === newEmail) {
    return NextResponse.json({ error: "Itu email kamu yang sekarang." }, { status: 400 })
  }

  // Don't let two accounts share an email. Checked again at verify time (TOCTOU-safe).
  const taken = await prisma.user.findFirst({ where: { email: { equals: newEmail, mode: "insensitive" } }, select: { id: true } })
  if (taken) return NextResponse.json({ error: "Email itu udah dipakai akun lain." }, { status: 409 })

  // Per-target-email resend cooldown, so the new address can't be spammed with codes.
  const existing = await getEmailOtp(newEmail, OtpPurpose.EMAIL_CHANGE)
  if (existing && !existing.consumedAt && isOtpResendCoolingDown(existing.resendAvailableAt)) {
    return NextResponse.json(
      { error: "Tunggu bentar sebelum minta kode lagi.", resendInSeconds: secondsUntil(existing.resendAvailableAt) },
      { status: 429 },
    )
  }
  const emailLimit = checkRateLimitByKey("otp:email-change:request", newEmail, { limit: 5, windowSeconds: 900 })
  if (!emailLimit.allowed) return rateLimitResponse(emailLimit.resetAt)

  try {
    // `name` on the OTP row carries the requesting user's id, so verify can only be completed by the
    // same account that requested the change (see the verify route).
    const { code, verification } = await upsertEmailOtp({ email: newEmail, purpose: OtpPurpose.EMAIL_CHANGE, name: session.user.id })
    const sent = await sendEmail({ ...emailChangeOtpEmail({ recipientName: me.name || "there", otpCode: code, expiresInMinutes: OTP_EXPIRES_IN_MINUTES }), to: newEmail })
    if (!sent) return NextResponse.json({ error: "Gagal ngirim email. Coba lagi bentar." }, { status: 502 })
    logAudit({ action: "update", entityType: "user", entityId: session.user.id, entityName: "email-change requested", userId: session.user.id, request })
    return NextResponse.json({ ok: true, resendInSeconds: secondsUntil(verification.resendAvailableAt) })
  } catch (error) {
    console.error("email change request error:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
