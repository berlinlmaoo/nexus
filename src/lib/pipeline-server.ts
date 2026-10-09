import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import {
  CLOSING_STATUS_OPTIONS,
  CONTRACT_STATUS_OPTIONS,
  DELIVERABLE_RISK_OPTIONS,
  DELIVERABLE_STATUS_OPTIONS,
  LINK_TYPES,
  PAYMENT_STATUS_OPTIONS,
  PIPELINE_STAGES,
  READINESS_OPTIONS,
  SERVICE_OPTIONS,
  VREG_STATUS_OPTIONS,
  daysOverdueOf,
  healthOf,
  isWonStage,
  phasesOf,
  stageGroupOf,
} from "@/lib/pipeline"

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
} satisfies Prisma.PipelineDealInclude

type DealRow = Prisma.PipelineDealGetPayload<{ include: typeof dealInclude }>

export type PipelineGate =
  | { ok: true; project: { id: string; name: string; type: string; workspaceId: string } }
  | { ok: false; response: NextResponse }

/**
 * The project's own access rule (checkProjectAccess, the board's): read = VIEWER, write = MEMBER — system
 * admin, One Above All / BoD / Manager of the workspace, and staff who are members of the project. The
 * GM's board is "editable antar divisi", so no money field is held back from members (open question in
 * the spec). Only a PIPELINE project has deals: anything else answers 400 NOT_PIPELINE.
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

type Link = { id: string; type: string; label: string; url: string }

function linksOut(raw: unknown): Link[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((l): l is Link => !!l && typeof l === "object" && typeof (l as Link).url === "string")
}

/** A deal as every client receives it: the stored columns, the people, and what the rules derive. */
export function serializeDeal(row: DealRow, today: string) {
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
  }
  return {
    id: row.id,
    projectId: row.projectId,
    code: row.code,
    position: row.position,
    name: row.name,
    brand: row.brand,
    service: row.service,
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
    links: linksOut(row.links),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    // Derived — the server's answer, so a phone does not have to port the formulas.
    stageGroup: stageGroupOf(row.stage),
    daysOverdue: daysOverdueOf(facts, today),
    health: healthOf(facts, today),
    phases: phasesOf(facts),
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

/** Every field a client may set, and how it is checked. `position` is separate: it is not history. */
export const DEAL_FIELDS: Record<string, FieldKind> = {
  name: { kind: "text", max: 200, required: true },
  brand: { kind: "text", max: 200 },
  service: { kind: "enum", options: SERVICE_OPTIONS },
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

function parseLinks(v: unknown): Link[] | undefined {
  if (!Array.isArray(v) || v.length > 50) return undefined
  const out: Link[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== "object") return undefined
    const l = raw as Record<string, unknown>
    const url = typeof l.url === "string" ? l.url.trim() : ""
    // http(s) only: a javascript: or data: link on a shared board would run in a colleague's browser.
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return undefined
    const type = typeof l.type === "string" && (LINK_TYPES as readonly string[]).includes(l.type) ? l.type : "Lainnya"
    const label = typeof l.label === "string" ? l.label.trim().slice(0, 200) : ""
    const id = typeof l.id === "string" && l.id.length > 0 && l.id.length <= 40 ? l.id : `lnk${Math.random().toString(36).slice(2, 10)}`
    out.push({ id, type, label, url })
  }
  return out
}

/**
 * Checks the fields of a create or PATCH body against DEAL_FIELDS. Unknown keys are ignored (a newer
 * client may send more). People must be members of the project's workspace — the pickers offer exactly
 * those. Returns the Prisma data (dates as Date) or the first field that is wrong.
 */
export async function parseDealFields(
  body: Record<string, unknown>,
  workspaceId: string,
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
        const links = parseLinks(v)
        if (!links) return bad(field, "Link harus diawali http:// atau https://.")
        data[field] = links
        break
      }
    }
  }
  return { ok: true, data }
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
 * The next free code in the project: "TZN-" + 2-digit year + 3-digit sequence. Counts the codes of
 * deals that exist AND of deals ever created here (their audit rows), so a deleted deal's code is never
 * handed out again — its restore from Audit would otherwise collide with the newcomer.
 */
export async function nextDealCode(projectId: string, now: Date = new Date()): Promise<string> {
  const yy = String(now.getUTCFullYear()).slice(-2)
  const head = `${DEAL_CODE_PREFIX}${yy}`
  const [live, created] = await Promise.all([
    prisma.pipelineDeal.findMany({ where: { projectId, code: { startsWith: head } }, select: { code: true } }),
    prisma.auditLog.findMany({
      where: { entityType: "pipeline_deal", action: "create", metadata: { path: ["projectId"], equals: projectId } },
      select: { metadata: true },
    }),
  ])
  let max = 0
  const consider = (code: unknown) => {
    if (typeof code !== "string" || !code.startsWith(head)) return
    const n = Number.parseInt(code.slice(head.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  for (const d of live) consider(d.code)
  for (const a of created) consider((a.metadata as { code?: unknown } | null)?.code)
  return `${head}${String(max + 1).padStart(3, "0")}`
}
