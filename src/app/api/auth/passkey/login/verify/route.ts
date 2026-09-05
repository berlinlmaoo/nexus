import { NextRequest, NextResponse } from "next/server"
import { encode } from "next-auth/jwt"
import { verifyAuthenticationResponse } from "@simplewebauthn/server"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { EXPECTED_ORIGINS, RP_ID, takeChallenge } from "@/lib/passkey"

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

function shouldUseSecureAuthCookies() {
  return (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").startsWith("https://")
}
function getSessionCookieName() {
  return `${shouldUseSecureAuthCookies() ? "__Secure-" : ""}authjs.session-token`
}

/**
 * Step 2: verify the signature and issue exactly the session `app-login` issues, so every existing
 * route authenticates it with no changes. Returned as JSON for the native app and set as a cookie
 * for the browser, which is the only difference between the two.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const assertion = body?.credential ?? body
  const challenge = typeof body?.challenge === "string" ? body.challenge : null
  if (!assertion?.id || !challenge) return NextResponse.json({ ok: false, error: "Malformed request" }, { status: 400 })

  const stored = await takeChallenge(challenge, "login")
  if (!stored) return NextResponse.json({ ok: false, error: "Challenge expired" }, { status: 400 })

  const passkey = await prisma.passkey.findUnique({
    where: { credentialId: assertion.id },
    include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
  })
  // Same answer whether the credential is unknown or the signature is wrong: distinguishing them
  // would let someone probe which passkeys exist.
  const reject = () => NextResponse.json({ ok: false, error: "CredentialsSignin" }, { status: 401 })
  if (!passkey) return reject()

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: (passkey.transports?.split(",").filter(Boolean) ?? undefined) as never,
      },
    })
  } catch {
    return reject()
  }
  if (!verification.verified) return reject()

  // A counter that goes backwards means the credential was cloned. Authenticators that always
  // report 0 are legitimate and common, so only a real regression is refused.
  const nextCounter = verification.authenticationInfo.newCounter
  if (nextCounter !== 0 && nextCounter < Number(passkey.counter)) return reject()

  await prisma.passkey.update({
    where: { id: passkey.id },
    data: { counter: BigInt(nextCounter), lastUsedAt: new Date() },
  })

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "Configuration" }, { status: 500 })

  const cookieName = getSessionCookieName()
  const token = await encode({
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: passkey.user.id,
      id: passkey.user.id,
      name: passkey.user.name,
      email: passkey.user.email,
      picture: passkey.user.avatar,
    },
  })

  await logAudit({
    action: "login",
    entityType: "user",
    entityId: passkey.user.id,
    entityName: passkey.user.name || undefined,
    userId: passkey.user.id,
    metadata: { provider: "passkey" },
  }).catch(() => null)

  const res = NextResponse.json(
    {
      ok: true,
      token,
      cookieName,
      expiresInSeconds: SESSION_MAX_AGE_SECONDS,
      user: { id: passkey.user.id, name: passkey.user.name, email: passkey.user.email, avatar: passkey.user.avatar },
    },
    { headers: { "Cache-Control": "no-store" } },
  )
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureAuthCookies(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
  return res
}
