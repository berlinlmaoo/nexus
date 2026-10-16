// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GIDEON get_calendar / list_room_bookings (16 Oct 2026): the person's Master Calendar through the Calendar's
 * own rules (calendarCallerFor + buildItems — nothing re-implemented), and Room Booking as the page shows it.
 * The database is an in-memory world behind a prisma mock; the rules themselves run for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ORG } = vi.hoisted(() => {
  process.env.NEXUS_ORG_WORKSPACE_ID = 'org-ws'
  return { ORG: 'org-ws' }
})

type Task = { id: string; title: string; project: string; due: string; assignees: string[]; status?: string; creatorId?: string }
const world = vi.hoisted(() => ({
  roles: {} as Record<string, string>,
  projectMembers: {} as Record<string, string[]>,
  projects: {} as Record<string, { id: string; name: string; color: string }>,
  tasks: [] as Task[],
  bookings: [] as { id: string; room: string; title: string; startsAt: Date; endsAt: Date; workspaceId: string; status: string; createdBy: { id: string; name: string } }[],
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }))

vi.mock('@/lib/prisma', () => {
  const within = (d: Date, w: { gte?: Date; lt?: Date; lte?: Date; gt?: Date } | undefined) =>
    !w || ((!w.gte || d >= w.gte) && (!w.lt || d < w.lt) && (!w.lte || d <= w.lte) && (!w.gt || d > w.gt))
  return {
    default: {
      workspaceMember: {
        findUnique: vi.fn(async ({ where }: any) => {
          const k = where.userId_workspaceId
          return k.workspaceId === ORG && world.roles[k.userId] ? { role: world.roles[k.userId] } : null
        }),
        findMany: vi.fn(async () => Object.entries(world.roles).map(([id, role]) => ({ role, user: { id, name: `Person ${id}`, email: `${id}@example.test`, avatar: null } }))),
      },
      appSetting: { findUnique: vi.fn(async () => null) },
      projectMember: {
        findMany: vi.fn(async ({ where }: any) => Object.entries(world.projectMembers).filter(([, ids]) => ids.includes(where.userId)).map(([projectId]) => ({ projectId }))),
      },
      orgUnit: { findMany: vi.fn(async () => [{ id: 'u-design', name: 'Design', kind: 'UNIT', logoUrl: null, parentId: null, position: 0, leadUserId: null }]) },
      orgUnitMember: { findMany: vi.fn(async () => [{ unitId: 'u-design', userId: 'staff', title: null, reportsToUserId: null }]) },
      holiday: { findMany: vi.fn(async () => []) },
      user: { findMany: vi.fn(async () => []) },
      task: {
        findMany: vi.fn(async ({ where }: any) => world.tasks
          .filter((t) => within(new Date(t.due), where.dueDate) && t.assignees.length > 0)
          .map((t) => ({
            id: t.id, title: t.title, status: t.status ?? 'TODO', priority: 'MEDIUM', dueDate: new Date(t.due), creatorId: t.creatorId ?? 'gideon',
            parent: null, taskList: { project: world.projects[t.project] }, taskProjects: [],
            assignees: t.assignees.map((userId) => ({ userId })),
          }))),
      },
      roomBooking: {
        findMany: vi.fn(async ({ where }: any) => world.bookings.filter((b) =>
          b.status === 'ACTIVE'
          && (where.workspaceId?.in ? where.workspaceId.in.includes(b.workspaceId) : b.workspaceId === where.workspaceId)
          && (!where.room?.in || where.room.in.includes(b.room))
          && b.startsAt < where.startsAt.lt && b.endsAt > where.endsAt.gt)),
      },
    },
  }
})

import { gideonGetCalendar, gideonListRoomBookings, readRange } from '@/lib/gideon-calendar-tools'

// Friday 16 Oct 2026, 12:00 WIB. "This week" = Mon 12 – Sun 18 Oct.
const NOW = new Date('2026-10-16T05:00:00.000Z')
const SECRET = 'Payroll bonus list for the board'

beforeEach(() => {
  world.roles = { oaa: 'ONE_ABOVE_ALL', bod: 'BOD', mgr: 'MANAGER', staff: 'STAFF' }
  world.projects = {
    atlas: { id: 'atlas', name: 'Atlas', color: '#111111' },
    fin: { id: 'fin', name: 'Finance Ops', color: '#222222' },
    brand: { id: 'brand', name: 'Brand', color: '#333333' },
  }
  world.projectMembers = { atlas: ['mgr', 'staff'], fin: ['bod'], brand: [] }
  world.tasks = [
    { id: 't-atlas', title: 'Atlas launch plan', project: 'atlas', due: '2026-10-14T00:00:00.000Z', assignees: ['staff'] },
    { id: 't-secret', title: SECRET, project: 'fin', due: '2026-10-15T00:00:00.000Z', assignees: ['bod'] },
    { id: 't-brand', title: 'Brand refresh', project: 'brand', due: '2026-10-16T08:00:00.000Z', assignees: ['oaa'] },
    { id: 't-own-fin', title: 'Send my receipts', project: 'fin', due: '2026-10-16T00:00:00.000Z', assignees: ['staff'] },
    { id: 't-nobody', title: 'Nobody does this', project: 'atlas', due: '2026-10-14T00:00:00.000Z', assignees: [] },
  ]
  world.bookings = []
})

const titles = (r: any) => r.items.map((i: any) => i.title).sort()

describe('get_calendar: the Calendar visibility matrix', () => {
  it('One Above All and BoD see every task in full', async () => {
    for (const who of ['oaa', 'bod']) {
      const r: any = await gideonGetCalendar(who, {}, NOW)
      expect(r.access).toBe('all')
      expect(r.from).toBe('2026-10-12')
      expect(r.to).toBe('2026-10-18')
      expect(titles(r)).toEqual(['Atlas launch plan', 'Brand refresh', SECRET, 'Send my receipts'].sort())
      expect(r.items.every((i: any) => !i.masked)).toBe(true)
    }
  })

  it('a Manager sees their projects and public ones in full, a private project they are not in masked', async () => {
    const r: any = await gideonGetCalendar('mgr', {}, NOW)
    expect(r.access).toBe('all_except_private')
    const masked = r.items.filter((i: any) => i.masked)
    expect(masked).toHaveLength(2)
    expect(masked.every((i: any) => i.title === 'Internal task' && !('id' in i) && !('project' in i) && !('url' in i))).toBe(true)
    expect(titles(r).filter((t: string) => t !== 'Internal task')).toEqual(['Atlas launch plan', 'Brand refresh'])
  })

  it('Staff: their own task in a private project is full; the others in it are masked', async () => {
    const r: any = await gideonGetCalendar('staff', {}, NOW)
    expect(titles(r)).toEqual(['Atlas launch plan', 'Brand refresh', 'Internal task', 'Send my receipts'])
    const m = r.items.find((i: any) => i.masked)
    expect(m).toMatchObject({ masked: true, title: 'Internal task', day: '2026-10-15', dayLabel: 'Thu 15 Oct', assignees: ['Person bod'] })
  })

  it('a masked task never leaks its title, id or project anywhere in the tool output', async () => {
    for (const who of ['mgr', 'staff']) {
      const out = JSON.stringify(await gideonGetCalendar(who, {}, NOW))
      expect(out).not.toContain(SECRET)
      expect(out).not.toContain('t-secret')
    }
    // The Manager is in no Finance task at all, so even the project's name stays out (the Staff member's own
    // receipts task there is theirs to see, project included).
    expect(JSON.stringify(await gideonGetCalendar('mgr', {}, NOW))).not.toContain('Finance Ops')
  })

  it('a project filter drops masked rows instead of revealing their project', async () => {
    const r: any = await gideonGetCalendar('mgr', { projectId: 'fin' }, NOW)
    expect(r.items).toEqual([])
  })

  it('someone outside the company workspace gets access "none" and nothing else', async () => {
    const r: any = await gideonGetCalendar('outsider', {}, NOW)
    expect(r.access).toBe('none')
    expect(r.items).toEqual([])
    expect(JSON.stringify(r)).not.toContain('Atlas')
  })

  it('a task nobody is doing is not on the calendar', async () => {
    const r: any = await gideonGetCalendar('oaa', {}, NOW)
    expect(titles(r)).not.toContain('Nobody does this')
  })

  it('mine = only the tasks the person is doing', async () => {
    const r: any = await gideonGetCalendar('staff', { mine: true }, NOW)
    expect(titles(r)).toEqual(['Atlas launch plan', 'Send my receipts'])
  })

  it('a division filter keeps the tasks of the people placed in it', async () => {
    const r: any = await gideonGetCalendar('oaa', { division: 'design' }, NOW)
    expect(titles(r)).toEqual(['Atlas launch plan', 'Send my receipts'])
  })

  it('an empty week says so', async () => {
    const r: any = await gideonGetCalendar('staff', { from: '2026-11-02', to: '2026-11-08' }, NOW)
    expect(r.items).toEqual([])
    expect(r.count).toBe(0)
    expect(r.note).toMatch(/Nothing is due/)
  })

  it('the range is capped at 62 days and says so', async () => {
    const r: any = await gideonGetCalendar('oaa', { from: '2026-10-01', to: '2026-12-31' }, NOW)
    expect(r.from).toBe('2026-10-01')
    expect(r.to).toBe('2026-12-01')
    expect(r.rangeCapped).toBe(true)
    expect(readRange({ from: '2026-10-01', to: '2026-12-01' }, '2026-10-16', 'week').capped).toBe(false)
  })

  it('sources are the full tasks only', async () => {
    const { refsFromResult } = await import('@/lib/gideon-runs')
    const refs = refsFromResult('get_calendar', await gideonGetCalendar('staff', {}, NOW))
    expect(refs.map((r) => r.id).sort()).toEqual(['t-atlas', 't-brand', 't-own-fin'])
  })
})

describe('list_room_bookings', () => {
  const at = (iso: string) => new Date(iso)
  beforeEach(() => {
    world.bookings = [
      { id: 'b1', room: 'Studio', title: 'Podcast take', startsAt: at('2026-10-17T07:00:00Z'), endsAt: at('2026-10-17T08:00:00Z'), workspaceId: ORG, status: 'ACTIVE', createdBy: { id: 'staff', name: 'Person staff' } },
      { id: 'b2', room: 'Ruang Meeting', title: 'Client call', startsAt: at('2026-10-17T07:00:00Z'), endsAt: at('2026-10-17T09:00:00Z'), workspaceId: ORG, status: 'ACTIVE', createdBy: { id: 'mgr', name: 'Person mgr' } },
      { id: 'b3', room: 'Studio', title: 'Demo workspace booking', startsAt: at('2026-10-17T07:00:00Z'), endsAt: at('2026-10-17T08:00:00Z'), workspaceId: 'demo', status: 'ACTIVE', createdBy: { id: 'x', name: 'X' } },
    ]
  })

  it('lists the company bookings as the page shows them, with free time per room', async () => {
    const r: any = await gideonListRoomBookings('staff', { date: '2026-10-17' }, NOW)
    expect(r.access).toBe('company')
    expect(r.bookings.map((b: any) => [b.room, b.title, b.start, b.end, b.bookedBy])).toEqual([
      ['Studio', 'Podcast take', '14:00', '15:00', 'Person staff'],
      ['Ruang Meeting', 'Client call', '14:00', '16:00', 'Person mgr'],
    ])
    expect(r.freeTime.find((f: any) => f.room === 'Studio').free).toEqual(['08:00–14:00', '15:00–21:00'])
  })

  it('"is the meeting room free tomorrow at 2?" — the slot, with who holds it until when', async () => {
    const r: any = await gideonListRoomBookings('staff', { date: 'tomorrow', room: 'Ruang Meeting', time: '14:00' }, NOW)
    expect(r.slot.day).toBe('2026-10-17')
    expect(r.slot.rooms).toEqual([{ room: 'Ruang Meeting', roomEn: 'Meeting Room', free: false, bookedBy: 'Person mgr', title: 'Client call', until: '16:00' }])
  })

  it('an unknown room is an error that lists the rooms', async () => {
    await expect(gideonListRoomBookings('staff', { room: 'Rooftop' }, NOW)).rejects.toThrow(/Unknown room.*Studio/)
  })

  it('someone outside the company workspace gets nothing', async () => {
    const r: any = await gideonListRoomBookings('outsider', { date: '2026-10-17' }, NOW)
    expect(r.access).toBe('none')
    expect(r.bookings).toEqual([])
  })
})
