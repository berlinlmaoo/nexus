import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'

/**
 * Real cost & margin on the Pipeline Dashboard (Control Tower v4/v5, 14 Oct 2026): the computation
 * (lib/pipeline.ts), the cost-list validation (lib/pipeline-server.ts), and who receives the numbers —
 * the project's access, enforced on the server for the list, a deal, a PATCH and the Excel export.
 */

const h = vi.hoisted(() => ({
  level: null as null | 'FULL' | 'EDIT' | 'COMMENT' | 'VIEW',
  deals: [] as Record<string, unknown>[],
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
    checkProjectAccess: vi.fn(async (_u: string, _p: string, required: string[]) => {
      if (!h.level) return { allowed: false, role: null, level: null }
      const need = required.includes('MEMBER') ? RANK.EDIT : RANK.VIEW
      return { allowed: RANK[h.level] >= need, role: null, level: h.level }
    }),
  }
})
vi.mock('@/lib/prisma', () => {
  const prisma = {
    project: { findUnique: vi.fn(async () => ({ id: 'p1', name: 'Board', type: 'PIPELINE', workspaceId: 'w1' })) },
    pipelineDeal: {
      findMany: vi.fn(async () => h.deals),
      findFirst: vi.fn(async () => h.deals[0] ?? null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...h.deals[0], ...data })),
    },
    pipelineDealChange: { createMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []) },
    workspaceMember: { findFirst: vi.fn(async () => ({ id: 'm' })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { default: prisma }
})

import prisma from '@/lib/prisma'
import { costTotalOf, marginOf, summarize, type PipelineDealFacts } from '@/lib/pipeline'
import { costLines, costsOf, normalizeCosts, parseDealFields, serializeDeal } from '@/lib/pipeline-server'
import { GET as listGET } from '@/app/api/projects/[projectId]/pipeline/route'
import { GET as dealGET, PATCH as dealPATCH } from '@/app/api/projects/[projectId]/pipeline/[dealId]/route'
import { GET as exportGET } from '@/app/api/projects/[projectId]/pipeline/export/route'

const TODAY = '2026-10-14'

function facts(over: Partial<PipelineDealFacts> = {}): PipelineDealFacts {
  return {
    stage: 'Won – In Execution', probability: 1, contractValue: 0, netValue: 0, contractStatus: 'Fully Executed',
    vregStatus: 'Not Required', readiness: 'Ready', deliverableStatus: 'In Progress', deliverableRisk: 'Aman',
    paymentStatus: 'Not Yet', outstandingReceivable: 0, paymentDueDate: null, maxDaysOverdue: 0, netCash: 0,
    closingStatus: 'Not Ready', blocker: '', terms: [], costs: [], ...over,
  }
}

function row(over: Record<string, unknown> = {}) {
  const now = new Date('2026-10-14T00:00:00Z')
  return {
    id: 'd1', projectId: 'p1', code: 'TZN-26001', position: 1024, name: 'Launch', brand: 'Acme', service: 'Event', services: ['Event'],
    bdUserId: null, bd: null, bdName: null, pmUserId: null, pm: null, pmName: null,
    stage: 'Won – In Execution', probability: 1, contractValue: 120_000_000, netValue: 100_000_000, invoiceValue: 0,
    contractStatus: 'Fully Executed', vregStatus: 'Not Required', readiness: 'Ready', deliverableStatus: 'In Progress',
    deliverableRisk: 'Aman', paymentStatus: 'Not Yet', outstandingReceivable: 0, paymentDueDate: null, maxDaysOverdue: 0,
    netCash: 0, closingStatus: 'Not Ready', mainDate: null, nextAction: '', nextActionDate: null, blocker: '', notes: '',
    links: [], costs: [{ id: 'c1', label: 'Vendor sound', amount: 30_000_000 }, { id: 'c2', label: 'Talent', amount: 10_000_000 }],
    createdById: null, createdBy: null, updatedById: null, updatedBy: null, createdAt: now, updatedAt: now,
    executionProjectId: null, executionProject: null, executionCalendarProjectId: null, executionCalendarProject: null,
    executionFolderId: null, executionFolder: null, executionCreatedAt: null, mainDateTaskId: null, terms: [],
    ...over,
  }
}

const ctx = { params: Promise.resolve({ projectId: 'p1' }) }
const dealCtx = { params: Promise.resolve({ projectId: 'p1', dealId: 'd1' }) }
const req = (url: string, init?: RequestInit) => new NextRequest(new URL(url, 'http://x'), init as never)

describe('margin rules', () => {
  it('adds the cost lines and counts margin on the net value', () => {
    const costs = [{ id: 'a', label: 'A', amount: 25 }, { id: 'b', label: 'B', amount: 15 }]
    expect(costTotalOf(costs)).toBe(40)
    expect(marginOf({ netValue: 100, costs })).toEqual({ totalCost: 40, costCount: 2, margin: 60, marginPct: 0.6 })
  })
  it('goes negative when costs pass the net value', () => {
    const m = marginOf({ netValue: 100, costs: [{ id: 'a', label: '', amount: 150 }] })
    expect(m.margin).toBe(-50)
    expect(m.marginPct).toBe(-0.5)
  })
  it('has no margin without a net value (no misleading 100% or 0)', () => {
    expect(marginOf({ netValue: 0, costs: [{ id: 'a', label: '', amount: 10 }] })).toEqual({ totalCost: 10, costCount: 1, margin: null, marginPct: null })
    expect(marginOf({ netValue: 0, costs: undefined })).toEqual({ totalCost: 0, costCount: 0, margin: null, marginPct: null })
  })
  it('a deal from before the column (no costs) is 100% margin on its net value', () => {
    expect(marginOf({ netValue: 50 })).toEqual({ totalCost: 0, costCount: 0, margin: 50, marginPct: 1 })
  })
  it('Real Profit = Σ margins of deals with a net value; real cost and cost-deal count over all deals', () => {
    const s = summarize([
      facts({ netValue: 100, costs: [{ id: 'a', label: '', amount: 30 }] }),
      facts({ netValue: 200, costs: [{ id: 'b', label: '', amount: 250 }] }),
      facts({ netValue: 0, costs: [{ id: 'c', label: '', amount: 5 }] }),
      facts({ netValue: 40 }),
    ], TODAY)
    expect(s.realCost).toBe(285)
    expect(s.realProfit).toBe(70 + -50 + 40)
    expect(s.costDealCount).toBe(3)
  })
})

describe('cost list validation', () => {
  it('keeps good ids, trims labels, rounds amounts, gives new ids to missing or repeated ones', () => {
    const out = normalizeCosts([
      { id: 'c1', label: '  Vendor   sound ', amount: 1500000.4 },
      { label: 'No id', amount: '2000' },
      { id: 'c1', label: 'Dup', amount: 1 },
      { id: 'bad id!', label: '', amount: 0 },
    ])!
    expect(out.map((c) => c.label)).toEqual(['Vendor sound', 'No id', 'Dup', ''])
    expect(out.map((c) => c.amount)).toEqual([1500000, 2000, 1, 0])
    expect(out[0].id).toBe('c1')
    expect(new Set(out.map((c) => c.id)).size).toBe(4)
  })
  it('refuses negative or non-numeric amounts, long labels, non-lists and too many lines', () => {
    expect(normalizeCosts([{ label: 'x', amount: -1 }])).toBeUndefined()
    expect(normalizeCosts([{ label: 'x', amount: 'abc' }])).toBeUndefined()
    expect(normalizeCosts([{ label: 'x'.repeat(121), amount: 1 }])).toBeUndefined()
    expect(normalizeCosts('nope')).toBeUndefined()
    expect(normalizeCosts(Array.from({ length: 101 }, () => ({ label: 'x', amount: 1 })))).toBeUndefined()
  })
  it('reads anything stored that is not a list as no costs', () => {
    expect(costsOf(null)).toEqual([])
    expect(costsOf({})).toEqual([])
    expect(costsOf([{ id: 'a', label: 'A', amount: 'x' }, 'junk'])).toEqual([{ id: 'a', label: 'A', amount: 0 }])
  })
  it('parseDealFields accepts costs and answers INVALID_FIELD shape on a bad one', async () => {
    const ok = await parseDealFields({ costs: [{ label: 'A', amount: 5 }] }, 'w1')
    expect(ok.ok && (ok.data.costs as unknown[]).length).toBe(1)
    const bad = await parseDealFields({ costs: [{ label: 'A', amount: -5 }] }, 'w1')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.field).toBe('costs')
  })
  it('formats the Rincian cell as "label: amount" per line', () => {
    expect(costLines([{ label: 'Vendor', amount: 1500000 }, { label: '', amount: 20 }])).toBe('Vendor: 1.500.000\n-: 20')
  })
  it('serializeDeal sends the lines and the derived margin', () => {
    const d = serializeDeal(row() as never, TODAY)
    expect(d.costs).toHaveLength(2)
    expect(d.costTotal).toBe(40_000_000)
    expect(d.margin).toBe(60_000_000)
    expect(d.marginPct).toBeCloseTo(0.6)
    const old = serializeDeal(row({ costs: undefined, netValue: 0 }) as never, TODAY)
    expect(old.costs).toEqual([])
    expect(old.margin).toBeNull()
  })
})

describe('who receives the numbers (project access, server side)', () => {
  beforeEach(() => {
    h.deals = [row()]
    vi.mocked(prisma.pipelineDeal.update).mockClear()
  })

  it('anyone outside the project gets 403 and no deal data from the list, a deal and the export', async () => {
    h.level = null
    for (const res of [
      await listGET(req('/api/projects/p1/pipeline'), ctx),
      await dealGET(req('/api/projects/p1/pipeline/d1'), dealCtx),
      await exportGET(req('/api/projects/p1/pipeline/export'), ctx),
    ]) {
      expect(res.status).toBe(403)
      const text = await res.text()
      expect(text).not.toContain('Vendor sound')
      expect(text).not.toContain('costs')
    }
  })

  it.each(['VIEW', 'COMMENT'] as const)('%s sees costs and margin, read-only', async (level) => {
    h.level = level
    const res = await listGET(req('/api/projects/p1/pipeline'), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.canEdit).toBe(false)
    expect(body.viewerAccessLevel).toBe(level)
    expect(body.deals[0].costs[0].label).toBe('Vendor sound')
    expect(body.deals[0].margin).toBe(60_000_000)
    expect(body.summary.realProfit).toBe(60_000_000)
    expect(body.summary.costDealCount).toBe(1)

    const patch = await dealPATCH(req('/api/projects/p1/pipeline/d1', { method: 'PATCH', body: JSON.stringify({ costs: [] }) }), dealCtx)
    expect(patch.status).toBe(403)
    expect(prisma.pipelineDeal.update).not.toHaveBeenCalled()
  })

  it.each(['EDIT', 'FULL'] as const)('%s may change the cost lines', async (level) => {
    h.level = level
    const list = await listGET(req('/api/projects/p1/pipeline'), ctx)
    expect((await list.json()).canEdit).toBe(true)
    const res = await dealPATCH(req('/api/projects/p1/pipeline/d1', {
      method: 'PATCH',
      body: JSON.stringify({ costs: [{ id: 'c1', label: 'Vendor sound', amount: 35_000_000 }] }),
    }), dealCtx)
    expect(res.status).toBe(200)
    const saved = await res.json()
    expect(saved.costTotal).toBe(35_000_000)
    expect(saved.margin).toBe(65_000_000)
    expect(prisma.pipelineDeal.update).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.pipelineDeal.update).mock.calls[0][0] as { data: { costs: unknown } }
    expect(call.data.costs).toEqual([{ id: 'c1', label: 'Vendor sound', amount: 35_000_000 }])
  })

  it('the export carries the four cost columns for a reader', async () => {
    h.level = 'VIEW'
    h.deals = [row(), row({ id: 'd2', code: 'TZN-26002', netValue: 0, costs: [] })]
    const res = await exportGET(req('/api/projects/p1/pipeline/export?lang=en'), ctx)
    expect(res.status).toBe(200)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await res.arrayBuffer())
    const ws = wb.getWorksheet('Master Project')!
    const header = (ws.getRow(1).values as unknown[]).slice(1)
    const at = (name: string) => header.indexOf(name) + 1
    for (const name of ['Total Real Cost', 'Margin (Rp)', 'Margin (%)', 'Rincian Real Cost']) expect(at(name)).toBeGreaterThan(0)
    const r2 = ws.getRow(2)
    expect(r2.getCell(at('Total Real Cost')).value).toBe(40_000_000)
    expect(r2.getCell(at('Margin (Rp)')).value).toBe(60_000_000)
    expect(r2.getCell(at('Margin (%)')).value).toBeCloseTo(0.6)
    expect(r2.getCell(at('Rincian Real Cost')).value).toBe('Vendor sound: 30.000.000\nTalent: 10.000.000')
    // No net value → margin cells blank, not 0 or 100%.
    const r3 = ws.getRow(3)
    expect(r3.getCell(at('Margin (Rp)')).value ?? '').toBe('')
    expect(r3.getCell(at('Margin (%)')).value ?? '').toBe('')
  })
})
