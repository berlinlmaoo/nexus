// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GIDEON move_room_booking / cancel_room_booking (owner, 16 Oct 2026): the approval matrix per mode, the plan (what
 * is left out stays), the card (before/after), old clients cannot apply, the re-check on Apply (a slot taken meanwhile,
 * and the database's exclusion constraint, both answer ROOM_TAKEN and keep the card open), the Room Booking page's own
 * permission (shared with PATCH/DELETE /api/room-bookings/:id), a card made stale by a change in between, and dont_ask.
 * Prisma is an in-memory world; the booking path (lib/room-booking.ts) is real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => {
  process.env.NEXUS_ORG_WORKSPACE_ID = 'org-ws'
  process.env.NEXUS_GIDEON_SERVICE_TOKEN = 'svc'
  return { mode: 'review', roles: {} as Record<string, string>, proposals: [] as any[], bookings: [] as any[], steps: [] as any[], seq: 0, raceOnUpdate: false, deleted: [] as any[], sessionUser: 'actor-1' }
})

vi.mock('@/lib/gideon-service-auth', () => ({ authenticateGideonService: vi.fn(async () => ({ ok: true, actor: { id: 'actor-1', name: 'Asker', email: 'asker@example.test' } })) }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: w.sessionUser } })) }))
vi.mock('@/lib/notification-service', () => ({ notifyTaskAssigned: vi.fn(), notifyTaskCompleted: vi.fn(), notifyCommentAdded: vi.fn(), notifyComplaintStatus: vi.fn(), createInAppNotification: vi.fn(async () => null), roomName: (r: string) => r }))
vi.mock('@/lib/deletion-snapshot', () => ({
  restorableDelete: vi.fn(async (input: any) => { w.deleted.push(input); w.bookings = w.bookings.filter((b) => b.id !== input.entityId); return { auditLogId: 'audit-1', rows: 1 } }),
}))

vi.mock('@/lib/prisma', () => {
  const match = (p: any, where: any) => Object.entries(where).every(([k, v]) => p[k] === v)
  const hits = (b: any, where: any) => {
    if (typeof where.id === 'string' && b.id !== where.id) return false
    if (where.id?.not && b.id === where.id.not) return false
    if (where.workspaceId?.in && !where.workspaceId.in.includes(b.workspaceId)) return false
    if (where.status && b.status !== where.status) return false
    if (where.room !== undefined && (typeof where.room === 'string' ? b.room !== where.room : !where.room.in.includes(b.room))) return false
    if (where.startsAt?.lt && !(b.startsAt < where.startsAt.lt)) return false
    if (where.endsAt?.gt && !(b.endsAt > where.endsAt.gt)) return false
    return true
  }
  const withCreator = (b: any) => ({ ...b, createdBy: { id: b.createdById, name: b.createdById === 'actor-1' ? 'Asker' : 'Tester Two' } })
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
      workspaceMember: {
        findUnique: vi.fn(async ({ where }: any) => ({ role: w.roles[where.userId_workspaceId.userId] ?? 'STAFF' })),
        findMany: vi.fn(async () => [{ workspaceId: 'org-ws' }]),
      },
      user: { findUnique: vi.fn(async () => ({ email: 'asker@example.test' })) },
      roomBooking: {
        findFirst: vi.fn(async ({ where }: any) => { const b = w.bookings.filter((x) => hits(x, where)).sort((a, b) => a.startsAt - b.startsAt)[0]; return b ? withCreator(b) : null }),
        findMany: vi.fn(async ({ where }: any) => w.bookings.filter((x) => hits(x, where)).map(withCreator)),
        findUnique: vi.fn(async ({ where }: any) => w.bookings.find((b) => b.id === where.id) ?? null),
        update: vi.fn(async ({ where, data }: any) => {
          // The database's exclusion constraint refusing a move that raced the app's guard.
          if (w.raceOnUpdate) { w.raceOnUpdate = false; throw Object.assign(new Error('conflicting key value violates exclusion constraint "RoomBooking_no_overlap"'), { code: '23P01' }) }
          const b = w.bookings.find((x) => x.id === where.id); Object.assign(b, data); return withCreator(b)
        }),
      },
    },
  }
})

import prisma from '@/lib/prisma'
import { createInAppNotification } from '@/lib/notification-service'
import { restorableDelete } from '@/lib/deletion-snapshot'
import { POST as TOOLS } from '@/app/api/gideon/tools/route'
import { POST as DECIDE } from '@/app/api/gideon/proposals/[id]/route'
import { PATCH, DELETE } from '@/app/api/room-bookings/[bookingId]/route'
import { needsApproval, proposalView } from '@/lib/gideon-runs'
import { planMoveRoom } from '@/lib/gideon-book-room-plan'

// Friday 16 Oct 2026, 10:00 WIB. Bookings are for Monday 19 Oct (WIB = UTC+7).
const NOW = new Date('2026-10-16T03:00:00.000Z')
const MON = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 19, h - 7, m)).toISOString()
const realFetch = globalThis.fetch
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  globalThis.fetch = (async (url: string, init: RequestInit) => TOOLS(new Request(url, init))) as any
})
afterAll(() => { vi.useRealTimers(); globalThis.fetch = realFetch })

const mine = () => ({ id: 'bk-mine', room: 'Studio', title: 'Client pitch', startsAt: new Date(MON(14)), endsAt: new Date(MON(15)), status: 'ACTIVE', workspaceId: 'org-ws', createdById: 'actor-1' })
const theirs = () => ({ id: 'bk-theirs', room: 'Ruang Meeting', title: 'Podcast', startsAt: new Date(MON(16)), endsAt: new Date(MON(17)), status: 'ACTIVE', workspaceId: 'org-ws', createdById: 'u2' })
beforeEach(() => {
  Object.assign(w, { mode: 'review', roles: {}, proposals: [], bookings: [mine(), theirs()], steps: [], seq: 0, raceOnUpdate: false, deleted: [], sessionUser: 'actor-1' })
  vi.mocked(prisma.roomBooking.update).mockClear()
  vi.mocked(restorableDelete).mockClear()
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
const studio = () => w.bookings.find((b) => b.id === 'bk-mine')

describe('move/cancel: the approval matrix and the plan', () => {
  it('always_ask and review hold both; dont_ask applies directly, except a move to a room that could be two', () => {
    for (const action of ['move_room_booking', 'cancel_room_booking']) {
      expect(needsApproval('always_ask', action, { bookingId: 'b', room: 'Studio' }, 'actor-1')).toBe(true)
      expect(needsApproval('review', action, { bookingId: 'b', room: 'Studio' }, 'actor-1')).toBe(true)
      expect(needsApproval('dont_ask', action, { bookingId: 'b', room: 'Studio' }, 'actor-1')).toBe(false)
    }
    expect(needsApproval('dont_ask', 'move_room_booking', { bookingId: 'b', start: '15:00' }, 'actor-1')).toBe(false)
    expect(needsApproval('dont_ask', 'move_room_booking', { bookingId: 'b', room: 'meeting' }, 'actor-1')).toBe(true)
  })

  it('what is left out stays: the room, the day, the length', () => {
    const cur = { room: 'Studio', title: 'Pitch', startsAt: new Date(MON(14)), endsAt: new Date(MON(15, 30)) }
    expect(planMoveRoom({ bookingId: 'b', start: '16:00' }, cur, NOW)).toMatchObject({ room: 'Studio', roomChanged: false, timeChanged: true })
    expect(planMoveRoom({ bookingId: 'b', start: '16:00' }, cur, NOW).end.toISOString()).toBe(MON(17, 30))
    const p = planMoveRoom({ booking_id: 'b', date: '2026-10-20' }, cur, NOW)
    expect([p.start.toISOString(), p.end.toISOString()]).toEqual([new Date(Date.UTC(2026, 9, 20, 7)).toISOString(), new Date(Date.UTC(2026, 9, 20, 8, 30)).toISOString()])
    expect(planMoveRoom({ bookingId: 'b', room: 'vip' }, cur, NOW)).toMatchObject({ room: 'Ruang Meeting VIP', roomChanged: true, timeChanged: false })
    expect(planMoveRoom({ bookingId: 'b', room: 'meeting' }, cur, NOW)).toMatchObject({ room: null, candidates: ['Ruang Meeting VIP', 'Ruang Meeting'] })
    expect(() => planMoveRoom({ bookingId: 'b', room: 'studio' }, cur, NOW)).toThrow(/nothing would change/)
    expect(() => planMoveRoom({ bookingId: 'b', date: '2026-10-01' }, cur, NOW)).toThrow(/already passed/)
    expect(() => planMoveRoom({ start: '16:00' }, cur, NOW)).toThrow(/bookingId is required/)
    expect(() => planMoveRoom({ bookingId: 'b', room: 'Rooftop' }, cur, NOW)).toThrow(/Unknown room/)
  })
})

describe('move_room_booking through the tools route and Apply', () => {
  it('review: a card with the booking before and after; nothing moved; the released apps get an App row', async () => {
    const r = await call('move_room_booking', { bookingId: 'bk-mine', start: '15:00' })
    expect(r.body.data).toMatchObject({ proposed: true, status: 'PENDING' })
    expect(prisma.roomBooking.update).not.toHaveBeenCalled()
    const view = proposalView(w.proposals[0])
    expect(view.bookingChange).toMatchObject({
      kind: 'move', bookingId: 'bk-mine', title: 'Client pitch',
      before: { room: 'Studio', start: '14:00', end: '15:00', startsAt: MON(14) },
      after: { room: 'Studio', start: '15:00', end: '16:00', startsAt: MON(15), endsAt: MON(16) },
    })
    expect(view.summary).toBe('Move “Client pitch” · Studio · Mon 19 Oct 14:00–15:00 → Studio · Mon 19 Oct 15:00–16:00')
    expect(view.diff.find((d) => d.field === 'When')).toMatchObject({ from: 'Mon 19 Oct 14:00–15:00', to: 'Mon 19 Oct 15:00–16:00' })
    expect(view.diff.find((d) => d.field === 'App')?.to).toMatch(/latest app or the web to move this booking/)
    expect(view).not.toHaveProperty('booking')
  })

  it('a client without the card cannot apply it: NEEDS_LATEST_APP, and it stays waiting', async () => {
    const id = (await call('move_room_booking', { bookingId: 'bk-mine', start: '15:00' })).body.data.proposalId
    for (const booking of [undefined, { room: 'Studio', startsAt: MON(15), endsAt: MON(16) }, { bookingId: 'bk-theirs', room: 'Studio', startsAt: MON(15), endsAt: MON(16) }]) {
      const r = await decide(id, { decision: 'apply', ...(booking ? { booking } : {}) })
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('NEEDS_LATEST_APP')
    }
    expect(w.proposals[0].status).toBe('PENDING')
    expect(prisma.roomBooking.update).not.toHaveBeenCalled()
  })

  it('Apply with the card choice moves it, as the person, through the Room Booking path', async () => {
    const id = (await call('move_room_booking', { bookingId: 'bk-mine', start: '15:00' })).body.data.proposalId
    const r = await decide(id, { decision: 'apply', booking: { bookingId: 'bk-mine', room: 'Ruang Meeting VIP', startsAt: MON(15), endsAt: MON(16) } })
    expect(r.status).toBe(200)
    expect(r.body.proposal.status).toBe('APPLIED')
    expect(studio()).toMatchObject({ room: 'Ruang Meeting VIP', startsAt: new Date(MON(15)), endsAt: new Date(MON(16)) })
    expect(r.body.proposal.bookingChange.applied).toMatchObject({ room: 'Ruang Meeting VIP', start: '15:00', end: '16:00' })
    expect(r.body.proposal.summary).toMatch(/→ Ruang Meeting VIP · Mon 19 Oct 15:00–16:00$/)
    // Their own booking: nobody else is told.
    expect(createInAppNotification).not.toHaveBeenCalled()
  })

  it('taken between the card and the tap: refused, the card stays open with the nearest free slots; another room goes through', async () => {
    const id = (await call('move_room_booking', { bookingId: 'bk-mine', start: '16:00' })).body.data.proposalId
    const r = await decide(id, { decision: 'apply', booking: { bookingId: 'bk-mine', room: 'Ruang Meeting', startsAt: MON(16), endsAt: MON(17) } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('ROOM_TAKEN')
    expect(r.body.proposal.status).toBe('PENDING')
    expect(r.body.proposal.error).toMatch(/^Ruang Meeting is already booked then \(“Podcast” by Tester Two until 17:00\)\. Nothing was moved\. Nearest free: /)
    expect(r.body.freeSlots.length).toBeGreaterThan(0)
    expect(studio().room).toBe('Studio')
    const again = await decide(id, { decision: 'apply', booking: { bookingId: 'bk-mine', room: 'Studio', startsAt: MON(16), endsAt: MON(17) } })
    expect(again.body.proposal.status).toBe('APPLIED')
    expect(again.body.proposal.error).toBeNull()
  })

  it('the database refuses a move that raced the guard (23P01): the same ROOM_TAKEN, card open', async () => {
    const id = (await call('move_room_booking', { bookingId: 'bk-mine', start: '18:00' })).body.data.proposalId
    w.raceOnUpdate = true
    const r = await decide(id, { decision: 'apply', booking: { bookingId: 'bk-mine', room: 'Studio', startsAt: MON(18), endsAt: MON(19) } })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('ROOM_TAKEN')
    expect(r.body.proposal.status).toBe('PENDING')
    expect(studio().startsAt.toISOString()).toBe(MON(14))
  })

  it('a booking that changed after the card was made is not moved', async () => {
    const id = (await call('move_room_booking', { bookingId: 'bk-mine', start: '18:00' })).body.data.proposalId
    studio().startsAt = new Date(MON(13)); studio().endsAt = new Date(MON(14))
    const r = await decide(id, { decision: 'apply', booking: { bookingId: 'bk-mine', room: 'Studio', startsAt: MON(18), endsAt: MON(19) } })
    expect(r.status).toBe(422)
    expect(r.body.proposal.status).toBe('FAILED')
    expect(r.body.proposal.error).toMatch(/changed since this card was made/)
  })

  it("someone else's booking: refused for staff (the page's rule); a manager gets the card naming whose it is", async () => {
    const refused = await call('move_room_booking', { bookingId: 'bk-theirs', start: '18:00' })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/Only the person who booked it, or a manager, can move this booking/)
    expect(w.proposals).toHaveLength(0)
    w.roles['actor-1'] = 'MANAGER'
    await call('move_room_booking', { bookingId: 'bk-theirs', start: '18:00' })
    expect(w.proposals[0].diff.find((d: any) => d.field === 'Booked by').to).toBe('Tester Two')
    const r = await decide(w.proposals[0].id, { decision: 'apply', booking: { bookingId: 'bk-theirs', room: 'Ruang Meeting', startsAt: MON(18), endsAt: MON(19) } })
    expect(r.body.proposal.status).toBe('APPLIED')
    // The owner is told a manager changed it, as on the Room Booking page.
    expect(createInAppNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2', type: 'booking_changed' }))
  })

  it('a named room that could be two waits for the pick even in dont_ask; the card has the candidates', async () => {
    w.mode = 'dont_ask'
    const r = await call('move_room_booking', { bookingId: 'bk-mine', room: 'meeting' })
    expect(r.body.data.proposed).toBe(true)
    expect(proposalView(w.proposals[0]).bookingChange?.after).toMatchObject({ room: null, requestedRoom: 'meeting', candidates: ['Ruang Meeting VIP', 'Ruang Meeting'] })
  })

  it('dont_ask moves directly and logs the booking as a source', async () => {
    w.mode = 'dont_ask'
    const r = await call('move_room_booking', { bookingId: 'bk-mine', room: 'vip' })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ moved: true, from: { room: 'Studio' }, booking: { room: 'Ruang Meeting VIP', start: '14:00' } })
    expect(w.steps).toEqual([expect.objectContaining({ tool: 'move_room_booking', label: 'Moving booking Client pitch', ok: true, refs: [expect.objectContaining({ kind: 'booking', id: 'bk-mine' })] })])
  })
})

describe('cancel_room_booking', () => {
  it('review: a card; a client without it cannot apply; Apply with the booking id deletes it through the page path (restorable)', async () => {
    const id = (await call('cancel_room_booking', { bookingId: 'bk-mine' })).body.data.proposalId
    const view = proposalView(w.proposals[0])
    expect(view.bookingChange).toMatchObject({ kind: 'cancel', bookingId: 'bk-mine', after: null, before: { room: 'Studio', start: '14:00' } })
    expect(view.summary).toBe('Cancel “Client pitch” · Studio · Mon 19 Oct 14:00–15:00')
    expect(view.diff.find((d) => d.field === 'App')?.to).toMatch(/latest app or the web to cancel this booking/)
    const old = await decide(id, { decision: 'apply' })
    expect(old.status).toBe(409)
    expect(old.body.code).toBe('NEEDS_LATEST_APP')
    expect(restorableDelete).not.toHaveBeenCalled()
    const r = await decide(id, { decision: 'apply', booking: { bookingId: 'bk-mine' } })
    expect(r.status).toBe(200)
    expect(r.body.proposal.status).toBe('APPLIED')
    expect(restorableDelete).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'room_booking', entityId: 'bk-mine', userId: 'actor-1', metadata: expect.objectContaining({ via: 'gideon' }) }))
    expect(studio()).toBeUndefined()
  })

  it("dont_ask cancels directly; someone else's booking is refused for staff", async () => {
    w.mode = 'dont_ask'
    const r = await call('cancel_room_booking', { bookingId: 'bk-mine' })
    expect(r.body.data).toMatchObject({ cancelled: true, booking: { id: 'bk-mine', room: 'Studio' } })
    const refused = await call('cancel_room_booking', { bookingId: 'bk-theirs' })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/can cancel this booking/)
    expect(restorableDelete).toHaveBeenCalledTimes(1)
  })
})

describe('the Room Booking routes share the same rules', () => {
  const patch = (id: string, body: unknown) => PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ bookingId: id }) })
  const del = (id: string) => DELETE(new Request('http://localhost', { method: 'DELETE' }) as never, { params: Promise.resolve({ bookingId: id }) })

  it('PATCH: 403 for staff on another booking, 404 unknown, 409 ROOM_TAKEN, 200 with { booking }', async () => {
    expect((await patch('bk-theirs', { title: 'x' })).status).toBe(403)
    expect(await (await patch('bk-theirs', { title: 'x' })).json()).toEqual({ error: 'Cuma pembuat booking atau manager yang bisa ubah booking ini.' })
    expect((await patch('nope', { title: 'x' })).status).toBe(404)
    const taken = await patch('bk-mine', { room: 'Ruang Meeting', startsAt: MON(16), endsAt: MON(17) })
    expect(taken.status).toBe(409)
    expect((await taken.json()).code).toBe('ROOM_TAKEN')
    const ok = await patch('bk-mine', { title: ' New title ' })
    expect(ok.status).toBe(200)
    expect((await ok.json()).booking).toMatchObject({ id: 'bk-mine', title: 'New title' })
  })

  it('DELETE: 403 message unchanged, 200 { success: true } through the Audit copy', async () => {
    const no = await del('bk-theirs')
    expect(no.status).toBe(403)
    expect(await no.json()).toEqual({ error: 'Cuma pembuat booking atau manager yang bisa hapus booking ini.' })
    const yes = await del('bk-mine')
    expect(await yes.json()).toEqual({ success: true })
    expect(restorableDelete).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'bk-mine', metadata: { room: 'Studio', createdById: 'actor-1' } }))
  })
})
