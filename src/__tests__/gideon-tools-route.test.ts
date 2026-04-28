import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/gideon-service-auth', () => ({
  authenticateGideonService: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
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
    task: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'
import { authenticateGideonService } from '@/lib/gideon-service-auth'
import { POST } from '@/app/api/gideon/tools/route'

const mockAuth = vi.mocked(authenticateGideonService)
const mockProjectFindMany = vi.mocked(prisma.project.findMany)
const mockProjectFindUnique = vi.mocked(prisma.project.findUnique)
const mockWorkspaceMemberFindMany = vi.mocked(prisma.workspaceMember.findMany)
const mockProjectMemberFindMany = vi.mocked(prisma.projectMember.findMany)
const mockTaskFindMany = vi.mocked(prisma.task.findMany)
const mockTaskCount = vi.mocked(prisma.task.count)
const mockTaskGroupBy = vi.mocked(prisma.task.groupBy)

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

  it('rejects unknown actions', async () => {
    const response = await POST(toolRequest({ action: 'delete_everything', input: {} }))

    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ ok: false, error: 'Unknown GIDEON tool action: delete_everything' })
  })
})
