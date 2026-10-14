import { decode } from "next-auth/jwt"
import prisma from "@/lib/prisma"
import { getSessionCookieName } from "@/lib/session-cookie"
import { createLogger } from "@/lib/logger"
import { clientIpFromHeaders } from "@/lib/client-ip"

/**
 * The session list behind Settings → Security → Active sessions (12 Oct 2026).
 *
 * Sessions stay stateless JWTs; this table is the ledger beside them. Every sign-in route (web
 * password, passkey, app-login, direct-login, SSO) records one UserSession row whose `token` column
 * holds the JWT's `sid` claim — never the JWT itself. The jwt callback (lib/auth.ts) then asks
 * `sessionRejected()` on each request: a revoked row ends that one token, and a live row gets its
 * lastActiveAt bumped at most every 5 minutes.
 *
 * Tokens minted before this table was written to (every device signed in today) have no row: the
 * first request after deploy creates one lazily, so they appear in the list without signing anyone
 * out. A token with no `sid` at all (minted 24–29 Sep 2026, before sids) is keyed by
 * `legacy:<userId>:<iat>` — its iat never changes (nothing re-encodes these cookies) — and can be
 * revoked like any other.
 *
 * "Sign out other sessions" revokes every row except the caller's and stamps User.sessionsCutoffAt,
 * so a token that has not made a request since (no row yet) is refused when it first shows up rather
 * than lazily listed as live.
 *
 * Lookups are cached per process (30 s for "live", for good once revoked); revocations made in this
 * process take effect at once, those made by the other blue-green slot within 30 s.
 */

const log = createLogger("user-sessions")

const RECHECK_MS = 30_000
const TOUCH_EVERY_MS = 5 * 60_000
const CACHE_MAX = 20_000
const FALLBACK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

type HeaderSource = { get(name: string): string | null } | null | undefined

type Entry = { revoked: boolean; checkedAt: number; touchedAt: number }
const cache = new Map<string, Entry>()

function remember(key: string, entry: Entry) {
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, entry)
}

/** Where the request came from: the client IP by the proxy trust rule of lib/client-ip.ts (as rate limiting uses). */
export function requestOrigin(h: HeaderSource): { ipAddress: string | null; userAgent: string | null; client: string | null } {
  if (!h) return { ipAddress: null, userAgent: null, client: null }
  const ip = clientIpFromHeaders(h)
  return {
    ipAddress: ip ? ip.slice(0, 64) : null,
    userAgent: h.get("user-agent")?.slice(0, 512) || null,
    client: h.get("x-nexus-client")?.trim().slice(0, 64) || null,
  }
}

type TokenLike = Record<string, unknown>

/** The key a token is listed and revoked under: its `sid`, or `legacy:<userId>:<iat>` for a token minted before sids. */
export function sessionKeyOf(token: TokenLike | null | undefined): string | null {
  if (!token) return null
  if (typeof token.sid === "string" && token.sid) return token.sid
  const userId = typeof token.id === "string" ? token.id : typeof token.sub === "string" ? token.sub : null
  if (userId && typeof token.iat === "number") return `legacy:${userId}:${token.iat}`
  return null
}

/** Record a session at sign-in. Never throws: a sign-in must not fail over the ledger. */
export async function recordUserSession(input: {
  userId: string
  sid: string
  headers?: HeaderSource
  expiresAt?: Date
}): Promise<void> {
  const now = Date.now()
  try {
    await prisma.userSession.createMany({
      data: [{
        userId: input.userId,
        token: input.sid,
        ...requestOrigin(input.headers),
        expiresAt: input.expiresAt ?? new Date(now + FALLBACK_LIFETIME_MS),
      }],
      skipDuplicates: true,
    })
    remember(input.sid, { revoked: false, checkedAt: now, touchedAt: now })
  } catch (e) {
    log.error("record session failed", { userId: input.userId, error: String(e) })
  }
}

/**
 * Called by the jwt callback on every authenticated request (after the deleted / offboarded /
 * sessionVersion checks). True = this token was signed out (from Settings, or by logging out) and must
 * be refused. A database error answers false, like the rest of that callback: never sign people out
 * because Postgres hiccupped.
 */
export async function sessionRejected(
  token: TokenLike,
  userId: string,
  cutoffAt: Date | null | undefined,
  headers?: HeaderSource,
): Promise<boolean> {
  const key = sessionKeyOf(token)
  if (!key) return false
  const now = Date.now()
  let entry = cache.get(key)
  if (entry?.revoked) return true
  try {
    if (!entry || now - entry.checkedAt > RECHECK_MS) {
      const [row, revokedRow] = await Promise.all([
        prisma.userSession.findUnique({ where: { token: key }, select: { revoked: true, lastActiveAt: true, userId: true } }),
        prisma.revokedSession.findUnique({ where: { sid: key }, select: { sid: true } }),
      ])
      let revoked = Boolean(revokedRow) || Boolean(row?.revoked) || (row != null && row.userId !== userId)
      let touchedAt = row?.lastActiveAt.getTime() ?? now
      if (!row && !revoked) {
        const iatMs = typeof token.iat === "number" ? token.iat * 1000 : null
        if (cutoffAt && iatMs !== null && iatMs < cutoffAt.getTime()) {
          // Signed in before "Sign out other sessions" and silent since: it was one of the others.
          revoked = true
        } else {
          const expMs = typeof token.exp === "number" ? token.exp * 1000 : now + FALLBACK_LIFETIME_MS
          await prisma.userSession.createMany({
            data: [{
              userId,
              token: key,
              ...requestOrigin(headers),
              createdAt: new Date(iatMs ?? now),
              lastActiveAt: new Date(now),
              expiresAt: new Date(expMs),
            }],
            skipDuplicates: true,
          })
          touchedAt = now
        }
      }
      entry = { revoked, checkedAt: now, touchedAt }
      remember(key, entry)
      if (revoked) return true
    }
    if (now - entry.touchedAt > TOUCH_EVERY_MS) {
      entry.touchedAt = now
      const origin = requestOrigin(headers)
      void prisma.userSession
        .updateMany({
          where: { token: key, revoked: false },
          data: {
            lastActiveAt: new Date(now),
            ...(origin.ipAddress && { ipAddress: origin.ipAddress }),
            ...(origin.userAgent && { userAgent: origin.userAgent }),
            ...(origin.client && { client: origin.client }),
          },
        })
        .catch((e) => log.error("touch session failed", { error: String(e) }))
    }
  } catch (e) {
    log.error("session check failed", { error: String(e) })
  }
  return false
}

/**
 * Sign these sessions out: the rows are marked revoked (they leave the list) and each key goes into
 * RevokedSession, which the jwt callback also honours. Takes effect in this process at once.
 */
export async function revokeSessionKeys(userId: string, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0
  const now = Date.now()
  const rows = await prisma.userSession.findMany({ where: { userId, token: { in: keys } }, select: { token: true, expiresAt: true } })
  const expiry = new Map(rows.map((r) => [r.token, r.expiresAt]))
  const result = await prisma.userSession.updateMany({ where: { userId, token: { in: keys }, revoked: false }, data: { revoked: true } })
  await prisma.revokedSession.createMany({
    data: keys.map((sid) => ({ sid, userId, expiresAt: expiry.get(sid) ?? new Date(now + FALLBACK_LIFETIME_MS) })),
    skipDuplicates: true,
  })
  for (const k of keys) remember(k, { revoked: true, checkedAt: now, touchedAt: now })
  // Housekeeping: revocations past their token's expiry mean nothing.
  await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => null)
  return result.count
}

/**
 * Every session of this user except `keepKey`: rows revoked, and a cutoff so that a token which has not
 * shown up since (no row yet) is refused too.
 */
export async function revokeOtherSessions(userId: string, keepKey: string | null): Promise<number> {
  const rows = await prisma.userSession.findMany({
    where: { userId, revoked: false, ...(keepKey && { token: { not: keepKey } }) },
    select: { token: true },
  })
  await prisma.user.update({ where: { id: userId }, data: { sessionsCutoffAt: new Date() } })
  return revokeSessionKeys(userId, rows.map((r) => r.token))
}

/**
 * After a sessionVersion bump (password reset, admin reset, password change from the web) every
 * existing token is already refused by the version check; this only takes their rows off the list.
 */
export async function markSessionsEnded(userId: string, keepKey?: string | null): Promise<void> {
  try {
    await prisma.userSession.updateMany({
      where: { userId, revoked: false, ...(keepKey && { token: { not: keepKey } }) },
      data: { revoked: true },
    })
  } catch (e) {
    log.error("mark sessions ended failed", { userId, error: String(e) })
  }
}

/** The caller's own session token, decoded from the session cookie (web and apps send the same cookie). */
export async function readSessionToken(req: { cookies: { get(name: string): { value: string } | undefined } }): Promise<TokenLike | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  const cookieName = getSessionCookieName()
  const raw = req.cookies.get(cookieName)?.value
  if (!secret || !raw) return null
  try {
    return ((await decode({ token: raw, secret, salt: cookieName })) as TokenLike | null) ?? null
  } catch {
    return null
  }
}
