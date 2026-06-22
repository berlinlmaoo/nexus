import prisma from "@/lib/prisma"
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
function publicBaseUrl(): string {
  const explicit = process.env.NEXUS_PUBLIC_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  const authUrl = process.env.NEXTAUTH_URL || ""
  if (/^https:\/\//.test(authUrl) && !/(localhost|127\.0\.0\.1)/.test(authUrl)) return authUrl.replace(/\/+$/, "")
  return "" // no usable public URL → omit the link rather than send a broken localhost one
}
function taskUrl(taskId: string): string {
  const base = publicBaseUrl()
  return base ? `${base}/tasks/${taskId}` : ""
}

export async function sendWA(phone: string, message: string) {
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

async function createInAppNotification(data: {
  userId: string
  type: string
  title: string
  message: string
  taskId?: string
  projectId?: string
  link?: string
}) {
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

  return notification
}

// ── Public methods ──────────────────────────────────────────────

/** Ping every BoD / Super Admin in the workspace that a staff member checked out OFFSITE (pending approval). */
export async function notifyOffsiteCheckoutPending(data: {
  workspaceId: string
  staffUserId: string
  staffName: string
  reason?: string | null
}) {
  const approvers = await prisma.workspaceMember.findMany({
    where: { workspaceId: data.workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] }, userId: { not: data.staffUserId } },
    select: { userId: true },
  })
  const reasonSuffix = data.reason ? ` — “${data.reason}”` : ""
  await Promise.all(
    approvers.map((a) =>
      createInAppNotification({
        userId: a.userId,
        type: "offsite_checkout_pending",
        title: "Checkout di luar — perlu approval",
        message: `${data.staffName} checkout di luar area kantor${reasonSuffix}. Cek & approve di Attendance.`,
        link: "/attendance",
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
    title: "Task Assigned",
    message: `${data.assignedByName} assigned you "${data.taskTitle}"`,
    taskId: data.taskId,
    projectId: data.projectId,
    link: `/projects/${data.projectId}/tasks/${data.taskId}`,
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
    title: "Mentioned in Comment",
    message: `${data.mentionedByName} mentioned you on "${data.taskTitle}"`,
    taskId: data.taskId,
    projectId: data.projectId,
    link: data.projectId ? `/projects/${data.projectId}/tasks/${data.taskId}` : undefined,
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

export async function notifyFeedMention(data: {
  mentionedUserId: string
  mentionedByName: string
  postId: string
  snippet: string
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
    title: data.reason === "author" ? "New comment on your post" : "Mentioned in a comment",
    message: `${data.commenterName} ${data.reason === "author" ? "commented on your post" : "mentioned you in a comment"}`,
    link,
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

export async function notifyDueSoon(data: {
  userId: string
  taskId: string
  taskTitle: string
  dueDate: string
  projectId?: string
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
    type: "task_due_soon",
    title: "Task Due Soon",
    message: `"${data.taskTitle}" is due on ${data.dueDate}`,
    taskId: data.taskId,
    projectId: data.projectId,
    link: data.projectId
      ? `/projects/${data.projectId}/tasks/${data.taskId}`
      : `/tasks/${data.taskId}`,
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
    title: "Project Invitation",
    message: `${data.invitedByName} invited you to "${data.projectName}"`,
    projectId: data.projectId,
    link: `/projects/${data.projectId}`,
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
      title: "Task Completed",
      message: `${data.completedByName} completed "${data.taskTitle}"`,
      taskId: data.taskId,
      projectId: data.projectId,
      link: `/projects/${data.projectId}/tasks/${data.taskId}`,
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
      title: "New Comment",
      message: `${data.commentByName} commented on "${data.taskTitle}"`,
      taskId: data.taskId,
      projectId: data.projectId,
      link: `/projects/${data.projectId}/tasks/${data.taskId}`,
    })
  }
}

// ── Due-soon checker (call from API or cron) ────────────────────

export async function checkDueSoonTasks() {
  const tomorrow = new Date()
  tomorrow.setHours(tomorrow.getHours() + 24)
  const now = new Date()

  const tasks = await prisma.task.findMany({
    where: {
      dueDate: { gte: now, lte: tomorrow },
      status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] },
    },
    include: {
      assignees: { include: { user: true } },
      taskList: { select: { projectId: true } },
    },
  })

  for (const task of tasks) {
    for (const assignee of task.assignees) {
      // Check if we already notified today
      const existing = await prisma.notification.findFirst({
        where: {
          userId: assignee.userId,
          taskId: task.id,
          type: "task_due_soon",
          createdAt: { gte: new Date(now.toDateString()) },
        },
      })
      if (existing) continue

      await notifyDueSoon({
        userId: assignee.userId,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.taskList.projectId,
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
export async function notifyComplaintFiled(data: { workspaceId: string; complaintId: string; categoryLabel: string }) {
  const bod = await prisma.workspaceMember.findMany({
    where: { workspaceId: data.workspaceId, role: { in: ["BOD", "ONE_ABOVE_ALL"] } },
    select: { userId: true },
  })
  await Promise.allSettled(
    bod.map((b) =>
      createInAppNotification({
        userId: b.userId,
        type: "complaint_filed",
        title: "Keluhan baru masuk",
        message: `Kategori: ${data.categoryLabel}. Buka untuk menanggapi.`,
        link: "/complaints",
      }),
    ),
  )
}

/** A reply landed in a complaint thread → ping the other side (BoD reply → reporter; reporter reply → BoD). */
export async function notifyComplaintReply(data: { complaintId: string; workspaceId: string; reporterId: string; fromReviewer: boolean; replierId: string }) {
  if (data.fromReviewer) {
    // BoD replied → tell the reporter (the reporter isn't anonymous to themselves).
    await createInAppNotification({
      userId: data.reporterId,
      type: "complaint_reply",
      title: "Balasan untuk keluhan kamu",
      message: "BoD membalas keluhan yang kamu ajukan.",
      link: "/complaints",
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
          title: "Balasan di keluhan",
          message: "Ada balasan baru di salah satu keluhan. Buka untuk menanggapi.",
          link: "/complaints",
        }),
      ),
    )
  }
}

/** A complaint's status changed → tell the reporter. */
export async function notifyComplaintStatus(data: { reporterId: string; complaintId: string; status: string }) {
  const label: Record<string, string> = {
    OPEN: "dibuka kembali", IN_REVIEW: "lagi ditangani BoD", RESOLVED: "ditandai selesai", CLOSED: "ditutup",
  }
  await createInAppNotification({
    userId: data.reporterId,
    type: "complaint_status",
    title: "Update keluhan kamu",
    message: `Keluhan kamu ${label[data.status] ?? data.status}.`,
    link: "/complaints",
  }).catch(() => null)
}
