export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readAndroidRelease } from "@/lib/android-release"
import { getAndroidVersionPolicy } from "@/lib/version-policy"

/**
 * GET /api/app/android/release — what the /download/android page shows. Exempt from the 426 gate for the
 * same reason as /api/app/android/apk.
 *
 * Sign-in required for every client (owner, 29 Oct 2026): signed out is 401, whoever asks. The web page
 * sends a 401 to /login, which comes back to it; the Android app's in-app updater reads it as "signed
 * out" (ApkUpdater.kt). From 25 to 29 Oct a signed-out browser got the facts without `downloadUrl`;
 * `signedIn` stays in the answer (always true now) for clients that still read it.
 *
 *   { available: false, signedIn, minSupported, latest }                       nothing published yet
 *   { available: true, signedIn, versionName, versionCode, sizeBytes, sha256, releasedAt, notes,
 *     fileName: "NEXUS-<versionName>.apk", downloadUrl: "/api/app/android/apk", minSupported, latest }
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [release, policy] = await Promise.all([readAndroidRelease(), Promise.resolve(getAndroidVersionPolicy())])
  const common = { signedIn: true, minSupported: policy.minSupported, latest: policy.latest }
  const headers = { "Cache-Control": "private, no-store" }
  if (typeof release === "string") return NextResponse.json({ available: false, ...common }, { headers })
  return NextResponse.json(
    {
      available: true,
      versionName: release.versionName,
      versionCode: release.versionCode,
      sizeBytes: release.sizeBytes,
      sha256: release.sha256,
      releasedAt: release.releasedAt,
      notes: release.notes,
      fileName: release.downloadName,
      downloadUrl: "/api/app/android/apk",
      ...common,
    },
    { headers },
  )
}
