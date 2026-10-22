import prisma from "@/lib/prisma"
import type { Prisma, User } from "@/generated/prisma/client"
import { pipelineToday, type PipelineSummary } from "@/lib/pipeline"
import { dealInclude, serializeDeal } from "@/lib/pipeline-server"
import { allPipelinesGate, loadAllPipelines, type SourcedDeal } from "@/lib/pipeline-all"
import { clip, num, str } from "./util"
import type { Input } from "./types"

/**
 * Pipeline reads for GIDEON (Control Tower v8, 22 Oct 2026): one deal in full (cashback, project contacts, budget
 * categories with spent / remaining, real cost lines with their category, barter, documents with the v8 types) and
 * the BoD / One Above All "All Pipelines" summary. Read only: the v8 lists are edited on the board itself.
 *
 * Access is the board's own, never wider:
 *  - a deal: readableBoardWhere below = projectAccessLevel (lib/rbac.ts) ≥ View, the rule pipelineGate "read" applies
 *    to GET …/pipeline (member of the board AND of its workspace, or BoD / OAA of the workspace). Everyone who may open
 *    the board sees every amount on it (owner, 14 Oct 2026); Presentation mode is only a screen state, so GIDEON shows
 *    amounts to exactly the people the board shows them to.
 *  - All Pipelines: allPipelinesGate, the same function as GET /api/pipelines/all, so a Manager / Staff gets the same
 *    refusal (ALL_PIPELINES_FORBIDDEN) even when they are a member of every board — and no board name or number.
 */

/** Boards (PIPELINE projects) this person may read, as a Prisma filter. Mirrors projectAccessLevel ≥ View. */
export function readableBoardWhere(actorId: string): Prisma.ProjectWhereInput {
  return {
    type: "PIPELINE",
    OR: [
      // A project member reads only while also a member of the board's workspace (projectAccessLevel: no workspace
      // role = no access, whatever the project membership says).
      { members: { some: { userId: actorId } }, workspace: { members: { some: { userId: actorId } } } },
      { workspace: { members: { some: { userId: actorId, role: { in: ["ONE_ABOVE_ALL", "BOD"] } } } } },
    ],
  }
}

/** The event-year filter as a Prisma range (the year of mainDate, as lib/pipeline.ts eventYearOf reads it). */
export function yearWhere(year: number): Prisma.PipelineDealWhereInput {
  return { mainDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }
}

/** A year the person asked for: 2026, "2026", or nothing. Throws on anything else (the board's own 400). */
export function yearOf(v: unknown): number | null {
  if (v === undefined || v === null || v === "" || v === "all") return null
  const s = String(v).trim()
  if (!/^\d{4}$/.test(s)) throw new Error("year must be a 4-digit year, e.g. 2026 (the year of the deal's event / main date).")
  return Number(s)
}

const rp = (n: number | null | undefined) => `Rp ${Math.round(n ?? 0).toLocaleString("id-ID")}`

/** Document / link types (v8), both languages, so the answer can follow the person's language. */
const DOC_TYPE: Record<string, string> = {
  Deck: "Deck", Quotation: "Quotation / Penawaran", Kontrak: "Contract / Kontrak", SPK: "SPK (Work Order)", MOU: "MOU",
  Invoice: "Invoice", Report: "Report / Laporan", Lainnya: "Other / Lainnya",
}
const CONTACT_ROLE: Record<string, string> = {
  Client: "Client / Klien", Vendor: "Vendor", Broker: "Broker", "PM (client side)": "PM (client side) / PM (pihak klien)",
  Finance: "Finance", Admin: "Admin", Other: "Other / Lainnya",
}

/** The deal the person means, among the boards they may read: by id, exact code, or (part of) the name. */
async function findReadableDeal(actor: User, input: Input) {
  const scope = readableBoardWhere(actor.id)
  const board = str(input.projectId)
  const project: Prisma.ProjectWhereInput = board ? { AND: [scope, { id: board }] } : scope
  const id = str(input.dealId)
  if (id) {
    const d = await prisma.pipelineDeal.findFirst({ where: { id, project }, include: { ...dealInclude, project: { select: { id: true, name: true } } } })
    if (!d) throw new Error("No deal this person can see has that id. Find it with nexus_search_deals.")
    return d
  }
  const q = str(input.deal) ?? str(input.code) ?? str(input.name) ?? str(input.query)
  if (!q) throw new Error("Say which deal: dealId (from nexus_search_deals) or its code / name.")
  const rows = await prisma.pipelineDeal.findMany({
    where: { project, OR: [{ code: { equals: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { brand: { contains: q, mode: "insensitive" } }] },
    select: { id: true, code: true, name: true, project: { select: { name: true } } },
    take: 8,
  })
  const lower = q.toLowerCase()
  const exact = rows.filter((r) => r.code.toLowerCase() === lower || r.name.toLowerCase() === lower)
  const pick = exact.length === 1 ? exact : rows
  if (!pick.length) throw new Error(`No deal on a Pipeline board this person can open matches "${q}". Say so; do not guess.`)
  if (pick.length > 1) throw new Error(`Several deals match "${q}": ${pick.map((r) => `${r.name} (${r.code}, ${r.project.name})`).join("; ")}. Ask which one.`)
  return prisma.pipelineDeal.findFirstOrThrow({ where: { id: pick[0].id }, include: { ...dealInclude, project: { select: { id: true, name: true } } } })
}

/** nexus_get_deal: one deal in full, compact and readable (amounts already in rupiah text). */
export async function getDeal(actor: User, input: Input) {
  const row = await findReadableDeal(actor, input)
  const d = serializeDeal(row, pipelineToday())
  const budgetName = new Map(d.budgets.map((b) => [b.id, b.name || "Untitled category"]))
  const out: Record<string, unknown> = {
    code: d.code,
    name: d.name,
    board: row.project.name,
    ...(d.brand ? { brand: d.brand } : {}),
    stage: d.stage,
    probability: `${Math.round(d.probability * 100)}%`,
    health: d.health.key === "NOT_STARTED" || d.health.key === "NONE" ? undefined : d.health.key.toLowerCase(),
    ...(d.services.length ? { services: d.services.join(", ") } : {}),
    bd: d.bd?.name ?? d.bdName ?? null,
    pm: d.pm?.name ?? d.pmName ?? null,
    mainDate: d.mainDate,
    eventYear: d.eventYear,
    contractValue: rp(d.contractValue),
    netValue: rp(d.netValue),
    ...(d.invoiceValue ? { invoiceValue: rp(d.invoiceValue) } : {}),
  }
  // Barter (v8): value is money, the compensation form is text. Neither changes margin.
  if (d.barterValue || d.barterCompensation) {
    out.barter = { value: rp(d.barterValue), ...(d.barterCompensation ? { compensation: d.barterCompensation } : {}) }
  }
  out.cashback = d.cashback.length
    ? { total: rp(d.cashbackTotal), recipients: d.cashback.map((c) => ({ name: c.name || "(no name)", amount: rp(c.amount) })) }
    : { total: rp(0), recipients: [], note: "No cashback recorded on this deal." }
  out.contacts = d.contacts.length
    ? d.contacts.map((c) => ({ role: CONTACT_ROLE[c.role] ?? c.role, name: c.name || "(no name)", ...(c.phone ? { phone: c.phone } : {}) }))
    : "No project contacts recorded."
  out.budget = d.budgets.length
    ? {
        total: rp(d.budgetTotal),
        categories: d.budgets.map((b) => ({
          category: b.name || "Untitled category",
          budget: rp(b.amount),
          spent: rp(b.spent),
          ...(b.remaining < 0 ? { overBy: rp(-b.remaining) } : { remaining: rp(b.remaining) }),
        })),
        rule: "spent = real cost lines booked to that category; budget never changes margin / real profit.",
      }
    : "No budget categories on this deal."
  out.realCost = {
    total: rp(d.costTotal),
    margin: d.margin === null ? "no net value yet" : rp(d.margin),
    ...(d.marginPct !== null && d.marginPct !== undefined ? { marginPct: `${Math.round(d.marginPct * 1000) / 10}%` } : {}),
    lines: d.costs.map((c) => ({
      label: c.label || "(no label)",
      amount: rp(c.amount),
      category: !c.budgetId ? "No budget category" : budgetName.get(c.budgetId) ?? "Deleted category",
    })),
  }
  for (const [k, v, skip] of [
    ["contract", d.contractStatus, "Not Started"], ["vendorRegistration", d.vregStatus, "Not Required"], ["readiness", d.readiness, "N/A"],
    ["deliverable", d.deliverableStatus, "Not Started"], ["risk", d.deliverableRisk, "Aman"], ["closing", d.closingStatus, "Not Ready"],
  ] as const) if (v && v !== skip) out[k] = v
  if (d.termSummary) {
    const t = d.termSummary
    out.payment = {
      status: t.paymentStatus, terms: `${t.paidCount}/${t.count} paid`, total: rp(t.totalAmount), paid: rp(t.totalPaid), outstanding: rp(t.outstanding),
      ...(t.maxDaysOverdue ? { daysOverdue: t.maxDaysOverdue } : {}), ...(t.nextDueDate ? { nextDue: t.nextDueDate } : {}),
      list: d.terms.map((x) => ({ label: x.label, amount: rp(x.amount), status: x.status, ...(x.dueDate ? { due: x.dueDate } : {}), ...(x.paidAmount ? { paid: rp(x.paidAmount) } : {}) })),
    }
  } else {
    out.payment = { status: d.paymentStatus, ...(d.outstandingReceivable ? { outstanding: rp(d.outstandingReceivable) } : {}), ...(d.daysOverdue ? { daysOverdue: d.daysOverdue } : {}) }
  }
  out.documents = d.links.length
    ? d.links.map((l) => ({ type: DOC_TYPE[l.type] ?? l.type, label: l.label || (l.kind === "file" ? l.fileName : "") || "(untitled)", kind: l.kind }))
    : "No documents or links."
  if (d.nextAction) out.nextAction = `${d.nextAction}${d.nextActionDate ? ` (${d.nextActionDate})` : ""}`
  if (d.blocker) out.blocker = clip(d.blocker, 200)
  if (d.notes) out.notes = clip(d.notes, 300)
  if (d.executionProject) out.executionProject = d.executionProject.name
  out.link = `/projects/${row.project.id}?deal=${d.id}`
  out.projectId = row.project.id
  out.dealId = d.id
  return out
}

function summaryOut(s: PipelineSummary) {
  return {
    deals: s.total,
    open: `${s.openCount} · ${rp(s.openValue)}`,
    weighted: rp(s.weightedValue),
    won: `${s.wonCount} · ${rp(s.wonValue)}`,
    active: s.activeCount,
    lost: `${s.lostCount} · ${rp(s.lostValue)}`,
    receivable: rp(s.receivable),
    receivableOverdue: rp(s.receivableOverdue),
    critical: s.criticalCount,
    attention: s.attentionCount,
    realCost: rp(s.realCost),
    realProfit: rp(s.realProfit),
  }
}

const FORBIDDEN = {
  access: false,
  code: "ALL_PIPELINES_FORBIDDEN",
  note:
    "All Pipelines (every company's Pipeline board combined) is for BoD and One Above All only; NEXUS refuses it for this person. " +
    "Tell them that plainly (ID: \"Semua Pipeline hanya untuk BoD dan One Above All.\"). Do NOT list, count, name or total any board or " +
    "deal from other boards, and do not try other tools to rebuild it. They can still ask about deals on the boards they were invited to.",
}

/** nexus_all_pipelines: the BoD / OAA combined view, as GET /api/pipelines/all computes it. */
export async function allPipelines(actor: User, input: Input) {
  const gate = await allPipelinesGate(actor.id, str(input.workspaceId) ?? null)
  if (!gate.ok) return FORBIDDEN
  const year = yearOf(input.year)
  // "source" = a board: its id, or (part of) its name ("Suwara" → "Pipeline Suwara").
  let source: string | null = null
  const want = str(input.source) ?? str(input.board) ?? str(input.company)
  if (want) {
    const lower = want.toLowerCase()
    const hit = gate.boards.filter((b) => b.id === want || b.name.toLowerCase() === lower)
    const part = hit.length ? hit : gate.boards.filter((b) => b.name.toLowerCase().includes(lower))
    if (part.length !== 1) {
      throw new Error(part.length ? `Several boards match "${want}": ${part.map((b) => b.name).join("; ")}. Ask which one.` : `No Pipeline board is named like "${want}". Boards: ${gate.boards.map((b) => b.name).join("; ")}.`)
    }
    source = part[0].id
  }
  const r = await loadAllPipelines(gate, { source, year })
  const byBoard = new Map<string, SourcedDeal[]>()
  for (const d of r.deals) { const g = byBoard.get(d.source.projectId) ?? []; g.push(d); byBoard.set(d.source.projectId, g) }
  const sum = (ds: SourcedDeal[], f: (d: SourcedDeal) => number) => ds.reduce((s, d) => s + (f(d) || 0), 0)
  const boards = gate.boards
    .filter((b) => !source || b.id === source)
    .map((b) => {
      const ds = byBoard.get(b.id) ?? []
      return {
        board: b.name,
        deals: ds.length,
        contractValue: rp(sum(ds, (d) => d.contractValue)),
        netValue: rp(sum(ds, (d) => d.netValue)),
        cashback: rp(sum(ds, (d) => d.cashbackTotal)),
        barter: rp(sum(ds, (d) => d.barterValue)),
        budget: rp(sum(ds, (d) => d.budgetTotal)),
        ...(b.status !== "ACTIVE" ? { boardStatus: b.status } : {}),
      }
    })
  const query = str(input.query)
  const stage = str(input.stage)
  let rows = r.deals
  if (query) { const q = query.toLowerCase(); rows = rows.filter((d) => [d.name, d.brand, d.code, d.bd?.name, d.bdName, d.pm?.name, d.pmName].some((x) => x && x.toLowerCase().includes(q))) }
  if (stage) { const s = stage.toLowerCase(); rows = rows.filter((d) => d.stage.toLowerCase().includes(s)) }
  rows = [...rows].sort((a, b) => b.contractValue - a.contractValue)
  const limit = Math.max(1, Math.min(50, Math.floor(num(input.limit) ?? 15)))
  const offset = Math.max(0, Math.floor(num(input.offset) ?? 0))
  const items = rows.slice(offset, offset + limit).map((d) => ({
    company: d.source.name, code: d.code, name: d.name, stage: d.stage, contractValue: rp(d.contractValue),
    ...(d.cashbackTotal ? { cashback: rp(d.cashbackTotal) } : {}), ...(d.barterValue ? { barter: rp(d.barterValue) } : {}),
    ...(d.eventYear ? { year: d.eventYear } : {}),
  }))
  const rest = rows.length - offset - items.length
  return {
    access: true,
    scope: source ? `one board: ${gate.boards.find((b) => b.id === source)?.name}` : `all ${gate.boards.length} Pipeline boards`,
    year: year ?? "all years",
    years: r.years,
    summary: summaryOut(r.summary),
    totals: {
      cashback: rp(sum(r.deals, (d) => d.cashbackTotal)),
      barter: rp(sum(r.deals, (d) => d.barterValue)),
      budget: rp(sum(r.deals, (d) => d.budgetTotal)),
    },
    boards,
    deals: { total: rows.length, shown: items.length, items, ...(rest > 0 ? { more: `${rest} more — call again with offset=${offset + items.length}, or narrow with query / stage / source / year.` } : {}) },
    note: "Read-only combined view (BoD / One Above All). For one deal's cashback, contacts, budget or documents use nexus_get_deal.",
  }
}
