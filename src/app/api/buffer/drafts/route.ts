export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getAdminSessionContext } from "@/lib/admin-access"
import { listDraftsCached, peekDraftsCache, bufferConfigured, BufferError } from "@/lib/buffer-client"

async function gate() {
  const { context } = await getAdminSessionContext()
  if (!context?.user) return { ok: false as const, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const isOAA = context.workspaceMemberships.some((m) => m.role === "ONE_ABOVE_ALL")
  if (!isOAA) return { ok: false as const, res: NextResponse.json({ error: "Khusus One Above All." }, { status: 403 }) }
  return { ok: true as const }
}

// Buffer's API is aggressively rate-limited (100/15min, 250/24h). The board polls and can be open in
// several tabs, so reads go through a shared 90s cache (in buffer-client; busted on approve/reject).
const CACHE_TTL = 90_000

function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /rate.?limit|too many requests|\b429\b/i.test(msg)
}

export async function GET() {
  const g = await gate()
  if (!g.ok) return g.res
  if (!bufferConfigured()) return NextResponse.json({ configured: false, drafts: [], channels: [] })

  try {
    const { drafts, cached } = await listDraftsCached(CACHE_TTL)
    return NextResponse.json({ configured: true, drafts, channels: [], cached })
  } catch (e) {
    console.error("[buffer] drafts failed", e)
    const rateLimited = isRateLimit(e)
    const msg = rateLimited
      ? "Buffer lagi kena rate limit — nampilin data terakhir, coba lagi nanti."
      : e instanceof BufferError
        ? e.message
        : "Gagal ambil draft dari Buffer."
    // Never blank the board on a transient upstream error: serve the last good cache if we have one.
    // Always return 200 so the frontend shows the message instead of throwing into a misleading "0 draft".
    const stale = peekDraftsCache()
    return NextResponse.json({
      configured: true,
      drafts: stale ?? [],
      channels: [],
      error: msg,
      stale: Boolean(stale),
      rateLimited,
    })
  }
}
