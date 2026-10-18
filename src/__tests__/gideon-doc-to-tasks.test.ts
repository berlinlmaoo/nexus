// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Turn this doc into tasks for the people named, due Friday" (end-to-end test on dev, 16 Oct 2026): GIDEON made
 * three tasks for nobody directly, then proposed three separate assignee updates. Now:
 *  - in "Review before writing" a new task for nobody is held as a proposal too;
 *  - an update_task aimed at that proposal (its id is the task's only id so far) is merged into the SAME card;
 *  - Discard leaves nothing behind;
 *  - "Friday" said on a Friday is next week's Friday, and the card says "Fri 23 Oct".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ proposals: [] as any[], seq: 0 }))

vi.mock('@/lib/gideon-service-auth', () => ({ authenticateGideonService: vi.fn(async () => ({ ok: true, actor: { id: 'actor-1', name: 'Asker', email: 'asker@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'actor-1' } })) }))
vi.mock('@/lib/notification-service', () => ({ notifyTaskAssigned: vi.fn(), notifyTaskCompleted: vi.fn(), notifyCommentAdded: vi.fn(), notifyComplaintStatus: vi.fn(), createInAppNotification: vi.fn(), roomName: (r: string) => r }))
vi.mock('@/lib/rbac', async (orig) => ({ ...(await orig<typeof import('@/lib/rbac')>()), checkProjectAccess: vi.fn(async () => ({ allowed: true, role: 'LEAD' })) }))
vi.mock('@/lib/gideon-identity', async (orig) => ({ ...(await orig<typeof import('@/lib/gideon-identity')>()), getGideonUserId: vi.fn(async () => 'gideon-user') }))

vi.mock('@/lib/prisma', () => {
  const match = (p: any, where: any) => Object.entries(where).every(([k, v]) => p[k] === v)
  const prismaMock: any = {
    $transaction: vi.fn(async (fn: any) => fn(prismaMock)),
    $executeRaw: vi.fn(async () => 1),
    gideonRun: { findUnique: vi.fn(async () => ({ id: 'run-1', userId: 'actor-1', approvalMode: 'review', trigger: 'CHAT', status: 'RUNNING', startedAt: new Date(), projectId: null })) },
    gideonRunStep: { create: vi.fn(async () => ({ id: 'step' })) },
    gideonProposal: {
      create: vi.fn(async ({ data }: any) => { const p = { id: `prop-${++store.seq}`, status: 'PENDING', createdAt: new Date(), result: null, error: null, decidedAt: null, ...data }; store.proposals.push(p); return p }),
      findFirst: vi.fn(async ({ where }: any) => store.proposals.find((p) => match(p, where)) ?? null),
      findUnique: vi.fn(async ({ where }: any) => store.proposals.find((p) => p.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const hit = store.proposals.filter((p) => match(p, where)); hit.forEach((p) => Object.assign(p, data)); return { count: hit.length } }),
      update: vi.fn(async ({ where, data }: any) => { const p = store.proposals.find((x) => x.id === where.id); Object.assign(p, data); return p }),
    },
    project: { findUnique: vi.fn(async () => ({ id: 'p1', name: 'Launch', status: 'ACTIVE' })), findFirst: vi.fn(async () => null) },
    taskList: {
      findFirst: vi.fn(async () => ({ id: 'list-todo', name: 'To Do', projectId: 'p1', project: { id: 'p1', name: 'Launch', status: 'ACTIVE', autoAssignEnabled: false, autoAssignAssigneeIds: [], members: [{ userId: 'u-ana' }, { userId: 'actor-1' }] } })),
    },
    user: { findMany: vi.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, name: id === 'u-ana' ? 'Alpha Tester' : id === 'u-bo' ? 'Beta Tester' : 'Asker' }))) },
    task: { create: vi.fn(), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
    taskAssignee: { createMany: vi.fn(), deleteMany: vi.fn() },
    customField: { findMany: vi.fn(async () => []) },
    activityLog: { create: vi.fn() },
  }
  return { default: prismaMock }
})

import prisma from '@/lib/prisma'
import { POST as TOOLS } from '@/app/api/gideon/tools/route'
import { POST as DECIDE } from '@/app/api/gideon/proposals/[id]/route'
import { needsApproval } from '@/lib/gideon-runs'
import { humanDay, parseDueInput, resolveDayPhrase } from '@/lib/gideon-dates'

// Friday 16 Oct 2026, 10:00 WIB.
const NOW = new Date('2026-10-16T03:00:00.000Z')
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })
beforeEach(() => { store.proposals = []; store.seq = 0; vi.mocked(prisma.task.create).mockClear() })

const call = async (action: string, input: Record<string, unknown>) => {
  const res = await TOOLS(new Request('http://localhost/api/gideon/tools', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t', 'x-gideon-run': 'run-1' },
    body: JSON.stringify({ action, input }),
  }))
  return { status: res.status, body: await res.json() as any }
}
const rowOf = (p: any, field: string) => (p.diff as any[]).find((r) => r.field === field)

describe('the weekday rule', () => {
  it('a weekday equal to today means next week; only "today" is today', () => {
    expect(resolveDayPhrase('Friday', '2026-10-16')).toBe('2026-10-23')
    expect(resolveDayPhrase('jumat', '2026-10-16')).toBe('2026-10-23')
    expect(resolveDayPhrase("Jum'at", '2026-10-16')).toBe('2026-10-23')
    expect(resolveDayPhrase('today', '2026-10-16')).toBe('2026-10-16')
    expect(resolveDayPhrase('hari ini', '2026-10-16')).toBe('2026-10-16')
  })
  it('other days, relative words and next week', () => {
    expect(resolveDayPhrase('saturday', '2026-10-16')).toBe('2026-10-17')
    expect(resolveDayPhrase('thursday', '2026-10-16')).toBe('2026-10-22')
    expect(resolveDayPhrase('senin', '2026-10-16')).toBe('2026-10-19')
    expect(resolveDayPhrase('tomorrow', '2026-10-16')).toBe('2026-10-17')
    expect(resolveDayPhrase('besok', '2026-10-16')).toBe('2026-10-17')
    expect(resolveDayPhrase('next week', '2026-10-16')).toBe('2026-10-19')
    expect(resolveDayPhrase('next friday', '2026-10-14')).toBe('2026-10-23')
    expect(resolveDayPhrase('this friday', '2026-10-14')).toBe('2026-10-16')
    expect(resolveDayPhrase('this friday', '2026-10-16')).toBe('2026-10-23')
    expect(resolveDayPhrase('minggu', '2026-10-16')).toBe('2026-10-18')
    expect(resolveDayPhrase('minggu ini', '2026-10-16')).toBeNull()
    expect(resolveDayPhrase('soonish', '2026-10-16')).toBeNull()
  })
  it('a due input becomes an explicit date at 00:00 UTC, and is labelled "Fri 23 Oct"', () => {
    expect(parseDueInput('Friday', NOW)?.toISOString()).toBe('2026-10-23T00:00:00.000Z')
    expect(parseDueInput('2026-10-23', NOW)?.toISOString()).toBe('2026-10-23T00:00:00.000Z')
    expect(parseDueInput(null, NOW)).toBeNull()
    expect(parseDueInput(undefined, NOW)).toBeUndefined()
    expect(() => parseDueInput('someday maybe', NOW)).toThrow(/Invalid date/)
    expect(humanDay('2026-10-23', 'en', '2026-10-16')).toBe('Fri 23 Oct')
    expect(humanDay('2026-10-23', 'id', '2026-10-16')).toBe('Jum 23 Okt')
    expect(humanDay('2027-01-08', 'en', '2026-10-16')).toBe('Fri 8 Jan 2027')
  })
})

describe('approval: what "Review before writing" holds', () => {
  it('create_task: for nobody or for others → held; only for the asker → made directly', () => {
    expect(needsApproval('review', 'create_task', { projectId: 'p1' }, 'actor-1')).toBe(true)
    expect(needsApproval('review', 'create_task', { projectId: 'p1', assigneeIds: [] }, 'actor-1')).toBe(true)
    expect(needsApproval('review', 'create_task', { projectId: 'p1', assigneeIds: ['u-ana'] }, 'actor-1')).toBe(true)
    expect(needsApproval('review', 'create_task', { projectId: 'p1', assigneeIds: ['actor-1'] }, 'actor-1')).toBe(false)
    expect(needsApproval('dont_ask', 'create_task', { projectId: 'p1', assigneeIds: ['u-ana'] }, 'actor-1')).toBe(false)
    expect(needsApproval('always_ask', 'create_task', { projectId: 'p1', assigneeIds: ['actor-1'] }, 'actor-1')).toBe(true)
  })
})

describe('doc → tasks: one complete proposal per new task', () => {
  it('create with assignees and "Friday" = ONE card with every field, and nothing created', async () => {
    const r = await call('create_task', { projectId: 'p1', title: 'Write the brief', dueDate: 'Friday', assigneeIds: ['u-ana'] })
    expect(r.body.data).toMatchObject({ proposed: true, due: 'Fri 23 Oct' })
    expect(r.body.data.note).toContain('Fri 23 Oct')
    expect(store.proposals).toHaveLength(1)
    const p = store.proposals[0]
    expect(p.diff.map((d: any) => d.field)).toEqual(['Title', 'Section', 'Status', 'Due', 'Assignees'])
    expect(rowOf(p, 'Due')).toEqual({ field: 'Due', to: 'Fri 23 Oct', toDay: '2026-10-23' })
    expect(rowOf(p, 'Assignees').to).toBe('Alpha Tester')
    expect(p.input.dueDate).toBe('Friday')
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('a create for nobody is held, and the update that assigns and dates it merges into the same card', async () => {
    const created = await call('create_task', { projectId: 'p1', title: 'Book the venue' })
    const proposalId = created.body.data.proposalId
    expect(rowOf(store.proposals[0], 'Assignees').to).toBe('—')
    expect(rowOf(store.proposals[0], 'Due').to).toBe('—')

    const updated = await call('update_task', { taskId: proposalId, assigneeIds: ['u-ana', 'u-bo'], dueDate: '2026-10-23' })
    expect(updated.status).toBe(200)
    expect(updated.body.data).toMatchObject({ proposed: true, merged: true, proposalId, due: 'Fri 23 Oct' })
    expect(store.proposals).toHaveLength(1)
    const p = store.proposals[0]
    expect(p.input).toMatchObject({ title: 'Book the venue', assigneeIds: ['u-ana', 'u-bo'], dueDate: '2026-10-23' })
    expect(rowOf(p, 'Assignees').to).toBe('Alpha Tester, Beta Tester')
    expect(rowOf(p, 'Due').toDay).toBe('2026-10-23')
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it('Discard leaves no task behind', async () => {
    const created = await call('create_task', { projectId: 'p1', title: 'Order banners', assigneeIds: ['u-ana'] })
    await call('update_task', { taskId: created.body.data.proposalId, dueDate: 'besok' })
    const res = await DECIDE(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ decision: 'discard' }) }) as never, { params: Promise.resolve({ id: created.body.data.proposalId }) })
    expect(res.status).toBe(200)
    expect(store.proposals.map((p) => p.status)).toEqual(['DISCARDED'])
    expect(prisma.task.create).not.toHaveBeenCalled()
    expect(prisma.taskAssignee.createMany).not.toHaveBeenCalled()
  })

  it('a decided proposal is not merged into: the update is a normal update (and fails for a task that does not exist)', async () => {
    const created = await call('create_task', { projectId: 'p1', title: 'Late one', assigneeIds: ['u-ana'] })
    store.proposals[0].status = 'DISCARDED'
    const r = await call('update_task', { taskId: created.body.data.proposalId, assigneeIds: ['u-bo'] })
    expect(r.status).toBe(400)
    expect(store.proposals[0].input.assigneeIds).toEqual(['u-ana'])
  })
})
