// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GIDEON delete_task (owner, 18 Oct 2026): a card in EVERY approval mode (dont_ask included) and never a direct
 * delete; the card shows the task; the web Delete button's own rule (Can edit, lib/task-delete.ts) when proposing and
 * again on Apply; Apply needs the task id echoed back from the destructive card (released apps cannot apply it); a
 * double tap deletes once; a task deleted or changed meanwhile is refused with a clear message and nothing deleted;
 * the delete goes through the restorable snapshot path with an audit row and a realtime ping.
 * Prisma is an in-memory world; lib/task-delete.ts is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => {
  process.env.NEXUS_ORG_WORKSPACE_ID = 'org-ws'
  process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'svc'
  return { mode: 'review', canEdit: {} as Record<string, boolean>, proposals: [] as any[], tasks: [] as any[], steps: [] as any[], seq: 0, audits: [] as any[], snapshots: [] as any[], pings: [] as any[], activity: [] as any[] }
})

// The task route's other handlers pull in the live editor (yjs); not part of a delete.
vi.mock('@/lib/collab-rooms', () => ({}))
vi.mock('@/lib/gideon-service-auth', () => ({ authenticateGideonService: vi.fn(async () => ({ ok: true, actor: { id: 'actor-1', name: 'Asker', email: 'asker@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'actor-1' } })) }))
vi.mock('@/lib/notification-service', () => ({ notifyTaskAssigned: vi.fn(), notifyTaskCompleted: vi.fn(), notifyCommentAdded: vi.fn(), notifyComplaintStatus: vi.fn(), createInAppNotification: vi.fn(async () => null), roomName: (r: string) => r }))
vi.mock('@/lib/rbac', async (orig) => ({ ...(await orig<any>()), checkProjectAccess: vi.fn(async (_u: string, projectId: string) => ({ allowed: !!w.canEdit[projectId] })) }))
vi.mock('@/lib/audit', async (orig) => ({ ...(await orig<any>()), logAudit: vi.fn(async (a: any) => { const id = `audit-${w.audits.length + 1}`; w.audits.push({ id, ...a }); return id }) }))
vi.mock('@/lib/socket-emitter', async (orig) => ({ ...(await orig<any>()), emitTaskDeleted: vi.fn((projectId: string, taskId: string) => { w.pings.push({ projectId, taskId }) }) }))
vi.mock('@/lib/deletion-snapshot', async (orig) => ({
  ...(await orig<any>()),
  // The snapshot transaction: the copy and the delete commit together or not at all.
  deleteKeepingSnapshot: vi.fn(async (input: any) => {
    const tx = {
      task: {
        delete: vi.fn(async ({ where }: any) => {
          const t = w.tasks.find((x) => x.id === where.id && (!where.updatedAt || x.updatedAt.getTime() === where.updatedAt.getTime()))
          if (!t) throw Object.assign(new Error('Record to delete does not exist.'), { code: 'P2025' })
          w.tasks = w.tasks.filter((x) => x !== t)
          return t
        }),
      },
    }
    await input.remove(tx)
    w.snapshots.push(input)
    return { rows: 1 }
  }),
}))

vi.mock('@/lib/prisma', () => {
  const match = (p: any, where: any) => Object.entries(where).every(([k, v]) => p[k] === v)
  const withRel = (t: any) => ({
    ...t,
    taskList: { id: t.taskListId, name: t.column, projectId: t.projectId, project: { id: t.projectId, name: t.projectName, status: 'ACTIVE', workspaceId: 'org-ws' } },
    assignees: t.assignees.map((name: string, i: number) => ({ user: { id: `u${i}`, name, email: null, avatar: null } })),
    taskProjects: t.alsoIn.map((projectId: string) => ({ projectId })),
    creator: null, customFieldValues: [], subtasks: [], _count: {},
  })
  return {
    default: {
      $executeRaw: vi.fn(async () => 1),
      gideonRun: { findUnique: vi.fn(async () => ({ id: 'run-1', userId: 'actor-1', approvalMode: w.mode, trigger: 'CHAT', status: 'RUNNING', startedAt: new Date(), projectId: null })) },
      gideonRunStep: { create: vi.fn(async ({ data }: any) => { w.steps.push(data); return { id: `st${w.steps.length}` } }) },
      gideonProposal: {
        create: vi.fn(async ({ data }: any) => { const p = { id: `prop-${++w.seq}`, status: 'PENDING', createdAt: new Date(), result: null, error: null, ...data }; w.proposals.push(p); return p }),
        findFirst: vi.fn(async ({ where }: any) => w.proposals.find((p) => match(p, where)) ?? null),
        findUnique: vi.fn(async ({ where }: any) => w.proposals.find((p) => p.id === where.id) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => { const hit = w.proposals.filter((p) => match(p, where)); hit.forEach((p) => Object.assign(p, data)); return { count: hit.length } }),
        update: vi.fn(async ({ where, data }: any) => { const p = w.proposals.find((x) => x.id === where.id); Object.assign(p, data); return p }),
      },
      task: {
        findFirst: vi.fn(async ({ where }: any) => { const t = w.tasks.find((x) => x.id === where.id); return t ? withRel(t) : null }),
        findUnique: vi.fn(async ({ where }: any) => { const t = w.tasks.find((x) => x.id === where.id); return t ? withRel(t) : null }),
      },
      auditLog: { delete: vi.fn(async ({ where }: any) => { w.audits = w.audits.filter((a) => a.id !== where.id) }) },
      activityLog: { create: vi.fn(async ({ data }: any) => { w.activity.push(data); return data }) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'STAFF' })), findMany: vi.fn(async () => [{ workspaceId: 'org-ws' }]) },
      user: { findUnique: vi.fn(async () => ({ email: 'asker@example.test' })), findMany: vi.fn(async () => []) },
    },
  }
})

import { POST as TOOLS } from '@/app/api/gideon/tools/route'
import { POST as DECIDE } from '@/app/api/gideon/proposals/[id]/route'
import { DELETE as DELETE_TASK } from '@/app/api/tasks/[taskId]/route'
import { APPROVAL_MODES, needsApproval } from '@/lib/gideon-runs'

const realFetch = globalThis.fetch
beforeAll(() => { globalThis.fetch = (async (url: string, init: RequestInit) => TOOLS(new Request(url, init))) as any })
afterAll(() => { globalThis.fetch = realFetch })

const task = () => ({
  id: 'task-1', title: 'Develop GIDEON Next Level', status: 'IN_PROGRESS', priority: 'HIGH', column: 'Doing', taskListId: 'tl-1',
  projectId: 'p-1', projectName: 'Atlas', dueDate: new Date('2026-10-23T05:00:00.000Z'), assignees: ['Berlin'], alsoIn: ['p-2'],
  updatedAt: new Date('2026-10-18T09:00:00.000Z'), tags: [], description: null,
})
beforeEach(() => {
  Object.assign(w, { mode: 'review', canEdit: { 'p-1': true }, proposals: [], tasks: [task()], steps: [], seq: 0, audits: [], snapshots: [], pings: [], activity: [] })
})

const call = async (action: string, input: Record<string, unknown>, run = true) => {
  const res = await TOOLS(new Request('http://localhost/api/gideon/tools', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer svc', ...(run ? { 'x-gideon-run': 'run-1' } : {}) },
    body: JSON.stringify({ action, input }),
  }))
  return { status: res.status, body: await res.json() as any }
}
const decide = async (id: string, body: Record<string, unknown>) => {
  const res = await DECIDE(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() as any }
}

describe('delete_task: always a card', () => {
  it('needs approval in every mode, dont_ask included', () => {
    for (const mode of APPROVAL_MODES) expect(needsApproval(mode, 'delete_task', { taskId: 't' }, 'actor-1')).toBe(true)
  })

  for (const mode of ['dont_ask', 'review', 'always_ask']) {
    it(`${mode}: proposes, deletes nothing, and the card shows the task`, async () => {
      w.mode = mode
      const r = await call('delete_task', { task_id: 'task-1' })
      expect(r.status).toBe(200)
      expect(r.body.data).toMatchObject({ proposed: true, status: 'PENDING' })
      expect(r.body.data.note).toMatch(/NOT deleted yet/)
      expect(r.body.data.note).toMatch(/Cancelled/)
      expect(w.tasks).toHaveLength(1)
      expect(w.audits).toHaveLength(0)
      const p = w.proposals[0]
      expect(p).toMatchObject({ action: 'delete_task', summary: 'Delete task “Develop GIDEON Next Level”', taskId: 'task-1', projectId: 'p-1' })
      expect(p.diff.map((d: any) => [d.field, d.to])).toEqual([
        ['Task', 'Develop GIDEON Next Level'], ['Project', 'Atlas'], ['Status', 'Doing'], ['Due', expect.stringMatching(/23 Oct/)], ['Assignees', 'Berlin'],
      ])
    })
  }

  it('the model can never delete directly: no run, or a plain call, refuses', async () => {
    const r = await call('delete_task', { taskId: 'task-1' }, false)
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/always waits for the person to confirm/)
    expect(w.tasks).toHaveLength(1)
  })

  it('without Can edit (a Staff with view access) it is refused up front, no card', async () => {
    w.canEdit = {}
    const r = await call('delete_task', { taskId: 'task-1' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/cannot delete tasks in Atlas.*Can edit/)
    expect(w.proposals).toHaveLength(0)
  })
})

describe('delete_task: Apply', () => {
  const propose = async () => { await call('delete_task', { taskId: 'task-1' }); return w.proposals[0] }

  it('the proposal view carries the delete card data', async () => {
    const p = await propose()
    const r = await decide(p.id, { decision: 'discard' })
    expect(r.body.proposal.taskDelete).toMatchObject({ taskId: 'task-1', title: 'Develop GIDEON Next Level', projectName: 'Atlas', status: 'Doing', progress: 'In progress', assignees: ['Berlin'], deleted: false })
    expect(w.tasks).toHaveLength(1)
  })

  it('a client without the delete card (no confirm) cannot apply it; the proposal keeps waiting', async () => {
    const p = await propose()
    const r = await decide(p.id, { decision: 'apply' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('NEEDS_LATEST_APP')
    expect(p.status).toBe('PENDING')
    expect((await decide(p.id, { decision: 'apply', confirm: { taskId: 'other' } })).status).toBe(409)
    expect(w.tasks).toHaveLength(1)
  })

  it('confirmed: deleted through the restorable path, audit row, activity, realtime to every project; a double tap deletes once', async () => {
    const p = await propose()
    const [a, b] = await Promise.all([decide(p.id, { decision: 'apply', confirm: { taskId: 'task-1' } }), decide(p.id, { decision: 'apply', confirm: { taskId: 'task-1' } })])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])
    const okRes = a.status === 200 ? a : b
    expect(okRes.body.proposal).toMatchObject({ status: 'APPLIED', taskDelete: { deleted: true, auditLogId: 'audit-1' } })
    expect(w.tasks).toHaveLength(0)
    expect(w.snapshots).toHaveLength(1)
    expect(w.snapshots[0]).toMatchObject({ entityType: 'task', entityId: 'task-1', deletedById: 'actor-1', auditLogId: 'audit-1' })
    expect(w.audits).toEqual([expect.objectContaining({ action: 'delete', entityType: 'task', entityId: 'task-1', userId: 'actor-1', metadata: expect.objectContaining({ via: 'GIDEON', projectName: 'Atlas' }) })])
    expect(w.pings).toEqual([{ projectId: 'p-1', taskId: 'task-1' }, { projectId: 'p-2', taskId: 'task-1' }])
    expect(w.activity[0].details).toMatch(/via GIDEON/)
  })

  it('already deleted meanwhile: a clear refusal, nothing else deleted', async () => {
    const p = await propose()
    w.tasks = []
    const r = await decide(p.id, { decision: 'apply', confirm: { taskId: 'task-1' } })
    expect(r.status).toBe(422)
    expect(r.body.proposal).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/already gone/) })
    expect(w.audits).toHaveLength(0)
  })

  it('changed after the card was made: refused, task kept', async () => {
    const p = await propose()
    w.tasks[0].updatedAt = new Date('2026-10-18T10:00:00.000Z')
    const r = await decide(p.id, { decision: 'apply', confirm: { taskId: 'task-1' } })
    expect(r.body.proposal).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/changed after the card was made/) })
    expect(w.tasks).toHaveLength(1)
    expect(w.audits).toHaveLength(0)
  })

  it('Can edit lost before Apply: refused, task kept', async () => {
    const p = await propose()
    w.canEdit = {}
    const r = await decide(p.id, { decision: 'apply', confirm: { taskId: 'task-1' } })
    expect(r.body.proposal).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/Can edit/) })
    expect(w.tasks).toHaveLength(1)
  })

  it('changed between the check and the delete (inside the transaction): refused, the audit row removed', async () => {
    const p = await propose()
    const prisma = (await import('@/lib/prisma')).default as any
    // The read sees the old version; the conditional delete in the transaction sees the new one.
    prisma.task.findUnique.mockImplementationOnce(async ({ where }: any) => {
      const t = w.tasks.find((x) => x.id === where.id)
      const snap = t ? { ...t, taskList: { id: t.taskListId, name: t.column, projectId: t.projectId, project: { name: t.projectName, workspaceId: 'org-ws' } }, taskProjects: [] } : null
      if (t) t.updatedAt = new Date('2026-10-18T11:00:00.000Z')
      return snap
    })
    const r = await decide(p.id, { decision: 'apply', confirm: { taskId: 'task-1' } })
    expect(r.body.proposal).toMatchObject({ status: 'FAILED', error: expect.stringMatching(/changed/) })
    expect(w.tasks).toHaveLength(1)
    expect(w.audits).toHaveLength(0)
  })
})

describe('DELETE /api/tasks/:id shares the same path', () => {
  const del = async () => {
    const res = await DELETE_TASK(new Request('http://localhost/api/tasks/task-1', { method: 'DELETE' }) as never, { params: Promise.resolve({ taskId: 'task-1' }) })
    return { status: res.status, body: await res.json() as any }
  }
  it('Can edit deletes, restorable, same response shape', async () => {
    const r = await del()
    expect(r).toEqual({ status: 200, body: { message: 'Task deleted', auditLogId: 'audit-1' } })
    expect(w.snapshots).toHaveLength(1)
  })
  it('no Can edit → 403 NEEDS_EDIT_ACCESS; gone → 404', async () => {
    w.canEdit = {}
    expect(await del()).toMatchObject({ status: 403, body: { code: 'NEEDS_EDIT_ACCESS' } })
    w.tasks = []
    expect(await del()).toEqual({ status: 404, body: { error: 'Task not found' } })
  })
})
