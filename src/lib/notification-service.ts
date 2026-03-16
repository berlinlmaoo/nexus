import prisma from "@/lib/prisma"
import { emitNotification } from "@/lib/socket-emitter"
import {
  sendEmail,
  taskAssignedEmail,
  taskDueSoonEmail,
  commentMentionEmail,
  projectInviteEmail,
  statusUpdateEmail,
} from "@/lib/email"

// ── Helpers ─────────────────────────────────────────────────────

async function getUserPrefs(userId: string) {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId },
  })
  // Default: everything enabled for email, disabled for WA/Slack
  return {
    emailEnabled: pref?.emailEnabled ?? true,
    waEnabled: pref?.waEnabled ?? false,
    slackEnabled: pref?.slackEnabled ?? false,
    waPhone: pref?.waPhone ?? null,
    slackWebhook: pref?.slackWebhook ?? null,
    taskAssigned: pref?.taskAssigned ?? true,
    taskDueSoon: pref?.taskDueSoon ?? true,
    commentMention: pref?.commentMention ?? true,
    projectInvite: pref?.projectInvite ?? true,
    statusUpdate: pref?.statusUpdate ?? true,
  }
}

async function sendWA(phone: string, message: string) {
  const webhookUrl = process.env.WA_WEBHOOK_URL
  if (!webhookUrl) {
    console.log("[WA] Webhook not configured. Message:", message)
    return
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message }),
    })
    console.log("[WA] Sent to", phone)
  } catch (error) {
    console.error("[WA] Failed:", error)
  }
}

async function sendSlack(webhookUrl: string, message: string) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    })
    console.log("[SLACK] Sent")
  } catch (error) {
    console.error("[SLACK] Failed:", error)
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

export async function notifyTaskAssigned(data: {
  assigneeId: string
  taskId: string
  taskTitle: string
  projectName: string
  projectId: string
  assignedByName: string
}) {
  const user = await prisma.user.findUnique({
    where: { id: data.assigneeId },
    select: { name: true, email: true },
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
  if (prefs.waEnabled && prefs.waPhone) {
    await sendWA(
      prefs.waPhone,
      `[NEXUS] ${data.assignedByName} assigned you "${data.taskTitle}" in ${data.projectName}`
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
  const user = await prisma.user.findUnique({
    where: { id: data.mentionedUserId },
    select: { name: true, email: true },
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

  if (prefs.waEnabled && prefs.waPhone) {
    await sendWA(
      prefs.waPhone,
      `[NEXUS] ${data.mentionedByName} mentioned you on "${data.taskTitle}": ${data.commentSnippet.slice(0, 100)}`
    )
  }

  if (prefs.slackEnabled && prefs.slackWebhook) {
    await sendSlack(
      prefs.slackWebhook,
      `*Mentioned*: ${data.mentionedByName} mentioned ${user.name} on "${data.taskTitle}"`
    )
  }
}

export async function notifyDueSoon(data: {
  userId: string
  taskId: string
  taskTitle: string
  dueDate: string
}) {
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
    link: `/tasks/${data.taskId}`,
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
  // Notify all project members
  const members = await prisma.projectMember.findMany({
    where: { projectId: data.projectId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })

  for (const member of members) {
    const prefs = await getUserPrefs(member.userId)

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
  // Notify all assignees + followers (except the person who completed it)
  const [assignees, followers] = await Promise.all([
    prisma.taskAssignee.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
    prisma.taskFollower.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
  ])

  const recipientIds = new Set<string>()
  for (const a of assignees) recipientIds.add(a.userId)
  for (const f of followers) recipientIds.add(f.userId)
  recipientIds.delete(data.completedById)

  for (const userId of recipientIds) {
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
  // Notify all assignees + followers (except the commenter)
  const [assignees, followers] = await Promise.all([
    prisma.taskAssignee.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
    prisma.taskFollower.findMany({ where: { taskId: data.taskId }, select: { userId: true } }),
  ])

  const recipientIds = new Set<string>()
  for (const a of assignees) recipientIds.add(a.userId)
  for (const f of followers) recipientIds.add(f.userId)
  recipientIds.delete(data.commentById)

  for (const userId of recipientIds) {
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
        dueDate: task.dueDate!.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })
    }
  }
}
