import { randomUUID } from "node:crypto"
import prisma from "@/lib/prisma"
import type { User } from "@/generated/prisma/client"
import { PIPELINE_STAGES } from "@/lib/pipeline"
import { parseTermFields, pipelineGate, probabilityForStage } from "@/lib/pipeline-server"
import { dayLabel, num, rupiah, str } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Pipeline through GIDEON (owner, 18 Oct 2026): move a deal to another stage, record a payment term. Same access as
 * the Pipeline Dashboard (pipelineGate "write" = Can edit in that board's project; BoD/OAA Full everywhere), checked
 * here for the card and again by the endpoint on Apply. Applied through the board's own endpoints AS the person
 * (PATCH …/pipeline/:dealId { stage } — row lock, history row, probability rule, realtime; POST …/terms — row lock,
 * idempotency key, "Termin n" label), never written here. Always a card: the board belongs to a team.
 */

/** Deals of the PIPELINE boards this person can see, by id or (part of) the name / code. */
async function findDeal(actor: User, input: Input) {
  const id = str(input.dealId)
  const q = str(input.deal) ?? str(input.name) ?? str(input.query) ?? str(input.code)
  const board = str(input.projectId)
  const projectScope = {
    type: "PIPELINE" as const,
    ...(board ? { id: board } : {}),
    OR: [
      { members: { some: { userId: actor.id } } },
      { workspace: { members: { some: { userId: actor.id, role: { in: ["ONE_ABOVE_ALL" as const, "BOD" as const] } } } } },
    ],
  }
  const select = { id: true, code: true, name: true, stage: true, probability: true, contractValue: true, projectId: true, project: { select: { name: true } } } as const
  if (id) {
    const d = await prisma.pipelineDeal.findFirst({ where: { id, project: projectScope }, select })
    if (!d) throw new Error("No deal this person can see has that id.")
    return d
  }
  if (!q) throw new Error("Say which deal: dealId (from nexus_search_deals) or its name / code.")
  const rows = await prisma.pipelineDeal.findMany({
    where: { project: projectScope, OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { equals: q, mode: "insensitive" } }] },
    select,
    take: 8,
  })
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase() || r.code.toLowerCase() === q.toLowerCase())
  const pick = exact.length === 1 ? exact : rows
  if (pick.length === 1) return pick[0]
  if (!pick.length) throw new Error(`No deal this person can see is named like "${q}".`)
  throw new Error(`Several deals match "${q}": ${pick.map((r) => `${r.name} (${r.code}, ${r.project.name})`).join("; ")}. Ask which one.`)
}

/** The board's own write gate, its refusal in words. */
async function assertCanWriteBoard(actor: User, projectId: string, projectName: string) {
  const gate = await pipelineGate(actor.id, projectId, "write")
  if (gate.ok) return
  const body = (await gate.response.json().catch(() => null)) as { error?: string } | null
  throw new Error(gate.response.status === 403
    ? `This person can see ${projectName} but cannot edit its deals (it needs Can edit in that board). Tell them so.`
    : body?.error ?? "This board cannot be edited.")
}

function stageOf(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const n = s.toLowerCase().replace(/[–—-]/g, "-").replace(/\s+/g, " ")
  const norm = (x: string) => x.toLowerCase().replace(/[–—-]/g, "-").replace(/\s+/g, " ")
  const exact = PIPELINE_STAGES.find((x) => norm(x) === n)
  if (exact) return exact
  const part = PIPELINE_STAGES.filter((x) => norm(x).includes(n))
  if (part.length === 1) return part[0]
  const alias: Record<string, string> = {
    proposal: "Proposal / Quotation", quotation: "Proposal / Quotation", penawaran: "Proposal / Quotation", nego: "Negotiation", negosiasi: "Negotiation",
    won: "Won – Contract Pending", menang: "Won – Contract Pending", execution: "Won – In Execution", eksekusi: "Won – In Execution",
    lost: "Lost / Cancelled", cancelled: "Lost / Cancelled", canceled: "Lost / Cancelled", batal: "Lost / Cancelled", kalah: "Lost / Cancelled",
    closed: "Closed", selesai: "Closed", masuk: "Incoming", baru: "Incoming",
  }
  return alias[n] ?? null
}

const pct = (p: number | null | undefined) => (typeof p === "number" ? `${Math.round(p * 100)}%` : "—")

async function describeMove(actor: User, input: Input) {
  const deal = await findDeal(actor, input)
  await assertCanWriteBoard(actor, deal.projectId, deal.project.name)
  const stage = stageOf(input.stage ?? input.to)
  if (!stage) throw new Error(`stage must be one of: ${PIPELINE_STAGES.join(" · ")}.`)
  if (stage === deal.stage) throw new Error(`${deal.name} is already in ${stage}. Nothing would change.`)
  const p = probabilityForStage(stage)
  return {
    summary: `Move “${deal.name}” to ${stage}`,
    projectId: deal.projectId,
    diff: [
      { field: "Deal", to: `${deal.name} (${deal.code})` },
      { field: "Project", to: deal.project.name },
      { field: "Stage", from: deal.stage, to: stage },
      ...(p !== null && p !== deal.probability ? [{ field: "Probability", from: pct(deal.probability), to: pct(p) }] : []),
    ],
    store: { dealId: deal.id, projectId: deal.projectId, stage, before: { stage: deal.stage } },
    note: "NOT moved yet. It waits on the card below and is saved on the board (with its history row) when the person confirms. Say so in one sentence.",
  }
}

async function describeTerm(actor: User, input: Input) {
  const deal = await findDeal(actor, input)
  await assertCanWriteBoard(actor, deal.projectId, deal.project.name)
  const body: Record<string, unknown> = {}
  const label = str(input.label)
  if (label) body.label = label
  const amount = num(input.amount)
  if (amount === undefined) throw new Error("amount is required: the term's amount in rupiah, as a plain number (e.g. 15000000).")
  body.amount = amount
  for (const k of ["dueDate", "invoiceDate", "paidAt"] as const) { const v = str(input[k]); if (v) body[k] = v }
  const invoiceNo = str(input.invoiceNo)
  if (invoiceNo) body.invoiceNo = invoiceNo
  const paid = num(input.paidAmount)
  if (paid !== undefined) body.paidAmount = paid
  const note = str(input.note)
  if (note) body.note = note
  // The board's own field rules (money ≥ 0 and whole, dates YYYY-MM-DD, text lengths) — the same function the endpoint runs.
  const parsed = parseTermFields(body)
  if (!parsed.ok) throw new Error(`${parsed.error.field}: ${parsed.error.error}`)
  const [count, sum] = await Promise.all([
    prisma.pipelinePaymentTerm.count({ where: { dealId: deal.id } }),
    prisma.pipelinePaymentTerm.aggregate({ where: { dealId: deal.id }, _sum: { amount: true } }),
  ])
  const termLabel = label || `Termin ${count + 1}`
  const total = (sum._sum.amount ?? 0) + amount
  return {
    summary: `Add ${termLabel} (${rupiah(amount)}) to “${deal.name}”`,
    projectId: deal.projectId,
    diff: [
      { field: "Deal", to: `${deal.name} (${deal.code})` },
      { field: "Term", to: termLabel },
      { field: "Amount", to: rupiah(amount) },
      ...(body.dueDate ? [{ field: "Due", to: dayLabel(String(body.dueDate)) ?? String(body.dueDate), toDay: String(body.dueDate) }] : []),
      ...(invoiceNo ? [{ field: "Invoice", to: invoiceNo }] : []),
      ...(paid !== undefined ? [{ field: "Paid", to: `${rupiah(paid)}${body.paidAt ? ` · ${body.paidAt}` : " · today"}` }] : []),
      ...(note ? [{ field: "Note", to: note }] : []),
      { field: "Terms", from: `${count} · ${rupiah(sum._sum.amount ?? 0)}`, to: `${count + 1} · ${rupiah(total)}` },
      ...(deal.contractValue ? [{ field: "Contract value", to: rupiah(deal.contractValue) }] : []),
    ],
    store: { dealId: deal.id, projectId: deal.projectId, term: body, clientRequestId: `gideon-${randomUUID()}` },
    note: "NOT added yet. It waits on the card below and is saved on the deal when the person confirms. Say the amount in rupiah and that it waits.",
  }
}

export const pipelineTools: Record<string, ExtraTool> = {
  move_deal_stage: {
    describe: describeMove,
    stepArg: (i) => str(i.deal) ?? str(i.name) ?? null,
    web: async (input, call) => {
      const r = await call({ method: "PATCH", path: `/api/projects/${String(input.projectId)}/pipeline/${String(input.dealId)}`, json: { stage: String(input.stage) } })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't move the deal") }
      return { ok: true, link: `/projects/${String(input.projectId)}`, result: { dealId: input.dealId, stage: r.body?.deal?.stage ?? input.stage } }
    },
  },
  add_payment_term: {
    describe: describeTerm,
    stepArg: (i) => str(i.deal) ?? str(i.name) ?? null,
    web: async (input, call) => {
      const term = (input.term && typeof input.term === "object" ? input.term : {}) as Record<string, unknown>
      const r = await call({ method: "POST", path: `/api/projects/${String(input.projectId)}/pipeline/${String(input.dealId)}/terms`, json: { ...term, clientRequestId: String(input.clientRequestId) } })
      if (!r.ok) return { ok: false, message: webError(r, "Couldn't add the payment term") }
      return { ok: true, link: `/projects/${String(input.projectId)}`, result: { termId: r.body?.term?.id ?? null } }
    },
  },
}
