import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { TaskStatus, TaskPriority } from '@/generated/prisma/enums'

const SYSTEM_PROMPT = `You are GIDEON (Global Intelligence Data Enterprise Operational Network), Strategic Operations AI for PATS Group. You have full access to NEXUS — the PATS project management platform. You can create tasks, update status, assign people, create goals, summarize projects, track time, and manage sprints. Tone: casual but sharp, like a genius co-worker. Never use filler phrases.`

const MODEL_MAP: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
}

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task in a project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        project_id: { type: 'string', description: 'Project ID' },
        priority: { type: 'string', enum: ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] },
        status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] },
        due_date: { type: 'string', description: 'Due date ISO format' },
        assignee_ids: { type: 'array', items: { type: 'string' }, description: 'User IDs to assign' },
      },
      required: ['title', 'project_id'],
    },
  },
  {
    name: 'update_task_status',
    description: 'Update the status of an existing task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'assign_task',
    description: 'Assign users to a task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' },
        user_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['task_id', 'user_ids'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks with optional filters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: { type: 'string' },
        status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] },
        assigned_to_me: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'list_projects',
    description: 'List all projects.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks by keyword in title or description.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_project_summary',
    description: 'Get project summary with task counts by status and team members.',
    input_schema: {
      type: 'object' as const,
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },
  {
    name: 'create_goal',
    description: 'Create a new goal/OKR.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        due_date: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_goals',
    description: 'List all goals.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_sprints',
    description: 'List sprints for a project.',
    input_schema: {
      type: 'object' as const,
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },
]

interface ToolInput {
  title?: string
  description?: string
  project_id?: string
  priority?: string
  status?: string
  due_date?: string
  assignee_ids?: string[]
  task_id?: string
  user_ids?: string[]
  assigned_to_me?: boolean
  query?: string
}

async function executeToolCall(
  toolName: string,
  input: ToolInput,
  userId: string
): Promise<{ success: boolean; data: unknown }> {
  switch (toolName) {
    case 'create_task': {
      const taskList = await prisma.taskList.findFirst({
        where: { projectId: input.project_id },
        orderBy: { position: 'asc' },
      })
      if (!taskList) return { success: false, data: { error: 'No task list found' } }

      const statusToListName: Record<string, string> = { TODO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'Review', DONE: 'Done' }
      let targetList = taskList
      if (input.status && statusToListName[input.status]) {
        const matched = await prisma.taskList.findFirst({ where: { projectId: input.project_id, name: statusToListName[input.status] } })
        if (matched) targetList = matched
      }

      const task = await prisma.task.create({
        data: {
          title: input.title!,
          description: input.description || null,
          status: (input.status as TaskStatus) || 'TODO',
          priority: (input.priority as TaskPriority) || 'MEDIUM',
          dueDate: input.due_date ? new Date(input.due_date) : null,
          taskListId: targetList.id,
          creatorId: userId,
          assignees: input.assignee_ids ? { create: input.assignee_ids.map((id) => ({ userId: id })) } : undefined,
        },
        include: { assignees: { include: { user: { select: { id: true, name: true } } } }, taskList: { select: { name: true } } },
      })

      await prisma.activityLog.create({ data: { action: 'TASK_CREATED', details: `Created task: ${task.title}`, userId, taskId: task.id, projectId: input.project_id! } })

      return { success: true, data: { id: task.id, title: task.title, status: task.status, priority: task.priority, taskList: task.taskList.name, assignees: task.assignees.map((a) => a.user.name) } }
    }

    case 'update_task_status': {
      const task = await prisma.task.update({ where: { id: input.task_id }, data: { status: input.status as TaskStatus }, select: { id: true, title: true, status: true } })
      await prisma.activityLog.create({ data: { action: 'TASK_STATUS_UPDATED', details: `Updated "${task.title}" to ${task.status}`, userId, taskId: task.id } })
      return { success: true, data: task }
    }

    case 'assign_task': {
      const existing = await prisma.taskAssignee.findMany({ where: { taskId: input.task_id }, select: { userId: true } })
      const existingIds = new Set(existing.map((a) => a.userId))
      const newIds = (input.user_ids || []).filter((id) => !existingIds.has(id))
      if (newIds.length > 0) await prisma.taskAssignee.createMany({ data: newIds.map((uid) => ({ taskId: input.task_id!, userId: uid })) })
      const task = await prisma.task.findUnique({ where: { id: input.task_id }, select: { id: true, title: true, assignees: { include: { user: { select: { id: true, name: true } } } } } })
      return { success: true, data: { id: task?.id, title: task?.title, assignees: task?.assignees.map((a) => a.user.name) } }
    }

    case 'list_tasks': {
      const where: Record<string, unknown> = {}
      if (input.project_id) where.taskList = { projectId: input.project_id }
      if (input.status) where.status = input.status
      if (input.assigned_to_me) where.assignees = { some: { userId } }
      const tasks = await prisma.task.findMany({ where, select: { id: true, title: true, status: true, priority: true, dueDate: true, assignees: { include: { user: { select: { name: true } } } }, taskList: { select: { name: true, project: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 50 })
      return { success: true, data: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, assignees: t.assignees.map((a) => a.user.name), project: t.taskList.project.name, list: t.taskList.name })) }
    }

    case 'list_projects': {
      const projects = await prisma.project.findMany({ select: { id: true, name: true, description: true, status: true, members: { include: { user: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' } })
      return { success: true, data: projects.map((p) => ({ id: p.id, name: p.name, description: p.description, status: p.status, members: p.members.map((m) => m.user.name) })) }
    }

    case 'search_tasks': {
      const tasks = await prisma.task.findMany({
        where: { OR: [{ title: { contains: input.query, mode: 'insensitive' } }, { description: { contains: input.query, mode: 'insensitive' } }] },
        select: { id: true, title: true, status: true, priority: true, dueDate: true, taskList: { select: { project: { select: { name: true } } } } },
        take: 20,
      })
      return { success: true, data: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, project: t.taskList.project.name })) }
    }

    case 'get_project_summary': {
      const project = await prisma.project.findUnique({
        where: { id: input.project_id },
        include: { members: { include: { user: { select: { name: true } } } }, taskLists: { include: { tasks: { select: { status: true, priority: true } } } } },
      })
      if (!project) return { success: false, data: { error: 'Project not found' } }
      const allTasks = project.taskLists.flatMap((tl) => tl.tasks)
      return {
        success: true,
        data: {
          name: project.name, description: project.description,
          members: project.members.map((m) => m.user.name),
          totalTasks: allTasks.length,
          byStatus: { todo: allTasks.filter((t) => t.status === 'TODO').length, inProgress: allTasks.filter((t) => t.status === 'IN_PROGRESS').length, inReview: allTasks.filter((t) => t.status === 'IN_REVIEW').length, done: allTasks.filter((t) => t.status === 'DONE').length },
          progress: allTasks.length > 0 ? Math.round((allTasks.filter((t) => t.status === 'DONE').length / allTasks.length) * 100) : 0,
        },
      }
    }

    case 'create_goal': {
      const workspace = await prisma.workspace.findFirst({ where: { members: { some: { userId } } } })
      if (!workspace) return { success: false, data: { error: 'No workspace' } }
      const goal = await prisma.goal.create({ data: { title: input.title!, description: input.description || null, dueDate: input.due_date ? new Date(input.due_date) : null, workspaceId: workspace.id, ownerId: userId } })
      return { success: true, data: { id: goal.id, title: goal.title, status: goal.status } }
    }

    case 'list_goals': {
      const goals = await prisma.goal.findMany({ include: { owner: { select: { name: true } }, milestones: true }, orderBy: { createdAt: 'desc' }, take: 20 })
      return { success: true, data: goals.map((g) => ({ id: g.id, title: g.title, status: g.status, progress: g.progress, owner: g.owner.name, milestones: g.milestones.length })) }
    }

    case 'list_sprints': {
      const sprints = await prisma.sprint.findMany({ where: { projectId: input.project_id }, include: { tasks: { include: { task: { select: { status: true } } } } }, orderBy: { startDate: 'desc' } })
      return { success: true, data: sprints.map((s) => ({ id: s.id, name: s.name, status: s.status, startDate: s.startDate, endDate: s.endDate, taskCount: s.tasks.length, completedTasks: s.tasks.filter((t) => t.task.status === 'DONE').length })) }
    }

    default:
      return { success: false, data: { error: `Unknown tool: ${toolName}` } }
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const { messages, model = 'sonnet' } = await req.json()
  const anthropicModel = MODEL_MAP[model] || MODEL_MAP.sonnet
  const client = new Anthropic()

  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const sendEvent = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  ;(async () => {
    try {
      let currentMessages = messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

      let continueLoop = true

      while (continueLoop) {
        continueLoop = false

        const response = client.messages.stream({
          model: anthropicModel,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: currentMessages,
          tools: TOOLS,
        })

        const finalMessage = await response.finalMessage()
        let hasToolUse = false

        for (const block of finalMessage.content) {
          if (block.type === 'text') {
            await sendEvent({ type: 'text', content: block.text })
          } else if (block.type === 'tool_use') {
            hasToolUse = true
            const result = await executeToolCall(block.name, block.input as ToolInput, session.user!.id!)
            await sendEvent({ type: 'tool_result', tool: block.name, result: result.data })

            currentMessages = [
              ...currentMessages,
              { role: 'assistant' as const, content: finalMessage.content },
              { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result.data) }] },
            ]

            continueLoop = true
          }
        }

        if (hasToolUse && finalMessage.stop_reason === 'end_turn') {
          continueLoop = false
        }
      }

      await sendEvent({ type: 'done' })
    } catch (error) {
      console.error('GIDEON API error:', error)
      await sendEvent({ type: 'error', content: 'An error occurred while processing your request.' })
    } finally {
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}
