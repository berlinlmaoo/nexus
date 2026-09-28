import { timingSafeEqual } from "crypto"

/**
 * Constant-time comparison of a presented secret with the expected one. False when either is empty.
 * Lengths are compared first (timingSafeEqual needs equal-length buffers); that leaks only the length.
 */
export function secretMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * True when the request carries `Authorization: Bearer <CRON_SECRET>` — the contract of the host's
 * cron caller (cron/nexus-cron.sh). No session fallback: a cron job is not something a signed-in
 * person should be able to trigger.
 */
export function isCronRequest(req: Request): boolean {
  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  return secretMatches(bearer, process.env.CRON_SECRET)
}
