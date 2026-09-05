import { NextResponse } from "next/server"
import { generateRegistrationOptions } from "@simplewebauthn/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { RP_ID, RP_NAME, saveChallenge } from "@/lib/passkey"

/** Step 1 of adding a passkey: hand the device a challenge to sign. Requires an existing session —
 *  a passkey is added by someone already signed in, never as a way to sign in for the first time. */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, passkeys: { select: { credentialId: true, transports: true } } },
  })
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: "none",
    // Stops the same device silently registering twice and leaving a dead credential behind.
    excludeCredentials: user.passkeys.map((p) => ({
      id: p.credentialId,
      transports: (p.transports?.split(",").filter(Boolean) ?? undefined) as never,
    })),
    authenticatorSelection: {
      // Discoverable, so signing in later needs no email typed first — the point of a passkey.
      residentKey: "preferred",
      userVerification: "preferred",
    },
  })

  await saveChallenge(options.challenge, "register", user.id)
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } })
}
