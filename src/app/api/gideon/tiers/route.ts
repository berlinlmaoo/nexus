export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getTierStatus, tierUnavailableText } from "@/lib/gideon-tier-status"

/**
 * GET /api/gideon/tiers → { tiers: { astra|luna|terra|experimental: { available, reason, since } }, texts }
 * Which GIDEON tiers can answer right now (18 Oct 2026). Model 0 is away while the office GPU transcribes a meeting
 * and while it loads again. The socket `gideon-tiers` { tiers } carries every change to every open client.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const tiers = await getTierStatus()
  const exp = tiers.experimental
  return NextResponse.json(
    { tiers, texts: exp.available ? null : { experimental: tierUnavailableText(exp.reason) } },
    { headers: { "Cache-Control": "no-store" } },
  )
}
