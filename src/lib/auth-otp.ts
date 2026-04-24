import { createHash, randomInt } from "crypto"
import { OtpPurpose } from "@/generated/prisma"
import prisma from "@/lib/prisma"

export const OTP_LENGTH = 6
export const OTP_EXPIRES_IN_MINUTES = 10
export const OTP_RESEND_COOLDOWN_SECONDS = 60
export const OTP_MAX_VERIFY_ATTEMPTS = 5

function otpPepper() {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "nexus-local-otp"
}

export function canonicalOtpEmail(email: string) {
  return email.trim().toLowerCase()
}

export function generateOtpCode() {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0")
}

export function hashOtpCode(email: string, purpose: OtpPurpose, code: string) {
  return createHash("sha256")
    .update(`${otpPepper()}:${canonicalOtpEmail(email)}:${purpose}:${code}`)
    .digest("hex")
}

export function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_EXPIRES_IN_MINUTES * 60 * 1000)
}

export function getOtpResendAvailableDate() {
  return new Date(Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000)
}

export async function upsertEmailOtp(input: {
  email: string
  purpose: OtpPurpose
  name?: string | null
  passwordHash?: string | null
}) {
  const email = canonicalOtpEmail(input.email)
  const code = generateOtpCode()
  const codeHash = hashOtpCode(email, input.purpose, code)
  const expiresAt = getOtpExpiryDate()
  const resendAvailableAt = getOtpResendAvailableDate()

  const verification = await prisma.emailOtpVerification.upsert({
    where: {
      email_purpose: {
        email,
        purpose: input.purpose,
      },
    },
    create: {
      email,
      purpose: input.purpose,
      codeHash,
      name: input.name ?? null,
      passwordHash: input.passwordHash ?? null,
      attempts: 0,
      expiresAt,
      resendAvailableAt,
      consumedAt: null,
    },
    update: {
      codeHash,
      name: input.name ?? null,
      passwordHash: input.passwordHash ?? null,
      attempts: 0,
      expiresAt,
      resendAvailableAt,
      consumedAt: null,
    },
  })

  return { code, verification }
}

export async function getEmailOtp(email: string, purpose: OtpPurpose) {
  return prisma.emailOtpVerification.findUnique({
    where: {
      email_purpose: {
        email: canonicalOtpEmail(email),
        purpose,
      },
    },
  })
}

export function isOtpExpired(expiresAt: Date) {
  return expiresAt.getTime() < Date.now()
}

export function isOtpResendCoolingDown(resendAvailableAt: Date) {
  return resendAvailableAt.getTime() > Date.now()
}

export function secondsUntil(date: Date) {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000))
}
