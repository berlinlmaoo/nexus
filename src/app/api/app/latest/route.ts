export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { fetchLatestIosVersion, APP_STORE_URL } from "@/lib/app-update"
import { PLAY_STORE_URL, androidLatestVersion } from "@/lib/android-app"

/**
 * GET /api/app/latest — the current store versions, so each app can show "update available" itself.
 * `android.version` is NEXUS_ANDROID_LATEST_VERSION (null until the owner sets it); `ios` is unchanged.
 */
export async function GET() {
  const version = await fetchLatestIosVersion()
  return NextResponse.json({ ios: { version, storeUrl: APP_STORE_URL }, android: { version: androidLatestVersion(), storeUrl: PLAY_STORE_URL } }, { headers: { "Cache-Control": "public, max-age=300" } })
}
