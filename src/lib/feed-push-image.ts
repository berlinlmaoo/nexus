import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * A Threads photo URL that works without a session — for the push notification only.
 *
 * Owner, 9 Oct 2026: a post with a photo should show the photo when the notification is long-pressed.
 * On iOS the picture is fetched by the Notification Service Extension, which runs outside the app and
 * has no session cookie, and /api/files requires one. So the push carries a narrow, signed URL instead:
 *
 *   /api/feed/push-image/<PostImage.id>?exp=<unix seconds>&sig=<HMAC-SHA256, base64url>
 *
 * Narrow on purpose: it names one PostImage row (never a path), it expires after a week (a push older
 * than that is not long-pressed), and the route serves it only while the post is not deleted — so a
 * leaked link stops working when the post is taken down, and it can never reach any other upload.
 * The key is derived from AUTH_SECRET with a purpose label, so this signature is useless anywhere else.
 */

export const PUSH_IMAGE_TTL_SECONDS = 7 * 24 * 60 * 60

function key(): Buffer | null {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) return null
  return createHmac("sha256", secret).update("nexus:feed-push-image:v1").digest()
}

function signature(k: Buffer, imageId: string, exp: number): string {
  return createHmac("sha256", k).update(`${imageId}.${exp}`).digest("base64url")
}

/** The path + query (no origin) for `imageId`, or null when no secret is configured. */
export function signedPushImagePath(imageId: string, nowMs = Date.now()): string | null {
  const k = key()
  if (!k) return null
  const exp = Math.floor(nowMs / 1000) + PUSH_IMAGE_TTL_SECONDS
  return `/api/feed/push-image/${encodeURIComponent(imageId)}?exp=${exp}&sig=${signature(k, imageId, exp)}`
}

/** True when `sig` is ours for (imageId, exp) and exp has not passed. Constant-time compare. */
export function verifyPushImage(imageId: string, expRaw: string | null, sig: string | null, nowMs = Date.now()): boolean {
  const k = key()
  if (!k || !imageId || !expRaw || !sig || !/^\d{1,12}$/.test(expRaw)) return false
  const exp = Number(expRaw)
  if (exp * 1000 < nowMs) return false
  const want = Buffer.from(signature(k, imageId, exp))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** The absolute URL for the push payload, or null when there is no public address or no secret. */
export function pushImageUrl(imageId: string | null | undefined, baseUrl: string, nowMs = Date.now()): string | null {
  if (!imageId || !/^https:\/\//i.test(baseUrl)) return null
  const path = signedPushImagePath(imageId, nowMs)
  return path ? `${baseUrl.replace(/\/+$/, "")}${path}` : null
}
