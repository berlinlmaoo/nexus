import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/gideon-service-auth', () => ({
  authenticateGideonService: vi.fn(),
}))

// The calendar tools import lib/calendar/server, which imports the session helper; no session is used here.
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }))

vi.mock('@/lib/notification-service', () => ({
  notifyTaskAssigned: vi.fn(),
  notifyTaskCompleted: vi.fn(),
  notifyCommentAdded: vi.fn(),
}))

const { mockTransaction } = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
}))

// Project access is rbac.ts's own unit (rbac.test.ts); here the actor may write.
vi.mock('@/lib/rbac', async (orig) => ({ ...(await orig<typeof import('@/lib/rbac')>()), checkProjectAccess: vi.fn(async () => ({ allowed: true, role: 'LEAD' })) }))

vi.mock('@/lib/gideon-identity', async (orig) => ({ ...(await orig<typeof import('@/lib/gideon-identity')>()), getGideonUserId: vi.fn(async () => 'gideon-user') }))
vi.mock('@/lib/status-sections', async (orig) => ({ ...(await orig<typeof import('@/lib/status-sections')>()), sectionForStatus: vi.fn(async () => null) }))

vi.mock('@/lib/prisma', () => {
  const prismaMock = {
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prismaMock)),
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    projectMember: {
      findMany: vi.fn(),
    },
    taskList: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
const mockProjectCount = vi.mocked(prisma.project.count)
const mockWorkspaceMemberCount = vi.mocked(prisma.workspaceMember.count)
const mockTaskListFindMany = vi.mocked(prisma.taskList.findMany)
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

  // GIDEON's read tools answer compact, paged rows since 18 Oct 2026 (lib/gideon-compact.ts): no member roster,
  // emails or avatars, and a page wrapper with the total.
  it('lists projects as compact rows with task counts, members and the scope', async () => {
    mockProjectFindMany.mockResolvedValue([
      {
        id: 'project-1',
        name: 'Project One',
        status: 'ACTIVE',
        type: 'TASK',
        _count: { members: 1 },
        taskLists: [{ id: 'list-1', _count: { tasks: 3 } }],
      },
    ] as never)
    mockProjectCount.mockResolvedValue(1 as never)
    mockTaskGroupBy.mockResolvedValueOnce([{ taskListId: 'list-1', _count: { _all: 2 } }] as never)
    mockWorkspaceMemberCount.mockResolvedValue(0 as never)

    const response = await POST(toolRequest({ action: 'list_projects', input: { status: 'ACTIVE' } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockProjectFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    expect(body).toEqual({
      ok: true,
      data: {
        scope: 'Exactly the projects this person is a member of.',
        total: 1,
        shown: 1,
        items: [{ id: 'project-1', name: 'Project One', status: 'ACTIVE', tasks: 3, open: 2, members: 1 }],
      },
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
        taskList: { name: 'Backlog', projectId: 'project-1', project: { id: 'project-1', name: 'Ops' } },
        assignees: [{ user: { name: 'Berlin' } }],
        customFieldValues: [],
      },
    ] as never)
    mockTaskCount.mockResolvedValue(1 as never)

    const response = await POST(toolRequest({ action: 'search_tasks', input: { query: 'supplier', limit: 500 } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(mockTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({
      total: 1,
      shown: 1,
      items: [
        expect.objectContaining({ id: 'task-1', title: 'Follow up supplier', status: 'Backlog', progress: 'To do', priority: 'High', assignees: ['Berlin'], project: 'Ops', projectId: 'project-1' }),
      ],
    })
  })

  it('returns a project summary with grouped status, priority and column counts', async () => {
    mockProjectFindUnique.mockResolvedValue({
      id: 'project-1',
      name: 'Ops',
      status: 'ACTIVE',
      type: 'TASK',
      workspace: { name: 'PATS' },
      members: [{ role: 'LEAD', user: { id: 'user-1', name: 'Berlin' } }],
      _count: { members: 1 },
    } as never)
    // Promise.all order in getProjectSummary: total, done, by status, open by priority, columns, by column,
    // open by column, overdue open, the open rows.
    mockTaskCount.mockResolvedValueOnce(10 as never).mockResolvedValueOnce(4 as never).mockResolvedValueOnce(1 as never)
    mockTaskGroupBy
      .mockResolvedValueOnce([{ status: 'TODO', _count: { _all: 6 } }, { status: 'DONE', _count: { _all: 4 } }] as never)
      .mockResolvedValueOnce([{ priority: 'HIGH', _count: { _all: 3 } }, { priority: 'LOW', _count: { _all: 3 } }] as never)
      .mockResolvedValueOnce([{ taskListId: 'list-1', _count: { _all: 10 } }] as never)
      .mockResolvedValueOnce([{ taskListId: 'list-1', _count: { _all: 6 } }] as never)
    mockTaskListFindMany.mockResolvedValue([{ id: 'list-1', name: 'Backlog' }] as never)
    mockTaskFindMany.mockResolvedValue([] as never)

    const response = await POST(toolRequest({ action: 'get_project_summary', input: { projectId: 'project-1' } }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      data: expect.objectContaining({
        project: { id: 'project-1', name: 'Ops', status: 'ACTIVE', workspace: 'PATS' },
        totalTasks: 10,
        completedTasks: 4,
        openTasks: 6,
        overdueOpenTasks: 1,
        progressPercent: 40,
        byStatus: { TODO: 6, DONE: 4 },
        openByPriority: { HIGH: 3, LOW: 3 },
        byColumn: [{ column: 'Backlog', total: 10, open: 6 }],
        members: [{ id: 'user-1', name: 'Berlin', role: 'LEAD' }],
        topOpenTasks: [],
      }),
    })
  })

  it('creates tasks with task list resolution and read-back verification', async () => {
    const taskList = {
      id: 'list-1',
      name: 'Backlog',
      projectId: 'project-1',
      project: { id: 'project-1', name: 'Ops', status: 'ACTIVE', autoAssignEnabled: false, autoAssignAssigneeIds: [], members: [] },
    }
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
    // Written by the GIDEON account and signed with who asked (the comment is never put under the actor's name).
    expect(mockCommentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: { taskId: 'task-1', userId: 'gideon-user', content: expect.stringContaining('Progress noted') } }))
    expect(body).toEqual({ ok: true, data: { task: expect.objectContaining({ id: 'task-1' }), comment: { ...comment, createdAt: '2026-04-28T00:00:00.000Z' } } })
  })

  it('rejects unknown actions', async () => {
    const response = await POST(toolRequest({ action: 'delete_everything', input: {} }))

    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ ok: false, error: 'Unknown GIDEON tool action: delete_everything' })
  })
})
