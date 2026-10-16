// @vitest-environment node
/**
 * Room Booking double-booking race, against a REAL Postgres (16 Oct 2026). The app's findFirst guard and
 * insert are two statements, so two requests at the same moment can both pass the guard; the exclusion
 * constraint RoomBooking_no_overlap (prisma/sql/2026-10-16-room-booking-no-overlap.sql) must refuse the
 * second insert, and the route must answer it with the usual 409 ROOM_TAKEN.
 *
 * Needs a THROWAWAY database with the schema pushed and that SQL file applied, named by
 * ROOM_BOOKING_TEST_DATABASE_URL; skipped without it. Never point it at a real database: it writes users,
 * a workspace and bookings. scripts/test-room-booking-race.sh does it all with a throwaway postgres:16 container
 * (db push, the SQL file twice, this test) and removes it afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const DB_URL = process.env.ROOM_BOOKING_TEST_DATABASE_URL
if (DB_URL) process.env.DATABASE_URL = DB_URL

const state = vi.hoisted(() => ({ userId: '', skipGuard: 0 }))

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: state.userId } })) }))
vi.mock('@/lib/notification-service', async (orig) => ({
  ...(await orig<typeof import('@/lib/notification-service')>()),
  createInAppNotification: vi.fn(async () => null),
}))
// `skipGuard` makes the next N conflict checks (a findFirst for an ACTIVE booking of a room) see nothing,
// i.e. the two requests that both passed the check before either inserted — the race, made deterministic.
// Everything else is the real client.
vi.mock('@/lib/prisma', async (orig) => {
  const real = (await orig<{ default: Record<string, any> }>()).default // eslint-disable-line @typescript-eslint/no-explicit-any
  const roomBooking = new Proxy(real.roomBooking, {
    get(target, key) {
      if (key === 'findFirst') {
        return (args: { where?: { status?: string; room?: unknown } }) => {
          const guard = args?.where?.status === 'ACTIVE' && args.where.room !== undefined
          if (guard && state.skipGuard > 0) { state.skipGuard--; return Promise.resolve(null) }
          return target.findFirst(args)
        }
      }
      const v = target[key]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  return { default: new Proxy(real, { get: (target, key) => (key === 'roomBooking' ? roomBooking : target[key as string]) }) }
})

const run = DB_URL ? describe : describe.skip

run('room booking: two requests for one slot (real Postgres)', () => {
  let prisma: typeof import('@/lib/prisma').default
  let POST: typeof import('@/app/api/room-bookings/route').POST
  let PATCH: typeof import('@/app/api/room-bookings/[bookingId]/route').PATCH
  let workspaceId = ''
  const tag = `rb${Date.now().toString(36)}`

  const day = new Date(Date.now() + 3 * 24 * 3_600_000)
  day.setUTCHours(3, 0, 0, 0) // 10:00 WIB, three days ahead
  const at = (h: number, m = 0) => new Date(day.getTime() + ((h - 10) * 60 + m) * 60_000).toISOString()

  const post = (body: Record<string, unknown>) =>
    POST(new Request('http://localhost/api/room-bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)

  beforeAll(async () => {
    prisma = (await import('@/lib/prisma')).default
    POST = (await import('@/app/api/room-bookings/route')).POST
    PATCH = (await import('@/app/api/room-bookings/[bookingId]/route')).PATCH
    const ws = await prisma.workspace.create({ data: { name: `Race ${tag}`, slug: `race-${tag}` } })
    workspaceId = ws.id
    const user = await prisma.user.create({ data: { name: 'Race Tester', email: `${tag}@example.test` } })
    await prisma.workspaceMember.create({ data: { userId: user.id, workspaceId, role: 'STAFF' } })
    state.userId = user.id
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.roomBooking.deleteMany({ where: { workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.user.deleteMany({ where: { email: `${tag}@example.test` } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
  })

  it('the constraint exists', async () => {
    const rows = await prisma.$queryRaw<{ n: number }[]>`select count(*)::int as n from pg_constraint where conname = 'RoomBooking_no_overlap'`
    expect(rows[0].n).toBe(1)
  })

  it('both pass the guard at once: exactly one 201 and one 409 ROOM_TAKEN, with the holder and free slots', async () => {
    state.skipGuard = 2
    const body = { room: 'Studio', title: 'Race', startsAt: at(14), endsAt: at(15) }
    const [a, b] = await Promise.all([post(body), post({ ...body, title: 'Race 2' })])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 409])
    const refused = a.status === 409 ? a : b
    const json = await refused.json()
    expect(json.code).toBe('ROOM_TAKEN')
    expect(json.conflict?.room).toBe('Studio')
    expect(Array.isArray(json.freeSlots)).toBe(true)
    expect(json.freeSlots.length).toBeGreaterThan(0)
    expect(await prisma.roomBooking.count({ where: { workspaceId, room: 'Studio', status: 'ACTIVE' } })).toBe(1)
    expect(state.skipGuard).toBe(0)
  })

  it('ten concurrent requests for an overlapping slot (no forcing): one booking', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post({ room: 'Ruang Meeting', title: `R${i}`, startsAt: at(11, i % 2 ? 30 : 0), endsAt: at(12, 30) })),
    )
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(9)
    expect(await prisma.roomBooking.count({ where: { workspaceId, room: 'Ruang Meeting', status: 'ACTIVE' } })).toBe(1)
  })

  it('back to back is not an overlap, and a cancelled booking frees its slot', async () => {
    const first = await post({ room: 'Ruang Meeting VIP', title: 'A', startsAt: at(9), endsAt: at(10) })
    expect(first.status).toBe(201)
    expect((await post({ room: 'Ruang Meeting VIP', title: 'B', startsAt: at(10), endsAt: at(11) })).status).toBe(201)
    const id = (await first.json()).booking.id
    await prisma.roomBooking.update({ where: { id }, data: { status: 'CANCELLED' } })
    expect((await post({ room: 'Ruang Meeting VIP', title: 'C', startsAt: at(9), endsAt: at(10) })).status).toBe(201)
  })

  it('a move into a taken slot that raced the guard is refused by the database: 409 ROOM_TAKEN', async () => {
    const r = await post({ room: 'Studio', title: 'Mover', startsAt: at(17), endsAt: at(18) })
    expect(r.status).toBe(201)
    const id = (await r.json()).booking.id
    state.skipGuard = 1
    const res = await PATCH(
      new Request(`http://localhost/api/room-bookings/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startsAt: at(14, 30), endsAt: at(15, 30) }) }) as never,
      { params: Promise.resolve({ bookingId: id }) },
    )
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ROOM_TAKEN')
    const kept = await prisma.roomBooking.findUnique({ where: { id } })
    expect(kept?.startsAt.toISOString()).toBe(at(17))
  })
})
