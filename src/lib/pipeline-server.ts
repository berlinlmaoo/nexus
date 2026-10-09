import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import {
  CLOSING_STATUS_OPTIONS,
  CONTRACT_STATUS_OPTIONS,
  DELIVERABLE_RISK_OPTIONS,
  DELIVERABLE_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  PIPELINE_STAGES,
  READINESS_OPTIONS,
  SERVICE_OPTIONS,
  VREG_STATUS_OPTIONS,
  daysOverdueOf,
  healthOf,
  isWonStage,
  phasesOf,
  pipelineToday,
  stageGroupOf,
  termDaysOverdue,
  termOutstanding,
  termStatusOf,
  termSummaryOf,
} from "@/lib/pipeline"
import { documentsOut, mergeDocuments, storedDocs } from "@/lib/pipeline-documents"

/**
 * Database side of the Pipeline Dashboard (owner, 9 Oct 2026): who may read or write a project's deals,
 * what a deal looks like on the wire, and how a PATCH is checked. Rules (health, KPIs) are in
 * lib/pipeline.ts; the routes are under src/app/api/projects/[projectId]/pipeline.
 */

/** The prefix of every deal code ("TZN-26001"), as on the GM's board. */
export const DEAL_CODE_PREFIX = "TZN-"

const personSelect = { select: { id: true, name: true, avatar: true } } as const

export const dealInclude = {
  bd: personSelect,
  pm: personSelect,
  updatedBy: personSelect,
  createdBy: personSelect,
  executionProject: { select: { id: true, name: true } },
  terms: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.PipelineDealInclude

type DealRow = Prisma.PipelineDealGetPayload<{ include: typeof dealInclude }>
type TermRow = DealRow["terms"][number]

/** A payment term on the wire, with what the rules derive from it (owner, 9 Oct 2026). */
export function serializeTerm(t: TermRow, today: string) {
  const facts = {
    amount: t.amount,
    dueDate: dateOut(t.dueDate),
    invoiceNo: t.invoiceNo,
    invoiceDate: dateOut(t.invoiceDate),
    paidAmount: t.paidAmount,
    paidAt: dateOut(t.paidAt),
  }
  return {
    id: t.id,
    dealId: t.dealId,
    position: t.position,
    label: t.label,
    ...facts,
    note: t.note,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    status: termStatusOf(facts, today),
    outstanding: termOutstanding(facts),
    daysOverdue: termDaysOverdue(facts, today),
  }
}

export type SerializedTerm = ReturnType<typeof serializeTerm>

export type PipelineGate =
  | { ok: true; project: { id: string; name: string; type: string; workspaceId: string } }
  | { ok: false; response: NextResponse }

/**
 * The project's access rule (checkProjectAccess), as for any project: read = VIEWER, write = MEMBER —
 * system admin, One Above All / BoD / Manager of the workspace, and staff who are members of the project
 * (owner, 9 Oct 2026, evening: the board's people are added as project members by its lead, like a task
 * project). The GM's board stays "editable antar divisi": no field is held back. Only a PIPELINE project
 * has deals: anything else answers 400 NOT_PIPELINE.
 */
export async function pipelineGate(userId: string, projectId: string, need: "read" | "write"): Promise<PipelineGate> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, type: true, workspaceId: true },
  })
  if (!project) return { ok: false, response: NextResponse.json({ error: "Project not found" }, { status: 404 }) }
  const access = await checkProjectAccess(userId, projectId, need === "write" ? ["MEMBER"] : ["VIEWER"])
  if (!access.allowed) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  if (project.type !== "PIPELINE") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Project ini bukan Pipeline Dashboard.", code: "NOT_PIPELINE" }, { status: 400 }),
    }
  }
  return { ok: true, project }
}

function dateOut(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/** A deal as every client receives it: the stored columns, the people, and what the rules derive. */
export function serializeDeal(row: DealRow, today: string) {
  const terms = row.terms.map((t) => serializeTerm(t, today))
  const facts = {
    stage: row.stage,
    probability: row.probability,
    contractValue: row.contractValue,
    netValue: row.netValue,
    contractStatus: row.contractStatus,
    vregStatus: row.vregStatus,
    readiness: row.readiness,
    deliverableStatus: row.deliverableStatus,
    deliverableRisk: row.deliverableRisk,
    paymentStatus: row.paymentStatus,
    outstandingReceivable: row.outstandingReceivable,
    paymentDueDate: dateOut(row.paymentDueDate),
    maxDaysOverdue: row.maxDaysOverdue,
    netCash: row.netCash,
    closingStatus: row.closingStatus,
    blocker: row.blocker,
    terms,
  }
  return {
    id: row.id,
    projectId: row.projectId,
    code: row.code,
    position: row.position,
    name: row.name,
    brand: row.brand,
    // Several services, presets and typed ones (owner, 9 Oct 2026). `service` = the first, for apps that
    // know one service only.
    services: servicesOf(row),
    service: servicesOf(row)[0] ?? "Other",
    bdUserId: row.bdUserId,
    bdName: row.bdName,
    bd: row.bd,
    pmUserId: row.pmUserId,
    pmName: row.pmName,
    pm: row.pm,
    ...facts,
    invoiceValue: row.invoiceValue,
    mainDate: dateOut(row.mainDate),
    nextAction: row.nextAction,
    nextActionDate: dateOut(row.nextActionDate),
    notes: row.notes,
    // Pasted links and attached files (owner, 9 Oct 2026); a file's `url` is its members-only download
    // route — lib/pipeline-documents.ts.
    links: documentsOut(row.projectId, row.id, row.links),
    // The Task project made when the deal was won (lib/pipeline-execution.ts); null = none (yet).
    executionProjectId: row.executionProjectId,
    executionProject: row.executionProject,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    // Derived — the server's answer, so a phone does not have to port the formulas.
    stageGroup: stageGroupOf(row.stage),
    daysOverdue: daysOverdueOf(facts, today),
    health: healthOf(facts, today),
    phases: phasesOf(facts, today),
    // Payments per term (owner, 9 Oct 2026). With terms, termSummary's outstanding / paymentStatus /
    // nextDueDate are the deal's — show them instead of the manual fields, which stay as stored (the
    // fallback for a deal without terms). daysOverdue, health and the KPIs already use them.
    termSummary: termSummaryOf(terms, today),
  }
}

export type SerializedDeal = ReturnType<typeof serializeDeal>

// ── Validation ────────────────────────────────────────────────────────────────────────────────────────

type FieldKind =
  | { kind: "text"; max: number; required?: boolean }
  | { kind: "optText"; max: number }
  | { kind: "enum"; options: readonly string[] }
  | { kind: "money"; allowNegative?: boolean }
  | { kind: "probability" }
  | { kind: "days" }
  | { kind: "date" }
  | { kind: "user" }
  | { kind: "links" }
  | { kind: "services" }

/** At most this many services on a deal, each at most SERVICE_MAX characters. Guards, not rules. */
const SERVICES_MAX = 20
const SERVICE_MAX = 60

/** Every field a client may set, and how it is checked. `position` is separate: it is not history. */
export const DEAL_FIELDS: Record<string, FieldKind> = {
  name: { kind: "text", max: 200, required: true },
  brand: { kind: "text", max: 200 },
  // An app that knows one service sends `service` (a preset, or since 9 Oct 2026 any name); it becomes the
  // first of `services`, the others stay. `services` (the list) wins when both are sent.
  service: { kind: "text", max: SERVICE_MAX, required: true },
  services: { kind: "services" },
  bdUserId: { kind: "user" },
  bdName: { kind: "optText", max: 120 },
  pmUserId: { kind: "user" },
  pmName: { kind: "optText", max: 120 },
  stage: { kind: "enum", options: PIPELINE_STAGES },
  probability: { kind: "probability" },
  contractValue: { kind: "money" },
  netValue: { kind: "money" },
  invoiceValue: { kind: "money" },
  contractStatus: { kind: "enum", options: CONTRACT_STATUS_OPTIONS },
  vregStatus: { kind: "enum", options: VREG_STATUS_OPTIONS },
  readiness: { kind: "enum", options: READINESS_OPTIONS },
  deliverableStatus: { kind: "enum", options: DELIVERABLE_STATUS_OPTIONS },
  deliverableRisk: { kind: "enum", options: DELIVERABLE_RISK_OPTIONS },
  paymentStatus: { kind: "enum", options: PAYMENT_STATUS_OPTIONS },
  outstandingReceivable: { kind: "money" },
  paymentDueDate: { kind: "date" },
  maxDaysOverdue: { kind: "days" },
  netCash: { kind: "money", allowNegative: true },
  closingStatus: { kind: "enum", options: CLOSING_STATUS_OPTIONS },
  mainDate: { kind: "date" },
  nextAction: { kind: "text", max: 500 },
  nextActionDate: { kind: "date" },
  blocker: { kind: "text", max: 500 },
  notes: { kind: "text", max: 5000 },
  links: { kind: "links" },
}

/** The 1e15 rupiah ceiling only keeps a typo (or a paste of a whole row) out of the totals. */
const MONEY_MAX = 1e15
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type FieldError = { field: string; error: string }

function parseDate(v: unknown): Date | null | undefined {
  if (v === null || v === "") return null
  if (typeof v !== "string" || !DATE_RE.test(v)) return undefined
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : d
}

/**
 * Checks the fields of a create or PATCH body against DEAL_FIELDS. Unknown keys are ignored (a newer
 * client may send more). People must be members of the project's workspace — the pickers offer exactly
 * those. Returns the Prisma data (dates as Date) or the first field that is wrong.
 *
 * `current`: the deal on a PATCH. Its links: attached files are matched against them by id and kept
 * (owner, 9 Oct 2026: files come and go only through the upload and DELETE …/documents/:docId); a create
 * has none, so a list that names a file there is refused. Its services: what a single `service` is put
 * in front of.
 */
export async function parseDealFields(
  body: Record<string, unknown>,
  workspaceId: string,
  current?: { links?: unknown; services?: string[]; service?: string },
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: FieldError }> {
  const data: Record<string, unknown> = {}
  const bad = (field: string, error: string) => ({ ok: false as const, error: { field, error } })
  for (const [field, spec] of Object.entries(DEAL_FIELDS)) {
    if (!(field in body)) continue
    const v = body[field]
    switch (spec.kind) {
      case "text": {
        if (typeof v !== "string") return bad(field, "Harus berupa teks.")
        const s = v.trim()
        if (spec.required && !s) return bad(field, "Tidak boleh kosong.")
        if (s.length > spec.max) return bad(field, `Maksimal ${spec.max} karakter.`)
        data[field] = s
        break
      }
      case "optText": {
        if (v === null || v === "") { data[field] = null; break }
        if (typeof v !== "string") return bad(field, "Harus berupa teks.")
        const s = v.trim()
        if (s.length > spec.max) return bad(field, `Maksimal ${spec.max} karakter.`)
        data[field] = s || null
        break
      }
      case "enum":
        if (typeof v !== "string" || !spec.options.includes(v)) return bad(field, "Pilihan tidak dikenal.")
        data[field] = v
        break
      case "money": {
        const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
        if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > MONEY_MAX) return bad(field, "Harus berupa angka.")
        if (!spec.allowNegative && n < 0) return bad(field, "Tidak boleh negatif.")
        data[field] = Math.round(n)
        break
      }
      case "probability":
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return bad(field, "Probabilitas 0 sampai 1.")
        data[field] = v
        break
      case "days":
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 3650) return bad(field, "Jumlah hari tidak valid.")
        data[field] = v
        break
      case "date": {
        const d = parseDate(v)
        if (d === undefined) return bad(field, "Tanggal harus YYYY-MM-DD.")
        data[field] = d
        break
      }
      case "user": {
        if (v === null || v === "") { data[field] = null; break }
        if (typeof v !== "string") return bad(field, "Orang tidak dikenal.")
        const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: v }, select: { id: true } })
        if (!member) return bad(field, "Orang ini bukan anggota workspace project ini.")
        data[field] = v
        break
      }
      case "links": {
        const links = mergeDocuments(storedDocs(current?.links ?? []), v)
        if (!links) return bad(field, "Link harus diawali http:// atau https://.")
        data[field] = links
        break
      }
      case "services": {
        const list = normalizeServices(v)
        if (!list) return bad(field, `Maksimal ${SERVICES_MAX} service, masing-masing 1–${SERVICE_MAX} karakter.`)
        data[field] = list
        break
      }
    }
  }
  // The two service fields always move together: `service` (the column older apps read) = the first.
  if ("services" in data) {
    const list = data.services as string[]
    data.service = list[0] ?? ""
  } else if (typeof data.service === "string") {
    const first = normalizeServices([data.service])?.[0] ?? data.service
    const rest = (current ? servicesOf({ services: current.services ?? [], service: current.service ?? "" }) : [])
      .filter((s) => s.toLowerCase() !== first.toLowerCase())
    data.service = first
    data.services = [first, ...rest]
  }
  return { ok: true, data }
}

// ── Services (owner, 9 Oct 2026: "gw mau bisa select multiple services dan ngetik service sendiri") ──

/**
 * A deal's services: the list, or — a deal from before the list (9 Oct 2026) — its single `service`.
 * An emptied list stays empty: writing the list sets `service` to "" with it.
 */
export function servicesOf(row: { services?: string[] | null; service?: string | null }): string[] {
  if (row.services && row.services.length) return row.services
  return row.service ? [row.service] : []
}

/**
 * A list as sent → as stored: trimmed, inner spaces collapsed, a preset typed in another case spelled as
 * the preset ("event" → "Event"), duplicates (any case) dropped, order kept. undefined = refused.
 */
export function normalizeServices(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > SERVICES_MAX) return undefined
  const presets = new Map(SERVICE_OPTIONS.map((s) => [s.toLowerCase(), s as string]))
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (typeof raw !== "string") return undefined
    const s = raw.trim().replace(/\s+/g, " ")
    if (!s || s.length > SERVICE_MAX) return undefined
    const name = presets.get(s.toLowerCase()) ?? s
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

/** A value as the history keeps it: dates as "YYYY-MM-DD", everything else as JSON. */
export function historyValue(v: unknown): Prisma.InputJsonValue | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return v as Prisma.InputJsonValue
}

/** Same value? Dates by day, links by content. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(historyValue(a)) === JSON.stringify(historyValue(b))
}

/**
 * Moving a deal into Lost / Cancelled makes its probability 0, into a won stage 1 — unless the same
 * request sets probability itself. Otherwise a deal won at 25% keeps weighing 25% if someone moves it
 * back, and a lost one keeps counting in the forecast.
 */
export function probabilityForStage(stage: string): number | null {
  if (stage === "Lost / Cancelled") return 0
  if (isWonStage(stage)) return 1
  return null
}

/** Default probability of a new deal: the GM's 10% in the open stages, 100% otherwise. */
export function defaultProbability(stage: string): number {
  return stageGroupOf(stage) === "Pipeline" ? 0.1 : stage === "Lost / Cancelled" ? 0 : 1
}

/**
 * The next free code in the project: "TZN-" + 2-digit year + 3-digit sequence, one above the highest
 * code that can still show up on this board — the deals that exist, and the deleted deals Control Room →
 * Audit can still restore (an unrestored DeletionSnapshot; restoring one with a code handed out again
 * would hit the unique index). Not the audit trail of every deal ever created: an emptied board starts
 * again at 001, and a code comes free only once nothing can bring its deal back (owner, 9 Oct 2026:
 * "start fresh" after the demo deals were cleared). The company has one board (POST /api/projects
 * refuses a second, owner/GM 9 Oct 2026), so this is its one series.
 */
export async function nextDealCode(projectId: string, now: Date = new Date()): Promise<string> {
  // The year of the company's day (WIB), so a deal added at 01:00 on 1 January is already "27…".
  const yy = pipelineToday(now).slice(2, 4)
  const head = `${DEAL_CODE_PREFIX}${yy}`
  const [live, restorable] = await Promise.all([
    prisma.pipelineDeal.findMany({ where: { projectId, code: { startsWith: head } }, select: { code: true } }),
    prisma.deletionSnapshot.findMany({
      where: { entityType: "pipeline_deal", restoredAt: null, meta: { path: ["projectId"], equals: projectId } },
      select: { data: true },
    }),
  ])
  let max = 0
  const consider = (code: unknown) => {
    if (typeof code !== "string" || !code.startsWith(head)) return
    const n = Number.parseInt(code.slice(head.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  for (const d of live) consider(d.code)
  for (const snap of restorable) {
    const rows = (snap.data as { tables?: { PipelineDeal?: { code?: unknown }[] } } | null)?.tables?.PipelineDeal
    for (const row of Array.isArray(rows) ? rows : []) consider(row?.code)
  }
  return `${head}${String(max + 1).padStart(3, "0")}`
}

// ── Payment terms (owner, 9 Oct 2026: "perlu per termin") ─────────────────────────────────────────────

/** Every field of a term a client may set. `position` is separate (order, not history). */
export const TERM_FIELDS: Record<string, FieldKind> = {
  label: { kind: "text", max: 80 },
  amount: { kind: "money" },
  dueDate: { kind: "date" },
  invoiceNo: { kind: "text", max: 80 },
  invoiceDate: { kind: "date" },
  paidAmount: { kind: "money" },
  paidAt: { kind: "date" },
  note: { kind: "text", max: 1000 },
}

/** A deal holds at most this many terms — a guard against a runaway client, not a business rule. */
export const MAX_TERMS_PER_DEAL = 60

/** Checks a term body against TERM_FIELDS, same rules (and same error shape) as a deal's fields. */
export function parseTermFields(
  body: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: FieldError } {
  const data: Record<string, unknown> = {}
  const bad = (field: string, error: string) => ({ ok: false as const, error: { field, error } })
  for (const [field, spec] of Object.entries(TERM_FIELDS)) {
    if (!(field in body)) continue
    const v = body[field]
    if (spec.kind === "text") {
      if (typeof v !== "string") return bad(field, "Harus berupa teks.")
      const t = v.trim()
      if (t.length > spec.max) return bad(field, `Maksimal ${spec.max} karakter.`)
      data[field] = t
    } else if (spec.kind === "money") {
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
      if (typeof n !== "number" || !Number.isFinite(n) || n > MONEY_MAX) return bad(field, "Harus berupa angka.")
      if (n < 0) return bad(field, "Tidak boleh negatif.")
      data[field] = Math.round(n)
    } else if (spec.kind === "date") {
      const d = parseDate(v)
      if (d === undefined) return bad(field, "Tanggal harus YYYY-MM-DD.")
      data[field] = d
    }
  }
  return { ok: true, data }
}
