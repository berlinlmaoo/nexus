export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readAndroidRelease } from "@/lib/android-release"
import { getAndroidVersionPolicy } from "@/lib/version-policy"

/**
 * GET /api/app/android/release — what the /download/android page shows. Exempt from the 426 gate for the
 * same reason as /api/app/android/apk.
 *
 * Signed out it still answers (owner, 25 Oct 2026: the page shows the real release and its button reads
 * "Sign in to download"), but without `downloadUrl`: the APK itself stays session-only. The Android app
 * (X-Nexus-Client: android/...) still gets 401 signed out, as before.
 *
 *   { available: false, signedIn, minSupported, latest }                       nothing published yet
 *   { available: true, signedIn, versionName, versionCode, sizeBytes, sha256, releasedAt, notes,
 *     fileName: "NEXUS-<versionName>.apk", downloadUrl: "/api/app/android/apk" | null, minSupported, latest }
 */
export async function GET(req: Request) {
  const session = await auth()
  const signedIn = Boolean(session?.user?.id)
  // The Android app's in-app updater reads a 401 here as "signed out" (ApkUpdater.kt); keep that for it.
  if (!signedIn && req.headers.get("x-nexus-client")?.toLowerCase().startsWith("android/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [release, policy] = await Promise.all([readAndroidRelease(), Promise.resolve(getAndroidVersionPolicy())])
  const common = { signedIn, minSupported: policy.minSupported, latest: policy.latest }
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
      downloadUrl: signedIn ? "/api/app/android/apk" : null,
      ...common,
    },
    { headers },
  )
}
