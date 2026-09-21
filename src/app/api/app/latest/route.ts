export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { fetchLatestIosVersion, APP_STORE_URL } from "@/lib/app-update"

/** GET /api/app/latest — the current App Store version, so the app can show "update available" itself. */
export async function GET() {
  const version = await fetchLatestIosVersion()
  return NextResponse.json({ ios: { version, storeUrl: APP_STORE_URL } }, { headers: { "Cache-Control": "public, max-age=300" } })
}
