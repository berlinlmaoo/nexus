export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { decode } from "next-auth/jwt"
import prisma from "@/lib/prisma"
import { getSessionCookieName } from "@/lib/session-cookie"
import { revokeSessionKeys, sessionKeyOf } from "@/lib/user-sessions"

/**
 * POST /api/auth/app-logout — ends THIS session on the server (security audit, 29 Sep 2026). Called by
 * the apps (and the web) when the person signs out, so a copy of the token (a backup, a proxy, a
 * stolen phone's disk) stops working now rather than when it expires.
 *
 *   token with `sid`     → that session alone is revoked (RevokedSession, until it would expire) and
 *                          leaves Settings → Security → Active sessions (lib/user-sessions.ts);
 *   token without `sid`  → issued before sids existed: revoked alone too, under its legacy key
 *                          (`legacy:<userId>:<iat>`). Only a token without even an iat falls back to
 *                          the user's sessionVersion, which ends every session of theirs.
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
    const key = sessionKeyOf(token)
    if (key) {
      await revokeSessionKeys(userId, [key])
    } else {
      await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
    }
  } catch (e) {
    console.error("[app-logout] revoke failed", e)
  }
  return NextResponse.json({ ok: true, revoked: true })
}
