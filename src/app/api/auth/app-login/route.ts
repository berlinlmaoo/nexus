import { encode } from "next-auth/jwt"
import { NextRequest, NextResponse } from "next/server"
import { logAudit } from "@/lib/audit"
import { verifyCredentialUser } from "@/lib/credentials-auth"
import { createLogger } from "@/lib/logger"

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
function shouldUseSecureAuthCookies() {
  return (
    process.env.NODE_ENV === "production" ||
    (process.env.NEXTAUTH_URL?.startsWith("https://") ?? false) ||
    (process.env.AUTH_URL?.startsWith("https://") ?? false)
  )
}

function getSessionCookieName() {
  return `${shouldUseSecureAuthCookies() ? "__Secure-" : ""}authjs.session-token`
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const email = body?.email
  const password = body?.password

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
    },
  })

  await logAudit({
    action: "login",
    entityType: "user",
    entityId: result.user.id,
    entityName: result.user.name || undefined,
    userId: result.user.id,
    metadata: { provider: "credentials", nativeApp: "ios" },
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
