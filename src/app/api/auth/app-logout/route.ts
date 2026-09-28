export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { decode } from "next-auth/jwt"
import prisma from "@/lib/prisma"
import { getSessionCookieName } from "@/lib/session-cookie"
import { SESSION_MAX_AGE_SECONDS } from "@/lib/session-issue"

/**
 * POST /api/auth/app-logout — ends THIS session on the server (security audit, 29 Sep 2026). Called by
 * the apps (and the web) when the person signs out, so a copy of the token (a backup, a proxy, a
 * stolen phone's disk) stops working now rather than when it expires.
 *
 *   token with `sid`     → that session alone is revoked (RevokedSession, until it would expire);
 *   token without `sid`  → issued before sids existed: the only lever is the user's sessionVersion,
 *                          which ends every session of theirs (they sign in again elsewhere).
 * Always answers 200 {ok:true} for a readable token — signing out never depends on this.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  const cookieName = getSessionCookieName()
  const raw = req.cookies.get(cookieName)?.value
  if (!secret || !raw) return NextResponse.json({ ok: true, revoked: false })
  let token: Record<string, unknown> | null = null
  try {
    token = (await decode({ token: raw, secret, salt: cookieName })) as Record<string, unknown> | null
  } catch {
    token = null
  }
  const userId = typeof token?.id === "string" ? token.id : typeof token?.sub === "string" ? token.sub : null
  if (!token || !userId) return NextResponse.json({ ok: true, revoked: false })
  try {
    if (typeof token.sid === "string") {
      const exp = typeof token.exp === "number" ? new Date(token.exp * 1000) : new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
      await prisma.revokedSession.upsert({
        where: { sid: token.sid },
        create: { sid: token.sid, userId, expiresAt: exp },
        update: {},
      })
      // Housekeeping: rows past their expiry mean nothing.
      await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => null)
    } else {
      await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
    }
  } catch (e) {
    console.error("[app-logout] revoke failed", e)
  }
  return NextResponse.json({ ok: true, revoked: true })
}
