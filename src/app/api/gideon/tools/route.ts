export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateGideonService } from '@/lib/gideon-service-auth'
import { notifyCommentAdded, notifyTaskAssigned, notifyTaskCompleted } from '@/lib/notification-service'
import { normalizeCustomFieldNumberInput, normalizeCustomFieldOptions, normalizeCustomFieldType, serializeCustomFieldValue } from '@/lib/custom-fields'
import type { Prisma, ProjectStatus, TaskPriority, TaskStatus, User } from '@/generated/prisma/client'

type GideonAction =
  | 'list_projects'
  | 'list_members'
  | 'list_tasks'
  | 'search_tasks'
  | 'get_project_summary'
  | 'create_task'
  | 'update_task'
  | 'add_task_comment'
  | 'list_custom_fields'

type ToolBody = {
  action?: GideonAction | string
  input?: Record<string, unknown>
}

const MAX_LIMIT = 100
const TASK_STATUSES = new Set(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'])
const TASK_PRIORITIES = new Set(['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'])
const STATUS_TO_LIST_NAMES: Record<string, string[]> = {
  TODO: ['To Do', 'Todo', 'Backlog'],
  IN_PROGRESS: ['In Progress', 'Doing'],
  IN_REVIEW: ['Review', 'In Review'],
  DONE: ['Done', 'DONE', 'Completed'],
}

function ok(data: unknown) {
  return NextResponse.json({ ok: true, data })
}

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const strings = value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
  return strings.length ? Array.from(new Set(strings)) : []
}

function asTaskStatus(value: unknown) {
  const status = asString(value)
  if (!status) return undefined
  if (!TASK_STATUSES.has(status)) throw new Error(`Invalid task status: ${status}`)
  return status as TaskStatus
}

function asTaskPriority(value: unknown) {
  const priority = asString(value)
  if (!priority) return undefined
  if (!TASK_PRIORITIES.has(priority)) throw new Error(`Invalid task priority: ${priority}`)
  return priority as TaskPriority
}

function asDate(value: unknown) {
  if (value === null) return null
  const raw = asString(value)
  if (!raw) return undefined
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${raw}`)
  return parsed
}

function asLimit(value: unknown, fallback = 50) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)))
}

function descriptionExcerpt(description?: string | null) {
  if (!description) return null
  return description.length > 280 ? `${description.slice(0, 277)}...` : description
}

function actorScopedProjectWhere(actor: Pick<User, 'id' | 'role'>, input: Record<string, unknown>) {
  const where: Prisma.ProjectWhereInput = {}
  const workspaceId = asString(input.workspaceId)
  const status = asString(input.status) as ProjectStatus | undefined

  if (workspaceId) where.workspaceId = workspaceId
  if (status) where.status = status

  if (actor.role !== 'ADMIN') {
    where.OR = [
      { members: { some: { userId: actor.id } } },
      { workspace: { members: { some: { userId: actor.id, role: { in: ['OWNER', 'ADMIN'] } } } } },
    ]
  }

  return where
}

function actorScopedTaskWhere(actor: Pick<User, 'id' | 'role'>, input: Record<string, unknown>) {
  const where: Prisma.TaskWhereInput = {}
  const taskListWhere: Prisma.TaskListWhereInput = {}
  const projectId = asString(input.projectId)
  const status = asString(input.status) as TaskStatus | undefined
  const priority = asString(input.priority) as TaskPriority | undefined
  const assigneeId = asString(input.assigneeId)

  if (projectId) taskListWhere.projectId = projectId
  if (status) where.status = status
  if (priority) where.priority = priority
  if (assigneeId) where.assignees = { some: { userId: assigneeId } }

  if (actor.role !== 'ADMIN') {
    taskListWhere.project = {
      OR: [
        { members: { some: { userId: actor.id } } },
        { workspace: { members: { some: { userId: actor.id, role: { in: ['OWNER', 'ADMIN'] } } } } },
      ],
    }
  }

  if (Object.keys(taskListWhere).length > 0) where.taskList = taskListWhere

  return where
}

const projectInclude = {
  workspace: { select: { id: true, name: true, slug: true } },
  members: {
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, avatar: true } },
    },
    orderBy: { joinedAt: 'asc' as const },
  },
  taskLists: {
    select: { id: true, name: true, position: true, _count: { select: { tasks: true } } },
    orderBy: { position: 'asc' as const },
  },
}

const taskInclude = {
  taskList: {
    select: {
      id: true,
      name: true,
      projectId: true,
      project: { select: { id: true, name: true, status: true } },
    },
  },
  assignees: {
    select: { user: { select: { id: true, name: true, email: true, avatar: true } } },
  },
  creator: { select: { id: true, name: true, email: true } },
  customFieldValues: {
    select: {
      id: true,
      customFieldId: true,
      value: true,
      customField: { select: { id: true, name: true, type: true, options: true, position: true } },
    },
    orderBy: { customField: { position: 'asc' as const } },
  },
}

function serializeProject(project: any) {
  const taskLists = project.taskLists.map((list: any) => ({
    id: list.id,
    name: list.name,
    position: list.position,
    taskCount: list._count.tasks,
  }))

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    color: project.color,
    icon: project.icon,
    workspace: project.workspace,
    members: project.members,
    taskLists,
    taskCount: taskLists.reduce((sum: number, list: { taskCount: number }) => sum + list.taskCount, 0),
  }
}

function serializeTask(task: any) {
  return {
    id: task.id,
    title: task.title,
    description: descriptionExcerpt(task.description),
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    tags: task.tags,
    project: task.project || task.taskList?.project || null,
    taskList: task.taskList ? { id: task.taskList.id, name: task.taskList.name, projectId: task.taskList.projectId } : null,
    assignees: task.assignees.map((entry: any) => entry.user),
    creator: task.creator,
    customFields: (task.customFieldValues || []).map((entry: any) => ({
      id: entry.id,
      customFieldId: entry.customFieldId,
      name: entry.customField?.name,
      type: entry.customField?.type,
      options: entry.customField?.options,
      value: entry.value,
    })),
  }
}

async function listProjects(actor: User, input: Record<string, unknown>) {
  const projects = await prisma.project.findMany({
    where: actorScopedProjectWhere(actor, input),
    include: projectInclude,
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    take: MAX_LIMIT,
  })

  return projects.map(serializeProject)
}

async function listMembers(actor: User, input: Record<string, unknown>) {
  const workspaceId = asString(input.workspaceId)
  const projectId = asString(input.projectId)

  if (projectId) {
    const members = await prisma.projectMember.findMany({
      where: {
        projectId,
        ...(actor.role === 'ADMIN'
          ? {}
          : {
              project: {
                OR: [
                  { members: { some: { userId: actor.id } } },
                  { workspace: { members: { some: { userId: actor.id, role: { in: ['OWNER', 'ADMIN'] } } } } },
                ],
              },
            }),
      },
      select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } },
      orderBy: { joinedAt: 'asc' },
      take: MAX_LIMIT,
    })
    return members
  }

  const members = await prisma.workspaceMember.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      ...(actor.role === 'ADMIN' ? {} : { workspace: { members: { some: { userId: actor.id, role: { in: ['OWNER', 'ADMIN'] } } } } }),
    },
    select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } }, workspace: { select: { id: true, name: true, slug: true } } },
    orderBy: { joinedAt: 'asc' },
    take: MAX_LIMIT,
  })
  return members
}

async function listTasks(actor: User, input: Record<string, unknown>) {
  const tasks = await prisma.task.findMany({
    where: actorScopedTaskWhere(actor, input),
    include: taskInclude,
    orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
    take: asLimit(input.limit),
  })

  return tasks.map(serializeTask)
}

async function searchTasks(actor: User, input: Record<string, unknown>) {
  const query = asString(input.query)
  if (!query) throw new Error('query is required')

  const baseWhere = actorScopedTaskWhere(actor, input)
  const tasks = await prisma.task.findMany({
    where: {
      ...baseWhere,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: taskInclude,
    orderBy: [{ updatedAt: 'desc' }],
    take: asLimit(input.limit),
  })

  return tasks.map(serializeTask)
}

async function getProjectSummary(actor: User, input: Record<string, unknown>) {
  const projectId = asString(input.projectId)
  if (!projectId) throw new Error('projectId is required')

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
      ...(actor.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { members: { some: { userId: actor.id } } },
              { workspace: { members: { some: { userId: actor.id, role: { in: ['OWNER', 'ADMIN'] } } } } },
            ],
          }),
    },
    select: {
      id: true,
      name: true,
      status: true,
      workspace: { select: { id: true, name: true, slug: true } },
      members: { select: { role: true, user: { select: { id: true, name: true, email: true, avatar: true } } } },
    },
  })

  if (!project) throw new Error('Project not found or not accessible')

  const taskWhere = { taskList: { projectId } }
  const [totalTasks, completedTasks, byStatusRows, byPriorityRows] = await Promise.all([
    prisma.task.count({ where: taskWhere }),
    prisma.task.count({ where: { ...taskWhere, status: 'DONE' } }),
    prisma.task.groupBy({ by: ['status'], where: taskWhere, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['priority'], where: taskWhere, _count: { _all: true } }),
  ])

  const byStatus = Object.fromEntries(byStatusRows.map((row) => [row.status, row._count._all]))
  const byPriority = Object.fromEntries(byPriorityRows.map((row) => [row.priority, row._count._all]))

  return {
    project,
    totalTasks,
    completedTasks,
    progressPercent: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    byStatus,
    byPriority,
  }
}

async function getAccessibleProject(actor: User, projectId: string) {
  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
      ...(actor.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { members: { some: { userId: actor.id } } },
              { workspace: { members: { some: { userId: actor.id, role: { in: ['OWNER', 'ADMIN'] } } } } },
            ],
          }),
    },
    select: { id: true, name: true, status: true },
  })
  if (!project) throw new Error('Project not found or not accessible')
  return project
}

async function getAccessibleTask(actor: User, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...actorScopedTaskWhere(actor, {}) },
    include: taskInclude,
  })
  if (!task) throw new Error('Task not found or not accessible')
  return task
}

async function resolveTaskList(actor: User, input: Record<string, unknown>, status?: TaskStatus) {
  const taskListId = asString(input.taskListId)
  const projectId = asString(input.projectId)

  if (taskListId) {
    const taskList = await prisma.taskList.findFirst({
      where: {
        id: taskListId,
        ...(projectId ? { projectId } : {}),
        ...(actor.role === 'ADMIN'
          ? {}
          : {
              project: {
                OR: [
                  { members: { some: { userId: actor.id } } },
                  { workspace: { members: { some: { userId: actor.id, role: { in: ['OWNER', 'ADMIN'] } } } } },
                ],
              },
            }),
      },
      select: { id: true, name: true, projectId: true, project: { select: { id: true, name: true, status: true } } },
    })
    if (!taskList) throw new Error('Task list not found or not accessible')
    return taskList
  }

  if (!projectId) throw new Error('projectId or taskListId is required')
  await getAccessibleProject(actor, projectId)

  const preferredNames = status ? STATUS_TO_LIST_NAMES[status] || [] : []
  for (const name of preferredNames) {
    const taskList = await prisma.taskList.findFirst({
      where: { projectId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, projectId: true, project: { select: { id: true, name: true, status: true } } },
    })
    if (taskList) return taskList
  }

  const fallback = await prisma.taskList.findFirst({
    where: { projectId },
    orderBy: { position: 'asc' },
    select: { id: true, name: true, projectId: true, project: { select: { id: true, name: true, status: true } } },
  })
  if (!fallback) throw new Error('No task list found for project')
  return fallback
}

async function listCustomFields(actor: User, input: Record<string, unknown>) {
  const projectId = asString(input.projectId)
  if (!projectId) throw new Error('projectId is required')
  await getAccessibleProject(actor, projectId)

  return prisma.customField.findMany({
    where: { projectId },
    select: { id: true, name: true, type: true, options: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
}

function asCustomFieldInputs(value: unknown): Array<{ fieldId?: string; name?: string; value: unknown }> {
  if (!Array.isArray(value)) return []
  const inputs: Array<{ fieldId?: string; name?: string; value: unknown }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const fieldId = asString(record.fieldId || record.customFieldId)
    const name = asString(record.name || record.fieldName)
    if (!fieldId && !name) continue
    inputs.push({ fieldId, name, value: record.value })
  }
  return inputs
}

async function resolveCustomFieldUpdates(actor: User, projectId: string, input: Record<string, unknown>) {
  const requested = asCustomFieldInputs(input.customFields)
  if (requested.length === 0) return []
  await getAccessibleProject(actor, projectId)

  const fields = await prisma.customField.findMany({
    where: { projectId },
    select: { id: true, name: true, type: true, options: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })

  return requested.map((request) => {
    const field = request.fieldId
      ? fields.find((candidate) => candidate.id === request.fieldId)
      : fields.find((candidate) => candidate.name.toLowerCase() === request.name?.toLowerCase())
    if (!field) throw new Error(`Custom field not found: ${request.fieldId || request.name}`)

    const normalizedType = normalizeCustomFieldType(field.type)
    if (!normalizedType) throw new Error(`Unsupported custom field type for ${field.name}: ${field.type}`)

    const options = normalizeCustomFieldOptions(normalizedType, field.options)
    const rawValue = normalizedType === 'NUMBER'
      ? normalizeCustomFieldNumberInput(String(request.value ?? ''), options)
      : request.value

    return {
      customFieldId: field.id,
      name: field.name,
      value: serializeCustomFieldValue(normalizedType, rawValue),
    }
  })
}

async function seedTaskCustomFieldDefaults(tx: Prisma.TransactionClient, taskId: string, projectId: string, taskCreatedAt?: Date | string | null) {
  const customFields = await tx.customField.findMany({
    where: { projectId },
    select: { id: true, type: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  })
  if (customFields.length === 0) return

  const valuesToCreate = customFields
    .map((field) => {
      const normalizedType = normalizeCustomFieldType(field.type)
      if (!normalizedType) return null
      return {
        customFieldId: field.id,
        taskId,
        value: serializeCustomFieldValue(normalizedType, undefined, taskCreatedAt),
      }
    })
    .filter((value): value is { customFieldId: string; taskId: string; value: string } => Boolean(value))

  if (valuesToCreate.length > 0) {
    await tx.customFieldValue.createMany({ data: valuesToCreate, skipDuplicates: true })
  }
}

async function applyCustomFieldUpdates(tx: Prisma.TransactionClient, taskId: string, updates: Array<{ customFieldId: string; value: string }>) {
  for (const update of updates) {
    await tx.customFieldValue.upsert({
      where: { customFieldId_taskId: { customFieldId: update.customFieldId, taskId } },
      update: { value: update.value },
      create: { customFieldId: update.customFieldId, taskId, value: update.value },
    })
  }
}

async function createTask(actor: User, input: Record<string, unknown>) {
  const title = asString(input.title)
  if (!title) throw new Error('title is required')
  const status = asTaskStatus(input.status) || 'TODO'
  const priority = asTaskPriority(input.priority) || 'MEDIUM'
  const dueDate = asDate(input.dueDate)
  const assigneeIds = asStringArray(input.assigneeIds)
  const taskList = await resolveTaskList(actor, input, status)
  const customFieldUpdates = await resolveCustomFieldUpdates(actor, taskList.projectId, input)

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        title,
        description: asString(input.description) || null,
        status,
        priority,
        dueDate: dueDate === undefined ? null : dueDate,
        taskListId: taskList.id,
        creatorId: actor.id,
        ...(assigneeIds ? { assignees: { create: assigneeIds.map((userId) => ({ userId })) } } : {}),
      },
      include: taskInclude,
    })

    await seedTaskCustomFieldDefaults(tx, created.id, taskList.projectId, created.createdAt)
    await applyCustomFieldUpdates(tx, created.id, customFieldUpdates)

    await tx.activityLog.create({
      data: {
        action: 'GIDEON_TASK_CREATED',
        details: `GIDEON created task: ${created.title}`,
        userId: actor.id,
        taskId: created.id,
        projectId: taskList.projectId,
      },
    })

    return created
  })

  if (assigneeIds) {
    await Promise.all(assigneeIds.map((assigneeId) =>
      notifyTaskAssigned({
        assigneeId,
        taskId: task.id,
        taskTitle: task.title,
        projectName: taskList.project.name,
        projectId: taskList.projectId,
        assignedByName: actor.name,
      })
    ))
  }

  const verified = await prisma.task.findUnique({ where: { id: task.id }, include: taskInclude })
  return serializeTask(verified || task)
}

async function updateTask(actor: User, input: Record<string, unknown>) {
  const taskId = asString(input.taskId)
  if (!taskId) throw new Error('taskId is required')
  const existing = await getAccessibleTask(actor, taskId)

  const data: Prisma.TaskUpdateInput = {}
  const title = asString(input.title)
  const description = input.description === null ? null : asString(input.description)
  const status = asTaskStatus(input.status)
  const priority = asTaskPriority(input.priority)
  const dueDate = asDate(input.dueDate)
  const taskListId = asString(input.taskListId)
  const assigneeIds = asStringArray(input.assigneeIds)
  const customFieldUpdates = await resolveCustomFieldUpdates(actor, existing.taskList.projectId, input)

  if (title) data.title = title
  if (input.description === null || description !== undefined) data.description = description || null
  if (status) data.status = status
  if (priority) data.priority = priority
  if (dueDate !== undefined) data.dueDate = dueDate
  if (taskListId) {
    const targetList = await resolveTaskList(actor, { taskListId }, status)
    data.taskList = { connect: { id: targetList.id } }
  }

  if (Object.keys(data).length === 0 && assigneeIds === undefined && customFieldUpdates.length === 0) throw new Error('No update fields provided')

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.task.update({ where: { id: taskId }, data })
    }
    if (assigneeIds !== undefined) {
      await tx.taskAssignee.deleteMany({ where: { taskId } })
      if (assigneeIds.length > 0) await tx.taskAssignee.createMany({ data: assigneeIds.map((userId) => ({ taskId, userId })), skipDuplicates: true })
    }
    await applyCustomFieldUpdates(tx, taskId, customFieldUpdates)
    await tx.activityLog.create({
      data: {
        action: 'GIDEON_TASK_UPDATED',
        details: `GIDEON updated task: ${existing.title}`,
        userId: actor.id,
        taskId,
        projectId: existing.taskList?.projectId,
      },
    })
  })

  const verified = await prisma.task.findUnique({ where: { id: taskId }, include: taskInclude })
  if (!verified) throw new Error('Task update verification failed')

  const newAssigneeIds = assigneeIds ? assigneeIds.filter((id) => !existing.assignees.some((entry: any) => entry.user.id === id)) : []
  await Promise.all(newAssigneeIds.map((assigneeId) =>
    notifyTaskAssigned({
      assigneeId,
      taskId: verified.id,
      taskTitle: verified.title,
      projectName: verified.taskList.project.name,
      projectId: verified.taskList.projectId,
      assignedByName: actor.name,
    })
  ))

  if (status === 'DONE' && existing.status !== 'DONE') {
    await notifyTaskCompleted({
      taskId: verified.id,
      taskTitle: verified.title,
      projectId: verified.taskList.projectId,
      projectName: verified.taskList.project.name,
      completedByName: actor.name,
      completedById: actor.id,
    })
  }

  return serializeTask(verified)
}

async function addTaskComment(actor: User, input: Record<string, unknown>) {
  const taskId = asString(input.taskId)
  const content = asString(input.content)
  if (!taskId) throw new Error('taskId is required')
  if (!content) throw new Error('content is required')
  const task = await getAccessibleTask(actor, taskId)

  const comment = await prisma.comment.create({
    data: { taskId, userId: actor.id, content },
    select: { id: true, content: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
  })

  await prisma.activityLog.create({
    data: {
      action: 'GIDEON_COMMENT_ADDED',
      details: `GIDEON commented on task: ${task.title}`,
      userId: actor.id,
      taskId,
      projectId: task.taskList?.projectId,
    },
  })

  await notifyCommentAdded({
    taskId,
    taskTitle: task.title,
    projectId: task.taskList.projectId,
    commentByName: actor.name,
    commentById: actor.id,
    commentSnippet: content.slice(0, 180),
  })

  return { task: serializeTask(task), comment }
}

export async function POST(req: Request) {
  const auth = await authenticateGideonService(req)
  if (!auth.ok) return auth.response

  let body: ToolBody
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON body')
  }

  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}

  try {
    switch (body.action) {
      case 'list_projects':
        return ok(await listProjects(auth.actor, input))
      case 'list_members':
        return ok(await listMembers(auth.actor, input))
      case 'list_tasks':
        return ok(await listTasks(auth.actor, input))
      case 'search_tasks':
        return ok(await searchTasks(auth.actor, input))
      case 'get_project_summary':
        return ok(await getProjectSummary(auth.actor, input))
      case 'list_custom_fields':
        return ok(await listCustomFields(auth.actor, input))
      case 'create_task':
        return ok(await createTask(auth.actor, input))
      case 'update_task':
        return ok(await updateTask(auth.actor, input))
      case 'add_task_comment':
        return ok(await addTaskComment(auth.actor, input))
      default:
        return error(`Unknown GIDEON tool action: ${body.action}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'NEXUS GIDEON tool failed'
    return error(message, 400)
  }
}
