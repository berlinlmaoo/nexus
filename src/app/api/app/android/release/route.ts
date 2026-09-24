export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readAndroidRelease } from "@/lib/android-release"
import { getAndroidVersionPolicy } from "@/lib/version-policy"

/**
 * GET /api/app/android/release — what the /download/android page shows (session required, like the
 * APK itself). Exempt from the 426 gate for the same reason as /api/app/android/apk.
 *
 *   { available: false, minSupported, latest }                       nothing published yet
 *   { available: true, versionName, versionCode, sizeBytes, sha256, releasedAt, notes,
 *     fileName: "NEXUS-<versionName>.apk", downloadUrl: "/api/app/android/apk", minSupported, latest }
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [release, policy] = await Promise.all([readAndroidRelease(), Promise.resolve(getAndroidVersionPolicy())])
  const common = { minSupported: policy.minSupported, latest: policy.latest }
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
