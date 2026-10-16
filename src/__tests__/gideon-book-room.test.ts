// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GIDEON book_room (owner, 16 Oct 2026): the approval matrix per mode, the room picker contract (a client without
 * it cannot apply), the re-check on Apply (a slot taken meanwhile is refused and the card stays open), a non-company
 * account refused, and the run log. Prisma is an in-memory world; the booking path (lib/room-booking.ts) is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => {
  process.env.NEXUS_ORG_WORKSPACE_ID = 'org-ws'
  process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'svc'
  return { mode: 'review', outsider: false, proposals: [] as any[], bookings: [] as any[], steps: [] as any[], seq: 0 }
})

vi.mock('@/lib/gideon-service-auth', () => ({ authenticateGideonService: vi.fn(async () => ({ ok: true, actor: { id: 'actor-1', name: 'Asker', email: 'asker@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'actor-1' } })) }))
vi.mock('@/lib/notification-service', () => ({ notifyTaskAssigned: vi.fn(), notifyTaskCompleted: vi.fn(), notifyCommentAdded: vi.fn(), notifyComplaintStatus: vi.fn(), createInAppNotification: vi.fn(async () => null), roomName: (r: string) => r }))

vi.mock('@/lib/prisma', () => {
  const match = (p: any, where: any) => Object.entries(where).every(([k, v]) => p[k] === v)
  const overlapping = (where: any) => w.bookings.filter((b) =>
    b.status === 'ACTIVE' && where.workspaceId.in.includes(b.workspaceId)
    && (typeof where.room === 'string' ? b.room === where.room : where.room.in.includes(b.room))
    && (!where.id?.not || b.id !== where.id.not)
    && b.startsAt < where.startsAt.lt && b.endsAt > where.endsAt.gt)
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
      workspaceMember: { findUnique: vi.fn(async () => (w.outsider ? null : { role: 'STAFF' })) },
      user: { findUnique: vi.fn(async () => ({ email: 'asker@example.test' })) },
      roomBooking: {
        findFirst: vi.fn(async ({ where }: any) => overlapping(where)[0] ?? null),
        findMany: vi.fn(async ({ where }: any) => overlapping(where)),
        create: vi.fn(async ({ data }: any) => { const b = { id: `bk-${w.bookings.length + 1}`, status: 'ACTIVE', ...data, createdBy: { id: data.createdById, name: 'Asker' } }; w.bookings.push(b); return b }),
      },
    },
  }
})

import prisma from '@/lib/prisma'
import { createInAppNotification } from '@/lib/notification-service'
import { POST as TOOLS } from '@/app/api/gideon/tools/route'
import { POST as DECIDE } from '@/app/api/gideon/proposals/[id]/route'
import { needsApproval, proposalView } from '@/lib/gideon-runs'
import { parseBookRoomChoice, planBookRoom } from '@/lib/gideon-book-room-plan'

// Friday 16 Oct 2026, 10:00 WIB. Bookings are for Monday 19 Oct (WIB = UTC+7).
const NOW = new Date('2026-10-16T03:00:00.000Z')
const MON = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 19, h - 7, m)).toISOString()
const realFetch = globalThis.fetch
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  // The apply route calls /api/gideon/tools over HTTP as the person; here that is the handler itself.
  globalThis.fetch = (async (url: string, init: RequestInit) => TOOLS(new Request(url, init))) as any
})
afterAll(() => { vi.useRealTimers(); globalThis.fetch = realFetch })
beforeEach(() => {
  Object.assign(w, { mode: 'review', outsider: false, proposals: [], bookings: [], steps: [], seq: 0 })
  vi.mocked(prisma.roomBooking.create).mockClear()
  vi.mocked(createInAppNotification).mockClear()
})

const call = async (action: string, input: Record<string, unknown>) => {
  const res = await TOOLS(new Request('http://localhost/api/gideon/tools', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer svc', 'x-gideon-run': 'run-1' },
    body: JSON.stringify({ action, input }),
  }))
  return { status: res.status, body: await res.json() as any }
}
const decide = async (id: string, body: Record<string, unknown>) => {
  const res = await DECIDE(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) })
  return { status: res.status, body: await res.json() as any }
}
const ask = { date: '2026-10-19', start: '14:00', end: '15:00', title: 'Client pitch' }

describe('book_room: the approval matrix', () => {
  it('always_ask and review always hold it; dont_ask books directly only when one room was named', () => {
    for (const room of ['Studio', undefined, 'meeting']) {
      expect(needsApproval('always_ask', 'book_room', { room }, 'actor-1')).toBe(true)
      expect(needsApproval('review', 'book_room', { room }, 'actor-1')).toBe(true)
    }
    expect(needsApproval('dont_ask', 'book_room', { room: 'Studio' }, 'actor-1')).toBe(false)
    expect(needsApproval('dont_ask', 'book_room', { room: 'vip' }, 'actor-1')).toBe(false)
    expect(needsApproval('dont_ask', 'book_room', {}, 'actor-1')).toBe(true)
    expect(needsApproval('dont_ask', 'book_room', { room: 'meeting' }, 'actor-1')).toBe(true) // Ruang Meeting or VIP
  })

  it('the plan: a relative day, WIB times, the model spellings; a picked choice is checked', () => {
    const p = planBookRoom({ date: 'monday', start_time: '14:00', duration_minutes: 90, title: 'Pitch', room: 'vip' })
    expect([p.start.toISOString(), p.end.toISOString(), p.room]).toEqual([MON(14), MON(15, 30), 'Ruang Meeting VIP'])
    expect(planBookRoom({ ...ask, room: 'meeting' })).toMatchObject({ room: null, requestedRoom: 'meeting', candidates: ['Ruang Meeting VIP', 'Ruang Meeting'] })
    expect(() => planBookRoom({ ...ask, end: '13:00' })).toThrow(/after the start/)
    expect(parseBookRoomChoice({ room: 'Rooftop', startsAt: MON(14), endsAt: MON(15) })).toBeNull()
    expect(parseBookRoomChoice({ room: 'Studio', startsAt: MON(15), endsAt: MON(14) })).toBeNull()
    expect(parseBookRoomChoice({ room: 'Studio', startsAt: MON(14), endsAt: MON(15) })).toEqual({ room: 'Studio', startsAt: MON(14), endsAt: MON(15) })
  })
})

describe('book_room through the tools route and Apply', () => {
  it('review, no room named: a card with the picker data; nothing booked', async () => {
    const r = await call('book_room', ask)
    expect(r.body.data).toMatchObject({ proposed: true, status: 'PENDING' })
    expect(prisma.roomBooking.create).not.toHaveBeenCalled()
    const view = proposalView(w.proposals[0])
    expect(view.booking).toMatchObject({ room: null, title: 'Client pitch', day: '2026-10-19', start: '14:00', end: '15:00', startsAt: MON(14), endsAt: MON(15) })
    expect(view.diff.find((d) => d.field === 'App')?.to).toMatch(/latest app or the web/)
  })

  it('a client without the picker cannot apply it: "open on the latest app", and it stays waiting', async () => {
    const id = (await call('book_room', { ...ask, room: 'Studio' })).body.data.proposalId
    const r = await decide(id, { decision: 'apply' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('NEEDS_LATEST_APP')
    expect(r.body.proposal.error).toMatch(/latest app or the web to choose a room/)
    expect(w.proposals[0].status).toBe('PENDING')
    expect(prisma.roomBooking.create).not.toHaveBeenCalled()
  })

  it('Apply with the picked room books it as the person, with the usual confirmation', async () => {
    const id = (await call('book_room', ask)).body.data.proposalId
    const r = await decide(id, { decision: 'apply', booking: { room: 'Studio', startsAt: MON(14), endsAt: MON(15) } })
    expect(r.status).toBe(200)
    expect(r.body.proposal.status).toBe('APPLIED')
    expect(w.bookings).toHaveLength(1)
    expect(w.bookings[0]).toMatchObject({ room: 'Studio', createdById: 'actor-1', workspaceId: 'org-ws', title: 'Client pitch' })
    expect(r.body.proposal.booking).toMatchObject({ room: 'Studio', bookingId: 'bk-1' })
    expect(createInAppNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'actor-1', type: 'booking_confirmed' }))
  })

  it('taken between the card and the tap: refused, never double-booked, the card stays open with the nearest free slots', async () => {
    const id = (await call('book_room', { ...ask, room: 'Studio' })).body.data.proposalId
    w.bookings.push({ id: 'other', room: 'Studio', title: 'Podcast', startsAt: new Date(MON(14)), endsAt: new Date(MON(15)), status: 'ACTIVE', workspaceId: 'org-ws', createdById: 'u2', createdBy: { id: 'u2', name: 'Tester Two' } })
    const r = await decide(id, { decision: 'apply', booking: { room: 'Studio', startsAt: MON(14), endsAt: MON(15) } })
    expect(r.status).toBe(409)
    expect(r.body.proposal.status).toBe('PENDING')
    expect(r.body.proposal.error).toBe('Studio is already booked then (“Podcast” by Tester Two until 15:00). Nothing was booked. Nearest free: 13:00–14:00, 15:00–16:00, 12:30–13:30, 15:30–16:30 WIB.')
    expect(r.body.freeSlots.length).toBeGreaterThan(0)
    expect(w.bookings.filter((b) => b.room === 'Studio')).toHaveLength(1)
    // Another room on the same card then goes through.
    const again = await decide(id, { decision: 'apply', booking: { room: 'Ruang Meeting', startsAt: MON(14), endsAt: MON(15) } })
    expect(again.body.proposal.status).toBe('APPLIED')
    expect(again.body.proposal.error).toBeNull()
  })

  it('the card names a busy room\'s holder up front', async () => {
    w.bookings.push({ id: 'other', room: 'Studio', title: 'Podcast', startsAt: new Date(MON(13)), endsAt: new Date(MON(16)), status: 'ACTIVE', workspaceId: 'org-ws', createdById: 'u2', createdBy: { id: 'u2', name: 'Tester Two' } })
    await call('book_room', { ...ask, room: 'Studio' })
    expect(w.proposals[0].diff.find((d: any) => d.field === 'Conflict').to).toBe('Booked by Tester Two until 16:00 (“Podcast”)')
  })

  it('always_ask holds even a named free room', async () => {
    w.mode = 'always_ask'
    const r = await call('book_room', { ...ask, room: 'Studio' })
    expect(r.body.data.proposed).toBe(true)
    expect(prisma.roomBooking.create).not.toHaveBeenCalled()
  })

  it("dont_ask with a named room books directly, and the run log records a book_room step and the booking as a source", async () => {
    w.mode = 'dont_ask'
    const r = await call('book_room', { ...ask, room: 'studio' })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ booked: true, booking: { room: 'Studio', start: '14:00', end: '15:00', dayLabel: 'Mon 19 Oct' } })
    expect(w.proposals).toHaveLength(0)
    expect(w.steps).toEqual([expect.objectContaining({ tool: 'book_room', label: 'Booking Studio, 2026-10-19', ok: true, refs: [expect.objectContaining({ kind: 'booking', id: 'bk-1' })] })])
  })

  it('dont_ask with a taken named room: refused with the holder and the nearest free slots', async () => {
    w.mode = 'dont_ask'
    w.bookings.push({ id: 'other', room: 'Studio', title: 'Podcast', startsAt: new Date(MON(14)), endsAt: new Date(MON(15)), status: 'ACTIVE', workspaceId: 'org-ws', createdById: 'u2', createdBy: { id: 'u2', name: 'Tester Two' } })
    const r = await call('book_room', { ...ask, room: 'Studio' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/already booked.*Nothing was booked\. Nearest free/)
    expect(w.bookings).toHaveLength(1)
  })

  it('an account outside the company workspace is refused, in every mode', async () => {
    w.outsider = true
    for (const mode of ['review', 'dont_ask']) {
      w.mode = mode
      const r = await call('book_room', { ...ask, room: 'Studio' })
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/only for the company workspace/)
    }
    expect(w.proposals).toHaveLength(0)
    expect(prisma.roomBooking.create).not.toHaveBeenCalled()
  })
})
