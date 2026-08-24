// Self-service email change — step 2: verify the code sent to the new address and commit the change.
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { OtpPurpose } from "@/generated/prisma"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { canonicalEmail } from "@/lib/email-auth"
import { logAudit } from "@/lib/audit"
import { checkRateLimit, checkRateLimitByKey, rateLimitResponse } from "@/lib/rate-limit"
import { OTP_MAX_VERIFY_ATTEMPTS, getEmailOtp, hashOtpCode, isOtpExpired } from "@/lib/auth-otp"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { allowed, resetAt } = checkRateLimit(request, undefined, { limit: 10, windowSeconds: 900 })
  if (!allowed) return rateLimitResponse(resetAt)

  const body = await request.json().catch(() => ({}))
  const newEmail = canonicalEmail(typeof body?.email === "string" ? body.email : "")
  const code = String(body?.code ?? "").trim()
  if (!newEmail || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "Email atau kode nggak valid." }, { status: 400 })

  const emailLimit = checkRateLimitByKey("otp:email-change:verify", newEmail, { limit: 10, windowSeconds: 900 })
  if (!emailLimit.allowed) return rateLimitResponse(emailLimit.resetAt)

  const pending = await getEmailOtp(newEmail, OtpPurpose.EMAIL_CHANGE)
  if (!pending || pending.consumedAt) return NextResponse.json({ error: "Nggak ada permintaan ganti email buat alamat ini." }, { status: 404 })
  // The request stashed the requesting user's id in `name`; only that account may complete it.
  if (pending.name !== session.user.id) return NextResponse.json({ error: "Kode ini bukan buat akun kamu." }, { status: 403 })
  if (isOtpExpired(pending.expiresAt)) return NextResponse.json({ error: "Kode udah kadaluarsa. Minta kode baru." }, { status: 410 })
  if (pending.attempts >= OTP_MAX_VERIFY_ATTEMPTS) return NextResponse.json({ error: "Kebanyakan salah kode. Minta kode baru." }, { status: 429 })

  if (hashOtpCode(newEmail, OtpPurpose.EMAIL_CHANGE, code) !== pending.codeHash) {
    await prisma.emailOtpVerification.update({
      where: { email_purpose: { email: newEmail, purpose: OtpPurpose.EMAIL_CHANGE } },
      data: { attempts: { increment: 1 } },
    })
    return NextResponse.json({ error: "Kode salah." }, { status: 400 })
  }

  // Re-check uniqueness at commit time — someone else could have claimed the address since step 1.
  const taken = await prisma.user.findFirst({
    where: { email: { equals: newEmail, mode: "insensitive" }, id: { not: session.user.id } },
    select: { id: true },
  })
  if (taken) return NextResponse.json({ error: "Email itu keburu dipakai akun lain." }, { status: 409 })

  try {
    const [updated] = await prisma.$transaction([
      prisma.user.update({ where: { id: session.user.id }, data: { email: newEmail }, select: { id: true, email: true } }),
      prisma.emailOtpVerification.update({
        where: { email_purpose: { email: newEmail, purpose: OtpPurpose.EMAIL_CHANGE } },
        data: { consumedAt: new Date() },
      }),
    ])
    logAudit({ action: "update", entityType: "user", entityId: session.user.id, entityName: `email changed to ${newEmail}`, userId: session.user.id, request })
    return NextResponse.json({ ok: true, email: updated.email })
  } catch (error) {
    console.error("email change verify error:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
