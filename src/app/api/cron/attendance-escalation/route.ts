export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { isCronRequest } from "@/lib/cron-auth"
import { createInAppNotification } from "@/lib/notification-service"
import { bi, dayText } from "@/lib/notification-text"
import { resolveAttendanceApprovers } from "@/lib/attendance-approvers"
import { loadChart, topBodOf } from "@/lib/attendance-chart"

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
/** The English word for each TYPE_LABEL value (and the checkout label), for bilingual notifications. */
const TYPE_LABEL_EN: Record<string, string> = { Cuti: "Leave", Sakit: "Sick leave", Izin: "Permission", "Day Off": "Day off", "Public Holiday": "Public holiday", "Checkout luar kantor": "Off-site check-out" }

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

    // Not for people who were offboarded (lib/offboarding.ts): their pending rows stay for the record,
    // but nobody is chased about them.
    const [requests, checkouts] = await Promise.all([
      prisma.attendanceRequest.findMany({
        where: { status: "PENDING", escalatedAt: null, createdAt: { lte: cutoff }, user: { deactivatedAt: null } },
        select: { id: true, type: true, createdAt: true, userId: true, workspaceId: true, user: { select: { name: true } } },
      }),
      prisma.attendanceRecord.findMany({
        where: { checkOutOffsite: true, checkOutApproval: "PENDING", escalatedAt: null, checkOutAt: { lte: cutoff }, user: { deactivatedAt: null } },
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
      // Only the BoD at the top of the requester's tree (owner, 30 Sep 2026), not every BoD. With no
      // BoD above them, One Above All.
      const chart = await loadChart(workspaceId)
      const top = topBodOf(userId, chart)
      const bod = (top ? [top] : chart.filter((m) => m.role === "ONE_ABOVE_ALL").map((m) => m.userId))
        .filter((id) => id !== userId && id !== managerId)
        .map((id) => ({ userId: id }))
      const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { name: true } })
      escalated.push({ kind, id, who, managerId, bod: bod.length })
      if (dryRun) return

      const name = who ?? "Seseorang"
      const mgr = manager?.name ?? "manager-nya"
      const nameEn = who ?? "someone"
      const mgrEn = manager?.name ?? "their manager"
      const labelEn = TYPE_LABEL_EN[label] ?? label
      await Promise.all([
        ...bod.map((b) => createInAppNotification({
          userId: b.userId,
          type: "attendance_request_escalated",
          ...bi(
            [`${labelEn} from ${nameEn} not answered yet`, `Filed ${dayText(since, "en")}, still waiting for ${mgrEn} after ${days} working day${days === 1 ? "" : "s"}. You can approve it yourself in Attendance.`],
            [`${label} ${name} belum ditanggapi`, `Diajukan ${fmt(since)}, masih menunggu ${mgr} lewat ${days} hari kerja. Kamu bisa menyetujuinya langsung di Attendance.`]
),
          link: kind === "request" ? `/attendance?request=${id}` : `/attendance?offsite=${id}`,
          push: true,
        }).catch(() => null)),
        createInAppNotification({
          userId: managerId,
          type: "attendance_request_escalated",
          ...bi(
            [`${labelEn} from ${nameEn} is still waiting for you`, `Filed ${dayText(since, "en")}. The BoD was told because it's past ${days} working day${days === 1 ? "" : "s"} — but the decision is still yours.`],
            [`${label} ${name} masih menunggu kamu`, `Diajukan ${fmt(since)}. BoD sudah diberi tahu karena lewat ${days} hari kerja — tapi keputusannya tetap punyamu.`]
),
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
