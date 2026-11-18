export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { getAppConfig } from "@/lib/app-config"
import { getTierStatus } from "@/lib/gideon-tier-status"
import { printingStatus } from "@/lib/print/config"

/**
 * GET /api/app/config?platform=ios|android|web — public, no auth, exempt from the 426 gate (a
 * locked app can still read its texts). Remote flags, numbers and sentences; see lib/app-config.ts.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("platform")
  const platform = p === "ios" || p === "android" || p === "web" ? p : null
  const cfg = await getAppConfig(platform)
  // gideonTiers (18 Oct 2026): which GIDEON tiers can answer right now — live, not part of the stored config. The
  // socket `gideon-tiers` moves it while an app is open; this is for an app that opens later.
  const gideonTiers = await getTierStatus().catch(() => null)
  // printing (18 Nov 2026): is there an office printer on this server (PRINT_IPP_URL) and what is it called. Live from
  // the server's env, not part of the stored config; off = the apps hide Print. Older apps ignore the key.
  const printing = printingStatus()
  return NextResponse.json({ ...cfg, gideonTiers, printing }, { headers: { "Cache-Control": "public, max-age=15" } })
}
