export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { serveFile } from "@/lib/file-response"
import { APK_CONTENT_TYPE, readAndroidRelease } from "@/lib/android-release"

/**
 * GET /api/app/android/apk — the current sideloaded Android build (lib/android-release.ts), for
 * signed-in people only (owner decision 24 Sep 2026: no anonymous download).
 *
 *   401  no session.
 *   404  no release published yet (or current.json names nothing servable), `code: NO_ANDROID_RELEASE`.
 *   200  the whole APK: Content-Type application/vnd.android.package-archive,
 *        Content-Disposition attachment; filename="NEXUS-<versionName>.apk", Content-Length.
 *   206  a byte range (Range: bytes=…), so a phone on bad signal resumes instead of starting over.
 *        ETag + Last-Modified are strong validators, and an If-Range that no longer matches (a new
 *        build was published mid-download) gets the whole new file, never a splice of two builds.
 *   416  a range past the end.
 *
 * Exempt from the 426 minimum-version gate (lib/version-policy.ts EXEMPT): a locked build must be
 * able to fetch its own replacement. Served through the same Range code as every other file
 * (lib/file-response.ts), never cached by a shared cache (private, no-store — the URL stays the same
 * across releases).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const release = await readAndroidRelease()
  if (typeof release === "string") {
    return NextResponse.json(
      { error: "No Android build is available to download yet.", code: "NO_ANDROID_RELEASE" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    )
  }
  return serveFile(req, release.path, {
    filename: release.downloadName,
    forceDownload: true,
    contentType: APK_CONTENT_TYPE,
    cacheControl: "private, no-store",
    etag: release.etag,
    lastModified: release.lastModified,
  })
}
