import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'

/**
 * Pipeline Dashboard v8 (Control Tower v8, 21 Oct 2026): barter, cashback, contacts, budget expenses, the year
 * filter, the nine new export columns, and All Pipelines (BoD / One Above All only, enforced on the server).
 * Also: an app from before v8 never wipes what it does not send (barter, a cost line's budget category).
 */

const h = vi.hoisted(() => ({
  level: null as null | 'FULL' | 'EDIT' | 'COMMENT' | 'VIEW',
  deals: [] as Record<string, unknown>[],
  role: 'BOD' as string,
}))

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/socket-emitter', () => ({ emitPipelineChanged: vi.fn() }))
vi.mock('@/lib/notification-text', () => ({ rememberUiLanguage: vi.fn() }))
vi.mock('@/lib/pipeline-execution', () => ({ syncMainDateTask: vi.fn() }))
vi.mock('@/lib/deletion-snapshot', () => ({ restorableDelete: vi.fn() }))
vi.mock('@/lib/rbac', () => {
  const RANK = { VIEW: 1, COMMENT: 2, EDIT: 3, FULL: 4 } as const
  return {
    hasProjectWideAccess: (role?: string | null) => role === 'BOD' || role === 'ONE_ABOVE_ALL',
    checkProjectAccess: vi.fn(async (_u: string, _p: string, required: string[]) => {
      if (!h.level) return { allowed: false, role: null, level: null }
      const need = required.includes('MEMBER') ? RANK.EDIT : RANK.VIEW
      return { allowed: RANK[h.level] >= need, role: null, level: h.level }
    }),
  }
})
vi.mock('@/lib/prisma', () => {
  const prisma = {
    project: {
      findUnique: vi.fn(async () => ({ id: 'p1', name: 'Pipeline Z Networks', type: 'PIPELINE', workspaceId: 'w1' })),
      findMany: vi.fn(async () => [
        { id: 'p1', name: 'Pipeline Z Networks', icon: 'chart', color: '#000', status: 'ACTIVE', _count: { pipelineDeals: 2 } },
        { id: 'p2', name: 'Pipeline Suwara', icon: 'chart', color: '#000', status: 'ACTIVE', _count: { pipelineDeals: 1 } },
      ]),
    },
    pipelineDeal: {
      findMany: vi.fn(async ({ where }: { where?: { projectId?: string | { in: string[] } } } = {}) => {
        const p = where?.projectId
        if (p && typeof p === 'object') return h.deals.filter((d) => p.in.includes(d.projectId as string))
        return h.deals.filter((d) => !p || d.projectId === p)
      }),
      findFirst: vi.fn(async () => h.deals[0] ?? null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...h.deals[0], ...data })),
    },
    pipelineDealChange: { createMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []) },
    workspaceMember: {
      findFirst: vi.fn(async () => ({ id: 'm' })),
      findMany: vi.fn(async () => [{ workspaceId: 'w1', role: h.role }]),
    },
    user: { findUnique: vi.fn(async () => ({ name: 'Rina Finance', email: 'rina@x' })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => (typeof ops === 'function' ? ops(prisma) : Promise.all(ops))),
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
  }
  return { default: prisma }
})

import prisma from '@/lib/prisma'
import { budgetUsageOf, dealYearsOf, filterByYear, marginOf, parseYearParam, summarize, LINK_TYPES, PIPELINE_VOCAB } from '@/lib/pipeline'
import { keepBudgetIds, normalizeCosts, parseItemFields, serializeDeal } from '@/lib/pipeline-server'
import { MASTER_COLUMNS } from '@/lib/pipeline-export'
import { GET as listGET } from '@/app/api/projects/[projectId]/pipeline/route'
import { PATCH as dealPATCH } from '@/app/api/projects/[projectId]/pipeline/[dealId]/route'
import { GET as exportGET } from '@/app/api/projects/[projectId]/pipeline/export/route'
import { GET as allGET } from '@/app/api/pipelines/all/route'
import { GET as boardsGET } from '@/app/api/pipelines/boards/route'
import { GET as allExportGET } from '@/app/api/pipelines/all/export/route'

const now = new Date('2026-10-21T00:00:00Z')
function item(over: Record<string, unknown>) {
  return { id: 'i', dealId: 'd1', kind: 'cashback', position: 1024, name: '', role: '', phone: '', amount: 0, clientRequestId: null, createdAt: now, updatedAt: now, ...over }
}
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'd1', projectId: 'p1', code: 'TZN-26001', position: 1024, name: 'Launch', brand: 'Acme', service: 'Event', services: ['Event'],
    bdUserId: null, bd: null, bdName: null, pmUserId: null, pm: null, pmName: null,
    stage: 'Won – In Execution', probability: 1, contractValue: 120_000_000, netValue: 100_000_000, invoiceValue: 0,
    contractStatus: 'Fully Executed', vregStatus: 'Not Required', readiness: 'Ready', deliverableStatus: 'In Progress',
    deliverableRisk: 'Aman', paymentStatus: 'Not Yet', outstandingReceivable: 0, paymentDueDate: null, maxDaysOverdue: 0,
    netCash: 0, closingStatus: 'Not Ready', mainDate: new Date('2026-11-02T00:00:00Z'), nextAction: '', nextActionDate: null, blocker: '', notes: '',
    links: [],
    costs: [{ id: 'c1', label: 'Venue rent', amount: 30_000_000, budgetId: 'b1' }, { id: 'c2', label: 'Talent', amount: 10_000_000 }],
    barterValue: 5_000_000, barterCompensation: '2 slot iklan TV',
    createdById: null, createdBy: null, updatedById: null, updatedBy: null, createdAt: now, updatedAt: now,
    executionProjectId: null, executionProject: null, executionCalendarProjectId: null, executionCalendarProject: null,
    executionFolderId: null, executionFolder: null, executionCreatedAt: null, mainDateTaskId: null, terms: [],
    items: [
      item({ id: 'k1', kind: 'cashback', name: 'Budi', amount: 1_500_000 }),
      item({ id: 'k2', kind: 'cashback', name: 'Sari', amount: 500_000 }),
      item({ id: 't1', kind: 'contact', role: 'Client', name: 'Andi', phone: '0812' }),
      item({ id: 'b1', kind: 'budget', name: 'Venue', amount: 25_000_000 }),
      item({ id: 'b2', kind: 'budget', name: 'Talent', amount: 15_000_000 }),
    ],
    ...over,
  }
}
const ctx = { params: Promise.resolve({ projectId: 'p1' }) }
const dealCtx = { params: Promise.resolve({ projectId: 'p1', dealId: 'd1' }) }
const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, 'http://x'), init as never)

beforeEach(() => {
  vi.clearAllMocks()
  h.level = 'FULL'
  h.role = 'BOD'
  h.deals = [row()]
})

describe('v8 rules', () => {
  it('budget remaining per category, over budget negative; margin ignores budget', () => {
    const use = budgetUsageOf([{ id: 'b1', name: 'Venue', amount: 25 }, { id: 'b2', name: 'Talent', amount: 15 }], [
      { id: 'c1', label: '', amount: 30, budgetId: 'b1' }, { id: 'c2', label: '', amount: 10, budgetId: 'b2' }, { id: 'c3', label: '', amount: 7 },
    ])
    expect(use).toEqual([
      { id: 'b1', name: 'Venue', amount: 25, spent: 30, remaining: -5 },
      { id: 'b2', name: 'Talent', amount: 15, spent: 10, remaining: 5 },
    ])
    expect(marginOf({ netValue: 100, costs: [{ id: 'c1', label: '', amount: 30, budgetId: 'b1' }] }).margin).toBe(70)
  })
  it('year filter: calendar year of the event date, deals without one left out', () => {
    const deals = [{ mainDate: '2026-12-31' }, { mainDate: '2027-01-01' }, { mainDate: null }]
    expect(dealYearsOf(deals)).toEqual([2027, 2026])
    expect(filterByYear(deals, 2026)).toEqual([{ mainDate: '2026-12-31' }])
    expect(filterByYear(deals, null)).toHaveLength(3)
    expect(parseYearParam('2026')).toBe(2026)
    expect(parseYearParam(null)).toBeNull()
    expect(parseYearParam('26')).toBeUndefined()
  })
  it('document types: Deck … Other, old keys kept', () => {
    expect(LINK_TYPES).toEqual(['Deck', 'Quotation', 'Kontrak', 'SPK', 'MOU', 'Invoice', 'Report', 'Lainnya'])
    expect(PIPELINE_VOCAB.contactRoles).toContain('PM (client side)')
  })
  it('cost budgetId: validated, and kept from the stored line when an older app omits it', () => {
    expect(normalizeCosts([{ id: 'c1', label: 'x', amount: 1, budgetId: 'bad id!' }])).toBeUndefined()
    const sent = normalizeCosts([{ id: 'c1', label: 'x', amount: 1 }, { id: 'c2', label: 'y', amount: 2, budgetId: null }, { id: 'c3', label: 'z', amount: 3, budgetId: 'b2' }])!
    expect(keepBudgetIds(sent, [{ id: 'c1', label: '', amount: 0, budgetId: 'b1' }, { id: 'c2', label: '', amount: 0, budgetId: 'b1' }]).map((c) => c.budgetId)).toEqual(['b1', null, 'b2'])
  })
  it('item fields per kind', () => {
    expect(parseItemFields('contact', { role: 'Broker', name: ' Andi ', phone: '0812', amount: 5 })).toEqual({ ok: true, data: { role: 'Broker', name: 'Andi', phone: '0812' } })
    expect(parseItemFields('contact', { role: 'Boss' }).ok).toBe(false)
    expect(parseItemFields('cashback', { amount: -1 }).ok).toBe(false)
    expect(parseItemFields('budget', { name: 'Venue', amount: '1000' })).toEqual({ ok: true, data: { name: 'Venue', amount: 1000 } })
  })
  it('serializes the lists, totals and remaining; an old row reads as empty', () => {
    const d = serializeDeal(row() as never, '2026-10-21')
    expect(d.cashbackTotal).toBe(2_000_000)
    expect(d.contacts).toEqual([expect.objectContaining({ role: 'Client', name: 'Andi', phone: '0812' })])
    expect(d.budgets.map((b) => [b.name, b.spent, b.remaining])).toEqual([['Venue', 30_000_000, -5_000_000], ['Talent', 0, 15_000_000]])
    expect(d.budgetTotal).toBe(40_000_000)
    expect(d.margin).toBe(60_000_000)
    expect(d.eventYear).toBe(2026)
    const old = serializeDeal(row({ items: undefined, barterValue: undefined, barterCompensation: undefined, mainDate: null }) as never, '2026-10-21')
    expect(old).toMatchObject({ cashback: [], contacts: [], budgets: [], cashbackTotal: 0, budgetTotal: 0, barterValue: 0, barterCompensation: '', eventYear: null })
  })
})

describe('PATCH from an app that does not know v8', () => {
  it('a cost edit without budgetId keeps the stored category; barter untouched', async () => {
    const res = await dealPATCH(req('/api/projects/p1/pipeline/d1', {
      method: 'PATCH',
      body: JSON.stringify({ costs: [{ id: 'c1', label: 'Venue rent', amount: 32_000_000 }, { id: 'c2', label: 'Talent', amount: 10_000_000 }], costsBase: [{ id: 'c1', label: 'Venue rent', amount: 30_000_000 }, { id: 'c2', label: 'Talent', amount: 10_000_000 }] }),
    }), dealCtx)
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.pipelineDeal.update).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.costs).toEqual([{ id: 'c1', label: 'Venue rent', amount: 32_000_000, budgetId: 'b1' }, { id: 'c2', label: 'Talent', amount: 10_000_000, budgetId: null }])
    expect(call.data).not.toHaveProperty('barterValue')
    expect(call.data).not.toHaveProperty('barterCompensation')
  })
  it('barter is set like any field', async () => {
    const res = await dealPATCH(req('/api/projects/p1/pipeline/d1', { method: 'PATCH', body: JSON.stringify({ barterValue: 7_000_000, barterCompensation: '  Booth  ' }) }), dealCtx)
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.pipelineDeal.update).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ barterValue: 7_000_000, barterCompensation: 'Booth' })
    expect((await dealPATCH(req('/api/projects/p1/pipeline/d1', { method: 'PATCH', body: JSON.stringify({ barterValue: -1 }) }), dealCtx)).status).toBe(400)
  })
})

describe('board year filter and export columns', () => {
  beforeEach(() => {
    h.deals = [row(), row({ id: 'd2', code: 'TZN-26002', mainDate: new Date('2027-02-01T00:00:00Z'), items: [] }), row({ id: 'd3', code: 'TZN-26003', mainDate: null, items: [] })]
  })
  it('GET ?year filters deals and KPIs; years lists every year', async () => {
    const all = await (await listGET(req('/api/projects/p1/pipeline'), ctx)).json()
    expect(all.deals).toHaveLength(3)
    expect(all.years).toEqual([2027, 2026])
    expect(all.year).toBeNull()
    const y = await (await listGET(req('/api/projects/p1/pipeline?year=2026'), ctx)).json()
    expect(y.deals.map((d: { id: string }) => d.id)).toEqual(['d1'])
    expect(y.summary.total).toBe(1)
    expect((await listGET(req('/api/projects/p1/pipeline?year=x'), ctx)).status).toBe(400)
  })
  it('the nine v8 columns at the end, with values', async () => {
    h.level = 'VIEW'
    const res = await exportGET(req('/api/projects/p1/pipeline/export'), ctx)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Master Project')!
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[]
    expect(header.slice(34)).toEqual(['Nilai Barter', 'Bentuk Kompensasi Barter', 'Total Cashback', 'Rincian Cashback', 'Kontak Project', 'Total Budget', 'Rincian Budget', 'Sumber', 'Tahun Event'])
    expect(MASTER_COLUMNS.slice(34).map((c) => c.en)).toEqual(['Barter Value', 'Barter Compensation Form', 'Total Cashback', 'Cashback Details', 'Project Contacts', 'Total Budget', 'Budget Details', 'Source', 'Event Year'])
    const r = ws.getRow(2)
    const at = (n: string) => header.indexOf(n) + 1
    expect(r.getCell(at('Nilai Barter')).value).toBe(5_000_000)
    expect(r.getCell(at('Bentuk Kompensasi Barter')).value).toBe('2 slot iklan TV')
    expect(r.getCell(at('Total Cashback')).value).toBe(2_000_000)
    expect(r.getCell(at('Rincian Cashback')).value).toBe('Budi: 1.500.000\nSari: 500.000')
    expect(r.getCell(at('Kontak Project')).value).toBe('Klien: Andi (0812)')
    expect(r.getCell(at('Total Budget')).value).toBe(40_000_000)
    expect(r.getCell(at('Rincian Budget')).value).toBe('Venue: 25.000.000 (terpakai 30.000.000, lebih 5.000.000)\nTalent: 15.000.000 (terpakai 0, sisa 15.000.000)')
    expect(r.getCell(at('Sumber')).value).toBe('Pipeline Z Networks')
    expect(r.getCell(at('Tahun Event')).value).toBe(2026)
    expect(ws.getRow(4).getCell(at('Tahun Event')).value).toBeNull()
    expect(ws.getRow(3).getCell(at('Total Cashback')).value).toBe(0)
  })
})

describe('All Pipelines: BoD / One Above All only', () => {
  beforeEach(() => {
    h.deals = [row(), row({ id: 'd2', projectId: 'p2', code: 'TZN-26002', mainDate: new Date('2025-05-01T00:00:00Z'), items: [] })]
  })
  it.each(['MANAGER', 'STAFF'])('%s gets 403 on every endpoint, even as a board member', async (role) => {
    h.role = role
    h.level = 'FULL'
    for (const r of [await allGET(req('/api/pipelines/all')), await boardsGET(req('/api/pipelines/boards')), await allExportGET(req('/api/pipelines/all/export'))]) {
      expect(r.status).toBe(403)
      expect((await r.json()).code).toBe('ALL_PIPELINES_FORBIDDEN')
    }
  })
  it.each(['BOD', 'ONE_ABOVE_ALL'])('%s sees every board, source per deal, combined KPIs, filters', async (role) => {
    h.role = role
    const all = await (await allGET(req('/api/pipelines/all'))).json()
    expect(all.boards.map((b: { name: string }) => b.name)).toEqual(['Pipeline Z Networks', 'Pipeline Suwara'])
    expect(all.deals.map((d: { source: { name: string } }) => d.source.name)).toEqual(['Pipeline Z Networks', 'Pipeline Suwara'])
    expect(all.summary.total).toBe(2)
    expect(all.canEdit).toBe(false)
    expect(all.years).toEqual([2026, 2025])
    const one = await (await allGET(req('/api/pipelines/all?source=p2'))).json()
    expect(one.deals.map((d: { id: string }) => d.id)).toEqual(['d2'])
    const yr = await (await allGET(req('/api/pipelines/all?year=2026'))).json()
    expect(yr.deals.map((d: { id: string }) => d.id)).toEqual(['d1'])
    expect((await allGET(req('/api/pipelines/all?source=nope'))).status).toBe(400)
    const s = summarize(all.deals, all.today)
    expect(s.wonValue).toBe(all.summary.wonValue)
  })
  it('combined export: Source = each deal\'s board', async () => {
    const res = await allExportGET(req('/api/pipelines/all/export?lang=en'))
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Master Project')!
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[]
    const src = header.indexOf('Source') + 1
    expect([ws.getRow(2).getCell(src).value, ws.getRow(3).getCell(src).value]).toEqual(['Pipeline Z Networks', 'Pipeline Suwara'])
  })
})
