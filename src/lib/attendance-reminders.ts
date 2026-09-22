import prisma from "@/lib/prisma"
import { getAttendanceDate, formatAttendanceDateKey, isWorkdayForAttendanceDate, resolveEffectiveAttendanceShift, resolveShiftWindowAt, safeAttendanceTimezone, isRestDayForMember, FLEXI_WORK_HOURS } from "@/lib/attendance"
import { isHoliday } from "@/lib/holidays"
import { isOutageDay, usualOfficeByUser } from "@/lib/attendance-absence"
import { notifyAttendanceReminder, sendWA } from "@/lib/notification-service"
import { publicBaseUrl } from "./public-url"

// WhatsApp reminders: nudge staff 15 minutes before their shift to check IN, and 15 minutes before
// shift end to check OUT. Driven by a per-minute cron (same cadence as accrue-late).
//
// Time handling is OVERNIGHT-AWARE: we work in ABSOLUTE datetimes (resolveShiftWindowAt rolls a shift
// end past midnight, e.g. 21:00→03:00), then fire when the current wall-clock minute (in the office tz)
// equals exactly `shiftBoundary − 15`. Because an overnight shift's check-out reminder lands on the NEXT
// calendar day, each member is evaluated against BOTH today's and yesterday's shift (yesterday only for
// the check-out, to catch a 02:45 ping for a shift that started the evening before).
//
// Idempotency is structural, not a stored flag: launchd StartInterval=60 spaces runs >60s apart, so a
// given minute-key is observed at most once → no double-send, no migration needed.
//
// dryRun (the GET preview) skips the minute gate and lists everyone in scope today with their resolved
// shift + the exact clock times they'd be pinged — so the roster can be verified before any real send.
// Pengingat MASUK tiga kali — 30 dan 15 menit sebelum, lalu tepat pada jam masuk — dan PULANG sekali,
// tepat pada jam pulang. Semuanya push ke HP lewat notifyAttendanceReminder; WhatsApp tetap dicoba
// kalau ada nomor, tapi bridge-nya sudah lama mati dan bukan lagi jalur yang diandalkan.
const CHECKIN_OFFSETS = [30, 15, 0] as const
const CHECKOUT_OFFSETS = [0] as const
const REMINDER_LEAD_MINUTES = 15 // hanya untuk label pratinjau lama
const ONE_DAY_MS = 86_400_000

export interface ReminderPreviewRow {
  userId: string
  name: string
  phone: string // masked, or — when only push is available
  shiftSource: string
  shiftStart: string
  shiftEnd: string
  checkinReminderAt: string
  checkoutReminderAt: string
  office: string
  officeTimezone: string | null
  resolvedTz: string
  onLeave: boolean
  checkedIn: boolean
  checkedOut: boolean
}

export interface AttendanceReminderResult {
  date: string
  dryRun: boolean
  checkinSent: number
  checkoutSent: number
  note?: string
  eligible?: number
  preview?: ReminderPreviewRow[]
}

/** Wall-clock parts of `date` in `tz`, using a fixed 00–23 hour cycle (avoids the "24:00" midnight quirk). */
function zoneParts(date: Date, tz: string): { ymd: string; hm: string; key: string } {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date)
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? ""
  const ymd = `${get("year")}-${get("month")}-${get("day")}`
  const hm = `${get("hour")}:${get("minute")}`
  return { ymd, hm, key: `${ymd} ${hm}` }
}

function attendanceUrl(): string {
  // Was `NEXUS_PUBLIC_URL || NEXTAUTH_URL` with no filter, so behind nginx it happily emitted a
  // 127.0.0.1 link into a WhatsApp reminder.
  const base = publicBaseUrl()
  return base && !/(localhost|127\.0\.0\.1)/.test(base) ? `${base}/attendance` : ""
}

function firstName(name?: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "kamu"
}

/** Keep only the leading + trailing digits so a roster preview never exposes full numbers. */
function maskPhone(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "")
  if (d.length <= 6) return "***"
  return `${d.slice(0, 4)}***${d.slice(-3)}`
}

async function coveredByLeave(userId: string, workspaceId: string, date: Date): Promise<boolean> {
  const covering = await prisma.attendanceRequest.findFirst({
    where: { userId, workspaceId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: date }, endDate: { gte: date } },
    select: { id: true },
  })
  return Boolean(covering)
}

function dayRecord(userId: string, workspaceId: string, attendanceDate: Date) {
  return prisma.attendanceRecord.findUnique({
    where: { userId_workspaceId_attendanceDate: { userId, workspaceId, attendanceDate } },
    select: { checkInAt: true, checkOutAt: true },
  })
}

/**
 * Send any check-in / check-out WhatsApp reminders due at `now` (or, with `dryRun`, just compute who is
 * in scope today and return the roster without sending). Recipients = every workspace member required to
 * absen (role not BOD / One-Above-All) who has a phone number on their profile. Skips non-workdays,
 * holidays, outage days, and anyone on approved/pending leave or day-off.
 */
export async function sendAttendanceReminders(now: Date = new Date(), opts?: { dryRun?: boolean }): Promise<AttendanceReminderResult> {
  const dryRun = opts?.dryRun === true
  // Two flavors of "today", kept distinct to dodge a UTC-midnight footgun:
  //  • REAL INSTANTS (now / yesterdayInstant) anchor the shift window, weekday & workday checks — anything
  //    that RE-DERIVES wall-clock parts in the office tz. Passing a UTC-midnight date there slips a day
  //    for negative-offset offices; passing the real instant is correct in every timezone.
  //  • ATTENDANCE-DATE keys (todayDate / yesterdayDate) are pure equality keys for record/leave/holiday
  //    lookups — same encoding the records are stored under (default attendance tz, like the other crons).
  const yesterdayInstant = new Date(now.getTime() - ONE_DAY_MS)
  const todayDate = getAttendanceDate(now)
  const yesterdayDate = new Date(todayDate.getTime() - ONE_DAY_MS)
  const dateKey = formatAttendanceDateKey(now)
  const result: AttendanceReminderResult = { date: dateKey, dryRun, checkinSent: 0, checkoutSent: 0, eligible: 0, preview: [] }

  if (await isOutageDay(dateKey)) {
    result.note = "Hari ini ditandai outage — tidak ada reminder."
    return result
  }

  const url = attendanceUrl()

  // One active office per workspace (used for workdays / timezone / default shift) — same convention as
  // the late-accrual & absence-deduction crons.
  const offices = await prisma.officeLocation.findMany({ where: { isActive: true } })
  const officeByWorkspace = new Map<string, (typeof offices)[number]>()
  for (const o of offices) if (!officeByWorkspace.has(o.workspaceId)) officeByWorkspace.set(o.workspaceId, o)

  for (const [workspaceId, office] of officeByWorkspace) {
    const tz = safeAttendanceTimezone(office.timezone)
    const nowKey = zoneParts(now, tz).key

    const todayOk = isWorkdayForAttendanceDate(now, office) && !(await isHoliday(workspaceId, todayDate))
    const yesterdayOk = isWorkdayForAttendanceDate(yesterdayInstant, office) && !(await isHoliday(workspaceId, yesterdayDate))
    if (dryRun && !todayOk) {
      result.note = !isWorkdayForAttendanceDate(now, office) ? "Hari ini bukan hari kerja — tidak ada reminder." : "Hari ini tanggal merah — tidak ada reminder."
      continue
    }
    if (!dryRun && !todayOk && !yesterdayOk) continue

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId, role: { notIn: ["BOD", "ONE_ABOVE_ALL"] } },
      select: { userId: true, restDays: true, user: { select: { id: true, name: true, phoneNumber: true } } },
    })
    const usualOffice = await usualOfficeByUser(workspaceId, offices.filter((o) => o.workspaceId === workspaceId))

    for (const member of members) {
      const phone = member.user?.phoneNumber
      // Their own office, not the workspace's first: HQ starts at 15:00, the other four at 09:00.
      const memberOffice = usualOffice.get(member.userId) ?? office
      // Nothing to remind on their fixed rest day.
      if (isRestDayForMember(now, member.restDays, tz)) continue

      // Resolve TODAY's shift window from the real instant (overnight-aware + tz-safe).
      const shiftToday = await resolveEffectiveAttendanceShift({ userId: member.userId, workspaceId, office: memberOffice, date: now })
      const winToday = resolveShiftWindowAt(now, memberOffice, shiftToday)
      const checkinAt = new Date(winToday.shiftStartAt.getTime() - REMINDER_LEAD_MINUTES * 60_000) // label pratinjau
      const checkoutTodayAt = winToday.shiftEndAt

      if (dryRun) {
        const [onLeave, record] = await Promise.all([
          coveredByLeave(member.userId, workspaceId, todayDate),
          dayRecord(member.userId, workspaceId, todayDate),
        ])
        const flexiPreviewRecord = shiftToday.flexi ? await dayRecord(member.userId, workspaceId, todayDate) : null
        const coParts = zoneParts(
          shiftToday.flexi && flexiPreviewRecord?.checkInAt
            ? new Date(flexiPreviewRecord.checkInAt.getTime() + FLEXI_WORK_HOURS * 60 * 60 * 1000)
            : checkoutTodayAt,
          tz,
        )
        const checkoutLabel = coParts.ymd === zoneParts(now, tz).ymd ? coParts.hm : `${coParts.hm} (+1)`
        result.eligible = (result.eligible ?? 0) + 1
        result.preview!.push({
          userId: member.userId,
          name: member.user?.name ?? "—",
          phone: phone ? maskPhone(phone) : "—",
          shiftSource: shiftToday.source,
          shiftStart: shiftToday.shiftStartTime,
          shiftEnd: shiftToday.flexi
            ? (flexiPreviewRecord?.checkInAt ? `${zoneParts(new Date(flexiPreviewRecord.checkInAt.getTime() + FLEXI_WORK_HOURS * 60 * 60 * 1000), tz).hm} (flexi)` : "flexi — belum check-in")
            : shiftToday.shiftEndTime,
          checkinReminderAt: CHECKIN_OFFSETS.map((o) => zoneParts(new Date(winToday.shiftStartAt.getTime() - o * 60_000), tz).hm).join(" · "),
          checkoutReminderAt: checkoutLabel,
          office: memberOffice.name ?? "—",
          officeTimezone: memberOffice.timezone ?? null,
          resolvedTz: tz,
          onLeave,
          checkedIn: Boolean(record?.checkInAt),
          checkedOut: Boolean(record?.checkOutAt),
        })
        continue
      }

      // ── Check-in reminders (shift start − 30, − 15, dan tepat 0) — hanya kalau belum check-in ──
      if (todayOk) {
        for (const off of CHECKIN_OFFSETS) {
          const at = new Date(winToday.shiftStartAt.getTime() - off * 60_000)
          if (zoneParts(at, tz).key !== nowKey) continue
          if (await coveredByLeave(member.userId, workspaceId, todayDate)) break
          const record = await dayRecord(member.userId, workspaceId, todayDate)
          if (record?.checkInAt) break
          const shouldSend = await notifyAttendanceReminder({
            userId: member.userId,
            kind: "checkin",
            attendanceDate: dateKey,
            shiftTime: shiftToday.shiftStartTime,
            offsetMinutes: off,
          })
          if (shouldSend) {
            if (phone) await sendWA(phone, off > 0
              ? `🔔 *Reminder Absen Masuk*\nHai ${firstName(member.user?.name)}, ${off} menit lagi jam masuk (${shiftToday.shiftStartTime}). Jangan lupa check-in di NEXUS ya 🙌${url ? `\n${url}` : ""}`
              : `⏰ *Waktunya Absen Masuk*\nHai ${firstName(member.user?.name)}, sudah jam ${shiftToday.shiftStartTime}. Check-in sekarang ya 🙌${url ? `\n${url}` : ""}`)
            result.checkinSent++
          }
        }
      }

      // ── Check-out reminder (shift end − 15) ── evaluate today's shift AND yesterday's (an overnight
      // shift that started yesterday ends — and so pings — today, after midnight).
      for (const anchor of [
        { ok: todayOk, instant: now, date: todayDate, win: winToday, shift: shiftToday },
        { ok: yesterdayOk, instant: yesterdayInstant, date: yesterdayDate, win: null as null | typeof winToday, shift: null as null | typeof shiftToday },
      ]) {
        if (!anchor.ok) continue
        let win = anchor.win
        let shift = anchor.shift
        if (!win || !shift) {
          shift = await resolveEffectiveAttendanceShift({ userId: member.userId, workspaceId, office: memberOffice, date: anchor.instant })
          win = resolveShiftWindowAt(anchor.instant, memberOffice, shift)
        }
        // Flexi has no fixed end: `shiftEndTime` is the end of the check-IN WINDOW (15:00), and
        // reading it as a going-home time told seven people to clock out at three in the afternoon.
        // Their day ends nine hours after they actually checked in, so the record has to be read
        // BEFORE the clock is compared — and someone who has not checked in has no end to remind
        // about at all.
        const flexiRecord = shift.flexi ? await dayRecord(member.userId, workspaceId, anchor.date) : null
        if (shift.flexi && !flexiRecord?.checkInAt) continue
        const endAt = shift.flexi && flexiRecord?.checkInAt
          ? new Date(flexiRecord.checkInAt.getTime() + FLEXI_WORK_HOURS * 60 * 60 * 1000)
          : win.shiftEndAt
        const endLabel = shift.flexi ? zoneParts(endAt, tz).hm : shift.shiftEndTime

        for (const off of CHECKOUT_OFFSETS) {
          const checkoutAt = new Date(endAt.getTime() - off * 60_000)
          if (zoneParts(checkoutAt, tz).key !== nowKey) continue
          if (await coveredByLeave(member.userId, workspaceId, anchor.date)) break
          const record = flexiRecord ?? await dayRecord(member.userId, workspaceId, anchor.date)
          if (!(record?.checkInAt && !record?.checkOutAt)) break
          const anchorDateKey = formatAttendanceDateKey(anchor.instant)
          const shouldSend = await notifyAttendanceReminder({
            userId: member.userId,
            kind: "checkout",
            attendanceDate: anchorDateKey,
            shiftTime: endLabel,
            offsetMinutes: off,
          })
          if (shouldSend) {
            if (phone) await sendWA(phone, off > 0
              ? `🔔 *Reminder Absen Pulang*\nHai ${firstName(member.user?.name)}, ${off} menit lagi jam pulang (${endLabel}). Jangan lupa check-out di NEXUS ya ✅${url ? `\n${url}` : ""}`
              : `⏰ *Waktunya Absen Pulang*\nHai ${firstName(member.user?.name)}, sudah jam ${endLabel}. Jangan lupa check-out ya ✅${url ? `\n${url}` : ""}`)
            result.checkoutSent++
          }
        }
      }
    }
  }

  return result
}
