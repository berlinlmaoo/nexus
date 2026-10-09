/**
 * Pipeline Dashboard (Project.type "PIPELINE", owner 9 Oct 2026): the vocabulary and the rules.
 *
 * Berlin: "GM gw udh kirim contoh pipeline dashboard yg dia pengen … tinggal diubah ke design NEXUS".
 * The GM's board ("Control Tower TZN") is the reference: its stage and status lists, its health rule and
 * its KPI formulas are kept as they are, so the numbers on NEXUS match the numbers he already trusts.
 * Stored values are his English keys (the dash in "Won – …" is an EN DASH); clients translate labels.
 *
 * Pure — no database, no imports. The web app keeps a byte-for-byte copy in
 * apps/nexus-lovable-ui/src/lib/pipeline.ts so an optimistic edit shows the same health the server will
 * send back. Change both. The spec, with the formulas in a table: ~/handoff/chat/PIPELINE-DASHBOARD.md.
 */

export const PIPELINE_STAGES = [
  "Incoming",
  "Proposal / Quotation",
  "Negotiation",
  "Won – Contract Pending",
  "Won – In Execution",
  "Closing",
  "Closed",
  "Lost / Cancelled",
] as const
export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export type StageGroup = "Pipeline" | "Pre-Execution" | "Execution" | "Closed" | "Lost"

export const SERVICE_OPTIONS = ["Event", "Creative", "Multimedia", "Digital Campaign", "Production", "Activation", "Exhibition", "Other"] as const
export const PROBABILITY_OPTIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1] as const
export const CONTRACT_STATUS_OPTIONS = ["Not Started", "Request to Legal", "Legal Drafting", "Internal Review", "Sent to Client", "Client Review", "Revision", "Final Review", "Client Signed", "TZN Signed", "Fully Executed", "Cancelled"] as const
export const VREG_STATUS_OPTIONS = ["Not Required", "Not Started", "Documents Gathering", "Ready to Submit", "Submitted", "Client Review", "Revision Required", "Approved", "Rejected"] as const
export const READINESS_OPTIONS = ["N/A", "Blocked", "Partial", "Ready"] as const
export const DELIVERABLE_STATUS_OPTIONS = ["Not Started", "Briefing", "In Progress", "Internal Review", "Client Review", "Revision", "Approved", "Completed", "Cancelled"] as const
export const DELIVERABLE_RISK_OPTIONS = ["Aman", "At Risk", "Overdue"] as const
export const PAYMENT_STATUS_OPTIONS = ["Not Yet", "Upcoming", "Due", "Overdue", "Partial", "Paid"] as const
export const CLOSING_STATUS_OPTIONS = ["Not Ready", "In Progress", "Waiting BAST", "Waiting Client Payment", "Waiting Vendor Settlement", "Waiting Deliverables", "Ready to Close", "Closed"] as const
export const LINK_TYPES = ["SPK", "Kontrak", "MOU", "Invoice", "Lainnya"] as const

/** Every option list, as GET …/pipeline sends it (`vocab`), so a client can draw its pickers from the server. */
export const PIPELINE_VOCAB = {
  stages: PIPELINE_STAGES,
  services: SERVICE_OPTIONS,
  probabilities: PROBABILITY_OPTIONS,
  contractStatuses: CONTRACT_STATUS_OPTIONS,
  vregStatuses: VREG_STATUS_OPTIONS,
  readiness: READINESS_OPTIONS,
  deliverableStatuses: DELIVERABLE_STATUS_OPTIONS,
  deliverableRisks: DELIVERABLE_RISK_OPTIONS,
  paymentStatuses: PAYMENT_STATUS_OPTIONS,
  closingStatuses: CLOSING_STATUS_OPTIONS,
  linkTypes: LINK_TYPES,
} as const

/** The GM's thresholds (his Google Sheets cfg_* parameters). */
export const PIPELINE_CFG = { paymentOverdueDays: 7, negCashPct: 0.1 } as const

/** The deal fields the rules read. Dates are "YYYY-MM-DD" or null (the API's shape). */
export type PipelineDealFacts = {
  stage: string
  probability: number
  contractValue: number
  netValue: number
  contractStatus: string
  vregStatus: string
  readiness: string
  deliverableStatus: string
  deliverableRisk: string
  paymentStatus: string
  outstandingReceivable: number
  paymentDueDate: string | null
  maxDaysOverdue: number
  netCash: number
  closingStatus: string
  blocker: string
}

export function stageGroupOf(stage: string): StageGroup {
  if (stage === "Incoming" || stage === "Proposal / Quotation" || stage === "Negotiation") return "Pipeline"
  if (stage === "Lost / Cancelled") return "Lost"
  if (stage === "Closed") return "Closed"
  if (stage === "Won – Contract Pending") return "Pre-Execution"
  return "Execution"
}

/** A stage of a deal that has been won (probability 1 when a deal moves here). */
export function isWonStage(stage: string): boolean {
  const g = stageGroupOf(stage)
  return g === "Pre-Execution" || g === "Execution" || g === "Closed"
}

/** The value a deal is counted at: its net value, or the contract value while net is not filled in (GM). */
export function dealValue(d: Pick<PipelineDealFacts, "netValue" | "contractValue">): number {
  return d.netValue > 0 ? d.netValue : d.contractValue || 0
}

/** Today in Jakarta as "YYYY-MM-DD" — the company's day, whatever the server's clock zone. */
export function pipelineToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * Days the receivable is overdue. From the payment due date while money is still owed — a number typed
 * by hand (the GM's sheet) is wrong the next morning; the typed maxDaysOverdue stays for rows without a
 * date (owner, 9 Oct 2026).
 */
export function daysOverdueOf(d: Pick<PipelineDealFacts, "paymentDueDate" | "outstandingReceivable" | "paymentStatus" | "maxDaysOverdue">, today: string): number {
  if (d.paymentDueDate && d.outstandingReceivable > 0 && d.paymentStatus !== "Paid") {
    return Math.max(0, daysBetween(d.paymentDueDate, today))
  }
  return Math.max(0, Math.round(d.maxDaysOverdue || 0))
}

export type HealthKey = "CRITICAL" | "ATTENTION" | "HEALTHY" | "NOT_STARTED" | "NONE"
export type HealthReasonCode =
  | "READINESS_BLOCKED"
  | "EXECUTION_WITHOUT_CONTRACT"
  | "RECEIVABLE_OVERDUE"
  | "DELIVERABLE_OVERDUE"
  | "NEGATIVE_CASH"
  | "READINESS_PARTIAL"
  | "DELIVERABLE_AT_RISK"
  | "PAYMENT_PARTIAL"
  | "PAYMENT_DUE"
  | "MINOR_OVERDUE"
  | "BLOCKER"
  | "VREG_PENDING"
export type HealthReason = { code: HealthReasonCode; days?: number; text?: string }
export type DealHealth = { key: HealthKey; reasons: HealthReason[] }

/** The GM's computeHealth, unchanged — reasons as codes so every client says them in its own language. */
export function healthOf(d: PipelineDealFacts, today: string): DealHealth {
  const group = stageGroupOf(d.stage)
  if (group === "Pipeline") return { key: "NOT_STARTED", reasons: [] }
  if (group === "Lost") return { key: "NONE", reasons: [] }
  const overdue = daysOverdueOf(d, today)
  const critical: HealthReason[] = []
  if (d.readiness === "Blocked") critical.push({ code: "READINESS_BLOCKED" })
  if (d.contractStatus !== "Fully Executed" && d.stage === "Won – In Execution") critical.push({ code: "EXECUTION_WITHOUT_CONTRACT" })
  if (overdue > PIPELINE_CFG.paymentOverdueDays) critical.push({ code: "RECEIVABLE_OVERDUE", days: overdue })
  if (d.deliverableRisk === "Overdue") critical.push({ code: "DELIVERABLE_OVERDUE" })
  if (d.netValue > 0 && d.netCash < -(PIPELINE_CFG.negCashPct * d.netValue)) critical.push({ code: "NEGATIVE_CASH" })
  if (critical.length) return { key: "CRITICAL", reasons: critical }
  const attention: HealthReason[] = []
  if (d.readiness === "Partial") attention.push({ code: "READINESS_PARTIAL" })
  if (d.deliverableRisk === "At Risk") attention.push({ code: "DELIVERABLE_AT_RISK" })
  if (d.paymentStatus === "Partial") attention.push({ code: "PAYMENT_PARTIAL" })
  if (d.paymentStatus === "Due") attention.push({ code: "PAYMENT_DUE" })
  if (overdue > 0) attention.push({ code: "MINOR_OVERDUE", days: overdue })
  if (d.blocker) attention.push({ code: "BLOCKER", text: d.blocker })
  if (d.vregStatus && d.vregStatus !== "Approved" && d.vregStatus !== "Not Required") attention.push({ code: "VREG_PENDING" })
  if (attention.length) return { key: "ATTENTION", reasons: attention }
  return { key: "HEALTHY", reasons: [] }
}

export type PhaseKey = "commercial" | "contract" | "readiness" | "deliverable" | "payment" | "closing"
export type PhaseState = "done" | "active" | "pending" | "bad"
export type DealPhase = { key: PhaseKey; state: PhaseState }

/** The six-dot track on every card: how far each operational line of the deal has come (GM's nodes). */
export function phasesOf(d: PipelineDealFacts): DealPhase[] {
  const group = stageGroupOf(d.stage)
  const commercial: PhaseState = group === "Pipeline" ? (d.stage === "Incoming" ? "pending" : "active") : group === "Lost" ? "bad" : "done"
  const contract: PhaseState = d.contractStatus === "Fully Executed" ? "done" : d.contractStatus === "Cancelled" ? "bad" : !d.contractStatus || d.contractStatus === "Not Started" ? "pending" : "active"
  const readiness: PhaseState = d.readiness === "Ready" ? "done" : d.readiness === "Blocked" ? "bad" : d.readiness === "Partial" ? "active" : "pending"
  const deliverable: PhaseState =
    d.deliverableStatus === "Completed" || d.deliverableStatus === "Approved" ? "done"
      : d.deliverableRisk === "Overdue" ? "bad"
      : d.deliverableRisk === "At Risk" ? "active"
      : d.deliverableStatus === "Not Started" ? "pending"
      : "active"
  const payment: PhaseState =
    d.paymentStatus === "Paid" ? "done"
      : d.paymentStatus === "Overdue" ? "bad"
      : d.paymentStatus === "Partial" || d.paymentStatus === "Due" || d.paymentStatus === "Upcoming" ? "active"
      : "pending"
  const closing: PhaseState = d.closingStatus === "Closed" ? "done" : !d.closingStatus || d.closingStatus === "Not Ready" ? "pending" : "active"
  return [
    { key: "commercial", state: commercial },
    { key: "contract", state: contract },
    { key: "readiness", state: readiness },
    { key: "deliverable", state: deliverable },
    { key: "payment", state: payment },
    { key: "closing", state: closing },
  ]
}

export type PipelineSummary = {
  total: number
  /** Incoming + Proposal + Negotiation: count and Σ value. */
  openCount: number
  openValue: number
  /** Σ value × probability over the open deals — the GM's "Weighted Pipeline". */
  weightedValue: number
  /** Won – Contract Pending, Won – In Execution, Closing, Closed: count and Σ net value. */
  wonCount: number
  wonValue: number
  /** Won – Contract Pending + In Execution + Closing — the GM's "Project Aktif". */
  activeCount: number
  lostCount: number
  lostValue: number
  readyCount: number
  blockedCount: number
  receivable: number
  /** Σ receivable of deals overdue by at least a day. */
  receivableOverdue: number
  criticalCount: number
  attentionCount: number
  /** Deliverable risk "Aman" outside the open pipeline and not yet completed — the GM's "Deliverable Aman". */
  deliverablesOnTrack: number
  deliverablesDone: number
}

/** The KPI strip, over every deal of the project (never the filtered view). The GM's renderInstruments. */
export function summarize(deals: PipelineDealFacts[], today: string): PipelineSummary {
  const s: PipelineSummary = {
    total: deals.length, openCount: 0, openValue: 0, weightedValue: 0, wonCount: 0, wonValue: 0, activeCount: 0,
    lostCount: 0, lostValue: 0, readyCount: 0, blockedCount: 0, receivable: 0, receivableOverdue: 0,
    criticalCount: 0, attentionCount: 0, deliverablesOnTrack: 0, deliverablesDone: 0,
  }
  for (const d of deals) {
    const group = stageGroupOf(d.stage)
    const value = dealValue(d)
    if (group === "Pipeline") {
      s.openCount++
      s.openValue += value
      s.weightedValue += value * (d.probability || 0)
    } else if (group === "Lost") {
      s.lostCount++
      s.lostValue += value
    } else {
      s.wonCount++
      s.wonValue += d.netValue || 0
      if (group !== "Closed") s.activeCount++
    }
    if (d.readiness === "Ready") s.readyCount++
    if (d.readiness === "Blocked") s.blockedCount++
    s.receivable += d.outstandingReceivable || 0
    if (daysOverdueOf(d, today) > 0) s.receivableOverdue += d.outstandingReceivable || 0
    const h = healthOf(d, today).key
    if (h === "CRITICAL") s.criticalCount++
    if (h === "ATTENTION") s.attentionCount++
    if (d.deliverableStatus === "Completed" || d.deliverableStatus === "Approved") s.deliverablesDone++
    else if (d.deliverableRisk === "Aman" && group !== "Pipeline") s.deliverablesOnTrack++
  }
  return s
}
