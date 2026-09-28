export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { getAppConfig } from "@/lib/app-config"

/**
 * GET /api/app/config?platform=ios|android|web — public, no auth, exempt from the 426 gate (a
 * locked app can still read its texts). Remote flags, numbers and sentences; see lib/app-config.ts.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("platform")
  const platform = p === "ios" || p === "android" || p === "web" ? p : null
  const cfg = await getAppConfig(platform)
  return NextResponse.json(cfg, { headers: { "Cache-Control": "public, max-age=60" } })
}
