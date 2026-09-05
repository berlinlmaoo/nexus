import prisma from "@/lib/prisma"

/**
 * Relying-party identity. This must match the domain that serves
 * /.well-known/apple-app-site-association, otherwise a passkey saved on the phone will simply not
 * be offered on the Mac and the failure is silent on both ends.
 */
export const RP_NAME = "NEXUS"
export const RP_ID = process.env.PASSKEY_RP_ID ?? "nexus.znetworks.id"

/**
 * Apple's native flow reports the origin as `https://<rpID>`, the same string a browser sends, so
 * one entry covers web, iPhone, iPad and Mac. Kept as a list because a second origin is exactly
 * what a staging domain would need, and guessing it later is worse than allowing for it now.
 */
export const EXPECTED_ORIGINS = [
  process.env.PASSKEY_ORIGIN ?? `https://${RP_ID}`,
]

/** A challenge is only useful once. Ten minutes is generous for a person fumbling with Face ID. */
const CHALLENGE_TTL_MS = 10 * 60 * 1000

export async function saveChallenge(challenge: string, purpose: "register" | "login", userId?: string) {
  // Opportunistic sweep: this table would otherwise grow forever from abandoned attempts.
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => null)
  await prisma.passkeyChallenge.create({
    data: { challenge, purpose, userId: userId ?? null, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  })
}

/**
 * Consume a challenge. Deleted whether or not it turns out to be valid: a challenge that survives
 * a failed attempt can be retried, which is the whole thing a challenge exists to prevent.
 */
export async function takeChallenge(challenge: string, purpose: "register" | "login") {
  const row = await prisma.passkeyChallenge.findUnique({ where: { challenge } })
  if (!row) return null
  await prisma.passkeyChallenge.delete({ where: { id: row.id } }).catch(() => null)
  if (row.purpose !== purpose) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  return row
}
