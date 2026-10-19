export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { resolveLegacyIds, resolveLegacyIdsInText } from "@/lib/legacy-ids"

/**
 * Old id -> new id, for clients that hold ids from before the UUIDv7 conversion (UUID-MIGRATION.md).
 *   GET /api/legacy-ids?path=/projects/<old>/tasks/<old>?x=1  -> { path: "/projects/<new>/tasks/<new>?x=1" }
 *   GET /api/legacy-ids?ids=<old>,<old>                         -> { ids: { "<old>": "<new>" } }
 * Signed-in only. Unknown ids are left as they are (answered, not refused).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const path = req.nextUrl.searchParams.get("path")
  if (path !== null) {
    if (path.length > 2000 || !path.startsWith("/")) return NextResponse.json({ error: "Bad path" }, { status: 400 })
    return NextResponse.json({ path: await resolveLegacyIdsInText(path) }, { headers: { "Cache-Control": "no-store" } })
  }

  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200)
  const map = await resolveLegacyIds(ids)
  return NextResponse.json({ ids: Object.fromEntries(map) }, { headers: { "Cache-Control": "no-store" } })
}
