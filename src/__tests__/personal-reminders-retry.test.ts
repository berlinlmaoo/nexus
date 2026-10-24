// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * sendDueReminders (visual QA 24 Oct 2026): a reminder whose send fails is released (firedAt back to null) so the
 * next tick sends it, instead of staying marked "gone off" with nobody told. Chip reminders carry a dedupeKey so
 * a retry can't show twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const w = vi.hoisted(() => ({ rows: [] as any[], failNext: 0, sent: [] as any[], chips: [] as any[] }))

vi.mock('@/lib/socket-emitter', () => ({ emitRemindersChanged: vi.fn() }))
vi.mock('@/lib/notification-service', () => ({
  createInAppNotification: vi.fn(async (d: any) => { if (w.failNext > 0) { w.failNext--; throw new Error('db blip') } w.sent.push(d); return { id: 'n' } }),
  notifyBlockReminder: vi.fn(async (d: any) => { if (w.failNext > 0) { w.failNext--; throw new Error('db blip') } w.chips.push(d) }),
}))
vi.mock('@/lib/prisma', () => ({
  default: {
    blockReminder: {
      findMany: vi.fn(async ({ where }: any) => w.rows.filter((r) => r.firedAt === null && r.remindAt <= where.remindAt.lte)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const r = w.rows.find((x) => x.id === where.id && (where.firedAt === null ? x.firedAt === null : x.firedAt?.getTime() === where.firedAt.getTime()))
        if (!r) return { count: 0 }
        r.firedAt = data.firedAt
        return { count: 1 }
      }),
    },
    task: { findUnique: vi.fn(async () => ({ title: 'Task', taskList: { projectId: 'p1' } })) },
    doc: { findUnique: vi.fn(async () => ({ title: 'Doc', projectId: 'p1' })) },
  },
}))

import { sendDueReminders } from '@/lib/personal-reminders'

const at = new Date('2026-10-25T02:00:00Z')
beforeEach(() => {
  Object.assign(w, {
    failNext: 0, sent: [], chips: [],
    rows: [
      { id: 'r1', sourceKind: 'personal', sourceId: 'u1', userId: 'u1', text: 'call vendor', remindAt: at, firedAt: null },
      { id: 'r2', sourceKind: 'task', sourceId: 't1', userId: 'u1', text: 'check', remindAt: at, firedAt: null },
    ],
  })
})

describe('sendDueReminders retry', () => {
  it('a failed send is released and goes out on the next tick', async () => {
    w.failNext = 1
    const first = await sendDueReminders(new Date('2026-10-25T02:00:30Z'))
    expect(first).toEqual({ due: 2, sent: 1, skipped: 1 })
    expect(w.rows.find((r) => r.id === 'r1').firedAt).toBeNull()
    expect(w.chips[0]).toMatchObject({ dedupeKey: 'block-reminder|r2' })
    const second = await sendDueReminders(new Date('2026-10-25T02:01:30Z'))
    expect(second).toEqual({ due: 1, sent: 1, skipped: 0 })
    expect(w.sent[0]).toMatchObject({ type: 'reminder', dedupeKey: 'reminder|r1' })
    expect(w.rows.every((r) => r.firedAt !== null)).toBe(true)
  })

  it('more than a day late is still closed without a notification', async () => {
    const res = await sendDueReminders(new Date('2026-10-26T03:00:00Z'))
    expect(res).toEqual({ due: 2, sent: 0, skipped: 2 })
    expect(w.sent.length + w.chips.length).toBe(0)
  })
})
