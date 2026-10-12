import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { checkProjectAccess, isSystemAdminUser, hasProjectLevel } from "@/lib/rbac"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { emitOutletSalesChanged } from "@/lib/socket-emitter"
import {
  OUTLET_FIELDS,
  OUTLET_FORM,
  isMonth,
  missingOf,
  monthBounds,
  outletToday,
  pctOf,
  statusOf,
  sumFilled,
  summarizeMonth,
} from "@/lib/outlet-sales"

/**
 * Database side of the Outlet Sales Dashboard (owner, 10 Oct 2026; rules in lib/outlet-sales.ts): who may
 * read or write, what an event looks like on the wire, how a body is checked, and the writes themselves.
 * The routes under src/app/api/projects/[projectId]/outlet-sales only authenticate and call these, so a
 * test script exercises exactly what the API runs (scripts/test-outlet-sales.ts).
 */

export const OUTLET_TYPE = "OUTLET_SALES"

type GateProject = { id: string; name: string; type: string; workspaceId: string }
export type OutletGate = { ok: true; project: GateProject } | { ok: false; response: NextResponse }

/**
 * An ordinary project for access (owner: "akses = anggota project seperti project biasa"):
 * checkProjectAccess with read = VIEWER, write = MEMBER — the project's members, plus Manager / BoD /
 * One Above All of the workspace and system admins, exactly as for a task project. Any member may add
 * an event and fill or change a report. Anything that is not an OUTLET_SALES project answers 400
 * NOT_OUTLET_SALES.
 */
export async function outletGate(userId: string, projectId: string, need: "read" | "write"): Promise<OutletGate> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, type: true, workspaceId: true },
  })
  if (!project) return { ok: false, response: NextResponse.json({ error: "Project not found" }, { status: 404 }) }
  const access = await checkProjectAccess(userId, projectId, need === "write" ? ["MEMBER"] : ["VIEWER"])
  if (!access.allowed) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  if (project.type !== OUTLET_TYPE) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Project ini bukan Outlet Sales Dashboard.", code: "NOT_OUTLET_SALES" }, { status: 400 }),
    }
  }
  return { ok: true, project }
}

/**
 * Who sets the monthly targets: the same people who manage the project's settings (canManageProject in
 * api/projects/[projectId]/route.ts) — system admin, the project's LEAD, and Manager / BoD / One Above
 * All of its workspace.
 */
export async function canManageOutletTargets(userId: string, projectId: string): Promise<boolean> {
  // Full access (lib/rbac.ts): the Project Owner, BoD / One Above All, a system admin (owner 13 Oct 2026).
  return hasProjectLevel(userId, projectId, "FULL")
}

// ── Wire format ───────────────────────────────────────────────────────────────────────────────────────

const personSelect = { select: { id: true, name: true, avatar: true } } as const

export const eventInclude = {
  createdBy: personSelect,
  updatedBy: personSelect,
  reportedBy: personSelect,
} satisfies Prisma.OutletSalesEventInclude

type EventRow = Prisma.OutletSalesEventGetPayload<{ include: typeof eventInclude }>

export function dayOut(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dayIn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

/** An event as every client receives it: what was typed, and what the rules derive from it. */
export function serializeEvent(row: EventRow, today: string) {
  const date = dayOut(row.date)
  const facts = { date, sales: row.sales, pax: row.pax }
  return {
    id: row.id,
    projectId: row.projectId,
    date,
    name: row.name,
    salesTarget: row.salesTarget,
    paxTarget: row.paxTarget,
    sales: row.sales,
    pax: row.pax,
    rsvpWalkIn: row.rsvpWalkIn,
    rsvpTeam: row.rsvpTeam,
    rsvpPr: row.rsvpPr,
    rsvpEo: row.rsvpEo,
    hostingTeam: row.hostingTeam,
    hostingPr: row.hostingPr,
    hostingEo: row.hostingEo,
    successWhat: row.successWhat,
    successWhy: row.successWhy,
    successRepeat: row.successRepeat,
    failWhat: row.failWhat,
    failWhy: row.failWhy,
    failPrevent: row.failPrevent,
    // Derived: the server's answer, so a phone does not port the arithmetic.
    rsvpTotal: sumFilled([row.rsvpWalkIn, row.rsvpTeam, row.rsvpPr, row.rsvpEo]),
    hostingTotal: sumFilled([row.hostingTeam, row.hostingPr, row.hostingEo]),
    salesPct: pctOf(row.sales, row.salesTarget),
    paxPct: pctOf(row.pax, row.paxTarget),
    status: statusOf(facts, today),
    missing: missingOf(facts),
    reportedAt: row.reportedAt?.toISOString() ?? null,
    reportedBy: row.reportedBy,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  }
}

export type SerializedOutletEvent = ReturnType<typeof serializeEvent>

type TargetRow = Prisma.OutletSalesTargetGetPayload<{ include: { updatedBy: typeof personSelect } }>

export function serializeTarget(row: TargetRow) {
  return {
    month: row.month,
    salesTarget: row.salesTarget,
    paxTarget: row.paxTarget,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  }
}

// ── Validation ────────────────────────────────────────────────────────────────────────────────────────

export type FieldError = { field: string; error: string }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDay(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false
  const d = dayIn(v)
  if (Number.isNaN(d.getTime()) || dayOut(d) !== v) return false
  const y = Number(v.slice(0, 4))
  return y >= 2000 && y <= 2100
}

/**
 * Checks a create or PATCH body against the form's fields (OUTLET_FIELDS). Only keys that are sent are
 * checked and returned; unknown keys are ignored (a newer client may send more). Numbers: whole and not
 * negative, null or "" = not filled (clears it). A money amount may come as a number or a digit string;
 * it is rounded to whole rupiah. Texts are trimmed. On a create, name and date are required.
 */
export function parseEventFields(
  body: Record<string, unknown>,
  mode: "create" | "patch",
): { ok: true; data: Record<string, unknown> } | { ok: false; error: FieldError } {
  const data: Record<string, unknown> = {}
  const bad = (field: string, error: string) => ({ ok: false as const, error: { field, error } })
  if (mode === "create") {
    if (!("name" in body)) return bad("name", "Nama event wajib diisi.")
    if (!("date" in body)) return bad("date", "Tanggal wajib diisi.")
  }
  for (const [key, spec] of Object.entries(OUTLET_FIELDS)) {
    if (!(key in body)) continue
    const v = body[key]
    switch (spec.type) {
      case "text": {
        if (typeof v !== "string") return bad(key, "Harus berupa teks.")
        const s = v.trim()
        if (spec.required && !s) return bad(key, "Nama event wajib diisi.")
        if (s.length > spec.max) return bad(key, `Maksimal ${spec.max} karakter.`)
        data[key] = s
        break
      }
      case "longtext": {
        if (v === null) { data[key] = ""; break }
        if (typeof v !== "string") return bad(key, "Harus berupa teks.")
        const s = v.trim()
        if (s.length > spec.max) return bad(key, `Maksimal ${spec.max} karakter.`)
        data[key] = s
        break
      }
      case "date":
        if (!validDay(v)) return bad(key, "Tanggal harus YYYY-MM-DD.")
        data[key] = dayIn(v)
        break
      case "money":
      case "count": {
        if (v === null || v === "") { data[key] = null; break }
        const n = typeof v === "string" ? Number(v.replace(/[.,\s]/g, "")) : v
        if (typeof n !== "number" || !Number.isFinite(n)) return bad(key, "Harus berupa angka.")
        if (n < 0) return bad(key, "Tidak boleh negatif.")
        if (n > spec.max) return bad(key, "Angkanya terlalu besar.")
        if (spec.type === "count" && !Number.isInteger(n)) return bad(key, "Harus bilangan bulat.")
        data[key] = Math.round(n)
        break
      }
    }
  }
  return { ok: true, data }
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────

/** How many older events still waiting for a report one read returns. */
const WAITING_EARLIER_LIMIT = 50

/** GET …/outlet-sales?month=: the month's target, summary and events, and older nights still unreported. */
export async function loadOutletMonth(projectId: string, month: string, today: string = outletToday()) {
  const { start, next } = monthBounds(month)
  const [targetRow, rows, earlier] = await Promise.all([
    prisma.outletSalesTarget.findUnique({ where: { projectId_month: { projectId, month } }, include: { updatedBy: personSelect } }),
    prisma.outletSalesEvent.findMany({
      where: { projectId, date: { gte: dayIn(start), lt: dayIn(next) } },
      include: eventInclude,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    // Nights before this month that are over and still miss an actual: the Board's "Waiting report"
    // column and the Overview's reminder show them too, so a forgotten report does not hide in an old month.
    prisma.outletSalesEvent.findMany({
      where: { projectId, date: { lt: dayIn(start < today ? start : today) }, OR: [{ sales: null }, { pax: null }] },
      include: eventInclude,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: WAITING_EARLIER_LIMIT,
    }),
  ])
  const events = rows.map((r) => serializeEvent(r, today))
  const target = targetRow ? serializeTarget(targetRow) : null
  return {
    month,
    today,
    target,
    summary: summarizeMonth(month, events, target),
    events,
    waitingEarlier: earlier.map((r) => serializeEvent(r, today)),
    form: OUTLET_FORM,
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────────────────────────────

type WriteResult<T> = { ok: true; value: T } | { ok: false; status: number; body: Record<string, unknown> }

/** Reported now (both actuals filled) → reportedAt / reportedById; back to unreported → cleared. */
function reportStamp(
  before: { sales: number | null; pax: number | null; reportedAt: Date | null } | null,
  after: { sales: number | null; pax: number | null },
  userId: string,
): Record<string, unknown> {
  const done = after.sales !== null && after.pax !== null
  if (done && !before?.reportedAt) return { reportedAt: new Date(), reportedById: userId }
  if (!done && before?.reportedAt) return { reportedAt: null, reportedById: null }
  return {}
}

function auditValue(v: unknown): unknown {
  return v instanceof Date ? dayOut(v) : v
}

export async function createOutletEvent(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
  request?: Request,
): Promise<WriteResult<SerializedOutletEvent>> {
  const parsed = parseEventFields(body, "create")
  if (!parsed.ok) return { ok: false, status: 400, body: { ...parsed.error, code: "INVALID_FIELD" } }
  const d = parsed.data
  const sales = (d.sales as number | null | undefined) ?? null
  const pax = (d.pax as number | null | undefined) ?? null
  const created = await prisma.outletSalesEvent.create({
    data: {
      ...(d as Omit<Prisma.OutletSalesEventUncheckedCreateInput, "projectId" | "name" | "date">),
      name: d.name as string,
      date: d.date as Date,
      projectId,
      createdById: userId,
      updatedById: userId,
      ...reportStamp(null, { sales, pax }, userId),
    },
    include: eventInclude,
  })
  const date = dayOut(created.date)
  await logAudit({
    action: "create",
    entityType: "outlet_sales_event",
    entityId: created.id,
    entityName: `${created.name} (${date})`,
    userId,
    request,
    metadata: { projectId, date, sales, pax },
  })
  emitOutletSalesChanged(projectId, created.id, date.slice(0, 7), userId)
  return { ok: true, value: serializeEvent(created, outletToday()) }
}

export async function findOutletEvent(projectId: string, eventId: string) {
  return prisma.outletSalesEvent.findFirst({ where: { id: eventId, projectId }, include: eventInclude })
}

const notFound = { ok: false as const, status: 404, body: { error: "Event tidak ditemukan.", code: "EVENT_NOT_FOUND" } }

/**
 * Change what is sent, nothing else: two people filling different parts of the same report never undo
 * each other. A PATCH that changes nothing answers the event as it is and writes no audit row.
 */
export async function updateOutletEvent(
  userId: string,
  projectId: string,
  eventId: string,
  body: Record<string, unknown>,
  request?: Request,
): Promise<WriteResult<SerializedOutletEvent>> {
  const current = await findOutletEvent(projectId, eventId)
  if (!current) return notFound
  const parsed = parseEventFields(body, "patch")
  if (!parsed.ok) return { ok: false, status: 400, body: { ...parsed.error, code: "INVALID_FIELD" } }
  const cur = current as unknown as Record<string, unknown>
  const changed = Object.keys(parsed.data).filter((k) => {
    const a = auditValue(cur[k])
    const b = auditValue(parsed.data[k])
    return a !== b
  })
  if (changed.length === 0) return { ok: true, value: serializeEvent(current, outletToday()) }

  const update: Record<string, unknown> = {}
  for (const k of changed) update[k] = parsed.data[k]
  const sales = "sales" in update ? (update.sales as number | null) : current.sales
  const pax = "pax" in update ? (update.pax as number | null) : current.pax
  const saved = await prisma.outletSalesEvent.update({
    where: { id: eventId },
    data: { ...update, updatedById: userId, ...reportStamp(current, { sales, pax }, userId) } as Prisma.OutletSalesEventUncheckedUpdateInput,
    include: eventInclude,
  })
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const k of changed) { before[k] = auditValue(cur[k]); after[k] = auditValue(update[k]) }
  const date = dayOut(saved.date)
  await logAudit({
    action: "update",
    entityType: "outlet_sales_event",
    entityId: eventId,
    entityName: `${saved.name} (${date})`,
    userId,
    request,
    metadata: { projectId, date, fields: changed, before, after },
  })
  // A date moved to another month: both months' screens refetch (the ping names the new one; clients
  // refetch whatever month they show on any ping of their project).
  emitOutletSalesChanged(projectId, eventId, date.slice(0, 7), userId)
  return { ok: true, value: serializeEvent(saved, outletToday()) }
}

/** Delete, restorable from Control Room → Audit (lib/deletion-snapshot.ts; owner: every delete restorable). */
export async function deleteOutletEvent(
  userId: string,
  project: GateProject,
  eventId: string,
  request?: Request,
): Promise<WriteResult<{ success: true }>> {
  const ev = await prisma.outletSalesEvent.findFirst({
    where: { id: eventId, projectId: project.id },
    select: { name: true, date: true, sales: true, pax: true },
  })
  if (!ev) return notFound
  const date = dayOut(ev.date)
  await restorableDelete({
    entityType: "outlet_sales_event",
    entityId: eventId,
    entityName: `${ev.name} (${date})`,
    workspaceId: project.workspaceId,
    userId,
    request,
    metadata: { projectId: project.id, date, sales: ev.sales, pax: ev.pax },
    meta: { open: { type: "outlet_sales_event", id: eventId, projectId: project.id, date }, projectId: project.id },
    remove: (tx) => tx.outletSalesEvent.delete({ where: { id: eventId } }),
  })
  emitOutletSalesChanged(project.id, eventId, date.slice(0, 7), userId)
  return { ok: true, value: { success: true } }
}

/** All targets of the project, oldest month first (a few dozen rows at most). */
export async function listOutletTargets(projectId: string) {
  const rows = await prisma.outletSalesTarget.findMany({
    where: { projectId },
    include: { updatedBy: personSelect },
    orderBy: { month: "asc" },
  })
  return rows.map(serializeTarget)
}

/**
 * PUT …/targets { month, salesTarget?, paxTarget? }: sets one month. A key left out keeps its value;
 * null (or "") clears it — the row stays, with nulls, and the audit row keeps what it was.
 */
export async function putOutletTarget(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
  request?: Request,
): Promise<WriteResult<ReturnType<typeof serializeTarget>>> {
  const month = body.month
  if (!isMonth(month)) return { ok: false, status: 400, body: { field: "month", error: "Bulan harus YYYY-MM.", code: "INVALID_FIELD" } }
  const data: { salesTarget?: number | null; paxTarget?: number | null } = {}
  for (const [key, max, whole] of [["salesTarget", 1e13, false], ["paxTarget", 10_000_000, true]] as const) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null || v === "") { data[key] = null; continue }
    const n = typeof v === "string" ? Number(v.replace(/[.,\s]/g, "")) : v
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max || (whole && !Number.isInteger(n))) {
      return { ok: false, status: 400, body: { field: key, error: "Target harus angka 0 atau lebih.", code: "INVALID_FIELD" } }
    }
    data[key] = Math.round(n)
  }
  const before = await prisma.outletSalesTarget.findUnique({ where: { projectId_month: { projectId, month } } })
  const saved = await prisma.outletSalesTarget.upsert({
    where: { projectId_month: { projectId, month } },
    create: { projectId, month, salesTarget: data.salesTarget ?? null, paxTarget: data.paxTarget ?? null, updatedById: userId },
    update: { ...data, updatedById: userId },
    include: { updatedBy: personSelect },
  })
  const changedSales = (before?.salesTarget ?? null) !== saved.salesTarget
  const changedPax = (before?.paxTarget ?? null) !== saved.paxTarget
  if (changedSales || changedPax) {
    await logAudit({
      action: "update",
      entityType: "outlet_sales_target",
      entityId: saved.id,
      entityName: `Target ${month}`,
      userId,
      request,
      metadata: {
        projectId,
        month,
        before: { salesTarget: before?.salesTarget ?? null, paxTarget: before?.paxTarget ?? null },
        after: { salesTarget: saved.salesTarget, paxTarget: saved.paxTarget },
      },
    })
    emitOutletSalesChanged(projectId, null, month, userId)
  }
  return { ok: true, value: serializeTarget(saved) }
}
