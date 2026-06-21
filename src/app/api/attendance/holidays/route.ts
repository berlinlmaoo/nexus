export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { logAudit } from "@/lib/audit"
import { attendanceMonthRange, formatAttendanceDateKey } from "@/lib/attendance"
import { getAttendanceWorkspaceContext } from "@/lib/attendance"
import { holidayDateFromKey } from "@/lib/holidays"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_RE = /^\d{4}-\d{2}$/

async function ctx() {
  const session = await auth()
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  const c = await getAttendanceWorkspaceContext(session.user.id)
  if (!c.workspace) return { error: NextResponse.json({ error: "No workspace membership found" }, { status: 404 }) }
  return { session, workspaceId: c.workspace.id, canManage: c.canManageAttendance }
}

function serialize(h: { id: string; date: Date; name: string }) {
  return { id: h.id, date: formatAttendanceDateKey(h.date), name: h.name }
}

// Company-wide public holidays (tanggal merah).
//   GET    ?month=YYYY-MM         -> list holidays in the month (any member)
//   POST   { date, name }         -> add a holiday (BoD only)
//   DELETE ?id= | ?date=YYYY-MM-DD -> remove a holiday (BoD only)
export async function GET(req: NextRequest) {
  try {
    const g = await ctx()
    if (g.error) return g.error
    const month = (req.nextUrl.searchParams.get("month") ?? "").trim() || formatAttendanceDateKey().slice(0, 7)
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Bulan harus format YYYY-MM." }, { status: 400 })
    const { start, end } = attendanceMonthRange(month)
    const holidays = await prisma.holiday.findMany({
      where: { workspaceId: g.workspaceId, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
      select: { id: true, date: true, name: true },
    })
    return NextResponse.json({ month, canManage: g.canManage, holidays: holidays.map(serialize) })
  } catch (error) {
    console.error("Error listing holidays:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await ctx()
    if (g.error) return g.error
    if (!g.canManage) return NextResponse.json({ error: "Hanya BoD ke atas yang bisa atur tanggal merah." }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const date = String(body?.date ?? "").trim()
    const name = String(body?.name ?? "").trim()
    if (!DATE_RE.test(date)) return NextResponse.json({ error: "Tanggal harus format YYYY-MM-DD." }, { status: 400 })

    const day = holidayDateFromKey(date)
    // Reject impossible dates: Invalid Date (e.g. 2026-13-45) or silent rollover (2026-02-30 → Mar 2).
    if (Number.isNaN(day.getTime()) || formatAttendanceDateKey(day) !== date) {
      return NextResponse.json({ error: "Tanggal tidak valid." }, { status: 400 })
    }
    const existing = await prisma.holiday.findUnique({ where: { workspaceId_date: { workspaceId: g.workspaceId, date: day } }, select: { id: true } })
    if (existing) return NextResponse.json({ error: "Tanggal itu sudah jadi tanggal merah." }, { status: 409 })

    const created = await prisma.holiday.create({
      data: { workspaceId: g.workspaceId, date: day, name: name || "Tanggal merah", createdById: g.session.user.id },
      select: { id: true, date: true, name: true },
    })

    try {
      await logAudit({ action: "create", entityType: "holiday", entityId: created.id, entityName: `${formatAttendanceDateKey(created.date)} ${created.name}`, userId: g.session.user.id, request: req, metadata: { date, name: created.name } })
    } catch { /* best-effort */ }

    return NextResponse.json({ holiday: serialize(created) }, { status: 201 })
  } catch (error) {
    console.error("Error adding holiday:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const g = await ctx()
    if (g.error) return g.error
    if (!g.canManage) return NextResponse.json({ error: "Hanya BoD ke atas yang bisa atur tanggal merah." }, { status: 403 })

    const id = (req.nextUrl.searchParams.get("id") ?? "").trim()
    const date = (req.nextUrl.searchParams.get("date") ?? "").trim()

    let target: { id: string } | null = null
    if (id) {
      target = await prisma.holiday.findUnique({ where: { id }, select: { id: true, workspaceId: true } }).then((h) => (h && h.workspaceId === g.workspaceId ? { id: h.id } : null))
    } else if (DATE_RE.test(date)) {
      const day = holidayDateFromKey(date)
      if (Number.isNaN(day.getTime()) || formatAttendanceDateKey(day) !== date) {
        return NextResponse.json({ error: "Tanggal tidak valid." }, { status: 400 })
      }
      target = await prisma.holiday.findUnique({ where: { workspaceId_date: { workspaceId: g.workspaceId, date: day } }, select: { id: true } })
    } else {
      return NextResponse.json({ error: "id atau date wajib diisi." }, { status: 400 })
    }
    if (!target) return NextResponse.json({ error: "Tanggal merah tidak ditemukan." }, { status: 404 })

    await prisma.holiday.delete({ where: { id: target.id } })
    try {
      await logAudit({ action: "delete", entityType: "holiday", entityId: target.id, userId: g.session.user.id, request: req })
    } catch { /* best-effort */ }

    return NextResponse.json({ message: "Tanggal merah dihapus." })
  } catch (error) {
    console.error("Error deleting holiday:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
