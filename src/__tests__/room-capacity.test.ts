// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Room capacity is data (16 Oct 2026): the AppSetting row "room-capacity", shown by the availability endpoint and
 * GIDEON's room list when a room has a number, hidden when it has none; set by a BoD through
 * PUT /api/admin/room-capacity. No number is invented: with no row every capacity is null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => {
  process.env.NEXUS_ORG_WORKSPACE_ID = 'org-ws'
  return { setting: undefined as unknown, bod: true, writes: [] as unknown[] }
})

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/org', async (orig) => ({ ...(await orig<typeof import('@/lib/org')>()), isOrgBodPlus: vi.fn(async () => w.bod) }))
vi.mock('@/lib/notification-service', () => ({ createInAppNotification: vi.fn(async () => null), roomName: (r: string) => r }))
vi.mock('@/lib/app-setting', () => ({
  getAppSetting: vi.fn(async () => (w.setting === undefined ? null : w.setting)),
  setAppSetting: vi.fn(async (_k: string, v: unknown) => { w.writes.push(v); w.setting = v }),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    roomBooking: { findMany: vi.fn(async () => []) },
    workspaceMember: { findMany: vi.fn(async () => [{ workspaceId: 'org-ws' }]), findUnique: vi.fn(async () => ({ role: 'STAFF' })) },
  },
}))

import { GET as AVAILABILITY } from '@/app/api/room-bookings/availability/route'
import { GET as CAP_GET, PUT as CAP_PUT } from '@/app/api/admin/room-capacity/route'
import { normalizeRoomCapacity } from '@/lib/room-booking-rooms'
import { gideonListRoomBookings } from '@/lib/gideon-calendar-tools'

beforeEach(() => { Object.assign(w, { setting: undefined, bod: true, writes: [] }) })

const avail = async () => {
  const res = await AVAILABILITY(new (await import('next/server')).NextRequest('http://localhost/api/room-bookings/availability?startsAt=2027-01-04T07:00:00.000Z&endsAt=2027-01-04T08:00:00.000Z'))
  return (await res.json()) as any
}
const put = async (body: unknown) => {
  const res = await CAP_PUT(new (await import('next/server')).NextRequest('http://localhost/api/admin/room-capacity', { method: 'PUT', body: JSON.stringify(body) }))
  return { status: res.status, body: (await res.json()) as any }
}

describe('room capacity', () => {
  it('nothing recorded: every capacity is null (hidden), never a made-up number', async () => {
    const a = await avail()
    expect(a.rooms.map((r: any) => r.capacity)).toEqual([null, null, null])
    expect((await gideonListRoomBookings('u1', { date: '2027-01-04' })).rooms.every((r: any) => r.capacity === null)).toBe(true)
  })

  it('a stored number shows on that room only; unknown rooms and bad numbers are ignored', async () => {
    w.setting = { Studio: 8, 'Ruang Meeting': '12', Rooftop: 40, 'Ruang Meeting VIP': -3 }
    const a = await avail()
    expect(Object.fromEntries(a.rooms.map((r: any) => [r.room, r.capacity]))).toEqual({ 'Ruang Meeting VIP': null, 'Ruang Meeting': 12, Studio: 8 })
    const g = await gideonListRoomBookings('u1', { date: '2027-01-04' })
    expect(g.rooms.find((r: any) => r.room === 'Studio')?.capacity).toBe(8)
    expect(normalizeRoomCapacity([4])).toEqual({})
    expect(normalizeRoomCapacity({ Studio: 2.5 })).toEqual({})
  })

  it('a BoD sets and clears it without a deploy; the next availability read shows it', async () => {
    const r = await put({ capacity: { Studio: 8, 'Ruang Meeting VIP': 6 } })
    expect(r.status).toBe(200)
    expect(r.body.rooms).toEqual([{ room: 'Ruang Meeting VIP', capacity: 6 }, { room: 'Ruang Meeting', capacity: null }, { room: 'Studio', capacity: 8 }])
    expect((await avail()).rooms.find((x: any) => x.room === 'Studio').capacity).toBe(8)
    const cleared = await put({ capacity: { Studio: null } })
    expect(cleared.body.rooms.find((x: any) => x.room === 'Studio').capacity).toBeNull()
    expect(cleared.body.rooms.find((x: any) => x.room === 'Ruang Meeting VIP').capacity).toBe(6)
    expect((await (await CAP_GET()).json() as any).rooms.find((x: any) => x.room === 'Ruang Meeting VIP').capacity).toBe(6)
  })

  it('refused: not BoD, an unknown room, a bad number; nothing written', async () => {
    w.bod = false
    expect((await put({ capacity: { Studio: 8 } })).status).toBe(403)
    w.bod = true
    expect((await put({ capacity: { Rooftop: 8 } })).status).toBe(400)
    expect((await put({ capacity: { Studio: 9999 } })).status).toBe(400)
    expect((await put({ capacity: { Studio: '8' } })).status).toBe(400)
    expect((await put([])).status).toBe(400)
    expect(w.writes).toEqual([])
  })
})
