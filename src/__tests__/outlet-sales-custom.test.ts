import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Outlet Sales Dashboard, owner's revisions of 14 Oct 2026 (after the meeting with Ryan): the per-outlet
 * report breakdown (sums, archive instead of delete, the mapping to the seven original columns that released
 * apps send and read) and the daily targets (a date's own target, else the month's share, per metric).
 */

const h = vi.hoisted(() => ({
  event: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  creates: [] as Record<string, unknown>[],
  config: null as unknown,
}))

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/socket-emitter', () => ({ emitOutletSalesChanged: vi.fn() }))
vi.mock('@/lib/deletion-snapshot', () => ({ restorableDelete: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ checkProjectAccess: vi.fn(), isSystemAdminUser: vi.fn(), hasProjectLevel: vi.fn() }))
vi.mock('@/lib/prisma', () => {
  const withRow = (data: Record<string, unknown>) => ({
    ...h.event,
    ...data,
    createdBy: null,
    updatedBy: null,
    reportedBy: null,
  })
  return {
    default: {
      project: { findUnique: vi.fn(async () => ({ outletReportConfig: h.config })) },
      outletSalesEvent: {
        findFirst: vi.fn(async () => (h.event ? withRow({}) : null)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          h.updates.push(data)
          h.event = { ...h.event, ...data }
          return withRow({})
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          h.creates.push(data)
          h.event = { ...baseRow(), ...data }
          return withRow({})
        }),
      },
    },
  }
})

import {
  buildMonthDays,
  communityTotal,
  daysInMonth,
  defaultReportConfig,
  effectiveDayTarget,
  eventTotals,
  legacyFormFor,
  mergeReportConfig,
  monthShare,
  readReportConfig,
  summarizeGuests,
  type OutletReportConfig,
} from '@/lib/outlet-sales'
import { createOutletEvent, parseValues, serializeEvent, updateOutletEvent, valuesOf } from '@/lib/outlet-sales-server'

function baseRow(): Record<string, unknown> {
  const now = new Date('2026-10-14T00:00:00Z')
  return {
    id: 'e1', projectId: 'p1', date: new Date('2026-10-10T00:00:00Z'), name: 'Night',
    salesTarget: null, paxTarget: null, sales: null, pax: null,
    rsvpWalkIn: null, rsvpTeam: null, rsvpPr: null, rsvpEo: null, hostingTeam: null, hostingPr: null, hostingEo: null,
    successWhat: '', successWhy: '', successRepeat: '', failWhat: '', failWhy: '', failPrevent: '',
    reportValues: {}, reportedAt: null, reportedById: null, createdById: null, updatedById: null,
    createdAt: now, updatedAt: now,
  }
}

const custom: OutletReportConfig = {
  version: 1,
  rsvp: [{ id: 'rsvpWalkIn', label: 'Walk-in' }, { id: 'rsvpTeam', label: 'Crew' }, { id: 'i_vip', label: 'VIP list' }],
  hosting: [{ id: 'hostingTeam', label: 'Hosting Team' }, { id: 'i_old', label: 'Old', archived: true }],
  communities: [
    { id: 'c_run', name: 'Run club', mode: 'total', items: [] },
    { id: 'c_art', name: 'Art collective', mode: 'breakdown', items: [{ id: 'i_ar', label: 'RSVP' }, { id: 'i_ah', label: 'Hosting' }] },
  ],
}

describe('report totals', () => {
  it('sums each group from its items, archived ones included', () => {
    const t = eventTotals(custom, { rsvpWalkIn: 10, rsvpTeam: 5, i_vip: 2, hostingTeam: 3, i_old: 4, c_run: 7, i_ar: 6, i_ah: 1 })
    expect(t.rsvpTotal).toBe(17)
    expect(t.hostingTotal).toBe(7)
    expect(t.communities).toEqual({ c_run: 7, c_art: 7 })
    expect(t.communityTotal).toBe(14)
  })
  it('null when nothing of a group was filled, 0 is a real zero', () => {
    const t = eventTotals(custom, { rsvpTeam: 0 })
    expect(t.rsvpTotal).toBe(0)
    expect(t.hostingTotal).toBeNull()
    expect(t.communityTotal).toBeNull()
  })
  it('a community switched to Breakdown keeps its old single number', () => {
    expect(communityTotal(custom.communities[1], { c_art: 9, i_ar: 1 })).toBe(10)
  })
  it('guest overview: per item, per community, grand total; archived lines only with figures', () => {
    const g = summarizeGuests(custom, [
      { rsvpWalkIn: 10, c_run: 3, i_ar: 2 },
      { rsvpWalkIn: 5, i_vip: 1, c_run: 4, i_ah: 1 },
      {},
    ])
    expect(g.reportCount).toBe(2)
    expect(g.rsvp.total).toBe(16)
    expect(g.rsvp.items.map((i) => [i.id, i.total])).toEqual([['rsvpWalkIn', 15], ['rsvpTeam', 0], ['i_vip', 1]])
    expect(g.hosting.items.map((i) => i.id)).toEqual(['hostingTeam'])
    expect(g.communities.total).toBe(10)
    expect(g.communities.items.map((c) => [c.id, c.total])).toEqual([['c_run', 7], ['c_art', 3]])
    expect(g.communities.items[1].items.map((i) => [i.id, i.total])).toEqual([['i_ar', 2], ['i_ah', 1]])
  })
})

describe('daily targets', () => {
  it('days in month', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-10')).toBe(31)
  })
  it("a date's own target wins, else the month's share, per metric", () => {
    expect(effectiveDayTarget(500, 31_000_000, '2026-10')).toEqual({ value: 500, source: 'day' })
    expect(effectiveDayTarget(null, 31_000_000, '2026-10')).toEqual({ value: 1_000_000, source: 'month' })
    expect(effectiveDayTarget(undefined, null, '2026-10')).toEqual({ value: null, source: null })
    expect(monthShare(100, '2026-10')).toBe(3.23)
  })
  it('builds every day with its actuals and percentages', () => {
    const days = buildMonthDays(
      '2026-10',
      [{ date: '2026-10-03', sales: 2_000_000, pax: 30 }, { date: '2026-10-03', sales: 1_000_000, pax: null }],
      { salesTarget: 31_000_000, paxTarget: null },
      [{ date: '2026-10-03', salesTarget: null, paxTarget: 40 }, { date: '2026-10-04', salesTarget: 5_000_000, paxTarget: null }],
    )
    expect(days).toHaveLength(31)
    const d3 = days[2]
    expect([d3.sales, d3.pax, d3.salesTarget, d3.salesTargetSource, d3.paxTarget, d3.paxTargetSource]).toEqual([3_000_000, 30, 1_000_000, 'month', 40, 'day'])
    expect([d3.salesPct, d3.paxPct]).toEqual([300, 75])
    const d4 = days[3]
    expect([d4.sales, d4.salesTarget, d4.salesTargetSource, d4.paxTarget, d4.paxTargetSource, d4.salesPct]).toEqual([null, 5_000_000, 'day', null, null, null])
  })
})

describe('report settings', () => {
  it('nothing stored reads as the original seven items', () => {
    const c = readReportConfig(null)
    expect(c.rsvp.map((i) => i.id)).toEqual(['rsvpWalkIn', 'rsvpTeam', 'rsvpPr', 'rsvpEo'])
    expect(c.hosting.map((i) => i.id)).toEqual(['hostingTeam', 'hostingPr', 'hostingEo'])
    expect(c.communities).toEqual([])
  })
  it('renames keep the id; new items get one; removed items with figures come back archived', () => {
    const prev = defaultReportConfig()
    const r = mergeReportConfig({
      rsvp: [{ id: 'rsvpTeam', label: '  RSVP   Crew ' }, { label: 'VIP' }],
      hosting: [{ id: 'hostingTeam', label: 'Hosting Team' }],
      communities: [{ name: 'Run club', mode: 'total' }],
    }, prev, new Set(['rsvpWalkIn', 'hostingEo']))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.rsvp[0]).toEqual({ id: 'rsvpTeam', label: 'RSVP Crew' })
    expect(r.config.rsvp[1].id).toMatch(/^i_[a-z0-9]{10}$/)
    // rsvpWalkIn had figures → archived; rsvpPr / rsvpEo had none → dropped.
    expect(r.config.rsvp.slice(2)).toEqual([{ id: 'rsvpWalkIn', label: 'Walk-in RSVP', archived: true }])
    expect(r.config.hosting).toEqual([{ id: 'hostingTeam', label: 'Hosting Team' }, { id: 'hostingEo', label: 'Hosting EO', archived: true }])
    expect(r.config.communities[0].id).toMatch(/^c_/)
  })
  it('a removed community with figures is archived whole', () => {
    const r = mergeReportConfig({ rsvp: custom.rsvp, hosting: custom.hosting, communities: [custom.communities[0]] }, custom, new Set(['i_ar']))
    expect(r.ok && r.config.communities[1]).toEqual({ id: 'c_art', name: 'Art collective', mode: 'breakdown', items: [{ id: 'i_ar', label: 'RSVP', archived: true }], archived: true })
  })
  it('refuses an original item moved to another group, duplicates and empty names', () => {
    expect(mergeReportConfig({ rsvp: [{ id: 'hostingPr', label: 'x' }] }, defaultReportConfig(), new Set()).ok).toBe(false)
    expect(mergeReportConfig({ rsvp: [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }] }, defaultReportConfig(), new Set()).ok).toBe(false)
    expect(mergeReportConfig({ rsvp: [{ id: 'a', label: '  ' }] }, defaultReportConfig(), new Set()).ok).toBe(false)
  })
  it('the form for released apps lists only the active original items, renamed and in order', () => {
    const f = legacyFormFor({ ...custom, rsvp: [{ id: 'rsvpTeam', label: 'Crew' }, { id: 'rsvpWalkIn', label: 'Walk-in RSVP' }, { id: 'rsvpEo', label: 'EO', archived: true }] })
    const rsvp = f.sections.find((s) => s.key === 'rsvp')!
    expect(rsvp.fields.map((x) => [x.key, x.label.en])).toEqual([['rsvpTeam', 'Crew'], ['rsvpWalkIn', 'Walk-in RSVP']])
    expect(f.sections.find((s) => s.key === 'hosting')!.fields.map((x) => x.key)).toEqual(['hostingTeam'])
    expect(f.sections.find((s) => s.key === 'sales')!.fields.length).toBe(2)
  })
})

describe('legacy mapping', () => {
  beforeEach(() => {
    h.event = baseRow()
    h.updates = []
    h.creates = []
    h.config = custom
  })
  it('reads the original items from their columns, the rest from the JSON (never a legacy id from JSON)', () => {
    const row = { ...baseRow(), rsvpTeam: 4, hostingTeam: 0, reportValues: { i_vip: 2, rsvpTeam: 99, junk: 'x' } }
    expect(valuesOf(row as never)).toEqual({ i_vip: 2, rsvpTeam: 4, hostingTeam: 0 })
  })
  it('splits values into columns and JSON; an unknown id asks for a reload', () => {
    const r = parseValues({ rsvpTeam: 3, i_vip: '1.000', c_run: null }, custom)
    expect(r).toEqual({ ok: true, columns: { rsvpTeam: 3 }, json: { i_vip: 1000, c_run: null } })
    const bad = parseValues({ i_gone: 1 }, custom)
    expect(bad.ok === false && bad.error.code).toBe('CONFIG_CHANGED')
    expect(parseValues({ i_vip: -1 }, custom).ok).toBe(false)
    expect(parseValues({ i_vip: 1.5 }, custom).ok).toBe(false)
  })
  it('an old app sending rsvpTeam still writes the column and sees the totals', async () => {
    const r = await updateOutletEvent('u1', 'p1', 'e1', { rsvpTeam: 5, rsvpWalkIn: 10 })
    expect(r.ok).toBe(true)
    expect(h.updates[0]).toMatchObject({ rsvpTeam: 5, rsvpWalkIn: 10 })
    expect(h.updates[0].reportValues).toBeUndefined()
    if (!r.ok) return
    expect([r.value.rsvpTeam, r.value.rsvpWalkIn, r.value.rsvpTotal]).toEqual([5, 10, 15])
    expect(r.value.values).toEqual({ rsvpTeam: 5, rsvpWalkIn: 10 })
  })
  it('a new client sending values: originals into columns, custom ids merged into the JSON', async () => {
    h.event = { ...baseRow(), reportValues: { c_run: 4 } }
    const r = await updateOutletEvent('u1', 'p1', 'e1', { values: { rsvpTeam: 7, i_vip: 3, i_ar: 2 } })
    expect(r.ok).toBe(true)
    expect(h.updates[0]).toMatchObject({ rsvpTeam: 7, reportValues: { c_run: 4, i_vip: 3, i_ar: 2 } })
    if (!r.ok) return
    expect([r.value.rsvpTeam, r.value.rsvpTotal, r.value.communityTotal]).toEqual([7, 10, 6])
    // Clearing one custom figure leaves the others.
    await updateOutletEvent('u1', 'p1', 'e1', { values: { i_vip: null } })
    expect(h.updates[1].reportValues).toEqual({ c_run: 4, i_ar: 2 })
  })
  it('values win over an old key sent alongside', async () => {
    await updateOutletEvent('u1', 'p1', 'e1', { rsvpTeam: 1, values: { rsvpTeam: 2 } })
    expect(h.updates[0]).toMatchObject({ rsvpTeam: 2 })
  })
  it('nothing changed = no write', async () => {
    h.event = { ...baseRow(), rsvpTeam: 2, reportValues: { i_vip: 1 } }
    const r = await updateOutletEvent('u1', 'p1', 'e1', { values: { rsvpTeam: 2, i_vip: 1 } })
    expect(r.ok).toBe(true)
    expect(h.updates).toHaveLength(0)
  })
  it('create stores custom figures in the JSON', async () => {
    const r = await createOutletEvent('u1', 'p1', { name: 'Night', date: '2026-10-11', values: { rsvpTeam: 1, c_run: 9 } })
    expect(r.ok).toBe(true)
    expect(h.creates[0]).toMatchObject({ rsvpTeam: 1, reportValues: { c_run: 9 } })
  })
  it('serializes old fields next to the new ones', () => {
    const e = serializeEvent({ ...baseRow(), rsvpEo: 2, reportValues: { i_vip: 1 }, createdBy: null, updatedBy: null, reportedBy: null } as never, '2026-10-14', custom)
    expect(e.rsvpEo).toBe(2)
    expect(e.values).toEqual({ i_vip: 1, rsvpEo: 2 })
    expect(e.rsvpTotal).toBe(1) // rsvpEo is not in this outlet's RSVP items any more, VIP list is
  })
})
