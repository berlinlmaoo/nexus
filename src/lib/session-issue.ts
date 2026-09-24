import { encode } from "next-auth/jwt"
import type { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSessionCookieName, shouldUseSecureAuthCookies } from "@/lib/session-cookie"

/** Same lifetime every sign-in route uses. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/**
 * The user's current User.sessionVersion, to embed in a token being minted (lib/session-version.ts).
 * undefined when it cannot be read: the token is then issued without the field, which keeps it valid
 * (only not revocable) — a sign-in must not fail over this.
 */
export async function currentSessionVersion(userId: string): Promise<number | undefined> {
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } })
    return row?.sessionVersion
  } catch {
    return undefined
  }
}

/**
 * Put a fresh session cookie on `response` for this user at this sessionVersion — the same token,
 * cookie name, salt and attributes `/api/auth/direct-login` (the web sign-in) sets, and the same
 * clearing of stale chunk cookies. Used by the password change so the person who changed it stays
 * signed in while every other session ends.
 */
export async function reissueSessionCookie(
  response: NextResponse,
  user: { id: string; name: string | null; email: string | null; avatar: string | null },
  sessionVersion: number,
): Promise<void> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("Missing AUTH_SECRET/NEXTAUTH_SECRET")

  const cookieName = getSessionCookieName()
  const secure = shouldUseSecureAuthCookies()
  const token = await encode({
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      picture: user.avatar,
      sessionVersion,
    },
  })

  for (let index = 0; index < 10; index++) {
    response.cookies.set(`${cookieName}.${index}`, "", {
      path: "/",
      expires: new Date(0),
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure,
    })
  }
  response.cookies.set(cookieName, token, {
    path: "/",
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    secure,
  })
}
