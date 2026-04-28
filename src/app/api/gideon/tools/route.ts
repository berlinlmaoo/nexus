import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { authenticateGideonService } from '@/lib/gideon-service-auth'
import type { Prisma, ProjectStatus, TaskPriority, TaskStatus, User } from '@/generated/prisma/client'

type GideonAction =
  | 'list_projects'
  | 'list_members'
  | 'list_tasks'
  | 'search_tasks'
  | 'get_project_summary'

type ToolBody = {
  action?: GideonAction | string
  input?: Record<string, unknown>
}

const MAX_LIMIT = 100

function ok(data: unknown) {
  return NextResponse.json({ ok: true, data })
}

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
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
      default:
        return error(`Unknown GIDEON tool action: ${body.action}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'NEXUS GIDEON tool failed'
    return error(message, 400)
  }
}
