export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import prisma from "@/lib/prisma"
import { logAudit } from "@/lib/audit"
import { checkProjectAccess } from "@/lib/rbac"
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit"
import {
  coerceCustomFieldValueForType,
  normalizeCustomFieldType,
  serializeCustomFieldValue,
} from "@/lib/custom-fields"
import { executeAutomations } from "@/lib/automation-engine"
import { dispatchWebhookEvent } from "@/lib/webhook-dispatcher"
import { emitTaskCreated } from "@/lib/socket-emitter"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import type { InputJsonValue } from "@prisma/client/runtime/client"

type FormMappingTarget =
  | "none"
  | "task_title"
  | "task_description"
  | "task_due_date"
  | "task_status"
  | "task_priority"
  | "task_list"
  | "custom_field"

interface IntakeFormField {
  id: string
  name: string
  type?: string
  required?: boolean
  attachmentEnabled?: boolean
  mapping?: {
    target?: FormMappingTarget
    customFieldId?: string
  }
  showIf?: {
    fieldId: string
    operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty"
    value: string
  }
  routingRules?: Array<{
    id?: string
    operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty"
    value: string
    action: "set_task_list" | "assign_user"
    targetTaskListId?: string
    targetUserId?: string
    targetUserIds?: string[]
  }>
}

const TASK_STATUSES = new Set(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"])
const TASK_PRIORITIES = new Set(["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"])
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

interface SubmittedFile {
  fieldId: string
  file: File
}

function getFieldValue(data: Record<string, unknown>, field: IntakeFormField) {
  return data[field.id] ?? data[field.name]
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value).trim()
}

function normalizeValueList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean)
  return [normalizeText(value)]
}

function getConditionFieldValue(
  condition: NonNullable<IntakeFormField["showIf"]>,
  data: Record<string, unknown>,
  fieldsById?: Map<string, IntakeFormField>
) {
  const conditionField = fieldsById?.get(condition.fieldId)
  return data[condition.fieldId] ?? (conditionField ? data[conditionField.name] : undefined)
}

function evaluateCondition(
  field: IntakeFormField,
  data: Record<string, unknown>,
  fieldsById?: Map<string, IntakeFormField>
) {
  if (!field.showIf) return true
  const fieldValues = normalizeValueList(getConditionFieldValue(field.showIf, data, fieldsById))
  const fieldValue = fieldValues.join(", ")
  const expected = String(field.showIf.value ?? "")

  switch (field.showIf.operator) {
    case "equals":
      return fieldValues.includes(expected)
    case "not_equals":
      return !fieldValues.includes(expected)
    case "contains":
      return fieldValue.toLowerCase().includes(expected.toLowerCase())
    case "is_empty":
      return !fieldValue
    case "is_not_empty":
      return !!fieldValue
    default:
      return true
  }
}

function getVisibleFields(fields: IntakeFormField[], data: Record<string, unknown>) {
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const visibilityCache = new Map<string, boolean>()

  const isVisible = (field: IntakeFormField, trail = new Set<string>()): boolean => {
    const cached = visibilityCache.get(field.id)
    if (cached !== undefined) return cached

    if (trail.has(field.id)) {
      visibilityCache.set(field.id, false)
      return false
    }

    if (!evaluateCondition(field, data, fieldsById)) {
      visibilityCache.set(field.id, false)
      return false
    }

    const parentId = field.showIf?.fieldId
    if (!parentId) {
      visibilityCache.set(field.id, true)
      return true
    }

    const parent = fieldsById.get(parentId)
    if (!parent) {
      visibilityCache.set(field.id, true)
      return true
    }

    const nextTrail = new Set(trail)
    nextTrail.add(field.id)
    const visible = isVisible(parent, nextTrail)
    visibilityCache.set(field.id, visible)
    return visible
  }

  return fields.filter((field) => isVisible(field))
}

function evaluateRoutingRule(
  rule: NonNullable<IntakeFormField["routingRules"]>[number],
  field: IntakeFormField,
  data: Record<string, unknown>
) {
  const fieldValues = normalizeValueList(getFieldValue(data, field))
  const fieldValue = fieldValues.join(", ")
  const expected = String(rule.value ?? "")

  switch (rule.operator) {
    case "equals":
      return fieldValues.includes(expected)
    case "not_equals":
      return !fieldValues.includes(expected)
    case "contains":
      return fieldValue.toLowerCase().includes(expected.toLowerCase())
    case "is_empty":
      return !fieldValue
    case "is_not_empty":
      return !!fieldValue
    default:
      return false
  }
}

function getRoutingTargetUserIds(rule: NonNullable<IntakeFormField["routingRules"]>[number]) {
  return Array.from(new Set([...(Array.isArray(rule.targetUserIds) ? rule.targetUserIds : []), ...(rule.targetUserId ? [rule.targetUserId] : [])]))
}

function normalizeEnumValue(value: unknown, allowed: Set<string>) {
  const normalized = normalizeText(value).toUpperCase().replace(/[\s-]+/g, "_")
  return allowed.has(normalized) ? normalized : undefined
}

function buildSubmissionSummary(fields: IntakeFormField[], data: Record<string, unknown>) {
  return fields
    .filter((field) => field.mapping?.target !== "task_description")
    .map((field) => {
      const value = normalizeText(getFieldValue(data, field))
      return value ? `- ${field.name}: ${value}` : null
    })
    .filter(Boolean)
    .join("\n")
}

function buildTaskDescriptionFromFields(fields: IntakeFormField[], data: Record<string, unknown>) {
  const descriptionFields = fields.filter((field) => field.mapping?.target === "task_description")
  const filledDescriptions = descriptionFields
    .map((field) => {
      const value = normalizeText(getFieldValue(data, field))
      if (!value) return null
      return `${field.name}:\n${value}`
    })
    .filter(Boolean)

  return filledDescriptions.join("\n\n")
}

async function parseSubmissionRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? ""

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData()
    const rawData = formData.get("data")
    const data =
      typeof rawData === "string"
        ? JSON.parse(rawData) as Record<string, unknown>
        : null

    const files: SubmittedFile[] = []
    for (const [key, value] of Array.from(formData.entries())) {
      const isFieldFile = key.startsWith("file:")
      const isFieldAttachment = key.startsWith("attachment:")
      if ((!isFieldFile && !isFieldAttachment) || !(value instanceof File) || value.size === 0) continue
      if (value.size > MAX_ATTACHMENT_SIZE) {
        throw new Error(`File "${value.name}" is too large. Maximum size is 50MB.`)
      }
      files.push({ fieldId: key.replace("file:", "").replace("attachment:", ""), file: value })
    }

    return { data, files }
  }

  const body = await request.json() as { data?: Record<string, unknown> }
  return { data: body.data ?? null, files: [] as SubmittedFile[] }
}

async function createTaskAttachments(files: SubmittedFile[], taskId: string, uploaderId: string) {
  if (files.length === 0) return []

  const uploadDir = path.join(process.cwd(), "public", "uploads", "attachments")
  await mkdir(uploadDir, { recursive: true })

  const attachments = []
  for (const { file } of files) {
    const ext = path.extname(file.name) || ""
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const bytes = await file.arrayBuffer()
    await writeFile(path.join(uploadDir, safeName), Buffer.from(bytes))

    attachments.push(
      await prisma.attachment.create({
        data: {
          filename: file.name,
          url: `/api/files/attachments/${safeName}`,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          taskId,
          uploaderId,
        },
      })
    )
  }

  return attachments
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const session = await auth()
    const userId = session?.user?.id || null
    const { allowed: rateLimitAllowed, resetAt } = checkRateLimit(request, userId ?? undefined, {
      limit: 20,
      windowSeconds: 60,
    })
    if (!rateLimitAllowed) return rateLimitResponse(resetAt)

    const { formId } = await params
    const { data, files } = await parseSubmissionRequest(request)

    if (!data) {
      return NextResponse.json({ error: "data is required" }, { status: 400 })
    }

    const form = await prisma.form.findUnique({
      where: { id: formId },
      include: {
        project: {
          include: {
            taskLists: { orderBy: { position: "asc" } },
            customFields: true,
            members: { orderBy: { joinedAt: "asc" }, select: { userId: true, role: true } },
            workspace: {
              select: {
                members: {
                  orderBy: { joinedAt: "asc" },
                  select: { userId: true, role: true },
                },
              },
            },
          },
        },
      },
    })

    if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 })

    if (!form.isPublic) {
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }

      const { allowed } = await checkProjectAccess(userId, form.projectId, ["MEMBER"])
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const fallbackCreatorId =
      userId ??
      form.project.members.find((member) => member.role === "LEAD")?.userId ??
      form.project.members[0]?.userId ??
      form.project.workspace.members.find((member) => member.role === "OWNER" || member.role === "ADMIN")?.userId ??
      form.project.workspace.members[0]?.userId

    if (!fallbackCreatorId) {
      return NextResponse.json({ error: "Form cannot create tasks because the project has no creator fallback" }, { status: 400 })
    }

    const fields = Array.isArray(form.fields) ? (form.fields as unknown as IntakeFormField[]) : []
    const visibleFields = getVisibleFields(fields, data)
    const requiredMissing = visibleFields.find((field) => {
      const value = getFieldValue(data, field)
      const uploadedFile = field.type === "file" ? files.find((item) => item.fieldId === field.id) : null
      if (field.required && field.type === "file") return !uploadedFile
      return field.required && (
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      )
    })

    if (requiredMissing) {
      return NextResponse.json({ error: `${requiredMissing.name} is required` }, { status: 400 })
    }

    const mappedTitleField = visibleFields.find((field) => field.mapping?.target === "task_title")
    const mappedDueDateField = visibleFields.find((field) => field.mapping?.target === "task_due_date")
    const mappedStatusField = visibleFields.find((field) => field.mapping?.target === "task_status")
    const mappedPriorityField = visibleFields.find((field) => field.mapping?.target === "task_priority")
    const mappedTaskListField = visibleFields.find((field) => field.mapping?.target === "task_list")

    const mappedTaskListValue = mappedTaskListField ? normalizeText(getFieldValue(data, mappedTaskListField)) : ""
    const taskList =
      form.project.taskLists.find((list) => list.id === mappedTaskListValue) ??
      form.project.taskLists.find((list) => list.name.toLowerCase() === mappedTaskListValue.toLowerCase()) ??
      form.project.taskLists[0]

    const validTaskListIds = new Set(form.project.taskLists.map((list) => list.id))
    const validProjectMemberIds = new Set(form.project.members.map((member) => member.userId))
    let routedTaskList = taskList
    const routedAssigneeIds = new Set<string>()

    for (const field of visibleFields) {
      for (const rule of field.routingRules ?? []) {
        if (!evaluateRoutingRule(rule, field, data)) continue

        if (rule.action === "set_task_list" && rule.targetTaskListId && validTaskListIds.has(rule.targetTaskListId)) {
          routedTaskList = form.project.taskLists.find((list) => list.id === rule.targetTaskListId) ?? routedTaskList
        }

        if (rule.action === "assign_user") {
          for (const targetUserId of getRoutingTargetUserIds(rule)) {
            if (validProjectMemberIds.has(targetUserId)) {
              routedAssigneeIds.add(targetUserId)
            }
          }
        }
      }
    }

    if (!routedTaskList) {
      return NextResponse.json({ error: "Project has no task list to create task in" }, { status: 400 })
    }

    const title = normalizeText(mappedTitleField ? getFieldValue(data, mappedTitleField) : "")
    if (!title) {
      return NextResponse.json({ error: "Task title is required" }, { status: 400 })
    }

    const descriptionFromField = buildTaskDescriptionFromFields(visibleFields, data)
    const summary = buildSubmissionSummary(visibleFields, data)
    const taskDescription = [descriptionFromField, summary ? `Submitted via form "${form.name}"\n\n${summary}` : ""]
      .filter(Boolean)
      .join("\n\n")

    const dueDateValue = mappedDueDateField ? normalizeText(getFieldValue(data, mappedDueDateField)) : ""
    const dueDate = dueDateValue ? new Date(dueDateValue) : null
    if (dueDateValue && Number.isNaN(dueDate?.getTime())) {
      return NextResponse.json({ error: "Invalid due date" }, { status: 400 })
    }
    const status = mappedStatusField
      ? normalizeEnumValue(getFieldValue(data, mappedStatusField), TASK_STATUSES)
      : undefined
    const priority = mappedPriorityField
      ? normalizeEnumValue(getFieldValue(data, mappedPriorityField), TASK_PRIORITIES)
      : undefined

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title,
          description: taskDescription || null,
          ...(status ? { status: status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED" } : {}),
          ...(priority ? { priority: priority as "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE" } : {}),
          ...(dueDate ? { dueDate } : {}),
          taskListId: routedTaskList.id,
          creatorId: fallbackCreatorId,
          assignees: routedAssigneeIds.size > 0
            ? {
                create: Array.from(routedAssigneeIds).map((uid) => ({ userId: uid })),
              }
            : undefined,
        },
      })

      const customFieldValues = visibleFields
        .filter((field) => field.mapping?.target === "custom_field" && field.mapping.customFieldId)
        .map((field) => {
          const customField = form.project.customFields.find((item) => item.id === field.mapping?.customFieldId)
          const type = normalizeCustomFieldType(customField?.type)
          if (!customField || !type) return null

          const coercedValue = coerceCustomFieldValueForType(type, getFieldValue(data, field), task.createdAt)
          return {
            customFieldId: customField.id,
            taskId: task.id,
            value: serializeCustomFieldValue(type, coercedValue, task.createdAt),
          }
        })
        .filter((value): value is { customFieldId: string; taskId: string; value: string } => Boolean(value))

      if (customFieldValues.length > 0) {
        await tx.customFieldValue.createMany({
          data: customFieldValues,
          skipDuplicates: true,
        })
      }

      const submission = await tx.formSubmission.create({
        data: {
          data: data as InputJsonValue,
          formId,
          taskId: task.id,
          submitterId: userId,
        },
      })

      return { submission, task }
    })

    const attachments = await createTaskAttachments(files, result.task.id, fallbackCreatorId)

    logAudit({ action: "create", entityType: "formSubmission", entityId: result.submission.id, entityName: form.name, userId: fallbackCreatorId, request, metadata: { formId, taskId: result.task.id } })

    for (const attachment of attachments) {
      logAudit({
        action: "create",
        entityType: "attachment",
        entityId: attachment.id,
        entityName: attachment.filename,
        userId: fallbackCreatorId,
        request,
        metadata: { taskId: result.task.id, source: "form", mimeType: attachment.mimeType, size: attachment.size },
      })
    }

    await prisma.activityLog.create({
      data: {
        action: "created task from form",
        details: `Created "${result.task.title}" from form "${form.name}"`,
        userId: fallbackCreatorId,
        taskId: result.task.id,
        projectId: form.projectId,
      },
    })

    executeAutomations(form.projectId, "task_created", {
      taskId: result.task.id,
      userId: fallbackCreatorId,
      projectId: form.projectId,
      assigneeIds: Array.from(routedAssigneeIds),
    }).catch(() => {})

    dispatchWebhookEvent("task.created", {
      taskId: result.task.id,
      title: result.task.title,
      status: result.task.status,
      priority: result.task.priority,
      taskListId: result.task.taskListId,
      creatorId: fallbackCreatorId,
      source: "form",
      formId,
      attachmentCount: attachments.length,
    }, form.projectId).catch(() => {})

    emitTaskCreated(form.projectId, JSON.parse(JSON.stringify(result.task)))

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Error submitting form:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
