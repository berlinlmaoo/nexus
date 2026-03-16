import prisma from "@/lib/prisma"

type AutomationEvent =
  | "task_created"
  | "task_status_changed"
  | "task_assigned"
  | "task_due_approaching"
  | "comment_added"
  | "sprint_started"

interface AutomationContext {
  taskId?: string
  userId: string
  projectId: string
  oldStatus?: string
  newStatus?: string
  assigneeIds?: string[]
  commentId?: string
  sprintId?: string
  [key: string]: unknown
}

interface AutomationTrigger {
  type: string
  value?: string
}

interface AutomationAction {
  type: string
  value?: string
}

const EVENT_TO_TRIGGER: Record<AutomationEvent, string> = {
  task_created: "TASK_CREATED",
  task_status_changed: "STATUS_CHANGED",
  task_assigned: "TASK_CREATED", // assignee-related automations fire on creation too
  task_due_approaching: "DUE_DATE_APPROACHING",
  comment_added: "TASK_CREATED", // comment triggers can match general task triggers
  sprint_started: "TASK_CREATED",
}

// Also match TASK_COMPLETED trigger when status changes to DONE
function matchesTrigger(
  trigger: AutomationTrigger,
  event: AutomationEvent,
  context: AutomationContext
): boolean {
  const triggerType = trigger.type

  switch (event) {
    case "task_created":
      return triggerType === "TASK_CREATED"
    case "task_status_changed":
      if (triggerType === "STATUS_CHANGED") {
        // If trigger has a value, match only that status
        if (trigger.value) return trigger.value === context.newStatus
        return true
      }
      if (triggerType === "TASK_COMPLETED") {
        return context.newStatus === "DONE"
      }
      return false
    case "task_assigned":
      return triggerType === "TASK_CREATED" // piggyback on task_created triggers
    case "task_due_approaching":
      return triggerType === "DUE_DATE_APPROACHING"
    case "comment_added":
      return triggerType === "TASK_CREATED" // comments can trigger task-level automations
    case "sprint_started":
      return triggerType === "TASK_CREATED"
    default:
      return false
  }
}

async function executeAction(
  action: AutomationAction,
  context: AutomationContext
): Promise<string> {
  const { taskId, userId, projectId } = context

  switch (action.type) {
    case "CHANGE_STATUS": {
      if (!taskId || !action.value) return "skipped: missing taskId or value"
      await prisma.task.update({
        where: { id: taskId },
        data: { status: action.value as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" },
      })
      return `Changed status to ${action.value}`
    }

    case "ASSIGN_TO": {
      if (!taskId || !action.value) return "skipped: missing taskId or value"
      // Check if already assigned
      const existing = await prisma.taskAssignee.findFirst({
        where: { taskId, userId: action.value },
      })
      if (!existing) {
        await prisma.taskAssignee.create({
          data: { taskId, userId: action.value },
        })
      }
      return `Assigned user ${action.value}`
    }

    case "SET_PRIORITY": {
      if (!taskId || !action.value) return "skipped: missing taskId or value"
      await prisma.task.update({
        where: { id: taskId },
        data: { priority: action.value as "URGENT" | "HIGH" | "MEDIUM" | "LOW" },
      })
      return `Set priority to ${action.value}`
    }

    case "CREATE_SUBTASK": {
      if (!taskId) return "skipped: missing taskId"
      const parentTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { taskListId: true },
      })
      if (!parentTask) return "skipped: parent task not found"
      await prisma.task.create({
        data: {
          title: action.value || "Subtask",
          taskListId: parentTask.taskListId,
          creatorId: userId,
          parentId: taskId,
        },
      })
      return `Created subtask "${action.value || "Subtask"}"`
    }

    case "ADD_TAG": {
      if (!taskId || !action.value) return "skipped: missing taskId or value"
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { tags: true },
      })
      if (!task) return "skipped: task not found"
      const tags = task.tags as string[]
      if (!tags.includes(action.value)) {
        await prisma.task.update({
          where: { id: taskId },
          data: { tags: [...tags, action.value] },
        })
      }
      return `Added tag "${action.value}"`
    }

    case "SEND_NOTIFICATION": {
      if (!taskId) return "skipped: missing taskId"
      const taskForNotif = await prisma.task.findUnique({
        where: { id: taskId },
        select: { title: true, assignees: { select: { userId: true } } },
      })
      if (!taskForNotif) return "skipped: task not found"
      // Notify all assignees
      for (const assignee of taskForNotif.assignees) {
        await prisma.notification.create({
          data: {
            userId: assignee.userId,
            type: "automation",
            title: "Automation Notification",
            message: action.value || `Automation triggered on "${taskForNotif.title}"`,
            taskId,
            projectId,
          },
        })
      }
      return `Sent notification to ${taskForNotif.assignees.length} assignee(s)`
    }

    case "MOVE_TO_SECTION": {
      if (!taskId || !action.value) return "skipped: missing taskId or value"
      await prisma.task.update({
        where: { id: taskId },
        data: { taskListId: action.value },
      })
      return `Moved task to section ${action.value}`
    }

    case "MARK_COMPLETE": {
      if (!taskId) return "skipped: missing taskId"
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "DONE" },
      })
      return "Marked task as completed"
    }

    default:
      return `Unknown action type: ${action.type}`
  }
}

export async function executeAutomations(
  projectId: string,
  event: AutomationEvent,
  context: AutomationContext
): Promise<void> {
  try {
    const automations = await prisma.automation.findMany({
      where: { projectId, enabled: true },
    })

    for (const automation of automations) {
      const trigger = automation.trigger as unknown as AutomationTrigger
      const action = automation.action as unknown as AutomationAction

      if (!matchesTrigger(trigger, event, context)) continue

      try {
        const result = await executeAction(action, context)

        // Log execution in ActivityLog
        await prisma.activityLog.create({
          data: {
            action: "automation_executed",
            details: `Automation "${automation.name}" fired: ${result}`,
            userId: context.userId,
            taskId: context.taskId || null,
            projectId,
          },
        })
      } catch (err) {
        console.error(`Automation "${automation.name}" failed:`, err)
        // Log failure
        await prisma.activityLog.create({
          data: {
            action: "automation_failed",
            details: `Automation "${automation.name}" failed: ${err instanceof Error ? err.message : "Unknown error"}`,
            userId: context.userId,
            taskId: context.taskId || null,
            projectId,
          },
        }).catch(() => {})
      }
    }
  } catch (err) {
    console.error("Failed to execute automations:", err)
  }
}
