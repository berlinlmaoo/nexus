export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"

const LATE_PREFIX = "attendance:late:"
const NOCHECKOUT_PREFIX = "attendance:nocheckout:"
const ALPHA_PREFIX = "attendance:alpha:"

// Self endpoint for the "your XP got cut" popup. Returns the logged-in user's OWN recent negative
// XP transactions (late / no-checkout / alpha / admin penalty) from the last 36h. Late penalties
// are enriched with the exact (uncapped) lateMinutes, and ones still ACCRUING (user hasn't checked
// in yet) are excluded — the check-in reminder modal already nags those, no need to double-popup.
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const since = new Date(Date.now() - 36 * 60 * 60 * 1000)
    const txns = await prisma.xpTransaction.findMany({
      where: { userId, amount: { lt: 0 }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, amount: true, reason: true, createdAt: true },
    })
    if (txns.length === 0) return NextResponse.json({ penalties: [] })

    // For late penalties: attach exact uncapped minutes from the checked-in record; skip ones with
    // no check-in yet (still accruing — reminder modal handles those).
    const lateMinutesByTxn = new Map<string, number>()
    const skip = new Set<string>()
    const lateTxns = txns.filter((t) => t.reason.startsWith(LATE_PREFIX))
    if (lateTxns.length > 0) {
      const dateKeys = [...new Set(lateTxns.map((t) => t.reason.slice(LATE_PREFIX.length)))]
      const records = await prisma.attendanceRecord.findMany({
        where: { userId, attendanceDate: { in: dateKeys.map((d) => new Date(`${d}T00:00:00.000Z`)) } },
        select: { attendanceDate: true, checkInAt: true, lateMinutes: true },
      })
      const recByDate = new Map(records.map((r) => [r.attendanceDate.toISOString().slice(0, 10), r]))
      for (const t of lateTxns) {
        const rec = recByDate.get(t.reason.slice(LATE_PREFIX.length))
        // Skip ONLY while still accruing (no check-in yet) — the reminder modal handles those.
        // Once checked in it's final: attach exact minutes if the record has them; otherwise the
        // frontend derives minutes from the (small) XP amount (e.g. accrual nicked XP within grace).
        if (!rec?.checkInAt) { skip.add(t.id); continue }
        if ((rec.lateMinutes ?? 0) > 0) lateMinutesByTxn.set(t.id, rec.lateMinutes as number)
      }
    }

    const kindOf = (reason: string): "late" | "nocheckout" | "alpha" | "admin" | "other" => {
      if (reason.startsWith(LATE_PREFIX)) return "late"
      if (reason.startsWith(NOCHECKOUT_PREFIX)) return "nocheckout"
      if (reason.startsWith(ALPHA_PREFIX)) return "alpha"
      if (reason === "penalty" || reason.startsWith("admin:")) return "admin"
      return "other"
    }

    const penalties = txns
      .filter((t) => !skip.has(t.id))
      .map((t) => ({
        id: t.id,
        amount: t.amount,
        reason: t.reason,
        kind: kindOf(t.reason),
        createdAt: t.createdAt.toISOString(),
        lateMinutes: lateMinutesByTxn.has(t.id) ? lateMinutesByTxn.get(t.id) : null,
      }))

    return NextResponse.json({ penalties })
  } catch (error) {
    console.error("my-penalties GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
