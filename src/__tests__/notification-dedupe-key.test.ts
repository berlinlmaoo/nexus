// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Notification dedupeKey (16 Oct 2026): a keyed notification is one INSERT … ON CONFLICT DO NOTHING
 * (createManyAndReturn + skipDuplicates); when nothing comes back another run stored it, and nothing is emitted or
 * pushed. A windowed call gets a key derived from its window bucket; an ad-hoc call is the plain insert it was.
 * The real-database proof is src/__tests__/race/notification-dedupe.race.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => ({ stored: new Set<string>(), creates: [] as any[], batches: [] as any[], pushes: 0, emits: 0 }))

vi.mock('@/lib/apns', () => ({ sendPushToUser: vi.fn(async () => { w.pushes++ }), sendPushToUsers: vi.fn() }))
vi.mock('@/lib/socket-emitter', () => ({ emitNotification: vi.fn(() => { w.emits++ }) }))
vi.mock('@/lib/notification-text', async (orig) => ({ ...(await orig<typeof import('@/lib/notification-text')>()), recipientLang: async () => 'en' }))
vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: vi.fn(async () => ({ deactivatedAt: null, dndUntil: null })) },
    notification: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => { w.creates.push(data); return { id: `n${w.creates.length}`, ...data } }),
      createManyAndReturn: vi.fn(async ({ data, skipDuplicates }: any) => {
        w.batches.push({ data, skipDuplicates })
        return data.filter((d: any) => (w.stored.has(d.dedupeKey) ? false : (w.stored.add(d.dedupeKey), true))).map((d: any, i: number) => ({ id: `k${i}`, ...d }))
      }),
    },
  },
}))

import { createInAppNotification, notifyAttendanceReminder } from '@/lib/notification-service'

beforeEach(() => { Object.assign(w, { stored: new Set(), creates: [], batches: [], pushes: 0, emits: 0 }) })
const base = { userId: 'u1', type: 'x', title: 'T', message: 'M', link: '/l', push: true }

describe('createInAppNotification dedupeKey', () => {
  it('a keyed notification is inserted with skipDuplicates; the second gets null and pushes nothing', async () => {
    const first = await createInAppNotification({ ...base, dedupeKey: 'x|u1|2026-10-16' })
    const second = await createInAppNotification({ ...base, dedupeKey: 'x|u1|2026-10-16' })
    expect(first).toMatchObject({ dedupeKey: 'x|u1|2026-10-16', userId: 'u1' })
    expect(second).toBeNull()
    expect(w.batches.every((b) => b.skipDuplicates === true)).toBe(true)
    expect([w.pushes, w.emits]).toEqual([1, 1])
    expect(w.creates).toHaveLength(0)
  })

  it('an ad-hoc notification (no key, no window) is the plain insert, with no dedupeKey column set', async () => {
    await createInAppNotification(base)
    await createInAppNotification(base)
    expect(w.creates).toHaveLength(2)
    expect(w.creates[0]).not.toHaveProperty('dedupeKey')
    expect(w.batches).toHaveLength(0)
  })

  it('a windowed call derives its key from the text and the window bucket', async () => {
    await createInAppNotification({ ...base, dedupeWindowMs: 60_000 })
    await createInAppNotification({ ...base, dedupeWindowMs: 60_000 })
    await createInAppNotification({ ...base, message: 'Other', dedupeWindowMs: 60_000 })
    const keys = w.batches.map((b) => b.data[0].dedupeKey)
    expect(keys[0]).toMatch(/^window\|x\|u1\|[0-9a-f]{24}\|60000\|\d+$/)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
    expect(w.pushes).toBe(2)
  })

  it('the attendance reminder keys by person, kind, day and offset, and says whether it sent', async () => {
    const a = await notifyAttendanceReminder({ userId: 'u1', kind: 'checkout', attendanceDate: '2026-10-16', shiftTime: '18:00', offsetMinutes: 0 })
    const b = await notifyAttendanceReminder({ userId: 'u1', kind: 'checkout', attendanceDate: '2026-10-16', shiftTime: '18:00', offsetMinutes: 0 })
    expect([a, b]).toEqual([true, false])
    expect(w.batches[0].data[0].dedupeKey).toBe('attendance-reminder|u1|checkout|2026-10-16|0')
  })
})
