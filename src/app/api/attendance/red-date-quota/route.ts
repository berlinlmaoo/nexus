export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { formatAttendanceDateKey, getAttendanceWorkspaceContext } from "@/lib/attendance"

const MONTH_RE = /^\d{4}-\d{2}$/

async function ctx() {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const c = await getAttendanceWorkspaceContext(session.user.id)
  if (!c.workspace) return { error: NextResponse.json({ error: "No workspace membership found" }, { status: 404 }) }
  return { session, workspaceId: c.workspace.id, canManage: c.canManageAttendance }
}

// Monthly "tanggal merah" quota (jatah) — same for every staff, set by BoD per month.
//   GET  ?month=YYYY-MM   -> { month, quota, canManage }
//   POST { month, quota } -> set the month's quota (BoD only). quota = integer 0..31.
export async function GET(req: NextRequest) {
  try {
    const g = await ctx()
    if (g.error) return g.error
    const month = (req.nextUrl.searchParams.get("month") ?? "").trim() || formatAttendanceDateKey().slice(0, 7)
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Bulan harus format YYYY-MM." }, { status: 400 })
    const row = await prisma.redDateQuota.findUnique({
      where: { workspaceId_month: { workspaceId: g.workspaceId, month } },
      select: { quota: true },
    })
    return NextResponse.json({ month, quota: row?.quota ?? 0, canManage: g.canManage })
  } catch (error) {
    console.error("Error reading red-date quota:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await ctx()
    if (g.error) return g.error
    if (!g.canManage) return NextResponse.json({ error: "Hanya BoD ke atas yang bisa atur jatah tanggal merah." }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const month = String(body?.month ?? "").trim() || formatAttendanceDateKey().slice(0, 7)
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Bulan harus format YYYY-MM." }, { status: 400 })
    const n = Number(body?.quota)
    if (!Number.isInteger(n) || n < 0 || n > 31) {
      return NextResponse.json({ error: "Jatah harus angka bulat 0–31." }, { status: 400 })
    }

    const saved = await prisma.redDateQuota.upsert({
      where: { workspaceId_month: { workspaceId: g.workspaceId, month } },
      create: { workspaceId: g.workspaceId, month, quota: n, updatedById: g.session.user.id },
      update: { quota: n, updatedById: g.session.user.id },
      select: { month: true, quota: true },
    })

    try {
      await logAudit({ action: "update", entityType: "red_date_quota", entityId: `${g.workspaceId}:${month}`, entityName: `tanggal-merah:${month}`, userId: g.session.user.id, request: req, metadata: { month, quota: n } })
    } catch { /* best-effort */ }

    return NextResponse.json({ month: saved.month, quota: saved.quota, canManage: true })
  } catch (error) {
    console.error("Error setting red-date quota:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
