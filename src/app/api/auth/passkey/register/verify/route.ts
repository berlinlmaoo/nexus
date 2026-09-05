import { NextRequest, NextResponse } from "next/server"
import { verifyRegistrationResponse } from "@simplewebauthn/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { EXPECTED_ORIGINS, RP_ID, takeChallenge } from "@/lib/passkey"

/** Step 2: check what the device signed and keep the public key. */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const attestation = body?.credential ?? body
  const challenge = typeof body?.challenge === "string" ? body.challenge : null
  if (!attestation || !challenge) return NextResponse.json({ error: "Malformed request" }, { status: 400 })

  const stored = await takeChallenge(challenge, "register")
  if (!stored || stored.userId !== session.user.id) {
    return NextResponse.json({ error: "Challenge expired or not yours" }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: challenge,
      expectedOrigin: EXPECTED_ORIGINS,
      expectedRPID: RP_ID,
    })
  } catch {
    return NextResponse.json({ error: "Could not verify that passkey" }, { status: 400 })
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Could not verify that passkey" }, { status: 400 })
  }

  const cred = verification.registrationInfo.credential
  await prisma.passkey.create({
    data: {
      userId: session.user.id,
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey),
      counter: BigInt(cred.counter),
      transports: cred.transports?.join(",") ?? null,
      label: typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null,
    },
  })

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
