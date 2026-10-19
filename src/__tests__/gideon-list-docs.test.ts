// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GIDEON nexus_list_docs (19 Oct 2026), through POST /api/gideon/tools: pages by date / project / title, newest first,
 * strictly the docs API's access rule (lib/rbac.ts projectAccessLevel: OAA / BoD of the workspace = every project,
 * anyone else = only projects they are a member of, and only while still in the workspace), excerpt only, paged.
 * Prisma is an in-memory world that applies the where clauses the tool sends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => {
  process.env.NEXUS_PUBLIC_URL = 'https://nexus.test'
  return {
    actorId: 'staff-1',
    workspaces: [] as any[],
    members: [] as any[],
    projects: [] as any[],
    docs: [] as any[],
    audits: [] as any[],
    users: [] as any[],
  }
})

vi.mock('@/lib/collab-rooms', () => ({}))
vi.mock('@/lib/gideon-service-auth', () => ({ authenticateGideonService: vi.fn(async () => ({ ok: true, actor: { id: w.actorId, name: 'Asker', email: 'asker@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }))
vi.mock('@/lib/notification-service', () => ({ notifyTaskAssigned: vi.fn(), notifyTaskCompleted: vi.fn(), notifyCommentAdded: vi.fn(), notifyComplaintStatus: vi.fn(), createInAppNotification: vi.fn(async () => null), roomName: (r: string) => r }))

vi.mock('@/lib/prisma', () => {
  const inList = (v: any, f: any) => (f && typeof f === 'object' && 'in' in f ? f.in.includes(v) : v === f)
  const contains = (v: string, f: any) => !f || String(v).toLowerCase().includes(String(f.contains).toLowerCase())
  const inRange = (v: Date, f: any) => !f || ((!f.gte || v >= f.gte) && (!f.lt || v < f.lt))
  const projectMatch = (p: any, where: any) => {
    const one = (c: any) => (!c.workspaceId || inList(p.workspaceId, c.workspaceId)) && (!c.id || inList(p.id, c.id))
    return (!where.OR || where.OR.some(one)) && contains(p.name, where.name)
  }
  const docMatch = (d: any, where: any) =>
    inList(d.projectId, where.projectId) && inRange(d.updatedAt, where.updatedAt) && inRange(d.createdAt, where.createdAt) && contains(d.title, where.title)
  const sortDocs = (rows: any[], orderBy: any[]) => {
    const field = Object.keys(orderBy[0])[0]
    return [...rows].sort((a, b) => b[field].getTime() - a[field].getTime() || (a.id < b.id ? 1 : -1))
  }
  const userName = (id: string) => w.users.find((u) => u.id === id)?.name ?? null
  return {
    default: {
      $transaction: vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
      gideonRun: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
      workspaceMember: { findMany: vi.fn(async ({ where }: any) => w.workspaces.filter((m) => m.userId === where.userId)) },
      projectMember: { findMany: vi.fn(async ({ where }: any) => w.members.filter((m) => m.userId === where.userId)) },
      project: {
        findMany: vi.fn(async ({ where }: any) => w.projects.filter((p) => projectMatch(p, where)).map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))),
        findUnique: vi.fn(async ({ where }: any) => w.projects.find((p) => p.id === where.id) ?? null),
        findFirst: vi.fn(async () => null),
      },
      doc: {
        count: vi.fn(async ({ where }: any) => w.docs.filter((d) => docMatch(d, where)).length),
        findMany: vi.fn(async ({ where, orderBy, skip = 0, take }: any) =>
          sortDocs(w.docs.filter((d) => docMatch(d, where)), orderBy).slice(skip, skip + take).map((d) => ({ ...d, author: { name: userName(d.authorId) } }))),
        groupBy: vi.fn(async ({ where, _max }: any) => {
          const field = Object.keys(_max)[0]
          const groups = new Map<string, any>()
          for (const d of w.docs.filter((x) => docMatch(x, where))) {
            const g = groups.get(d.projectId) ?? { projectId: d.projectId, _count: { _all: 0 }, _max: { [field]: null } }
            g._count._all++
            if (!g._max[field] || d[field] > g._max[field]) g._max[field] = d[field]
            groups.set(d.projectId, g)
          }
          return [...groups.values()]
        }),
      },
      auditLog: {
        findMany: vi.fn(async ({ where }: any) => {
          const rows = w.audits.filter((a) => a.entityType === where.entityType && a.action === where.action && where.entityId.in.includes(a.entityId)).sort((a, b) => b.createdAt - a.createdAt)
          const seen = new Set<string>()
          return rows.filter((a) => (seen.has(a.entityId) ? false : (seen.add(a.entityId), true))).map((a) => ({ entityId: a.entityId, user: { name: userName(a.userId) } }))
        }),
      },
      gideonRunStep: { create: vi.fn(async () => ({})) },
    },
  }
})

import { POST } from '@/app/api/gideon/tools/route'
import { parseWibInstant } from '@/lib/gideon-list-docs'

async function call(input: Record<string, unknown>, actorId = 'staff-1') {
  w.actorId = actorId
  const res = await POST(new Request('http://localhost/api/gideon/tools', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer svc' }, body: JSON.stringify({ action: 'list_docs', input }) }))
  return { status: res.status, body: (await res.json()) as any }
}

// WIB = UTC+7: "2026-10-19 08:00 WIB" = 01:00Z.
const wib = (s: string) => new Date(Date.parse(`${s}:00Z`) - 7 * 3_600_000)

beforeEach(() => {
  w.users = [
    { id: 'staff-1', name: 'Sari Staff' },
    { id: 'bod-1', name: 'Budi BoD' },
    { id: 'ex-1', name: 'Eko Former' },
    { id: 'mgr-1', name: 'Maya Manager' },
  ]
  w.workspaces = [
    { userId: 'staff-1', workspaceId: 'ws', role: 'STAFF' },
    { userId: 'bod-1', workspaceId: 'ws', role: 'BOD' },
    { userId: 'mgr-1', workspaceId: 'ws', role: 'MANAGER' },
    // ex-1 left the workspace but still has a stale project membership.
  ]
  w.projects = [
    { id: 'p-intoo', name: 'Master IP Intoo', workspaceId: 'ws' },
    { id: 'p-agenz', name: 'Master IP Agenz', workspaceId: 'ws' },
    { id: 'p-secret', name: 'Master IP Secret (private)', workspaceId: 'ws' },
    { id: 'p-other', name: 'Finance', workspaceId: 'ws' },
    { id: 'p-foreign', name: 'Master IP Elsewhere', workspaceId: 'ws-2' },
  ]
  w.members = [
    { userId: 'staff-1', projectId: 'p-intoo', role: 'MEMBER', accessLevel: 'EDIT' },
    { userId: 'staff-1', projectId: 'p-agenz', role: 'VIEWER', accessLevel: 'VIEW' },
    { userId: 'staff-1', projectId: 'p-foreign', role: 'MEMBER', accessLevel: 'EDIT' },
    { userId: 'mgr-1', projectId: 'p-intoo', role: 'MEMBER', accessLevel: 'EDIT' },
    { userId: 'ex-1', projectId: 'p-intoo', role: 'MEMBER', accessLevel: 'EDIT' },
  ]
  const long = 'Selesai: '.padEnd(600, 'x')
  w.docs = [
    { id: 'd1', title: 'Daily Update Intoo 19 Okt', projectId: 'p-intoo', authorId: 'staff-1', createdAt: wib('2026-10-19T08:00'), updatedAt: wib('2026-10-19T09:30'), contentText: long },
    { id: 'd2', title: 'Daily Update Intoo 18 Okt', projectId: 'p-intoo', authorId: 'staff-1', createdAt: wib('2026-10-18T08:00'), updatedAt: wib('2026-10-18T08:10'), contentText: 'Kemarin' },
    { id: 'd3', title: 'Daily Update Agenz 17 Okt', projectId: 'p-agenz', authorId: 'mgr-1', createdAt: wib('2026-10-17T08:00'), updatedAt: wib('2026-10-17T08:00'), contentText: 'Agenz' },
    { id: 'd4', title: 'Daily Update Secret 19 Okt', projectId: 'p-secret', authorId: 'bod-1', createdAt: wib('2026-10-19T07:00'), updatedAt: wib('2026-10-19T07:00'), contentText: 'RAHASIA gaji direksi' },
    { id: 'd5', title: 'Budget notes', projectId: 'p-other', authorId: 'bod-1', createdAt: wib('2026-10-19T06:00'), updatedAt: wib('2026-10-19T06:00'), contentText: 'finance' },
    { id: 'd6', title: 'Daily Update Elsewhere', projectId: 'p-foreign', authorId: 'bod-1', createdAt: wib('2026-10-19T06:00'), updatedAt: wib('2026-10-19T06:00'), contentText: 'other workspace' },
    // 00:30 WIB on 19 Oct = 18 Oct 17:30Z: belongs to the 19th in WIB.
    { id: 'd7', title: 'Late night note Intoo', projectId: 'p-intoo', authorId: 'staff-1', createdAt: wib('2026-10-19T00:30'), updatedAt: wib('2026-10-19T00:30'), contentText: 'malam' },
  ]
  w.audits = [
    { entityType: 'doc', action: 'update', entityId: 'd1', userId: 'mgr-1', createdAt: wib('2026-10-19T09:30') },
    { entityType: 'doc', action: 'update', entityId: 'd1', userId: 'staff-1', createdAt: wib('2026-10-19T09:00') },
  ]
})

describe('nexus_list_docs access', () => {
  it('Staff never sees a private project (not a member) or a project of a workspace they are not in', async () => {
    const { status, body } = await call({ projectQuery: 'Master' })
    expect(status).toBe(200)
    const projects = body.data.projects.map((p: any) => p.name)
    expect(projects).toEqual(['Master IP Agenz', 'Master IP Intoo'])
    const ids = body.data.items.map((d: any) => d.id)
    expect(ids).not.toContain('d4')
    expect(ids).not.toContain('d6')
    expect(JSON.stringify(body)).not.toContain('RAHASIA')
    expect(JSON.stringify(body)).not.toContain('Secret')
  })

  it('Staff asking for the private project by id gets the same refusal as a project that does not exist', async () => {
    const a = await call({ projectId: 'p-secret' })
    const b = await call({ projectId: 'no-such-project' })
    expect(a.status).toBe(400)
    expect(a.body.ok).toBe(false)
    expect(a.body.error).toBe(b.body.error)
    expect(a.body.error).not.toContain('Secret')
  })

  it('a VIEW-only member still lists that project (any level opens a page, as GET /api/docs/[id])', async () => {
    const { body } = await call({ projectId: 'p-agenz' })
    expect(body.data.items.map((d: any) => d.id)).toEqual(['d3'])
  })

  it('BoD sees every project of the workspace, including the private one, but not another workspace', async () => {
    const { body } = await call({ projectQuery: 'Master' }, 'bod-1')
    expect(body.data.projects.map((p: any) => p.name)).toEqual(['Master IP Agenz', 'Master IP Intoo', 'Master IP Secret (private)'])
    expect(body.data.items.map((d: any) => d.id)).not.toContain('d6')
  })

  it('a member who left the workspace sees nothing (projectAccessLevel needs the workspace)', async () => {
    const { body } = await call({}, 'ex-1')
    expect(body.data.total).toBe(0)
    expect(body.data.items).toEqual([])
  })

  it('a project name that matches nothing visible answers so, without listing everything', async () => {
    const { body } = await call({ projectQuery: 'Secret' })
    expect(body.data.total).toBe(0)
    expect(body.data.note).toMatch(/No project/)
  })
})

describe('nexus_list_docs filters', () => {
  it('updatedSince is a WIB day: 00:30 WIB on the 19th counts, the 18th does not; newest first', async () => {
    const { body } = await call({ projectQuery: 'Master', updatedSince: '2026-10-19' })
    expect(body.data.items.map((d: any) => d.id)).toEqual(['d1', 'd7'])
    expect(body.data.window.fromDay).toBe('2026-10-19')
    // "Which IP has not posted today": Agenz is listed with 0 pages.
    expect(body.data.projects).toEqual([
      expect.objectContaining({ name: 'Master IP Agenz', pages: 0, latestDay: null }),
      expect.objectContaining({ name: 'Master IP Intoo', pages: 2, latestDay: '2026-10-19' }),
    ])
  })

  it('updatedBefore is exclusive and combines with updatedSince (a week window)', async () => {
    const { body } = await call({ updatedSince: '2026-10-17', updatedBefore: '2026-10-19' })
    expect(body.data.items.map((d: any) => d.id)).toEqual(['d2', 'd3'])
  })

  it('titleQuery matches part of the title, case-insensitive', async () => {
    const { body } = await call({ titleQuery: 'daily update intoo' })
    expect(body.data.items.map((d: any) => d.id)).toEqual(['d1', 'd2'])
  })

  it('a row carries project, both dates, WIB days, author, last editor, a short excerpt and the URL — never the body', async () => {
    const { body } = await call({ projectId: 'p-intoo', limit: 1 })
    const d = body.data.items[0]
    expect(d).toMatchObject({ id: 'd1', title: 'Daily Update Intoo 19 Okt', project: { id: 'p-intoo', name: 'Master IP Intoo' }, createdDay: '2026-10-19', updatedDay: '2026-10-19', author: 'Sari Staff', lastEditedBy: 'Maya Manager', url: 'https://nexus.test/docs/d1' })
    expect(d.excerpt.length).toBeLessThanOrEqual(200)
    expect(d).not.toHaveProperty('text')
    expect(d).not.toHaveProperty('contentText')
    expect(d).not.toHaveProperty('content')
  })

  it('no audit row → the author is the last editor', async () => {
    const { body } = await call({ titleQuery: '18 Okt' })
    expect(body.data.items[0].lastEditedBy).toBe('Sari Staff')
  })

  it('sort=created filters and sorts by creation', async () => {
    const { body } = await call({ projectId: 'p-intoo', sort: 'created', updatedSince: '2026-10-19' })
    expect(body.data.window.field).toBe('createdAt')
    expect(body.data.items.map((d: any) => d.id)).toEqual(['d1', 'd7'])
  })

  it('a date it cannot read is refused, not ignored', async () => {
    const { status, body } = await call({ updatedSince: 'minggu ini' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/updatedSince/)
  })

  it('parseWibInstant: day = 00:00 WIB, bare date-time = WIB, an offset is kept', () => {
    expect(parseWibInstant('2026-10-19', 'x')!.toISOString()).toBe('2026-10-18T17:00:00.000Z')
    expect(parseWibInstant('2026-10-19T08:00', 'x')!.toISOString()).toBe('2026-10-19T01:00:00.000Z')
    expect(parseWibInstant('2026-10-19T08:00:00Z', 'x')!.toISOString()).toBe('2026-10-19T08:00:00.000Z')
    expect(parseWibInstant('', 'x')).toBeUndefined()
  })
})

describe('nexus_list_docs paging', () => {
  it('default 20, max 50; total + more + offset walk the list without gaps or repeats', async () => {
    w.docs = Array.from({ length: 57 }, (_, i) => ({ id: `x${String(i).padStart(2, '0')}`, title: `Daily ${i}`, projectId: 'p-intoo', authorId: 'staff-1', createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)), updatedAt: new Date(Date.UTC(2026, 9, 1, 0, i)), contentText: '' }))
    const first = await call({})
    expect(first.body.data.shown).toBe(20)
    expect(first.body.data.total).toBe(57)
    expect(first.body.data.more).toMatch(/offset=20/)
    expect(first.body.data.items[0].id).toBe('x56')

    const big = await call({ limit: 500 })
    expect(big.body.data.shown).toBe(50)

    const seen: string[] = []
    let offset = 0
    for (;;) {
      const r = await call({ limit: 25, offset })
      seen.push(...r.body.data.items.map((d: any) => d.id))
      if (!r.body.data.more) break
      offset += r.body.data.shown
    }
    expect(seen.length).toBe(57)
    expect(new Set(seen).size).toBe(57)
  })
})
