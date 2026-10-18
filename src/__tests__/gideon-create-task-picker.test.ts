// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GIDEON create_task with no project named (owner, 18 Oct 2026): a card with a project picker in every approval mode
 * instead of "which project?" in the chat. The picker lists only projects the person can edit (Can edit / Full,
 * ACTIVE, type TASK); preselected from a named project or the chat's project context; Apply needs the chosen project
 * (released apps cannot apply it), re-checks it (403, card stays open), the column must be the project's, the PIC
 * its members; a double tap creates one task. lib/gideon-task-target.ts is real; Prisma is in memory.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => {
  process.env.NEXUS_ORG_WORKSPACE_ID = 'org-ws'
  process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'svc'
  return { mode: 'dont_ask', wsRole: 'STAFF', runProject: null as string | null, proposals: [] as any[], steps: [] as any[], seq: 0, applied: [] as any[] }
})

const PROJECTS = [
  { id: 'p-edit', name: 'GIDEON Next Level', type: 'TASK', status: 'ACTIVE', workspaceId: 'org-ws', icon: 'folder', color: '#7B2FBE', member: { role: 'MEMBER', accessLevel: 'EDIT' } },
  { id: 'p-full', name: 'Atlas', type: 'TASK', status: 'ACTIVE', workspaceId: 'org-ws', icon: 'folder', color: '#7B2FBE', member: { role: 'LEAD', accessLevel: 'FULL' } },
  { id: 'p-view', name: 'Finance', type: 'TASK', status: 'ACTIVE', workspaceId: 'org-ws', icon: 'folder', color: '#7B2FBE', member: { role: 'VIEWER', accessLevel: 'VIEW' } },
  { id: 'p-comment', name: 'Legal', type: 'TASK', status: 'ACTIVE', workspaceId: 'org-ws', icon: 'folder', color: '#7B2FBE', member: { role: 'MEMBER', accessLevel: 'COMMENT' } },
  { id: 'p-archived', name: 'Old', type: 'TASK', status: 'ARCHIVED', workspaceId: 'org-ws', icon: 'folder', color: '#7B2FBE', member: { role: 'LEAD', accessLevel: 'FULL' } },
  { id: 'p-pipe', name: 'Pipeline Z', type: 'PIPELINE', status: 'ACTIVE', workspaceId: 'org-ws', icon: 'folder', color: '#7B2FBE', member: { role: 'LEAD', accessLevel: 'FULL' } },
  { id: 'p-none', name: 'Not mine', type: 'TASK', status: 'ACTIVE', workspaceId: 'org-ws', icon: 'folder', color: '#7B2FBE', member: null },
]
const SECTIONS: Record<string, any[]> = { 'p-edit': [{ id: 's-todo', name: 'To Do', taskStatus: 'TODO', color: null }, { id: 's-doing', name: 'Doing', taskStatus: 'IN_PROGRESS', color: null }], 'p-full': [{ id: 's-a', name: 'Backlog', taskStatus: null, color: null }] }
const MEMBERS: Record<string, any[]> = { 'p-edit': [{ user: { id: 'actor-1', name: 'Asker', avatar: null } }, { user: { id: 'u-rina', name: 'Rina', avatar: null } }], 'p-full': [{ user: { id: 'actor-1', name: 'Asker', avatar: null } }] }

vi.mock('@/lib/gideon-service-auth', () => ({ authenticateGideonService: vi.fn(async () => ({ ok: true, actor: { id: 'actor-1', name: 'Asker', email: 'asker@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'actor-1' } })) }))
vi.mock('@/lib/collab-rooms', () => ({}))
vi.mock('@/lib/notification-service', () => ({ notifyTaskAssigned: vi.fn(), notifyTaskCompleted: vi.fn(), notifyCommentAdded: vi.fn(), notifyComplaintStatus: vi.fn(), createInAppNotification: vi.fn(async () => null), roomName: (r: string) => r }))
vi.mock('@/lib/rbac', async (orig) => {
  const real = await orig<any>()
  return {
    ...real,
    projectAccessLevel: vi.fn(async (_u: string, projectId: string) => {
      const p = PROJECTS.find((x) => x.id === projectId)
      if (!p) return null
      if (real.hasProjectWideAccess(w.wsRole)) return 'FULL'
      return real.memberAccessLevel(p.member)
    }),
  }
})

vi.mock('@/lib/prisma', () => {
  const match = (p: any, where: any) => Object.entries(where).every(([k, v]) => p[k] === v)
  return {
    default: {
      $executeRaw: vi.fn(async () => 1),
      gideonRun: { findUnique: vi.fn(async () => ({ id: 'run-1', userId: 'actor-1', approvalMode: w.mode, trigger: 'CHAT', status: 'RUNNING', startedAt: new Date(), projectId: w.runProject })) },
      gideonRunStep: { create: vi.fn(async ({ data }: any) => { w.steps.push(data); return { id: `st${w.steps.length}` } }) },
      gideonProposal: {
        create: vi.fn(async ({ data }: any) => { const p = { id: `prop-${++w.seq}`, status: 'PENDING', createdAt: new Date(), result: null, error: null, ...data }; w.proposals.push(p); return p }),
        findFirst: vi.fn(async ({ where }: any) => w.proposals.find((p) => match(p, where)) ?? null),
        findUnique: vi.fn(async ({ where }: any) => w.proposals.find((p) => p.id === where.id) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => { const hit = w.proposals.filter((p) => match(p, where)); hit.forEach((p) => Object.assign(p, data)); return { count: hit.length } }),
        update: vi.fn(async ({ where, data }: any) => { const p = w.proposals.find((x) => x.id === where.id); Object.assign(p, data); return p }),
      },
      workspaceMember: { findMany: vi.fn(async () => [{ workspaceId: 'org-ws', role: w.wsRole }]), findUnique: vi.fn(async () => ({ role: w.wsRole })) },
      project: {
        // The where the lib builds: type, status, OR [wide workspaces | member LEAD/MEMBER].
        findMany: vi.fn(async ({ where }: any) => PROJECTS
          .filter((p) => p.type === where.type && p.status === where.status)
          .filter((p) => where.OR.some((o: any) => o.workspaceId.in.includes(p.workspaceId) && (!o.members || (p.member && o.members.some.role.in.includes(p.member.role)))))
          .map((p) => ({ ...p, members: p.member ? [p.member] : [] }))),
        findUnique: vi.fn(async ({ where }: any) => PROJECTS.find((p) => p.id === where.id) ?? null),
      },
      taskList: { findMany: vi.fn(async ({ where }: any) => SECTIONS[where.projectId] ?? []) },
      projectMember: { findMany: vi.fn(async ({ where }: any) => MEMBERS[where.projectId] ?? []) },
      user: { findUnique: vi.fn(async () => ({ email: 'asker@example.test' })), findMany: vi.fn(async ({ where }: any) => (where.id?.in ?? []).map((id: string) => ({ id, name: id === 'u-rina' ? 'Rina' : 'Asker' }))) },
    },
  }
})

import { POST as TOOLS } from '@/app/api/gideon/tools/route'
import { POST as DECIDE } from '@/app/api/gideon/proposals/[id]/route'
import { GET as TARGETS } from '@/app/api/gideon/task-targets/route'
import { APPROVAL_MODES, needsApproval } from '@/lib/gideon-runs'

// Apply calls the tools route over HTTP: stand in for it and record what it would create.
const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const id = (init.headers as Record<string, string>)['x-gideon-approved']
    const p = w.proposals.find((x) => x.id === id)
    await new Promise((r) => setTimeout(r, 5))
    w.applied.push(JSON.parse(JSON.stringify(p.input)))
    return new Response(JSON.stringify({ ok: true, data: { id: `task-${w.applied.length}`, title: p.input.title, status: 'TODO', project: { name: 'x' }, assignees: [] } }), { status: 200 })
  }) as any
})
afterAll(() => { globalThis.fetch = realFetch })
beforeEach(() => { Object.assign(w, { mode: 'dont_ask', wsRole: 'STAFF', runProject: null, proposals: [], steps: [], seq: 0, applied: [] }) })

const call = async (input: Record<string, unknown>) => {
  const res = await TOOLS(new Request('http://localhost/api/gideon/tools', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer svc', 'x-gideon-run': 'run-1' },
    body: JSON.stringify({ action: 'create_task', input }),
  }))
  return { status: res.status, body: await res.json() as any }
}
const decide = async (id: string, body: Record<string, unknown>) => {
  const res = await DECIDE(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() as any }
}

describe('create_task without a project: the picker card', () => {
  it('is held in every mode (no project named); a named project id is not affected', () => {
    for (const m of APPROVAL_MODES) expect(needsApproval(m, 'create_task', { title: 'X' }, 'actor-1')).toBe(true)
    expect(needsApproval('dont_ask', 'create_task', { title: 'X', projectId: 'p-edit' }, 'actor-1')).toBe(false)
  })

  it('dont_ask: a card, not a question; only editable, open task projects; nothing preselected', async () => {
    const r = await call({ title: 'develop GIDEON Next Level' })
    expect(r.body.data).toMatchObject({ proposed: true, status: 'PENDING' })
    expect(r.body.data.note).toMatch(/project picker/)
    expect(r.body.data.note).toMatch(/do NOT ask which project/)
    const p = w.proposals[0]
    expect(p.input.pickProject).toBe(true)
    expect(p.input.taskTarget.projects.map((x: any) => x.id)).toEqual(['p-edit', 'p-full'])
    expect(p.input.taskTarget.preselectedProjectId).toBeNull()
    expect(p.projectId).toBeNull()
  })

  it('BoD (Full everywhere) sees every open task project, still not Pipeline or archived', async () => {
    w.wsRole = 'BOD'
    await call({ title: 'X' })
    expect(w.proposals[0].input.taskTarget.projects.map((x: any) => x.id)).toEqual(['p-edit', 'p-full', 'p-view', 'p-comment', 'p-none'])
  })

  it('preselects a named project, else the chat context project, else nothing', async () => {
    await call({ title: 'A', project: 'gideon next level' })
    expect(w.proposals[0].input.taskTarget.preselectedProjectId).toBe('p-edit')
    w.runProject = 'p-full'
    await call({ title: 'B' })
    expect(w.proposals[1].input.taskTarget.preselectedProjectId).toBe('p-full')
    expect(w.proposals[1].summary).toBe('Create task “B” in Atlas')
    w.runProject = 'p-view' // context the person can only view: not preselected
    await call({ title: 'C' })
    expect(w.proposals[2].input.taskTarget.preselectedProjectId).toBeNull()
  })

  it('the proposal view carries the picker', async () => {
    await call({ title: 'A', dueDate: '2026-10-23', assigneeIds: ['u-rina'] })
    const r = await decide(w.proposals[0].id, { decision: 'discard' })
    expect(r.body.proposal.taskTarget).toMatchObject({ title: 'A', projectId: null, assigneeIds: ['u-rina'], dueDay: '2026-10-23', projects: [{ id: 'p-edit' }, { id: 'p-full' }] })
  })

  it('task-targets: sections + members of an editable project; 403 for view-only', async () => {
    const ok = await TARGETS({ nextUrl: new URL('http://x/api/gideon/task-targets?projectId=p-edit') } as never)
    expect(await ok.json()).toEqual({ sections: SECTIONS['p-edit'], members: MEMBERS['p-edit'].map((m) => m.user) })
    expect((await TARGETS({ nextUrl: new URL('http://x/api/gideon/task-targets?projectId=p-view') } as never)).status).toBe(403)
    expect((await TARGETS({ nextUrl: new URL('http://x/api/gideon/task-targets?projectId=p-pipe') } as never)).status).toBe(403)
  })
})

describe('Apply', () => {
  const propose = async () => { await call({ title: 'develop GIDEON Next Level', status: 'IN_PROGRESS' }); return w.proposals[0] }

  it('without a chosen project (a released app) it is refused and keeps waiting', async () => {
    const p = await propose()
    const r = await decide(p.id, { decision: 'apply' })
    expect(r).toMatchObject({ status: 409, body: { code: 'NEEDS_LATEST_APP' } })
    expect(p.status).toBe('PENDING')
    expect(w.applied).toHaveLength(0)
  })

  it('a project the person cannot edit → 403, the card stays open', async () => {
    const p = await propose()
    for (const projectId of ['p-view', 'p-comment', 'p-archived', 'p-pipe', 'p-none']) {
      const r = await decide(p.id, { decision: 'apply', task: { projectId, assigneeIds: [], dueDate: null } })
      expect(r.status).toBe(403)
    }
    expect(p.status).toBe('PENDING')
    expect(w.applied).toHaveLength(0)
  })

  it('a column of another project or a PIC who is not a member → 400', async () => {
    const p = await propose()
    expect((await decide(p.id, { decision: 'apply', task: { projectId: 'p-edit', taskListId: 's-a', assigneeIds: [] } })).body.code).toBe('BAD_SECTION')
    expect((await decide(p.id, { decision: 'apply', task: { projectId: 'p-full', assigneeIds: ['u-rina'] } })).body.code).toBe('BAD_ASSIGNEE')
    expect(w.applied).toHaveLength(0)
  })

  it('chosen: exactly what the card picked is created, once (double tap)', async () => {
    const p = await propose()
    const task = { projectId: 'p-edit', taskListId: 's-doing', assigneeIds: ['u-rina'], dueDate: '2026-10-23' }
    const [a, b] = await Promise.all([decide(p.id, { decision: 'apply', task }), decide(p.id, { decision: 'apply', task })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(w.applied).toHaveLength(1)
    expect(w.applied[0]).toMatchObject({ projectId: 'p-edit', taskListId: 's-doing', status: 'IN_PROGRESS', assigneeIds: ['u-rina'], dueDate: '2026-10-23', title: 'develop GIDEON Next Level' })
    expect(p).toMatchObject({ status: 'APPLIED', projectId: 'p-edit', summary: 'Create task “develop GIDEON Next Level” in GIDEON Next Level' })
  })
})
