export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isCronRequest } from "@/lib/cron-auth"
import { createInAppNotification } from "@/lib/notification-service"
import { resolveAttendanceApprovers } from "@/lib/attendance-approvers"

/**
 * Eskalasi Bagan Approval — fase 2.
 *
 * Sejak bagan, BoD TIDAK lagi diberi tahu request staff yang sudah punya manager. Itu benar pada
 * hari biasa dan salah pada hari manager-nya cuti: request-nya diam di antrean yang tidak dilihat
 * siapa pun, dan yang menemukannya adalah staff yang bertanya kenapa cutinya belum disetujui.
 *
 * Jadi: request (dan checkout luar kantor) yang masih PENDING lewat N HARI KERJA sejak diajukan,
 * dan routing-nya DIRECT_MANAGER, dieskalasi — BoD diberi tahu, manager-nya diingatkan sekali
 * lagi, dan `escalatedAt` diisi supaya ini terjadi SEKALI, bukan tiap 30 menit.
 *
 * Yang routing-nya sudah ke kelompok BoD (staff belum ditaruh, request manager) tidak disentuh:
 * BoD sudah tahu sejak awal.
 *
 * "Hari kerja" = Senin–Jumat. Libur nasional tidak dihitung — batasnya 2 hari, dan salah satu
 * hari kadang libur hanya berarti eskalasi datang sehari lebih cepat, bukan salah orang.
 */
const DEFAULT_BUSINESS_DAYS = 2
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

/** Tanggal `days` hari kerja yang lalu, dihitung dalam WIB, sebagai batas atas createdAt. */
function businessDaysAgo(days: number, now = new Date()): Date {
  let d = new Date(now.getTime() + WIB_OFFSET_MS) // "jam dinding" WIB dalam bingkai UTC
  let left = days
  while (left > 0) {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000)
    const dow = d.getUTCDay() // 0 Minggu … 6 Sabtu, dalam bingkai WIB karena sudah digeser
    if (dow !== 0 && dow !== 6) left--
  }
  return new Date(d.getTime() - WIB_OFFSET_MS)
}

const TYPE_LABEL: Record<string, string> = { LEAVE: "Cuti", SICK: "Sakit", PERMIT: "Izin", DAY_OFF: "Day Off", RED_DATE: "Public Holiday" }

export async function POST(req: NextRequest) {
  try {
    // CRON_SECRET only (Authorization: Bearer, as cron/nexus-cron.sh sends it). No session fallback.
    if (!isCronRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Tipe dinamai, bukan `typeof body`: sesudah `= null` TS menyempitkan body ke null, dan
    // `as typeof body` lalu berarti `as null` — bangunannya gagal dengan "never".
    type Body = { dryRun?: boolean; businessDays?: number }
    let body: Body | null = null
    try { body = (await req.json()) as Body } catch { /* tanpa body */ }
    const dryRun = body?.dryRun === true
    const days = Number(body?.businessDays ?? process.env.ATTENDANCE_ESCALATION_BUSINESS_DAYS ?? DEFAULT_BUSINESS_DAYS)
    const cutoff = businessDaysAgo(Number.isFinite(days) && days > 0 ? days : DEFAULT_BUSINESS_DAYS)

    const [requests, checkouts] = await Promise.all([
      prisma.attendanceRequest.findMany({
        where: { status: "PENDING", escalatedAt: null, createdAt: { lte: cutoff } },
        select: { id: true, type: true, createdAt: true, userId: true, workspaceId: true, user: { select: { name: true } } },
      }),
      prisma.attendanceRecord.findMany({
        where: { checkOutOffsite: true, checkOutApproval: "PENDING", escalatedAt: null, checkOutAt: { lte: cutoff } },
        select: { id: true, checkOutAt: true, userId: true, workspaceId: true, user: { select: { name: true } } },
      }),
    ])

    const escalated: Array<{ kind: "request" | "checkout"; id: string; who: string | null; managerId: string; bod: number }> = []
    const skipped: Array<{ kind: string; id: string; reason: string }> = []

    const fmt = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })

    async function escalate(kind: "request" | "checkout", id: string, who: string | null, userId: string, workspaceId: string, since: Date, label: string) {
      const r = await resolveAttendanceApprovers(userId, workspaceId)
      // Routing ke kelompok BoD = BoD sudah tahu sejak awal. Tidak ada yang perlu dieskalasi.
      if (r.mode !== "DIRECT_MANAGER" || r.userIds.length !== 1) { skipped.push({ kind, id, reason: "routing BoD_GROUP" }); return }
      const managerId = r.userIds[0]
      const bod = await prisma.workspaceMember.findMany({
        where: { workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] }, userId: { notIn: [userId, managerId] } },
        select: { userId: true },
      })
      const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { name: true } })
      escalated.push({ kind, id, who, managerId, bod: bod.length })
      if (dryRun) return

      const name = who ?? "Seseorang"
      const mgr = manager?.name ?? "manager-nya"
      await Promise.all([
        ...bod.map((b) => createInAppNotification({
          userId: b.userId,
          type: "attendance_request_escalated",
          title: `${label} ${name} belum ditanggapi`,
          message: `Diajukan ${fmt(since)}, masih menunggu ${mgr} lewat ${days} hari kerja. Kamu bisa menyetujuinya langsung di Attendance.`,
          link: kind === "request" ? `/attendance?request=${id}` : `/attendance?offsite=${id}`,
          push: true,
        }).catch(() => null)),
        createInAppNotification({
          userId: managerId,
          type: "attendance_request_escalated",
          title: `${label} ${name} masih menunggu kamu`,
          message: `Diajukan ${fmt(since)}. BoD sudah diberi tahu karena lewat ${days} hari kerja — tapi keputusannya tetap punyamu.`,
          link: kind === "request" ? `/attendance?request=${id}` : `/attendance?offsite=${id}`,
          push: true,
        }).catch(() => null),
      ])
      if (kind === "request") await prisma.attendanceRequest.update({ where: { id }, data: { escalatedAt: new Date() } })
      else await prisma.attendanceRecord.update({ where: { id }, data: { escalatedAt: new Date() } })
    }

    for (const r of requests) await escalate("request", r.id, r.user?.name ?? null, r.userId, r.workspaceId, r.createdAt, TYPE_LABEL[r.type] ?? r.type)
    for (const c of checkouts) if (c.checkOutAt) await escalate("checkout", c.id, c.user?.name ?? null, c.userId, c.workspaceId, c.checkOutAt, "Checkout luar kantor")

    if (escalated.length > 0) console.log("[attendance-escalation]", JSON.stringify({ dryRun, days, cutoff, escalated: escalated.length, skipped: skipped.length }))
    return NextResponse.json({ ok: true, dryRun, businessDays: days, cutoff, candidates: requests.length + checkouts.length, escalated, skipped })
  } catch (error) {
    console.error("[attendance-escalation]", error)
    return NextResponse.json({ error: "Escalation failed" }, { status: 500 })
  }
}
