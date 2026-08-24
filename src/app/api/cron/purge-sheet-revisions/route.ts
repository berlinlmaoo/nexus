export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { getUserOrgRole, isBodPlus } from "@/lib/feed"
import { ensureRevisionTrigger } from "@/lib/project-sheets"

/**
 * Retention for spreadsheet cell history: **90 days, except the newest entry per cell, which is
 * kept forever.**
 *
 * The two halves answer two different questions, and only keeping both answers them all:
 *   - "what happened to this sheet lately / who broke the number last week" → needs the full stream,
 *     and a quarter covers the audit window these sheets actually live on (budgets, rekap, rundown).
 *   - "who put this figure here in the first place" → needs the LAST edit of a cell no matter how
 *     old, and that's the question people actually ask about a cell nobody has touched in a year.
 * A plain date cutoff answers the first and silently loses the second, which is the worse failure.
 *
 * The churn — the intermediate edits between the first value and the current one — is what gets
 * pruned, and that's the part nobody reads.
 */
const RETENTION_DAYS = 90

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    const authHeader = req.headers.get("authorization") || ""
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

    let authorized = Boolean(cronSecret && bearer && bearer === cronSecret)
    if (!authorized) {
      // Manual run from a BoD account, so this is testable without the cron secret.
      const session = await auth()
      if (session?.user?.id && isBodPlus(await getUserOrgRole(session.user.id))) authorized = true
    }
    if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

    // The EXISTS is the "keep the newest per cell" half: a row only goes if a NEWER revision of the
    // same cell exists. Served by the (rowId, columnId, createdAt DESC) index.
    const deleted = await prisma.$executeRaw`
      DELETE FROM "SheetCellRevision" r
      WHERE r."createdAt" < ${cutoff}
        AND EXISTS (
          SELECT 1 FROM "SheetCellRevision" n
          WHERE n."rowId" = r."rowId"
            AND n."columnId" = r."columnId"
            AND n."createdAt" > r."createdAt"
        )
    `

    // The nightly log is the one place a missing trigger would reliably surface — history stopping
    // is otherwise completely silent. Rebuilds it if it's gone.
    await ensureRevisionTrigger(true)
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relname = 'SheetRow' AND t.tgname = 'sheet_row_revisions'
    `

    const remaining = await prisma.sheetCellRevision.count()
    return NextResponse.json({
      ok: true,
      retentionDays: RETENTION_DAYS,
      cutoff: cutoff.toISOString(),
      deleted,
      remaining,
      triggerInstalled: Number(n) > 0,
    })
  } catch (error) {
    console.error("Error purging sheet revisions:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
