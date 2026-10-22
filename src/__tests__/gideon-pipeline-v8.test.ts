import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GIDEON reads Pipeline v8 (22 Oct 2026): nexus_get_deal (cashback, contacts, budget spent / remaining, real cost
 * categories, barter, document types) and nexus_all_pipelines (BoD / One Above All only — a Manager / Staff gets the
 * same refusal as GET /api/pipelines/all and not one name or number of another board).
 */

const h = vi.hoisted(() => ({ role: 'BOD' as string, deals: [] as Record<string, unknown>[], lastWhere: null as unknown }))

vi.mock('@/lib/rbac', () => ({
  hasProjectWideAccess: (role?: string | null) => role === 'BOD' || role === 'ONE_ABOVE_ALL',
  checkProjectAccess: vi.fn(async () => ({ allowed: true, role: null, level: 'FULL' })),
}))
vi.mock('@/lib/prisma', () => {
  const prisma = {
    project: {
      findMany: vi.fn(async () => [
        { id: 'p1', name: 'Pipeline Z Networks', icon: 'chart', color: '#000', status: 'ACTIVE', _count: { pipelineDeals: 1 } },
        { id: 'p2', name: 'Pipeline Suwara', icon: 'chart', color: '#000', status: 'ACTIVE', _count: { pipelineDeals: 1 } },
      ]),
    },
    pipelineDeal: {
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        h.lastWhere = where
        const p = where?.projectId as { in: string[] } | undefined
        if (p && typeof p === 'object') return h.deals.filter((d) => p.in.includes(d.projectId as string))
        return h.deals.map((d) => ({ id: d.id, code: d.code, name: d.name, project: d.project }))
      }),
      findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => { h.lastWhere = where; return h.deals[0] ?? null }),
      findFirstOrThrow: vi.fn(async () => h.deals[0]),
    },
    workspaceMember: { findMany: vi.fn(async () => [{ workspaceId: 'w1', role: h.role }]) },
  }
  return { default: prisma }
})

import { allPipelines, getDeal, readableBoardWhere, yearOf, yearWhere } from '@/lib/gideon-tools/pipeline-read'
import { EXTRA_TOOL_META } from '@/lib/gideon-tools/meta'

const now = new Date('2026-10-21T00:00:00Z')
const actor = { id: 'u1' } as never
function item(over: Record<string, unknown>) {
  return { id: 'i', dealId: 'd1', kind: 'cashback', position: 1024, name: '', role: '', phone: '', amount: 0, clientRequestId: null, createdAt: now, updatedAt: now, ...over }
}
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'd1', projectId: 'p1', project: { id: 'p1', name: 'Pipeline Z Networks' }, code: 'TZN-26001', position: 1024, name: 'Launch', brand: 'Acme', service: 'Event', services: ['Event'],
    bdUserId: null, bd: null, bdName: 'Rina', pmUserId: null, pm: null, pmName: null,
    stage: 'Won – In Execution', probability: 1, contractValue: 120_000_000, netValue: 100_000_000, invoiceValue: 0,
    contractStatus: 'Fully Executed', vregStatus: 'Not Required', readiness: 'Ready', deliverableStatus: 'In Progress',
    deliverableRisk: 'Aman', paymentStatus: 'Not Yet', outstandingReceivable: 0, paymentDueDate: null, maxDaysOverdue: 0,
    netCash: 0, closingStatus: 'Not Ready', mainDate: new Date('2026-11-02T00:00:00Z'), nextAction: '', nextActionDate: null, blocker: '', notes: '',
    links: [{ id: 'l1', type: 'Quotation', label: 'Penawaran v2', url: 'https://example.test/q' }, { id: 'l2', type: 'Report', label: '', url: 'https://example.test/r' }],
    costs: [
      { id: 'c1', label: 'Sewa venue', amount: 31_000_000, budgetId: 'b1' },
      { id: 'c2', label: 'Talent fee', amount: 10_000_000, budgetId: 'b2' },
      { id: 'c3', label: 'Lain-lain', amount: 2_000_000 },
      { id: 'c4', label: 'Old', amount: 1_000_000, budgetId: 'gone' },
    ],
    barterValue: 5_000_000, barterCompensation: '2 slot iklan TV',
    createdById: null, createdBy: null, updatedById: null, updatedBy: null, createdAt: now, updatedAt: now,
    executionProjectId: null, executionProject: null, executionCalendarProjectId: null, executionCalendarProject: null,
    executionFolderId: null, executionFolder: null, executionCreatedAt: null, mainDateTaskId: null, terms: [],
    items: [
      item({ id: 'k1', kind: 'cashback', name: 'Budi', amount: 1_500_000 }),
      item({ id: 'k2', kind: 'cashback', name: 'Sari', amount: 500_000 }),
      item({ id: 't1', kind: 'contact', role: 'PM (client side)', name: 'Andi', phone: '0812' }),
      item({ id: 'b1', kind: 'budget', name: 'Venue', amount: 25_000_000 }),
      item({ id: 'b2', kind: 'budget', name: 'Talent', amount: 15_000_000 }),
    ],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.role = 'BOD'
  h.deals = [row()]
})

describe('nexus_get_deal', () => {
  it('reads every v8 list with the server\'s own numbers', async () => {
    const d = (await getDeal(actor, { deal: 'TZN-26001' })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.cashback.total).toBe('Rp 2.000.000')
    expect(d.cashback.recipients).toEqual([{ name: 'Budi', amount: 'Rp 1.500.000' }, { name: 'Sari', amount: 'Rp 500.000' }])
    expect(d.contacts).toEqual([{ role: 'PM (client side) / PM (pihak klien)', name: 'Andi', phone: '0812' }])
    expect(d.budget.total).toBe('Rp 40.000.000')
    expect(d.budget.categories).toEqual([
      { category: 'Venue', budget: 'Rp 25.000.000', spent: 'Rp 31.000.000', overBy: 'Rp 6.000.000' },
      { category: 'Talent', budget: 'Rp 15.000.000', spent: 'Rp 10.000.000', remaining: 'Rp 5.000.000' },
    ])
    expect(d.realCost.lines.map((l: { category: string }) => l.category)).toEqual(['Venue', 'Talent', 'No budget category', 'Deleted category'])
    // Budget never changes the margin: net 100 − cost 44 = 56.
    expect(d.realCost.margin).toBe('Rp 56.000.000')
    expect(d.realCost.marginPct).toBe('56%')
    expect(d.barter).toEqual({ value: 'Rp 5.000.000', compensation: '2 slot iklan TV' })
    expect(d.documents.map((x: { type: string }) => x.type)).toEqual(['Quotation / Penawaran', 'Report / Laporan'])
    expect(d.eventYear).toBe(2026)
  })
  it('looks only on boards the person may read (project member AND workspace member, or BoD / OAA)', async () => {
    await getDeal(actor, { dealId: 'd1' })
    const where = h.lastWhere as { project: unknown }
    expect(where.project).toEqual(readableBoardWhere('u1'))
    const or = (readableBoardWhere('u1').OR ?? []) as Record<string, unknown>[]
    expect(or[0]).toEqual({ members: { some: { userId: 'u1' } }, workspace: { members: { some: { userId: 'u1' } } } })
    expect(or[1]).toEqual({ workspace: { members: { some: { userId: 'u1', role: { in: ['ONE_ABOVE_ALL', 'BOD'] } } } } })
  })
  it('an unknown deal is a plain "no deal", never a guess', async () => {
    h.deals = []
    await expect(getDeal(actor, { deal: 'nothing' })).rejects.toThrow(/No deal/)
  })
})

describe('nexus_all_pipelines', () => {
  beforeEach(() => {
    h.deals = [row(), row({ id: 'd2', projectId: 'p2', project: { id: 'p2', name: 'Pipeline Suwara' }, code: 'TZN-26002', name: 'Fest', mainDate: new Date('2025-05-01T00:00:00Z'), items: [], barterValue: 0 })]
  })
  it.each(['MANAGER', 'STAFF'])('%s gets the server\'s refusal and nothing of any board', async (role) => {
    h.role = role
    const r = await allPipelines(actor, {})
    expect(r).toMatchObject({ access: false, code: 'ALL_PIPELINES_FORBIDDEN' })
    const text = JSON.stringify(r)
    expect(text).not.toMatch(/Suwara|Z Networks|Rp|TZN-/)
  })
  it.each(['BOD', 'ONE_ABOVE_ALL'])('%s sees every board with totals, filters by company and year', async (role) => {
    h.role = role
    const r = (await allPipelines(actor, {})) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.access).toBe(true)
    expect(r.boards.map((b: { board: string }) => b.board)).toEqual(['Pipeline Z Networks', 'Pipeline Suwara'])
    expect(r.totals.cashback).toBe('Rp 2.000.000')
    expect(r.deals.items.map((d: { company: string }) => d.company).sort()).toEqual(['Pipeline Suwara', 'Pipeline Z Networks'])
    const one = (await allPipelines(actor, { source: 'suwara' })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(one.deals.items.map((d: { code: string }) => d.code)).toEqual(['TZN-26002'])
    const yr = (await allPipelines(actor, { year: 2026 })) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(yr.deals.items.map((d: { code: string }) => d.code)).toEqual(['TZN-26001'])
    await expect(allPipelines(actor, { source: 'nope' })).rejects.toThrow(/No Pipeline board/)
  })
})

describe('year filter and registry', () => {
  it('year = the main date\'s calendar year', () => {
    expect(yearOf(undefined)).toBeNull()
    expect(yearOf('2026')).toBe(2026)
    expect(() => yearOf('26')).toThrow()
    expect(yearWhere(2026)).toEqual({ mainDate: { gte: new Date('2026-01-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') } })
  })
  it('both are reads (no card, no write path)', () => {
    expect(EXTRA_TOOL_META.get_deal.write).toBe(false)
    expect(EXTRA_TOOL_META.all_pipelines.write).toBe(false)
  })
})
