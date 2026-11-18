export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { isOrgMember } from "@/lib/org"
import { PRINT_NOT_CONFIGURED, printerConfig } from "@/lib/print/config"
import { printerStatus } from "@/lib/print/status"

/**
 * GET /api/print/status — the office printer right now, for the Print page and dialog (owner, 18 Nov 2026). Any member
 * of the company workspace. CUPS is asked at most every 3 s (lib/print/status.ts).
 *   200 { reachable, state: "idle"|"printing"|"stopped"|"error"|"unreachable", reasons: [{ keyword, severity }],
 *         message, acceptingJobs, waiting, jobs: [{ position, state, who: { id, name } | null, mine, title?, nexusJobId? }],
 *         checkedAt }
 *   who null = a job that did not come from NEXUS. Jobs sent straight to the printer over WiFi are not visible at all.
 *   401 · 403 NOT_A_MEMBER · 503 PRINT_NOT_CONFIGURED
 */
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!printerConfig()) return NextResponse.json({ error: PRINT_NOT_CONFIGURED, code: "PRINT_NOT_CONFIGURED" }, { status: 503 })
    if (!(await isOrgMember(session.user.id))) return NextResponse.json({ error: "Printing is for members of the company workspace", code: "NOT_A_MEMBER" }, { status: 403 })
    return NextResponse.json(await printerStatus(session.user.id), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Error reading the printer status:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
