export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { assetLinksStatements } from "@/lib/android-app"

/**
 * The body of https://nexus.znetworks.id/.well-known/assetlinks.json (Digital Asset Links).
 *
 * nginx (maintenance/phaethon.conf) proxies exactly that path here, the same way it proxies the OAuth
 * discovery documents; every other /.well-known/ path stays a 404, and the Apple association file is
 * still the static one from the SPA's dist. Served from the app rather than as a file because the
 * statement is built from NEXUS_ANDROID_CERT_SHA256, the same env the passkey origins read
 * (lib/passkey.ts), so the two can never disagree, and a new signing key is an env change instead of
 * a hand copy into a directory the SPA deploy deliberately never touches.
 *
 * Google fetches it without redirects and wants application/json. Until the env holds a fingerprint
 * the answer is [] — a valid, empty list: the domain vouches for nothing, App Links stay unverified
 * and links keep opening in the browser, which is today's behaviour.
 */
export async function GET() {
  return NextResponse.json(assetLinksStatements(), {
    headers: { "Cache-Control": "public, max-age=300" },
  })
}
