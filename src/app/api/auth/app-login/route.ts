import { encode } from "next-auth/jwt"
import { checkRateLimitByKey, trustedClientIp } from '@/lib/rate-limit'
import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { verifyCredentialUser } from "@/lib/credentials-auth"
import { createLogger } from "@/lib/logger"
import { nativeAppPlatformOf } from "@/lib/client-version"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

const log = createLogger("app-login")
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/**
 * Native-app login (iOS Swift client). Same credential check + session JWT that the web
 * `direct-login` issues, but returned as JSON instead of a Set-Cookie. The app stores `token` in
 * the Keychain and sends it back as `Cookie: <cookieName>=<token>` on every request — so all 197
 * existing API routes' `auth()` calls validate it as a normal session with ZERO route changes.
 *
 * (The `__Secure-` cookie-name prefix is a browser-only restriction; a native client may set that
 * cookie header directly. The token is AUTH_SECRET-signed, so it can't be forged.)
 */
import { getSessionCookieName } from "@/lib/session-cookie"
import { currentSessionVersion, newSessionId } from "@/lib/session-issue"

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = body?.email
  const password = body?.password

  // 60 attempts per IP per 15 minutes (an office behind one NAT stays far below it).
  if (!checkRateLimitByKey('login-ip', trustedClientIp(request), { limit: 60, windowSeconds: 900 }).allowed) {
    return NextResponse.json(
      { ok: false, error: 'TooManyAttempts', message: 'Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '900' } },
    )
  }
  const result = await verifyCredentialUser(email, password)
  if (!result) {
    return NextResponse.json({ ok: false, error: "CredentialsSignin" }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) {
    log.error("app login failed: missing auth secret")
    return NextResponse.json({ ok: false, error: "Configuration" }, { status: 500 })
  }

  const cookieName = getSessionCookieName()
  const token = await encode({
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: result.user.id,
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      picture: result.user.image,
      sessionVersion: await currentSessionVersion(result.user.id),
      sid: newSessionId(),
    },
  })

  await logAudit({
    action: "login",
    entityType: "user",
    entityId: result.user.id,
    entityName: result.user.name || undefined,
    userId: result.user.id,
    // Which app, from X-Nexus-Client. "ios" when the header is absent or unreadable: every caller of this
    // route before Android existed was the iOS app, and 0.1.5 and older send no header at all.
    metadata: { provider: "credentials", nativeApp: nativeAppPlatformOf(request.headers.get("x-nexus-client")) ?? "ios" },
  }).catch((error) => log.error("app login audit failed", { userId: result.user.id, error: String(error) }))

  return NextResponse.json(
    {
      ok: true,
      token,
      cookieName,
      expiresInSeconds: SESSION_MAX_AGE_SECONDS,
      user: { id: result.user.id, name: result.user.name, email: result.user.email, avatar: result.user.image },
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
