import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/gideon-service-auth', () => ({
  authenticateGideonService: vi.fn(),
}))

vi.mock('@/lib/notification-service', () => ({
  notifyTaskAssigned: vi.fn(),
  notifyTaskCompleted: vi.fn(),
  notifyCommentAdded: vi.fn(),
}))

const { mockTransaction } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const prismaMock = {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prismaMock)),
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
    },
    projectMember: {
      findMany: vi.fn(),
    },
    taskList: {
      findFirst: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    taskAssignee: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    comment: {
      create: vi.fn(),
    },
    customField: {
      findMany: vi.fn(),
    },
    customFieldValue: {
      createMany: vi.fn(),
      upsert: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
  }
  mockTransaction.mockImplementation(prismaMock.$transaction)
  return { default: prismaMock }
})

import prisma from '@/lib/prisma'
import { authenticateGideonService } from '@/lib/gideon-service-auth'
import { POST } from '@/app/api/gideon/tools/route'

const mockAuth = vi.mocked(authenticateGideonService)
const mockProjectFindMany = vi.mocked(prisma.project.findMany)
const mockProjectFindUnique = vi.mocked(prisma.project.findUnique)
const mockWorkspaceMemberFindMany = vi.mocked(prisma.workspaceMember.findMany)
const mockProjectMemberFindMany = vi.mocked(prisma.projectMember.findMany)
const mockTaskFindMany = vi.mocked(prisma.task.findMany)
const mockTaskFindFirst = vi.mocked(prisma.task.findFirst)
const mockTaskFindUnique = vi.mocked(prisma.task.findUnique)
const mockTaskCreate = vi.mocked(prisma.task.create)
const mockTaskUpdate = vi.mocked(prisma.task.update)
const mockTaskCount = vi.mocked(prisma.task.count)
const mockTaskGroupBy = vi.mocked(prisma.task.groupBy)
const mockTaskListFindFirst = vi.mocked(prisma.taskList.findFirst)
const mockTaskAssigneeDeleteMany = vi.mocked(prisma.taskAssignee.deleteMany)
const mockTaskAssigneeCreateMany = vi.mocked(prisma.taskAssignee.createMany)
const mockCommentCreate = vi.mocked(prisma.comment.create)
const mockCustomFieldFindMany = vi.mocked(prisma.customField.findMany)
const mockCustomFieldValueCreateMany = vi.mocked(prisma.customFieldValue.createMany)
const mockCustomFieldValueUpsert = vi.mocked(prisma.customFieldValue.upsert)
const mockActivityLogCreate = vi.mocked(prisma.activityLog.create)

function toolRequest(body: unknown) {
  return new Request('http://localhost/api/gideon/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>
}

describe('POST /api/gideon/tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({
      ok: true,
      actor: { id: 'actor-1', name: 'GIDEON', email: 'gideon@patsgroup.id', role: 'ADMIN' } as never,
    })
  })

  it('returns auth failure responses from the service auth helper', async () => {
    mockAuth.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) as never,
    })

    const response = await POST(toolRequest({ action: 'list_projects', input: {} }))

    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({ ok: false, error: 'Unauthorized' })
  })

  it('lists projects with compact task counts and members', async () => {
    mockProjectFindMany.mockResolvedValue([
      {
        id: 'project-1',
        name: 'Project One',
        description: 'Main project',
        status: 'ACTIVE',
        color: '#7B2FBE',
        icon: 'folder',
        workspace: { id: 'workspace-1', name: 'PATS', slug: 'pats' },
        members: [{ role: 'LEAD', user: { id: 'user-1', name: 'Berlin', email: 'berlin@example.com', avatar: null } }],
        taskLists: [{ id: 'list-1', name: 'Backlog', position: 0, _count: { tasks: 3 } }],
      },
    ] as never)

    const response = await POST(toolRequest({ action: 'list_projects', input: { status: 'ACTIVE' } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockProjectFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    expect(body).toEqual({
      ok: true,
      data: [
        {
          id: 'project-1',
          name: 'Project One',
          description: 'Main project',
          status: 'ACTIVE',
          color: '#7B2FBE',
          icon: 'folder',
          workspace: { id: 'workspace-1', name: 'PATS', slug: 'pats' },
          members: [{ role: 'LEAD', user: { id: 'user-1', name: 'Berlin', email: 'berlin@example.com', avatar: null } }],
          taskLists: [{ id: 'list-1', name: 'Backlog', position: 0, taskCount: 3 }],
          taskCount: 3,
        },
      ],
    })
  })

  it('searches tasks and caps user-supplied limits at 100', async () => {
    mockTaskFindMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Follow up supplier',
        description: 'Long enough description',
        status: 'TODO',
        priority: 'HIGH',
        dueDate: null,
        tags: ['ops'],
        project: { id: 'project-1', name: 'Ops', status: 'ACTIVE' },
        taskList: { id: 'list-1', name: 'Backlog' },
        assignees: [{ user: { id: 'user-1', name: 'Berlin', email: 'berlin@example.com', avatar: null } }],
        creator: { id: 'actor-1', name: 'GIDEON', email: 'gideon@patsgroup.id' },
      },
    ] as never)

    const response = await POST(toolRequest({ action: 'search_tasks', input: { query: 'supplier', limit: 500 } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    expect(body.ok).toBe(true)
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'task-1', title: 'Follow up supplier', assignees: [{ id: 'user-1', name: 'Berlin', email: 'berlin@example.com', avatar: null }] }),
    ])
  })

  it('returns a project summary with grouped status and priority counts', async () => {
    mockProjectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'Ops',
      status: 'ACTIVE',
      workspace: { id: 'workspace-1', name: 'PATS', slug: 'pats' },
      members: [{ role: 'LEAD', user: { id: 'user-1', name: 'Berlin', email: 'berlin@example.com', avatar: null } }],
    } as never)
    mockTaskCount.mockResolvedValueOnce(10 as never).mockResolvedValueOnce(4 as never)
    mockTaskGroupBy
      .mockResolvedValueOnce([{ status: 'TODO', _count: { _all: 6 } }, { status: 'DONE', _count: { _all: 4 } }] as never)
      .mockResolvedValueOnce([{ priority: 'HIGH', _count: { _all: 3 } }, { priority: 'LOW', _count: { _all: 7 } }] as never)

    const response = await POST(toolRequest({ action: 'get_project_summary', input: { projectId: 'project-1' } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: expect.objectContaining({
        project: expect.objectContaining({ id: 'project-1', name: 'Ops' }),
        totalTasks: 10,
        completedTasks: 4,
        progressPercent: 40,
        byStatus: { TODO: 6, DONE: 4 },
        byPriority: { HIGH: 3, LOW: 7 },
      }),
    })
  })

  it('creates tasks with task list resolution and read-back verification', async () => {
    const taskList = { id: 'list-1', name: 'Backlog', projectId: 'project-1', project: { id: 'project-1', name: 'Ops', status: 'ACTIVE' } }
    const createdTask = {
      id: 'task-1',
      title: 'New GIDEON task',
      description: null,
      status: 'TODO',
      priority: 'HIGH',
      dueDate: null,
      tags: [],
      taskList,
      assignees: [],
      creator: { id: 'actor-1', name: 'GIDEON', email: 'gideon@patsgroup.id' },
    }
    mockProjectFindUnique.mockResolvedValue({ id: 'project-1', name: 'Ops', status: 'ACTIVE' } as never)
    mockTaskListFindFirst.mockResolvedValue(taskList as never)
    mockTaskCreate.mockResolvedValue(createdTask as never)
    mockTaskFindUnique.mockResolvedValue(createdTask as never)
    mockCustomFieldFindMany.mockResolvedValue([] as never)
    mockCustomFieldValueCreateMany.mockResolvedValue({ count: 0 } as never)
    mockActivityLogCreate.mockResolvedValue({ id: 'log-1' } as never)

    const response = await POST(toolRequest({ action: 'create_task', input: { projectId: 'project-1', title: 'New GIDEON task', priority: 'HIGH' } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockTaskCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: 'New GIDEON task', priority: 'HIGH', taskListId: 'list-1' }) }))
    expect(mockTaskFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-1' } }))
    expect(body).toEqual({ ok: true, data: expect.objectContaining({ id: 'task-1', title: 'New GIDEON task' }) })
  })

  it('updates tasks in a transaction and verifies the updated task', async () => {
    const existingTask = {
      id: 'task-1',
      title: 'Do thing',
      description: null,
      status: 'TODO',
      priority: 'MEDIUM',
      dueDate: null,
      tags: [],
      taskList: { id: 'list-1', name: 'Backlog', projectId: 'project-1', project: { id: 'project-1', name: 'Ops', status: 'ACTIVE' } },
      assignees: [{ user: { id: 'user-1', name: 'Berlin', email: 'berlin@example.com', avatar: null } }],
      creator: { id: 'actor-1', name: 'GIDEON', email: 'gideon@patsgroup.id' },
    }
    const updatedTask = { ...existingTask, status: 'DONE', priority: 'HIGH' }
    mockTaskFindFirst.mockResolvedValue(existingTask as never)
    mockTaskUpdate.mockResolvedValue(updatedTask as never)
    mockTaskFindUnique.mockResolvedValue(updatedTask as never)
    mockTaskAssigneeDeleteMany.mockResolvedValue({ count: 1 } as never)
    mockTaskAssigneeCreateMany.mockResolvedValue({ count: 1 } as never)
    mockActivityLogCreate.mockResolvedValue({ id: 'log-1' } as never)

    const response = await POST(toolRequest({ action: 'update_task', input: { taskId: 'task-1', status: 'DONE', priority: 'HIGH', assigneeIds: ['user-1'] } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-1' }, data: expect.objectContaining({ status: 'DONE', priority: 'HIGH' }) }))
    expect(mockTaskAssigneeDeleteMany).toHaveBeenCalledWith({ where: { taskId: 'task-1' } })
    expect(body).toEqual({ ok: true, data: expect.objectContaining({ id: 'task-1', status: 'DONE', priority: 'HIGH' }) })
  })

  it('adds task comments and returns the created comment', async () => {
    const task = {
      id: 'task-1',
      title: 'Do thing',
      description: null,
      status: 'TODO',
      priority: 'MEDIUM',
      dueDate: null,
      tags: [],
      taskList: { id: 'list-1', name: 'Backlog', projectId: 'project-1', project: { id: 'project-1', name: 'Ops', status: 'ACTIVE' } },
      assignees: [],
      creator: { id: 'actor-1', name: 'GIDEON', email: 'gideon@patsgroup.id' },
    }
    const comment = { id: 'comment-1', content: 'Progress noted', createdAt: new Date('2026-04-28T00:00:00.000Z'), user: { id: 'actor-1', name: 'GIDEON', email: 'gideon@patsgroup.id' } }
    mockTaskFindFirst.mockResolvedValue(task as never)
    mockCommentCreate.mockResolvedValue(comment as never)
    mockActivityLogCreate.mockResolvedValue({ id: 'log-1' } as never)

    const response = await POST(toolRequest({ action: 'add_task_comment', input: { taskId: 'task-1', content: 'Progress noted' } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockCommentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: { taskId: 'task-1', userId: 'actor-1', content: 'Progress noted' } }))
    expect(body).toEqual({ ok: true, data: { task: expect.objectContaining({ id: 'task-1' }), comment: { ...comment, createdAt: '2026-04-28T00:00:00.000Z' } } })
  })

  it('rejects unknown actions', async () => {
    const response = await POST(toolRequest({ action: 'delete_everything', input: {} }))

    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ ok: false, error: 'Unknown GIDEON tool action: delete_everything' })
  })
})
