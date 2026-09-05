import { NextResponse } from "next/server"
import { generateAuthenticationOptions } from "@simplewebauthn/server"
import { RP_ID, saveChallenge } from "@/lib/passkey"

/** Step 1 of signing in. No email is asked for and no credential list is sent: the passkey is
 *  discoverable, so the device offers whichever ones it holds for this domain. Naming the
 *  credentials here would also tell an unauthenticated caller which accounts exist. */
export async function POST() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  })
  await saveChallenge(options.challenge, "login")
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } })
}
