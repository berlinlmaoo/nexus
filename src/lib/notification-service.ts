import prisma from "@/lib/prisma"
import { resolveAttendanceApprovers } from "@/lib/attendance-approvers"
import { dayOffBalances, dayOffPeriodOf, dayOffUsageKey } from "@/lib/day-off-usage"
import { sendPushToUser, sendPushToUsers, type PushPayload } from "@/lib/apns"
import { ORG_WORKSPACE_ID } from "@/lib/org"
import { pushImageUrl } from "@/lib/feed-push-image"
import { emitNotification } from "@/lib/socket-emitter"
import { postWaBridge } from "@/lib/wa-bridge"
import {
  sendEmail,
  taskAssignedEmail,
  taskDueSoonEmail,
  commentMentionEmail,
  projectInviteEmail,
  statusUpdateEmail,
} from "@/lib/email"
import { createLogger } from "@/lib/logger"
import { normalizeIndonesianPhoneNumber } from "@/lib/phone-number"
import { publicBaseUrl, publicUrl } from "./public-url"

const log = createLogger("notifications")

// ── Helpers ─────────────────────────────────────────────────────

const DEFAULT_PREFS = {
  emailEnabled: true,
  waEnabled: false,
  slackEnabled: false,
  desktopEnabled: false,
  desktopSoundEnabled: true,
  waPhone: null as string | null,
  slackWebhook: null as string | null,
  taskAssigned: true,
  taskDueSoon: true,
  commentMention: true,
  projectInvite: true,
  statusUpdate: true,
}

type NotifPrefs = typeof DEFAULT_PREFS

async function isUserDnd(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dndUntil: true },
  })
  if (!user?.dndUntil) return false
  return new Date(user.dndUntil) > new Date()
}

async function getUserPrefs(userId: string): Promise<NotifPrefs> {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId },
  })
  return {
    emailEnabled: pref?.emailEnabled ?? DEFAULT_PREFS.emailEnabled,
    waEnabled: pref?.waEnabled ?? DEFAULT_PREFS.waEnabled,
    slackEnabled: pref?.slackEnabled ?? DEFAULT_PREFS.slackEnabled,
    desktopEnabled: pref?.desktopEnabled ?? DEFAULT_PREFS.desktopEnabled,
    desktopSoundEnabled: pref?.desktopSoundEnabled ?? DEFAULT_PREFS.desktopSoundEnabled,
    waPhone: pref?.waPhone ?? DEFAULT_PREFS.waPhone,
    slackWebhook: pref?.slackWebhook ?? DEFAULT_PREFS.slackWebhook,
    taskAssigned: pref?.taskAssigned ?? DEFAULT_PREFS.taskAssigned,
    taskDueSoon: pref?.taskDueSoon ?? DEFAULT_PREFS.taskDueSoon,
    commentMention: pref?.commentMention ?? DEFAULT_PREFS.commentMention,
    projectInvite: pref?.projectInvite ?? DEFAULT_PREFS.projectInvite,
    statusUpdate: pref?.statusUpdate ?? DEFAULT_PREFS.statusUpdate,
  }
}

/** Batch-fetch DND status for multiple users in a single query */
async function getBatchDndStatus(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const now = new Date()
  const dndUsers = await prisma.user.findMany({
    where: { id: { in: userIds }, dndUntil: { gt: now } },
    select: { id: true },
  })
  return new Set(dndUsers.map((u) => u.id))
}

/** Batch-fetch notification prefs for multiple users in a single query */
async function getBatchPrefs(userIds: string[]): Promise<Map<string, NotifPrefs>> {
  if (userIds.length === 0) return new Map()
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds } },
  })
  const map = new Map<string, NotifPrefs>()
  for (const userId of userIds) {
    const pref = prefs.find((p) => p.userId === userId)
    map.set(userId, {
      emailEnabled: pref?.emailEnabled ?? DEFAULT_PREFS.emailEnabled,
      waEnabled: pref?.waEnabled ?? DEFAULT_PREFS.waEnabled,
      slackEnabled: pref?.slackEnabled ?? DEFAULT_PREFS.slackEnabled,
      desktopEnabled: pref?.desktopEnabled ?? DEFAULT_PREFS.desktopEnabled,
      desktopSoundEnabled: pref?.desktopSoundEnabled ?? DEFAULT_PREFS.desktopSoundEnabled,
      waPhone: pref?.waPhone ?? DEFAULT_PREFS.waPhone,
      slackWebhook: pref?.slackWebhook ?? DEFAULT_PREFS.slackWebhook,
      taskAssigned: pref?.taskAssigned ?? DEFAULT_PREFS.taskAssigned,
      taskDueSoon: pref?.taskDueSoon ?? DEFAULT_PREFS.taskDueSoon,
      commentMention: pref?.commentMention ?? DEFAULT_PREFS.commentMention,
      projectInvite: pref?.projectInvite ?? DEFAULT_PREFS.projectInvite,
      statusUpdate: pref?.statusUpdate ?? DEFAULT_PREFS.statusUpdate,
    })
  }
  return map
}

function whatsappChatIdFromPhone(phone: string): string | null {
  const normalized = normalizeIndonesianPhoneNumber(phone)
  if (!normalized) return null
  const digits = normalized.replace(/\D/g, "")
  if (!digits) return null
  return `${digits}@s.whatsapp.net`
}

function shouldUseHermesBridge(webhookUrl: string): boolean {
  try {
    const url = new URL(webhookUrl)
    return url.pathname.replace(/\/+$/, "").endsWith("/send")
  } catch {
    return false
  }
}

function envFlagEnabled(name: string, defaultValue = true): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  return !["0", "false", "no", "off"].includes(raw.toLowerCase())
}

// Public deep link to a task's detail (same route the email "View Task" button uses) so WA notifications
// are one-tap → straight into the task. NEXUS_PUBLIC_URL is required on backends that sit behind an nginx
// proxy with a localhost NEXTAUTH_URL (e.g. the beta backend serving nexus.patsgroup.id); we fall back to
// NEXTAUTH_URL only when it's already a public https URL.
function taskUrl(taskId: string): string {
  return publicUrl(`tasks/${taskId}`)
}

export async function sendWA(phone: string, message: string) {
  // Kill switch. Tanpa ini WA tidak bisa dimatikan lewat env: rantai webhookUrl di bawah
  // berakhir di URL hardcoded, jadi mengosongkan WA_WEBHOOK_URL tetap menyisakan percobaan
  // koneksi yang gagal (ECONNREFUSED) plus timeout 10 detik per penerima.
  if (process.env.WA_DELIVERY_DISABLED === "1") return

  const webhookUrl =
    process.env.WA_WEBHOOK_URL ||
    process.env.HERMES_WA_BRIDGE_URL ||
    "http://host.docker.internal:3001/send"

  const chatId = whatsappChatIdFromPhone(phone)
  if (!chatId) {
    log.warn("WA phone invalid, skipping notification", { phone })
    return
  }

  const useHermesBridge = shouldUseHermesBridge(webhookUrl)
  const body = useHermesBridge ? { chatId, message } : { phone, message }

  try {
    // The Hermes bridge rejects non-loopback Host headers; postWaBridge (raw node:http) overrides it.
    // A non-bridge webhook is a normal external URL → plain fetch.
    if (useHermesBridge) {
      const r = await postWaBridge(webhookUrl, body)
      if (r.status < 200 || r.status >= 300) {
        log.error("WA delivery failed", { phone, status: r.status, response: r.body.slice(0, 300) })
        return
      }
      log.info("WA message sent", { phone, via: "hermes_bridge" })
      return
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const response = await res.text().catch(() => "")
      log.error("WA delivery failed", { phone, status: res.status, response: response.slice(0, 300) })
      return
    }

    log.info("WA message sent", { phone, via: "webhook" })
  } catch (error) {
    log.error("WA delivery failed", { error: String(error) })
  }
}

async function sendSlack(webhookUrl: string, message: string) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    })
    log.info("Slack message sent")
  } catch (error) {
    log.error("Slack delivery failed", { error: String(error) })
  }
}

/**
 * Write one notification row, then fan it out to the socket and (optionally) APNs.
 *
 * `dedupeWindowMs` is opt-in, and opt-in on purpose. The suppression has to live HERE rather than at
 * a call site because the push and the socket emit happen inside this function: a guard bolted on
 * outside would stop the row and still buzz the phone. But it must not be the default, because the
 * same helper carries chat (`/api/conversations/[id]/messages`), where two identical short replies a
 * minute apart ("ok", "noted") are two real events. Notification identity is not event identity for
 * every type, so the type's author declares the window it wants.
 *
 * The key is (userId, type, link, message) — an exact repeat of something we already told this
 * person, about the same thing, within the window. `notifyAttendanceReminder` hand-rolls the same
 * shape with no window (one reminder per shift, forever); this is that idea made reusable.
 *
 * Returns null when the notification was suppressed.
 */
/**
 * Offboarded people (User.deactivatedAt, lib/offboarding.ts) get no notifications: they can't sign in
 * to read them, and a push to a phone that left the company is a leak. One primary-key lookup per
 * recipient, remembered for a minute so a fan-out to the whole office stays cheap. The offboard and
 * reinstate routes call forgetRecipientState so the change counts at once in this process.
 */
const RECIPIENT_STATE_MS = 60_000
const recipientDeactivated = new Map<string, { deactivated: boolean; at: number }>()

export function forgetRecipientState(userId: string) {
  recipientDeactivated.delete(userId)
}

async function isDeactivatedRecipient(userId: string): Promise<boolean> {
  const hit = recipientDeactivated.get(userId)
  if (hit && Date.now() - hit.at < RECIPIENT_STATE_MS) return hit.deactivated
  try {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { deactivatedAt: true } })
    const deactivated = Boolean(row?.deactivatedAt)
    if (recipientDeactivated.size > 5000) recipientDeactivated.clear()
    recipientDeactivated.set(userId, { deactivated, at: Date.now() })
    return deactivated
  } catch {
    // Unreadable: deliver as before this check existed rather than drop a notification.
    return false
  }
}

export async function createInAppNotification(data: {
  userId: string
  type: string
  title: string
  message: string
  taskId?: string
  projectId?: string
  link?: string
  push?: boolean
  dedupeWindowMs?: number
  /** APNs aps.category (notification actions on iOS). Push only; the in-app row does not carry it. */
  pushCategory?: string
  /** Extra custom keys in the APNs payload. Push only. */
  pushData?: Record<string, string | number | boolean | null>
  /** aps.thread-id, so related pushes stack. Push only. */
  pushThreadId?: string
  /** Absolute picture URL for the expanded notification (apns.ts PushPayload.image). Push only. */
  pushImage?: string | null
}) {
  if (await isDeactivatedRecipient(data.userId)) {
    log.info("notification skipped: recipient offboarded", { userId: data.userId, type: data.type })
    return null
  }

  if (data.dedupeWindowMs && data.dedupeWindowMs > 0) {
    const since = new Date(Date.now() - data.dedupeWindowMs)
    const duplicate = await prisma.notification.findFirst({
      where: {
        userId: data.userId,
        type: data.type,
        link: data.link || null,
        message: data.message,
        createdAt: { gte: since },
      },
      select: { id: true },
    })
    if (duplicate) {
      log.info("notification suppressed as duplicate", { userId: data.userId, type: data.type })
      return null
    }
  }

  const notification = await prisma.notification.create({
    data: {
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      taskId: data.taskId || null,
      projectId: data.projectId || null,
      link: data.link || null,
    },
  })

  // Real-time: push to user's socket room
  emitNotification(data.userId, JSON.parse(JSON.stringify(notification)))

  if (data.push) {
    await sendPushToUser(data.userId, {
      title: data.title,
      body: data.message,
      type: data.type,
      taskId: data.taskId,
      projectId: data.projectId,
      link: data.link,
      category: data.pushCategory,
      data: data.pushData,
      threadId: data.pushThreadId,
      image: data.pushImage,
      notificationId: notification.id,
    }).catch((error) => log.error("APNs delivery failed", { error: String(error) }))
  }

  return notification
}

/**
 * Pengingat absen ke HP (in-app + push). `offsetMinutes` = berapa menit SEBELUM batas shift:
 * 30, 15, atau 0 (tepat waktu). Tiap offset punya notifikasi sendiri per hari — dedupe-nya lewat
 * `link`, yang memuat tanggal dan offset, jadi cron per-menit yang menabrak menit yang sama dua
 * kali tidak mengirim dua kali.
 */
export async function notifyAttendanceReminder(data: {
  userId: string
  kind: "checkin" | "checkout"
  attendanceDate: string
  shiftTime: string
  offsetMinutes?: number
}): Promise<boolean> {
  if (await isUserDnd(data.userId)) return false
  const off = data.offsetMinutes ?? 15
  const type = data.kind === "checkin" ? "attendance_checkin_reminder" : "attendance_checkout_reminder"
  const link = `/attendance?reminder=${data.kind}&date=${data.attendanceDate}&t=${off}`
  const existing = await prisma.notification.findFirst({
    where: { userId: data.userId, type, link },
    select: { id: true },
  })
  if (existing) return false
  const soon = off > 0 ? `${off} menit lagi` : "sekarang"
  await createInAppNotification({
    userId: data.userId,
    type,
    title: data.kind === "checkin"
      ? (off > 0 ? `Absen masuk ${soon}` : "Waktunya absen masuk")
      : (off > 0 ? `Absen pulang ${soon}` : "Waktunya absen pulang"),
    message: data.kind === "checkin"
      ? (off > 0 ? `Jam masuk ${data.shiftTime}. Jangan lupa check-in di NEXUS.` : `Sudah jam ${data.shiftTime} — check-in sekarang supaya tidak tercatat telat.`)
      : (off > 0 ? `Jam pulang ${data.shiftTime}. Jangan lupa check-out.` : `Sudah jam ${data.shiftTime} — jangan lupa check-out sebelum pulang.`),
    link,
    push: true,
  })
  return true
}

/**
 * "Tercatat tanpa keterangan": the absence cron cut a day off because nobody checked in that day.
 *
 * The cut itself happens at 02:00 WIB (nexus-absence.timer), and nobody should be woken by it; this
 * is sent from /api/cron/absence-notify in the morning instead. Until it existed the person found out
 * — if at all — from a quota counter that had quietly gone down.
 *
 * Once per (person, date), forever: the key is the `link`, which carries the date, exactly as
 * `notifyAttendanceReminder` keys its reminders. The check and the write sit under an advisory lock
 * on that same pair, so two runs that overlap (a manual re-run while the timer fires) cannot both get
 * past the check. Do-not-disturb keeps the in-app row and drops only the buzz — this is a record of
 * something that happened, not a nudge whose moment passes.
 *
 * `dryRun` answers what WOULD be sent and never writes, locks or pushes.
 */
export async function notifyAttendanceAbsentRecorded(data: {
  userId: string
  /** The attendance date that was cut, "YYYY-MM-DD" (Asia/Jakarta). */
  dateKey: string
  quota: number
  used: number
  dryRun?: boolean
}): Promise<{ sent: boolean; skipped?: "already_sent" | "dry_run"; title: string; message: string; link: string; push: boolean }> {
  const type = "attendance_absent_recorded"
  // Opens Attendance on both clients (iOS NotificationTarget(path:) → .screen(.attendance); web
  // /attendance). The date rides along as the dedupe key and for a client that later wants to focus it.
  const link = `/attendance?absent=${data.dateKey}`
  const title = "Tercatat tanpa keterangan"
  const day = new Date(`${data.dateKey}T00:00:00.000Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "UTC" })
  // Never "lewat N hari": the allowance reads 4/4 at most, everywhere (see lib/day-off-usage).
  const remaining = Math.max(0, data.quota - data.used)
  const balance = remaining > 0
    ? `Jatah periode ini: sisa ${remaining} dari ${data.quota}.`
    : `Jatah periode ini sudah habis (${data.quota}/${data.quota}).`
  const message = `Kamu gak absen tanggal ${day} — dipotong 1 day off. ${balance}`
  const push = !(await isUserDnd(data.userId))

  if (data.dryRun) {
    const existing = await prisma.notification.findFirst({ where: { userId: data.userId, type, link }, select: { id: true } })
    return { sent: false, skipped: existing ? "already_sent" : "dry_run", title, message, link, push }
  }

  const sent = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`absentnotify|${data.userId}|${data.dateKey}`})::int8)`
      const existing = await tx.notification.findFirst({ where: { userId: data.userId, type, link }, select: { id: true } })
      if (existing) return false
      // Written through the shared helper (own connection, committed on return) while this
      // transaction still holds the lock — so a second run waiting on the lock finds the row.
      await createInAppNotification({ userId: data.userId, type, title, message, link, push })
      return true
    },
    // The push is awaited inside; APNs can take a few seconds per device.
    { maxWait: 10_000, timeout: 30_000 },
  )
  return sent
    ? { sent: true, title, message, link, push }
    : { sent: false, skipped: "already_sent", title, message, link, push }
}

// ── Public methods ──────────────────────────────────────────────

/** Ping every BoD / Super Admin in the workspace that a staff member checked out OFFSITE (pending approval). */
const ATTENDANCE_TYPE_LABEL: Record<string, string> = {
  LEAVE: "Cuti",
  SICK: "Sakit",
  PERMIT: "Izin",
  DAY_OFF: "Day Off",
  RED_DATE: "Public Holiday",
}

/**
 * Someone filed a leave/permit/sick/day-off request. Until now the only alert was a WhatsApp
 * message via wa-bot, so with the bridge down approvers were told nothing at all and requests
 * sat in the queue unseen.
 *
 * Who gets told mirrors who may actually approve — and both come from the SAME resolver
 * (src/lib/attendance-approvers.ts): a staff member's manager from the approval chart, or the
 * BoD group when there is none. BoD are deliberately NOT told about requests that already have a
 * manager; they can still open Attendance and override.
 */
export async function notifyAttendanceRequestPending(requestId: string) {
  const req = await prisma.attendanceRequest.findUnique({
    where: { id: requestId },
    select: {
      type: true,
      status: true,
      reason: true,
      startDate: true,
      endDate: true,
      workspaceId: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
  })
  if (!req || req.status !== "PENDING") return

  // Bagan Approval menentukan siapa yang diberi tahu — satu sumber, dipakai juga oleh izin review.
  const { userIds: targets } = await resolveAttendanceApprovers(req.userId, req.workspaceId)
  if (!targets.length) return

  const typeLabel = ATTENDANCE_TYPE_LABEL[req.type] ?? req.type
  const who = req.user?.name || req.user?.email || "Seseorang"
  const fmt = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })
  const start = fmt(req.startDate)
  const end = fmt(req.endDate)
  const when = start === end ? start : `${start} – ${end}`
  const reasonSuffix = req.reason ? ` — “${req.reason}”` : ""
  // Izin: the reviewer is told what the requester has left of day off in that period, the same number
  // the queue shows as `requesterDayOff`. A hint only — if it cannot be read, the notification still goes.
  let dayOffNote = ""
  if (req.type === "PERMIT") {
    try {
      const periodKey = dayOffPeriodOf(req.startDate)
      const b = (await dayOffBalances(req.workspaceId, [{ userId: req.userId, periodKey }])).get(dayOffUsageKey(req.userId, periodKey))
      if (b) {
        dayOffNote = b.remaining > 0
          ? ` Day off-nya periode ini: sisa ${b.remaining} dari ${b.quota}.`
          : ` Day off-nya periode ini sudah habis (${b.quota}/${b.quota}).`
      }
    } catch (error) {
      log.error("day-off balance for izin notification failed", { error: String(error) })
    }
  }

  await Promise.all(
    targets.map((userId) =>
      // The name leads the title and the request's id rides in the link: on a lock screen the first
      // line is all anybody reads, and a tap has to land ON this request with Approve/Reject in
      // front of the reviewer — both clients resolve `?request=` (web RequestsSection, iOS
      // AttendanceRequestsCard) — not on the top of a list they then scroll.
      createInAppNotification({
        userId,
        type: "attendance_request_pending",
        title: `${who} mengajukan ${typeLabel.toLowerCase()}`,
        message: `${when}${reasonSuffix}.${dayOffNote} Approve atau tolak di Attendance.`,
        link: `/attendance?request=${requestId}`,
        push: true,
      }).catch(() => null),
    ),
  )
}

export async function notifyOffsiteCheckoutPending(data: {
  workspaceId: string
  staffUserId: string
  staffName: string
  reason?: string | null
  /** The attendance record the check-out belongs to — what `?offsite=` opens on both clients. */
  recordId?: string | null
}) {
  // Jalur yang sama dengan request cuti/izin. Dulu blok ini hanya menyebut BoD, jadi manager
  // TIDAK PERNAH diberi tahu checkout luar kantor anak buahnya — padahal dialah yang menyetujuinya.
  const { userIds: approvers } = await resolveAttendanceApprovers(data.staffUserId, data.workspaceId)
  const reasonSuffix = data.reason ? ` — “${data.reason}”` : ""
  await Promise.all(
    approvers.map((userId) =>
      createInAppNotification({
        userId,
        type: "offsite_checkout_pending",
        title: `${data.staffName} check-out di luar kantor`,
        message: `Perlu approval${reasonSuffix}. Approve atau tolak di Attendance.`,
        link: data.recordId ? `/attendance?offsite=${data.recordId}` : "/attendance",
        push: true,
      }).catch(() => null),
    ),
  )
}

export async function notifyTaskAssigned(data: {
  assigneeId: string
  taskId: string
  taskTitle: string
  projectName: string
  projectId: string
  assignedByName: string
}) {
  // Skip if user has DND active
  if (await isUserDnd(data.assigneeId)) return

  const user = await prisma.user.findUnique({
    where: { id: data.assigneeId },
    select: { name: true, email: true, phoneNumber: true },
  })
  if (!user) return

  const prefs = await getUserPrefs(data.assigneeId)

  // In-app notification
  await createInAppNotification({
    userId: data.assigneeId,
    type: "task_assigned",
    // The lock screen shows the title and little else; "Task Assigned" said nothing 1,193 times.
    title: `${data.assignedByName} assigned you: ${data.taskTitle}`,
    message: data.projectName ? `In ${data.projectName}` : `${data.assignedByName} assigned you "${data.taskTitle}"`,
    taskId: data.taskId,
    projectId: data.projectId,
    link: `/projects/${data.projectId}/tasks/${data.taskId}`,
    push: prefs.taskAssigned,
  })

  if (!prefs.taskAssigned) return

  // Email
  if (prefs.emailEnabled) {
    const email = taskAssignedEmail({
      recipientName: user.name,
      taskTitle: data.taskTitle,
      taskId: data.taskId,
      projectName: data.projectName,
      assignedBy: data.assignedByName,
    })
    email.to = user.email
    await sendEmail(email)
  }

  // WA
  // Phase 1 default: NEXUS assignment notifications should reach assignees on WA
  // when a usable phone number exists. Users can still override the number via
  // NotificationPreference.waPhone; ops can kill-switch this default with
  // NEXUS_WA_TASK_ASSIGNMENTS_DEFAULT_ENABLED=false.
  const assignmentWaDefaultEnabled = envFlagEnabled("NEXUS_WA_TASK_ASSIGNMENTS_DEFAULT_ENABLED", true)
  const waRecipient = prefs.waPhone || user.phoneNumber
  if (prefs.taskAssigned && waRecipient && (prefs.waEnabled || assignmentWaDefaultEnabled)) {
    const link = taskUrl(data.taskId)
    await sendWA(
      waRecipient,
      `[NEXUS] ${data.assignedByName} assigned you "${data.taskTitle}" in ${data.projectName}${link ? `\n${link}` : ""}`
    )
  }

  // Slack
  if (prefs.slackEnabled && prefs.slackWebhook) {
    await sendSlack(
      prefs.slackWebhook,
      `*Task Assigned*: ${data.assignedByName} assigned "${data.taskTitle}" to ${user.name}`
    )
  }
}

export async function notifyMention(data: {
  mentionedUserId: string
  mentionedByName: string
  taskId: string
  taskTitle: string
  commentSnippet: string
  projectId?: string
}) {
  // Skip if user has DND active
  if (await isUserDnd(data.mentionedUserId)) return

  const user = await prisma.user.findUnique({
    where: { id: data.mentionedUserId },
    select: { name: true, email: true, phoneNumber: true },
  })
  if (!user) return

  const prefs = await getUserPrefs(data.mentionedUserId)

  await createInAppNotification({
    userId: data.mentionedUserId,
    type: "comment_mention",
    title: `${data.mentionedByName} mentioned you on: ${data.taskTitle}`,
    message: data.commentSnippet ? data.commentSnippet.slice(0, 140) : `${data.mentionedByName} mentioned you on "${data.taskTitle}"`,
    taskId: data.taskId,
    projectId: data.projectId,
    link: data.projectId ? `/projects/${data.projectId}/tasks/${data.taskId}` : undefined,
    push: prefs.commentMention,
  })

  if (!prefs.commentMention) return

  if (prefs.emailEnabled) {
    const email = commentMentionEmail({
      recipientName: user.name,
      mentionedBy: data.mentionedByName,
      taskTitle: data.taskTitle,
      taskId: data.taskId,
      commentSnippet: data.commentSnippet,
    })
    email.to = user.email
    await sendEmail(email)
  }

  // WA — mirror task-assignment behavior so mentions actually reach people: fall back to the profile
  // phone number, and default-on (ops can kill-switch with NEXUS_WA_MENTIONS_DEFAULT_ENABLED=false).
  // The mention pref itself is already gated above (`if (!prefs.commentMention) return`).
  const mentionWaDefaultEnabled = envFlagEnabled("NEXUS_WA_MENTIONS_DEFAULT_ENABLED", true)
  const waRecipient = prefs.waPhone || user.phoneNumber
  if (waRecipient && (prefs.waEnabled || mentionWaDefaultEnabled)) {
    const link = taskUrl(data.taskId)
    await sendWA(
      waRecipient,
      `[NEXUS] ${data.mentionedByName} mentioned you on "${data.taskTitle}": ${data.commentSnippet.slice(0, 100)}${link ? `\n${link}` : ""}`
    )
  }

  if (prefs.slackEnabled && prefs.slackWebhook) {
    await sendSlack(
      prefs.slackWebhook,
      `*Mentioned*: ${data.mentionedByName} mentioned ${user.name} on "${data.taskTitle}"`
    )
  }
}

// ── Threads (Feed) ──────────────────────────────────────────
// Feed mentions/comments reuse the `commentMention` preference (no new flag → no migration).
// No taskId is set (a postId isn't a Task); the link points at /threads?post=<id>.

/** aps.thread-id for new posts and mentions: they stack as one "Threads" group on the lock screen. */
const FEED_THREAD_ID = "feed"
const FEED_BODY_MAX = 180
/** What a push says about a post: its text, or "📷 Foto" for a photo with no words. */
export function feedPushBody(text: string, hasPhoto: boolean, max = FEED_BODY_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return hasPhoto ? "📷 Foto" : ""
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
}

export async function notifyFeedMention(data: {
  mentionedUserId: string
  mentionedByName: string
  postId: string
  snippet: string
  /** The post's first PostImage id: its photo rides on the push like a new-post push's does. */
  imageId?: string | null
}) {
  if (await isUserDnd(data.mentionedUserId)) return
  const user = await prisma.user.findUnique({ where: { id: data.mentionedUserId }, select: { name: true, phoneNumber: true } })
  if (!user) return
  const prefs = await getUserPrefs(data.mentionedUserId)
  const base = publicBaseUrl()
  const link = `/threads?post=${data.postId}`

  await createInAppNotification({
    userId: data.mentionedUserId,
    type: "feed_mention",
    title: "Mentioned on Threads",
    message: `${data.mentionedByName} mentioned you in a post`,
    link,
    push: prefs.commentMention,
    pushThreadId: FEED_THREAD_ID,
    pushImage: pushImageUrl(data.imageId, base),
  })

  if (!prefs.commentMention) return
  const waDefaultEnabled = envFlagEnabled("NEXUS_WA_MENTIONS_DEFAULT_ENABLED", true)
  const waRecipient = prefs.waPhone || user.phoneNumber
  if (waRecipient && (prefs.waEnabled || waDefaultEnabled)) {
    await sendWA(waRecipient, `[NEXUS] ${data.mentionedByName} mentioned you on Threads: ${data.snippet.slice(0, 100)}${base ? `\n${base}${link}` : ""}`)
  }
  if (prefs.slackEnabled && prefs.slackWebhook) {
    await sendSlack(prefs.slackWebhook, `*Threads*: ${data.mentionedByName} mentioned ${user.name} in a post`)
  }
}

/**
 * A new post on Threads, to everyone in the company (owner, 9 Oct 2026: "push notif untuk semua orang
 * yang ada di workspace Z Networks kalo ada orang yang bikin threads ... keliatan isi threads nya apa
 * dan kalo ada foto muncul di notif pas di teken lama").
 *
 * Audience = the members of the company workspace — the same people orgRoleOf lets read the feed —
 * minus the author, minus anyone offboarded, minus `skipUserIds` (the people @mentioned in the post,
 * who get their own "mentioned you" notification instead of two pushes for one post).
 *
 * Built for 50+ people per post, and run after the response (the caller does not await it): the
 * in-app rows go in with one createManyAndReturn per chunk instead of one INSERT per person, and the
 * pushes go through sendPushToUsers — one device query, one log line, the shared in-flight limiter.
 * Each person still gets their own row id on the push, so Android can mark it read on tap.
 *
 * Preferences: the in-app row is always written (it is the bell, and the post is there either way).
 * The push respects Do Not Disturb and the same switch every Threads notification already reads
 * (`commentMention`); there is no separate "new posts" switch, so turning that off silences Threads
 * on the phone entirely. No WhatsApp or Slack: a message per post per person would be spam.
 */
export async function notifyFeedPost(data: {
  postId: string
  authorId: string
  authorName: string
  text: string
  /** The first PostImage id, if the post has photos. */
  imageId?: string | null
  skipUserIds?: string[]
}) {
  const skip = new Set([data.authorId, ...(data.skipUserIds ?? [])])
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: ORG_WORKSPACE_ID, user: { deactivatedAt: null } },
    select: { userId: true },
  })
  const recipients = [...new Set(members.map((m) => m.userId))].filter((id) => !skip.has(id))
  if (recipients.length === 0) return

  const link = `/threads?post=${data.postId}`
  const title = `${data.authorName} posted on Threads`
  const message = feedPushBody(data.text, Boolean(data.imageId)) || "New post"
  const image = pushImageUrl(data.imageId, publicBaseUrl())

  const CHUNK = 200
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const ids = recipients.slice(i, i + CHUNK)
    const rows = await prisma.notification.createManyAndReturn({
      data: ids.map((userId) => ({ userId, type: "feed_post", title, message, link })),
    })
    for (const row of rows) emitNotification(row.userId, JSON.parse(JSON.stringify(row)))

    const [dnd, prefs] = await Promise.all([getBatchDndStatus(ids), getBatchPrefs(ids)])
    const items: Array<{ userId: string; payload: PushPayload }> = rows
      .filter((row) => !dnd.has(row.userId) && prefs.get(row.userId)?.commentMention !== false)
      .map((row) => ({
        userId: row.userId,
        payload: { title, body: message, type: "feed_post", link, threadId: FEED_THREAD_ID, image, notificationId: row.id },
      }))
    await sendPushToUsers(items, "feed_post").catch((error) => log.error("feed post push failed", { error: String(error) }))
  }
}

// Likes already told, per (post, liker), for this process: a double-tap that lands as like-unlike-like
// inside the same second must not race the database check below into two notifications.
const recentLikeNotices = new Map<string, number>()

/**
 * "{name} liked your post" to the post's author (owner, 9 Oct 2026: "push notif pas gw like post
 * threads nya gmn ke org yg punya threads? ... biar kaya x/twitter").
 *
 * At most ONE per (post, liker), ever: liking, unliking and liking again must not ping the author
 * twice. There is no column for "who did this" on Notification, and adding one is a migration, so the
 * existing row is the marker: same recipient, type feed_like, the post's link, and the liker's name in
 * the title. (Caveats, accepted: a liker who renames themselves between the two likes, or an author
 * who deleted the first notification, can be told a second time.)
 */
export async function notifyFeedLike(data: {
  postId: string
  authorId: string
  likerId: string
  likerName: string
  postText: string
  hasPhoto: boolean
}) {
  if (data.authorId === data.likerId) return
  const key = `${data.postId}:${data.likerId}`
  const now = Date.now()
  if ((recentLikeNotices.get(key) ?? 0) > now - 60_000) return
  if (recentLikeNotices.size > 5000) recentLikeNotices.clear()
  recentLikeNotices.set(key, now)

  const link = `/threads?post=${data.postId}`
  const title = `${data.likerName} liked your post`
  const already = await prisma.notification.findFirst({
    where: { userId: data.authorId, type: "feed_like", link, title },
    select: { id: true },
  })
  if (already) return

  const dnd = await isUserDnd(data.authorId)
  const prefs = await getUserPrefs(data.authorId)
  await createInAppNotification({
    userId: data.authorId,
    type: "feed_like",
    title,
    message: feedPushBody(data.postText, data.hasPhoto, 140) || "Your post on Threads",
    link,
    push: !dnd && prefs.commentMention,
    // Likes on one post stack together, apart from new posts.
    pushThreadId: `feed:${data.postId}`,
  })
}

export async function notifyFeedComment(data: {
  recipientUserId: string
  commenterName: string
  postId: string
  snippet: string
  reason: "author" | "mention"
}) {
  if (await isUserDnd(data.recipientUserId)) return
  const user = await prisma.user.findUnique({ where: { id: data.recipientUserId }, select: { name: true, phoneNumber: true } })
  if (!user) return
  const prefs = await getUserPrefs(data.recipientUserId)
  const base = publicBaseUrl()
  const link = `/threads?post=${data.postId}`

  await createInAppNotification({
    userId: data.recipientUserId,
    type: "feed_comment",
    title: data.reason === "author" ? `${data.commenterName} commented on your post` : `${data.commenterName} mentioned you`,
    message: data.snippet ? data.snippet.slice(0, 140) : (data.reason === "author" ? "New comment on your post" : "Mentioned in a comment on Threads"),
    link,
    push: prefs.commentMention,
    pushThreadId: `feed:${data.postId}`,
  })

  if (!prefs.commentMention) return
  const waDefaultEnabled = envFlagEnabled("NEXUS_WA_MENTIONS_DEFAULT_ENABLED", true)
  const waRecipient = prefs.waPhone || user.phoneNumber
  if (waRecipient && (prefs.waEnabled || waDefaultEnabled)) {
    await sendWA(waRecipient, `[NEXUS] ${data.commenterName} on Threads: ${data.snippet.slice(0, 100)}${base ? `\n${base}${link}` : ""}`)
  }
  if (prefs.slackEnabled && prefs.slackWebhook) {
    await sendSlack(prefs.slackWebhook, `*Threads*: ${data.commenterName} commented`)
  }
}

// ── Integrity (peer reports / "cepu") ────────────────────────

/** Tell the reported person a report was filed about them (reporter stays anonymous) — due-process so they can rebut. */
export async function notifyPeerReportFiled(data: { reportedUserId: string; categoryLabel: string }) {
  if (await isUserDnd(data.reportedUserId)) return
  const user = await prisma.user.findUnique({ where: { id: data.reportedUserId }, select: { name: true, phoneNumber: true } })
  if (!user) return
  const prefs = await getUserPrefs(data.reportedUserId)
  const base = publicBaseUrl()
  const link = `/peer-reports`
  await createInAppNotification({
    userId: data.reportedUserId,
    type: "peer_report_filed",
    title: "Ada laporan tentang kamu",
    message: `Soal: ${data.categoryLabel}. Kamu bisa kasih bantahan sebelum BoD memutuskan.`,
    link,
    // The only chance to rebut, and it sat in the in-app bell alone.
    push: true,
  })
  const waRecipient = prefs.waPhone || user.phoneNumber
  if (waRecipient && (prefs.waEnabled || envFlagEnabled("NEXUS_WA_MENTIONS_DEFAULT_ENABLED", true))) {
    await sendWA(waRecipient, `[NEXUS] Ada laporan tentang kamu soal "${data.categoryLabel}". Buka Integrity buat kasih bantahan${base ? `: ${base}${link}` : ""}.`)
  }
}

/** Broadcast a verified-violation announcement to EVERY workspace member (the public "pengumuman"). */
export async function notifyViolationAnnouncement(data: { reportedName: string; categoryLabel: string }) {
  const members = await prisma.workspaceMember.findMany({ select: { userId: true }, distinct: ["userId"] })
  const title = "⚠️ Pelanggaran terbukti"
  const message = `${data.reportedName} terbukti melanggar: ${data.categoryLabel}`
  await Promise.allSettled(
    members.map((m) => createInAppNotification({ userId: m.userId, type: "violation_announcement", title, message, link: "/peer-reports" })),
  )
}

/// An announcement, delivered.
///
/// Until now posting one only wrote a row: the pop-up was picked up the next time somebody happened
/// to open NEXUS. For "wear a mask on the way in today" that is not a delay, it is a miss — the
/// person who most needed it reads it after they have already arrived.
export async function notifyAnnouncement(announcementId: string) {
  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { id: true, title: true, body: true, active: true, targetUserIds: true, createdById: true, kind: true },
  })
  if (!announcement || !announcement.active) return
  // No relation on the model — `createdById` is a bare column — so the name is one extra lookup.
  const author = announcement.createdById
    ? (await prisma.user.findUnique({ where: { id: announcement.createdById }, select: { name: true } }))?.name?.trim() || null
    : null

  // Audience mirrors /api/announcements/active exactly — an empty target list means everyone. The
  // two must agree: a push nobody can then open, or a pop-up nobody was told about, is worse than
  // either alone.
  const audience = announcement.targetUserIds.length
    ? announcement.targetUserIds
    : (await prisma.workspaceMember.findMany({ select: { userId: true }, distinct: ["userId"] })).map((m) => m.userId)

  // The author is included. Excluding them read well — "they already know what they wrote" — and
  // was wrong in practice: the person who posts a company-wide notice is usually the one checking it
  // went out, and silence is indistinguishable from a broken feature. They also belong to the
  // company the notice is about.
  const recipients = [...new Set(audience)]

  const body = announcement.body.trim()
  const message = body.length > 160 ? `${body.slice(0, 157)}…` : body

  await Promise.allSettled(
    recipients.map((userId) =>
      // `?announcement=<id>` opens THIS announcement on tap even after it was dismissed — the
      // pop-up only ever shows unseen ones, so without the id a tapped push could land on nothing.
      createInAppNotification({
        userId,
        type: "announcement",
        // A personal warning or an SP must not look like a company notice on the lock screen.
        title: `${announcement.kind === "sp" ? "📄 SP" : announcement.kind === "warning" ? "⚠️" : "📣"} ${announcement.title}`,
        message: author ? `${author}: ${message}` : message,
        link: `/dashboard?announcement=${announcement.id}`,
        push: true,
      }),
    ),
  )
}

export async function notifyDueSoon(data: {
  userId: string
  taskId: string
  taskTitle: string
  dueDate: string
  dueAt: string
  projectId?: string
  stage: "2d" | "1d" | "due"
}) {
  // Skip if user has DND active
  if (await isUserDnd(data.userId)) return

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { name: true, email: true },
  })
  if (!user) return

  const prefs = await getUserPrefs(data.userId)
  const type = data.stage === "due" ? "task_due_now" : `task_due_${data.stage}`
  const title = data.stage === "due"
    ? `Due now: ${data.taskTitle}`
    : data.stage === "1d" ? `Due tomorrow: ${data.taskTitle}` : `Due in 2 days: ${data.taskTitle}`

  await createInAppNotification({
    userId: data.userId,
    type,
    title,
    message: `"${data.taskTitle}" is due on ${data.dueDate}`,
    taskId: data.taskId,
    projectId: data.projectId,
    link: `${data.projectId
      ? `/projects/${data.projectId}/tasks/${data.taskId}`
      : `/tasks/${data.taskId}`}?reminder=${data.stage}&due=${encodeURIComponent(data.dueAt)}`,
    push: prefs.taskDueSoon,
  })

  if (!prefs.taskDueSoon) return

  if (prefs.emailEnabled) {
    const email = taskDueSoonEmail({
      recipientName: user.name,
      taskTitle: data.taskTitle,
      taskId: data.taskId,
      dueDate: data.dueDate,
    })
    email.to = user.email
    await sendEmail(email)
  }

  if (prefs.waEnabled && prefs.waPhone) {
    await sendWA(
      prefs.waPhone,
      `[NEXUS] Task "${data.taskTitle}" is due on ${data.dueDate}`
    )
  }
}

export async function notifyProjectInvite(data: {
  userId: string
  projectId: string
  projectName: string
  invitedByName: string
  role: string
}) {
  // Skip if user has DND active
  if (await isUserDnd(data.userId)) return

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
    select: { name: true, email: true },
  })
  if (!user) return

  const prefs = await getUserPrefs(data.userId)

  await createInAppNotification({
    userId: data.userId,
    type: "project_invite",
    title: `${data.invitedByName} invited you to ${data.projectName}`,
    message: `You're now ${data.role ? `a ${data.role.toLowerCase()}` : "a member"} of "${data.projectName}".`,
    projectId: data.projectId,
    link: `/projects/${data.projectId}`,
    push: prefs.projectInvite,
  })

  if (!prefs.projectInvite) return

  if (prefs.emailEnabled) {
    const email = projectInviteEmail({
      recipientName: user.name,
      projectName: data.projectName,
      projectId: data.projectId,
      invitedBy: data.invitedByName,
      role: data.role,
    })
    email.to = user.email
    await sendEmail(email)
  }

  if (prefs.waEnabled && prefs.waPhone) {
    await sendWA(
      prefs.waPhone,
      `[NEXUS] ${data.invitedByName} invited you to project "${data.projectName}" as ${data.role}`
    )
  }

  if (prefs.slackEnabled && prefs.slackWebhook) {
    await sendSlack(
      prefs.slackWebhook,
      `*Project Invite*: ${data.invitedByName} invited ${user.name} to "${data.projectName}"`
    )
  }
}

export async function notifyStatusUpdate(data: {
  projectId: string
  projectName: string
  updatedByName: string
  status: string
  summary: string
}) {
  const members = await prisma.projectMember.findMany({
    where: { projectId: data.projectId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })

  const userIds = members.map((m) => m.userId)
  const [dndSet, prefsMap] = await Promise.all([
    getBatchDndStatus(userIds),
    getBatchPrefs(userIds),
  ])

  for (const member of members) {
    if (dndSet.has(member.userId)) continue

    const prefs = prefsMap.get(member.userId) ?? DEFAULT_PREFS

    await createInAppNotification({
      userId: member.userId,
      type: "status_update",
      title: "Status Update",
      message: `${data.updatedByName} updated "${data.projectName}" status to ${data.status}`,
      projectId: data.projectId,
      link: `/projects/${data.projectId}`,
      push: prefs.statusUpdate,
    })

    if (!prefs.statusUpdate) continue

    if (prefs.emailEnabled) {
      const email = statusUpdateEmail({
        recipientName: member.user.name,
        projectName: data.projectName,
        projectId: data.projectId,
        status: data.status,
        updatedBy: data.updatedByName,
        summary: data.summary,
      })
      email.to = member.user.email
      await sendEmail(email)
    }

    if (prefs.waEnabled && prefs.waPhone) {
      await sendWA(
        prefs.waPhone,
        `[NEXUS] ${data.updatedByName} updated "${data.projectName}" → ${data.status}`
      )
    }
  }
}

// Guards a double-submit of the SAME card — a double-tap on the board, or a request retried after it
// had already succeeded — not a fan-out. Deliberately short: anything longer starts eating real
// events, because a card genuinely moved done → todo → done inside the window would announce the
// retreat and then go silent on the recovery. Sized in seconds because that is the timescale of the
// only real repeat in the log (one task, two TODO→DONE rows seven seconds apart, 2026-08-18).
const SUBMISSION_STATUS_DEDUPE_MS = 60 * 1000

/**
 * Tell whoever filed a form submission that its status moved.
 *
 * "Pengajuan Saya" is driven by the status of the TASK linked to the submission, not by a field on
 * the submission itself - so the moment Finance drags that task to another column, the submitter's
 * board changes underneath them with nothing to announce it. Until now the only way to find out was
 * to open the app and look.
 *
 * Rides the existing `statusUpdate` preference rather than adding a column: that flag was written
 * for `notifyStatusUpdate`, which nothing has ever called, and "a status you care about changed" is
 * the same promise to the reader.
 *
 * NAME THE SUBMISSION, NOT THE FORM. This once quoted `form.name`, which every submission of one
 * form shares: when Finance cleared a column of nineteen different requests, the submitter got
 * nineteen byte-identical `moved "Pengajuan Finance PATS Entertainment" from todo to done` lines and
 * it read as one event repeating. The rows were real and distinct — nineteen tasks, nineteen
 * `ActivityLog` rows, one write each — so the defect was the wording, not the write path.
 */
export async function notifySubmissionStatus(data: {
  submitterId: string
  submissionId: string
  /**
   * What the submitter calls THIS submission: the linked task's title (e.g. "ZALEEFYA - QUEENBAR"),
   * which is exactly the label `GET /api/forms/my-submissions` puts on their card. Never the form's
   * name — that is shared by every submission of the form and makes distinct events indistinguishable.
   */
  subject: string
  fromStatus: string
  toStatus: string
  updatedByName: string
}) {
  if (await isUserDnd(data.submitterId)) return

  const prefs = await getUserPrefs(data.submitterId)
  const human = (s: string) => s.replace(/_/g, " ").toLowerCase()

  // Points at the submitter's own board, opened on THIS submission — `/submissions` reads it as
  // `?id=` and pops the detail drawer. Not the task: the submitter often has no access to the
  // project the task lives in, and `GET /api/forms/my-submissions/[submissionId]` is the one
  // endpoint that is scoped to them.
  await createInAppNotification({
    userId: data.submitterId,
    type: "submission_status",
    title: "Submission update",
    message: `${data.updatedByName} moved "${data.subject}" from ${human(data.fromStatus)} to ${human(data.toStatus)}`,
    link: `/submissions?id=${data.submissionId}`,
    push: prefs.statusUpdate,
    dedupeWindowMs: SUBMISSION_STATUS_DEDUPE_MS,
  })
}

/**
 * Your streak is about to lapse.
 *
 * Sent late in the day, and only to people who actually have something to lose (currentStreak > 0)
 * and haven't done anything today. Anyone at zero gets nothing: nagging someone about a streak they
 * are not on is how a notification channel earns itself a mute.
 */
export async function notifyStreakAtRisk(data: { userId: string; currentStreak: number }) {
  if (await isUserDnd(data.userId)) return
  const prefs = await getUserPrefs(data.userId)
  await createInAppNotification({
    userId: data.userId,
    type: "streak_at_risk",
    title: "Your streak ends at midnight",
    message: `${data.currentStreak} day${data.currentStreak === 1 ? "" : "s"} on the line — finish something today to keep it.`,
    link: "/my-tasks",
    push: prefs.statusUpdate,
  })
}

/**
 * One day of allowance left this month.
 *
 * Fires once per month per kind, at the point where the next request is the last one. Earlier than
 * that is noise; later is useless.
 */
export async function notifyQuotaLow(data: {
  userId: string
  kind: "dayoff" | "red_date"
  remaining: number
  quota: number
}) {
  if (await isUserDnd(data.userId)) return
  const prefs = await getUserPrefs(data.userId)
  const label = data.kind === "dayoff" ? "day-off" : "public-holiday"
  await createInAppNotification({
    userId: data.userId,
    type: data.kind === "dayoff" ? "dayoff_quota_low" : "red_date_quota_low",
    title: `${data.remaining} ${label} day left`,
    message: `You've used ${data.quota - data.remaining} of ${data.quota} this month.`,
    link: "/attendance",
    push: prefs.statusUpdate,
  })
}

/** A room booking starts shortly. Only the person who booked it is told. */
export async function notifyBookingSoon(data: {
  userId: string
  bookingId: string
  room: string
  title: string
  minutes: number
}) {
  if (await isUserDnd(data.userId)) return
  const prefs = await getUserPrefs(data.userId)
  await createInAppNotification({
    userId: data.userId,
    type: "booking_soon",
    title: `${data.room} in ${data.minutes} min`,
    message: data.title,
    // Doubles as the de-dupe key: one reminder per booking, forever (booking-reminder matches
    // `link contains <id>`, so reminders sent with the old /master-calendar link still count). Room
    // Booking is its own screen now; the Calendar no longer shows bookings.
    link: `/room-booking?booking=${data.bookingId}`,
    push: prefs.statusUpdate,
  })
}

/** A quest is finished but the XP is still sitting there uncollected. */
export async function notifyQuestClaimable(data: {
  userId: string
  questKey: string
  periodKey: string
  title: string
}) {
  if (await isUserDnd(data.userId)) return
  const prefs = await getUserPrefs(data.userId)
  await createInAppNotification({
    userId: data.userId,
    type: "quest_claimable",
    title: "Quest ready to claim",
    message: `"${data.title}" is done — collect the XP before the week resets.`,
    // The key doubles as the de-dupe marker: one nudge per quest per period.
    link: `/dashboard?quest=${data.questKey}:${data.periodKey}`,
    push: prefs.statusUpdate,
  })
}

export async function notifyTaskCompleted(data: {
  taskId: string
  taskTitle: string
  projectId: string
  projectName: string
  completedByName: string
  completedById: string
}) {
  const [assignees, followers] = await Promise.all([
    prisma.taskAssignee.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
    prisma.taskFollower.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
  ])

  const recipientIds = new Set<string>()
  for (const a of assignees) recipientIds.add(a.userId)
  for (const f of followers) recipientIds.add(f.userId)
  recipientIds.delete(data.completedById)

  const userIds = Array.from(recipientIds)
  const dndSet = await getBatchDndStatus(userIds)

  for (const userId of userIds) {
    if (dndSet.has(userId)) continue

    await createInAppNotification({
      userId,
      type: "task_completed",
      title: `${data.completedByName} completed: ${data.taskTitle}`,
      message: data.projectName ? `In ${data.projectName}` : `${data.completedByName} completed "${data.taskTitle}"`,
      taskId: data.taskId,
      projectId: data.projectId,
      link: `/projects/${data.projectId}/tasks/${data.taskId}`,
      push: true,
    })
  }
}

export async function notifyCommentAdded(data: {
  taskId: string
  taskTitle: string
  projectId: string
  commentByName: string
  commentById: string
  commentSnippet: string
}) {
  const [assignees, followers] = await Promise.all([
    prisma.taskAssignee.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
    prisma.taskFollower.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
  ])

  const recipientIds = new Set<string>()
  for (const a of assignees) recipientIds.add(a.userId)
  for (const f of followers) recipientIds.add(f.userId)
  recipientIds.delete(data.commentById)

  const userIds = Array.from(recipientIds)
  const dndSet = await getBatchDndStatus(userIds)

  for (const userId of userIds) {
    if (dndSet.has(userId)) continue

    await createInAppNotification({
      userId,
      type: "comment_added",
      title: `${data.commentByName} commented on: ${data.taskTitle}`,
      message: data.commentSnippet ? data.commentSnippet.slice(0, 140) : `${data.commentByName} commented on "${data.taskTitle}"`,
      taskId: data.taskId,
      projectId: data.projectId,
      link: `/projects/${data.projectId}/tasks/${data.taskId}`,
      push: true,
    })
  }
}

// ── Due-soon checker (call from API or cron) ────────────────────

export async function checkDueSoonTasks() {
  const now = new Date()
  const inTwoDays = new Date(now.getTime() + 48 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const tasks = await prisma.task.findMany({
    where: {
      dueDate: { gte: thirtyDaysAgo, lte: inTwoDays },
      status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] },
    },
    include: {
      assignees: { include: { user: true } },
      taskList: { select: { projectId: true } },
    },
  })

  for (const task of tasks) {
    const hoursLeft = (task.dueDate!.getTime() - now.getTime()) / 3_600_000
    const stage: "2d" | "1d" | "due" = hoursLeft <= 0 ? "due" : hoursLeft <= 24 ? "1d" : "2d"
    const type = stage === "due" ? "task_due_now" : `task_due_${stage}`
    const dueAt = task.dueDate!.toISOString()
    for (const assignee of task.assignees) {
      const existing = await prisma.notification.findFirst({
        where: {
          userId: assignee.userId,
          taskId: task.id,
          type,
          link: { contains: encodeURIComponent(dueAt) },
        },
      })
      if (existing) continue

      await notifyDueSoon({
        userId: assignee.userId,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.taskList.projectId,
        stage,
        dueAt,
        dueDate: task.dueDate!.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })
    }
  }
}

// ── Complaint & Escalation channel ───────────────────────────────────────────────

/** A new complaint was filed → ping every BoD (reporter identity is never included, anon or not). */
/** Who a ticket is from, the way a BoD is allowed to see it: the name, or nothing when it was filed anonymously. */
async function complaintHeadline(complaintId: string) {
  const c = await prisma.complaint.findUnique({
    where: { id: complaintId },
    select: { subject: true, anonymous: true, reporter: { select: { name: true, email: true } } },
  })
  if (!c) return null
  const reporter = c.anonymous ? "Pelapor anonim" : (c.reporter?.name || c.reporter?.email || "Seseorang")
  return { subject: c.subject, reporter, anonymous: c.anonymous }
}

export async function notifyComplaintFiled(data: { workspaceId: string; complaintId: string; categoryLabel: string }) {
  const bod = await prisma.workspaceMember.findMany({
    where: { workspaceId: data.workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
    select: { userId: true },
  })
  const head = await complaintHeadline(data.complaintId)
  await Promise.allSettled(
    bod.map((b) =>
      createInAppNotification({
        userId: b.userId,
        type: "complaint_filed",
        title: head ? `Tiket baru dari ${head.reporter}` : "Keluhan baru masuk",
        message: head ? `${head.subject} · ${data.categoryLabel}` : `Kategori: ${data.categoryLabel}. Buka untuk menanggapi.`,
        link: `/complaints?id=${data.complaintId}`,
        push: true,
      }),
    ),
  )
}

/** A reply landed in a complaint thread → ping the other side (BoD reply → reporter; reporter reply → BoD). */
export async function notifyComplaintReply(data: { complaintId: string; workspaceId: string; reporterId: string; fromReviewer: boolean; replierId: string; byGideon?: boolean; preview?: string | null }) {
  const head = await complaintHeadline(data.complaintId)
  const subject = head ? `“${head.subject}”` : "tiket"
  const snippet = data.preview?.trim() ? ` — ${data.preview.trim().length > 120 ? data.preview.trim().slice(0, 117) + "…" : data.preview.trim()}` : ""
  const link = `/complaints?id=${data.complaintId}`
  if (data.fromReviewer) {
    const replier = data.byGideon ? "GIDEON" : ((await prisma.user.findUnique({ where: { id: data.replierId }, select: { name: true } }))?.name || "BoD")
    // BoD (or GIDEON) replied → tell the reporter (the reporter isn't anonymous to themselves).
    // Until 16 Sep 2026 none of the ticket notifications were pushed — the row appeared in the
    // in-app bell and nowhere else, so an answered ticket looked identical to an ignored one on a
    // phone in a pocket.
    await createInAppNotification({
      userId: data.reporterId,
      type: "complaint_reply",
      title: `${replier} membalas tiket kamu`,
      message: data.byGideon
        ? `${subject}: GIDEON sudah mengecek datanya dan menjawab. Kalau ada usulan, tinggal menunggu keputusan BoD.`
        : `${subject}${snippet || " — buka untuk membaca balasannya."}`,
      link,
      push: true,
    }).catch(() => null)
  } else {
    // Reporter replied → tell every BoD (except whoever just posted, if a BoD somehow filed it).
    const bod = await prisma.workspaceMember.findMany({
      where: { workspaceId: data.workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] }, userId: { not: data.replierId } },
      select: { userId: true },
    })
    await Promise.allSettled(
      bod.map((b) =>
        createInAppNotification({
          userId: b.userId,
          type: "complaint_reply",
          title: `${head?.reporter ?? "Pelapor"} membalas tiket`,
          message: `${subject}${snippet || " — buka untuk menanggapi."}`,
          link,
          push: true,
        }),
      ),
    )
  }
}

/** A complaint's status changed → tell the reporter. */
export async function notifyComplaintStatus(data: { reporterId: string; complaintId: string; status: string; detail?: string }) {
  const label: Record<string, string> = {
    OPEN: "dibuka kembali", AWAITING_DECISION: "nunggu keputusan BoD",
    IN_REVIEW: "lagi ditangani BoD", RESOLVED: "selesai", CLOSED: "ditutup",
  }
  const head = await complaintHeadline(data.complaintId)
  const subject = head ? `“${head.subject}”` : "kamu"
  await createInAppNotification({
    userId: data.reporterId,
    type: "complaint_status",
    title: data.status === "RESOLVED" ? `Tiket ${subject} selesai ✓` : `Update tiket ${subject}`,
    message: data.detail ? `${data.detail}` : `Tiket ${subject} ${label[data.status] ?? data.status}.`,
    link: `/complaints?id=${data.complaintId}`,
    push: true,
  }).catch(() => null)
}
