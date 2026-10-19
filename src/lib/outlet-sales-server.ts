import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { DOUBLE_TAP_MS, readIdempotencyKey } from "@/lib/idempotency"
import type { Prisma } from "@/generated/prisma/client"
import { checkProjectAccess, hasProjectLevel } from "@/lib/rbac"
import { logAudit } from "@/lib/audit"
import { restorableDelete } from "@/lib/deletion-snapshot"
import { emitOutletSalesChanged } from "@/lib/socket-emitter"
import {
  COUNT_MAX,
  LEGACY_ITEM_IDS,
  MONEY_MAX,
  OUTLET_FIELDS,
  buildMonthDays,
  configIds,
  eventTotals,
  isLegacyItemId,
  isMonth,
  legacyFormFor,
  mergeReportConfig,
  missingOf,
  monthBounds,
  outletToday,
  reportOpen,
  writesReport,
  pctOf,
  readReportConfig,
  statusOf,
  summarizeGuests,
  summarizeMonth,
  type OutletReportConfig,
  type OutletValues,
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
 * checkProjectAccess with read = VIEWER, write = MEMBER — the project's members, plus BoD / One Above
 * All of the workspace, exactly as for a task project. Any member may add
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
 * Who sets the targets (monthly and per day) and the report settings: Full access to the project only
 * (lib/rbac.ts) — the Project Owner, a member invited with Full, and BoD / One Above All of its workspace
 * (owner, 13 and 16 Oct 2026). A Manager is not included as such: only when invited with Full.
 */
export async function canManageOutletTargets(userId: string, projectId: string): Promise<boolean> {
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

type ValueRow = Pick<EventRow, "reportValues" | "rsvpWalkIn" | "rsvpTeam" | "rsvpPr" | "rsvpEo" | "hostingTeam" | "hostingPr" | "hostingEo">

/**
 * Every breakdown figure of a report by item id: the seven original items from their columns, the rest
 * from `reportValues`. A legacy id is never read from the JSON (the column is the only home of its figure).
 */
export function valuesOf(row: ValueRow): OutletValues {
  const out: OutletValues = {}
  const json = row.reportValues
  if (json && typeof json === "object" && !Array.isArray(json)) {
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      if (!isLegacyItemId(k) && typeof v === "number" && Number.isFinite(v)) out[k] = v
    }
  }
  const cols = row as unknown as Record<string, number | null>
  for (const id of LEGACY_ITEM_IDS) if (cols[id] !== null && cols[id] !== undefined) out[id] = cols[id] as number
  return out
}

/** An event as every client receives it: what was typed, and what the rules derive from it. */
export function serializeEvent(row: EventRow, today: string, config: OutletReportConfig) {
  const date = dayOut(row.date)
  const facts = { date, sales: row.sales, pax: row.pax }
  const values = valuesOf(row)
  const totals = eventTotals(config, values)
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
    // The outlet's breakdown (owner, 14 Oct 2026): every figure by item id, the seven originals included.
    values,
    // Derived: the server's answer, so a phone does not port the arithmetic. The totals add up every item
    // of the outlet's config (an archived item keeps counting in the reports that have it).
    rsvpTotal: totals.rsvpTotal,
    hostingTotal: totals.hostingTotal,
    communityTotal: totals.communityTotal,
    communityTotals: totals.communities,
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

/**
 * `values` of a create or PATCH body: { [itemId]: number | null }. Only the ids sent change; null or ""
 * clears one. An id the outlet's config does not know (an item removed meanwhile) answers CONFIG_CHANGED,
 * so a stale form reloads instead of a figure silently going nowhere. The seven original ids land in their
 * columns (`columns`), every other id in the JSON (`json`).
 */
export function parseValues(
  raw: unknown,
  config: OutletReportConfig,
):
  | { ok: true; columns: Record<string, number | null>; json: Record<string, number | null> }
  | { ok: false; error: FieldError & { code: string } } {
  const columns: Record<string, number | null> = {}
  const json: Record<string, number | null> = {}
  if (raw === undefined) return { ok: true, columns, json }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: { field: "values", error: "Harus berupa objek.", code: "INVALID_FIELD" } }
  }
  const known = configIds(config)
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(id)) {
      return { ok: false, error: { field: `values.${id}`, error: "Pengaturan laporan baru saja berubah. Muat ulang form, lalu isi lagi.", code: "CONFIG_CHANGED" } }
    }
    let n: number | null
    if (v === null || v === "") n = null
    else {
      const x = typeof v === "string" ? Number(v.replace(/[.,\s]/g, "")) : v
      if (typeof x !== "number" || !Number.isFinite(x)) return { ok: false, error: { field: `values.${id}`, error: "Harus berupa angka.", code: "INVALID_FIELD" } }
      if (x < 0) return { ok: false, error: { field: `values.${id}`, error: "Tidak boleh negatif.", code: "INVALID_FIELD" } }
      if (x > COUNT_MAX) return { ok: false, error: { field: `values.${id}`, error: "Angkanya terlalu besar.", code: "INVALID_FIELD" } }
      if (!Number.isInteger(x)) return { ok: false, error: { field: `values.${id}`, error: "Harus bilangan bulat.", code: "INVALID_FIELD" } }
      n = x
    }
    if (isLegacyItemId(id)) columns[id] = n
    else json[id] = n
  }
  return { ok: true, columns, json }
}

/** The outlet's report config (the original seven items when it never set one). */
export async function loadReportConfig(projectId: string): Promise<OutletReportConfig> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { outletReportConfig: true } })
  return readReportConfig(p?.outletReportConfig ?? null)
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────

/** How many older events still waiting for a report one read returns. */
const WAITING_EARLIER_LIMIT = 50

/** GET …/outlet-sales?month=: the month's target, summary and events, and older nights still unreported. */
export async function loadOutletMonth(projectId: string, month: string, today: string = outletToday()) {
  const { start, next } = monthBounds(month)
  const [targetRow, rows, earlier, config, dayRows] = await Promise.all([
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
    loadReportConfig(projectId),
    prisma.outletSalesDayTarget.findMany({
      where: { projectId, date: { gte: dayIn(start), lt: dayIn(next) } },
      include: { updatedBy: personSelect },
      orderBy: { date: "asc" },
    }),
  ])
  const events = rows.map((r) => serializeEvent(r, today, config))
  const target = targetRow ? serializeTarget(targetRow) : null
  const dayTargets = dayRows.map(serializeDayTarget)
  return {
    month,
    today,
    target,
    summary: summarizeMonth(month, events, target),
    events,
    waitingEarlier: earlier.map((r) => serializeEvent(r, today, config)),
    // Owner, 14 Oct 2026: the outlet's own breakdown, the month's Guest overview, and every day's target
    // in force (its own, else the month's share) with its actuals.
    config,
    guests: summarizeGuests(config, events.map((e) => e.values)),
    days: buildMonthDays(month, events, target, dayTargets),
    dayTargets,
    // Released apps draw this form: the original items under this outlet's labels (legacyFormFor).
    form: legacyFormFor(config),
  }
}

type DayTargetRow = Prisma.OutletSalesDayTargetGetPayload<{ include: { updatedBy: typeof personSelect } }>

export function serializeDayTarget(row: DayTargetRow) {
  return {
    date: dayOut(row.date),
    salesTarget: row.salesTarget,
    paxTarget: row.paxTarget,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
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
): Promise<WriteResult<SerializedOutletEvent> & { duplicate?: boolean }> {
  const idem = readIdempotencyKey(request, body.clientRequestId)
  if (!idem.ok) return { ok: false, status: 400, body: { error: "Idempotency key must be 8–200 characters of letters, digits, . _ : -", code: "BAD_IDEMPOTENCY_KEY" } }
  const parsed = parseEventFields(body, "create")
  if (!parsed.ok) return { ok: false, status: 400, body: { ...parsed.error, code: "INVALID_FIELD" } }
  const config = await loadReportConfig(projectId)
  const vals = parseValues(body.values, config)
  if (!vals.ok) return { ok: false, status: 400, body: { ...vals.error } }
  // `values` wins over an old key for the same item (a client that sends both).
  const d = { ...parsed.data, ...vals.columns }
  const json: Record<string, number> = {}
  for (const [k, v] of Object.entries(vals.json)) if (v !== null) json[k] = v
  if (!reportOpen(dayOut(d.date as Date), outletToday()) && writesReport({ ...d, ...json })) return reportNotOpen
  const sales = (d.sales as number | null | undefined) ?? null
  const pax = (d.pax as number | null | undefined) ?? null
  // One "Add night" at a time per outlet (race audit 16 Oct 2026, M9): a double tap or a retry stored the
  // night twice. With a key (body clientRequestId or Idempotency-Key) the same key gives the same night;
  // without one (every app before this) the same night — same name, same date — added by the same person in
  // the last 10 s is the same press. Either way the repeat answers 200 with the night already stored.
  const made = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outletev|${projectId}`})::int8)`
    const seen = idem.key
      ? await tx.outletSalesEvent.findFirst({ where: { projectId, clientRequestId: idem.key }, include: eventInclude })
      : await tx.outletSalesEvent.findFirst({
          where: {
            projectId, createdById: userId, clientRequestId: null, name: d.name as string, date: d.date as Date,
            createdAt: { gte: new Date(Date.now() - DOUBLE_TAP_MS) },
          },
          include: eventInclude,
        })
    if (seen) return { event: seen, duplicate: true }
    const event = await tx.outletSalesEvent.create({
      data: {
        ...(d as Omit<Prisma.OutletSalesEventUncheckedCreateInput, "projectId" | "name" | "date">),
        reportValues: json,
        name: d.name as string,
        date: d.date as Date,
        projectId,
        createdById: userId,
        updatedById: userId,
        clientRequestId: idem.key,
        ...reportStamp(null, { sales, pax }, userId),
      },
      include: eventInclude,
    })
    return { event, duplicate: false }
  })
  if (made.duplicate) return { ok: true, value: serializeEvent(made.event, outletToday(), config), duplicate: true }
  const created = made.event
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
  return { ok: true, value: serializeEvent(created, outletToday(), config) }
}

export async function findOutletEvent(projectId: string, eventId: string) {
  return prisma.outletSalesEvent.findFirst({ where: { id: eventId, projectId }, include: eventInclude })
}

const notFound = { ok: false as const, status: 404, body: { error: "Event tidak ditemukan.", code: "EVENT_NOT_FOUND" } }

/** A report for a night after today (WIB): refused until the night itself (UI tour run 13, W-B5). */
const reportNotOpen = {
  ok: false as const,
  status: 400,
  body: { error: "Laporan dibuka pada malam itu.", errorEn: "Reports open on the night itself.", code: "REPORT_NOT_OPEN" },
}

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
  const parsed = parseEventFields(body, "patch")
  if (!parsed.ok) return { ok: false, status: 400, body: { ...parsed.error, code: "INVALID_FIELD" } }
  const config = await loadReportConfig(projectId)
  const vals = parseValues(body.values, config)
  if (!vals.ok) return { ok: false, status: 400, body: { ...vals.error } }
  const fields = { ...parsed.data, ...vals.columns }

  // Read, merge and write under the event's row lock (race audit 16 Oct 2026, M9). The JSON figures are
  // merged key by key in code; two people filling different items read the same JSON, and the second write
  // put back the item the first had just filled. Now the second waits and merges into the first's result.
  const done = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OutletSalesEvent" WHERE id = ${eventId} AND "projectId" = ${projectId} FOR UPDATE`
    const current = await tx.outletSalesEvent.findFirst({ where: { id: eventId, projectId }, include: eventInclude })
    if (!current) return { kind: "early" as const, result: notFound }
    const cur = current as unknown as Record<string, unknown>
    const changed = Object.keys(fields).filter((k) => auditValue(cur[k]) !== auditValue(fields[k]))
    // The JSON figures: merged key by key, so two people filling different items never undo each other.
    const before = valuesOf(current)
    const changedValues = Object.keys(vals.json).filter((k) => (before[k] ?? null) !== vals.json[k])
    if (changed.length === 0 && changedValues.length === 0) return { kind: "early" as const, result: { ok: true as const, value: serializeEvent(current, outletToday(), config) } as WriteResult<SerializedOutletEvent> }
    // A night after today: no report yet. Clearing one, or changing the plan (name, targets), still goes; moving
    // a night that already has a report into the future does not.
    const nextDate = changed.includes("date") ? dayOut(fields.date as Date) : dayOut(current.date)
    if (!reportOpen(nextDate, outletToday())) {
      const sent: Record<string, unknown> = {}
      for (const k of changed) sent[k] = fields[k]
      for (const k of changedValues) sent[k] = vals.json[k]
      const kept: Record<string, unknown> = { ...before }
      for (const k of Object.keys(OUTLET_FIELDS)) kept[k] = cur[k]
      if (writesReport(sent) || (changed.includes("date") && writesReport({ ...kept, ...sent }))) return { kind: "early" as const, result: reportNotOpen }
    }

    const update: Record<string, unknown> = {}
    for (const k of changed) update[k] = fields[k]
    if (changedValues.length > 0) {
      const json: Record<string, number> = {}
      for (const [k, v] of Object.entries(before)) if (!isLegacyItemId(k)) json[k] = v
      for (const k of changedValues) {
        const v = vals.json[k]
        if (v === null) delete json[k]
        else json[k] = v
      }
      update.reportValues = json
    }
    const sales = "sales" in update ? (update.sales as number | null) : current.sales
    const pax = "pax" in update ? (update.pax as number | null) : current.pax
    const saved = await tx.outletSalesEvent.update({
      where: { id: eventId },
      data: { ...update, updatedById: userId, ...reportStamp(current, { sales, pax }, userId) } as Prisma.OutletSalesEventUncheckedUpdateInput,
      include: eventInclude,
    })
    const auditBefore: Record<string, unknown> = {}
    const auditAfter: Record<string, unknown> = {}
    for (const k of changed) { auditBefore[k] = auditValue(cur[k]); auditAfter[k] = auditValue(update[k]) }
    for (const k of changedValues) { auditBefore[`values.${k}`] = before[k] ?? null; auditAfter[`values.${k}`] = vals.json[k] }
    return { kind: "saved" as const, saved, changed, changedValues, auditBefore, auditAfter }
  })
  if (done.kind === "early") return done.result
  const { saved, changed, changedValues, auditBefore, auditAfter } = done
  const date = dayOut(saved.date)
  await logAudit({
    action: "update",
    entityType: "outlet_sales_event",
    entityId: eventId,
    entityName: `${saved.name} (${date})`,
    userId,
    request,
    metadata: { projectId, date, fields: [...changed, ...changedValues.map((k) => `values.${k}`)], before: auditBefore, after: auditAfter },
  })
  // A date moved to another month: both months' screens refetch (the ping names the new one; clients
  // refetch whatever month they show on any ping of their project).
  emitOutletSalesChanged(projectId, eventId, date.slice(0, 7), userId)
  return { ok: true, value: serializeEvent(saved, outletToday(), config) }
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
  // One writer per outlet-month (QA 19 Oct 2026: three parallel saves of a new month gave two 500s on the
  // unique key, the check-then-insert the day targets already lock against).
  const { before, saved } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outlettarget|${projectId}|${month}`})::int8)`
    const before = await tx.outletSalesTarget.findUnique({ where: { projectId_month: { projectId, month } } })
    const saved = await tx.outletSalesTarget.upsert({
      where: { projectId_month: { projectId, month } },
      create: { projectId, month, salesTarget: data.salesTarget ?? null, paxTarget: data.paxTarget ?? null, updatedById: userId },
      update: { ...data, updatedById: userId },
      include: { updatedBy: personSelect },
    })
    return { before, saved }
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

// ── Daily targets (owner, 14 Oct 2026) ────────────────────────────────────────────────────────────────

/**
 * PUT …/day-targets { date, salesTarget?, paxTarget? }: one date's own target. Each part on its own: a
 * key left out keeps its value, null (or "") clears it and that part falls back to the month's share. A
 * date whose two parts are both cleared has no row any more. Same people as the monthly target.
 */
export async function putOutletDayTarget(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
  request?: Request,
): Promise<WriteResult<{ date: string; salesTarget: number | null; paxTarget: number | null }>> {
  const date = body.date
  if (!validDay(date)) return { ok: false, status: 400, body: { field: "date", error: "Tanggal harus YYYY-MM-DD.", code: "INVALID_FIELD" } }
  const data: { salesTarget?: number | null; paxTarget?: number | null } = {}
  for (const [key, max, whole] of [["salesTarget", MONEY_MAX * 10, false], ["paxTarget", COUNT_MAX * 10, true]] as const) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null || v === "") { data[key] = null; continue }
    const n = typeof v === "string" ? Number(v.replace(/[.,\s]/g, "")) : v
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max || (whole && !Number.isInteger(n))) {
      return { ok: false, status: 400, body: { field: key, error: "Target harus angka 0 atau lebih.", code: "INVALID_FIELD" } }
    }
    data[key] = Math.round(n)
  }
  const where = { projectId_date: { projectId, date: dayIn(date) } }
  // Read-merge-write under one lock per outlet-date (race audit 16 Oct 2026, M9): two people setting the
  // sales and the pax target of one date at once each wrote both parts back from what they had read.
  const done = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outletdaytarget|${projectId}|${date}`})::int8)`
    const before = await tx.outletSalesDayTarget.findUnique({ where })
    const next = {
      salesTarget: "salesTarget" in data ? data.salesTarget ?? null : before?.salesTarget ?? null,
      paxTarget: "paxTarget" in data ? data.paxTarget ?? null : before?.paxTarget ?? null,
    }
    const was = { salesTarget: before?.salesTarget ?? null, paxTarget: before?.paxTarget ?? null }
    if (was.salesTarget === next.salesTarget && was.paxTarget === next.paxTarget) return { next, was, entityId: null }
    if (next.salesTarget === null && next.paxTarget === null) {
      if (!before) return { next, was, entityId: null }
      await tx.outletSalesDayTarget.delete({ where })
      return { next, was, entityId: before.id }
    }
    const saved = await tx.outletSalesDayTarget.upsert({
      where,
      create: { projectId, date: dayIn(date), ...next, updatedById: userId },
      update: { ...next, updatedById: userId },
    })
    return { next, was, entityId: saved.id }
  })
  const { next, was, entityId } = done
  if (!entityId) return { ok: true, value: { date, ...next } }
  await logAudit({
    action: "update",
    entityType: "outlet_sales_target",
    entityId,
    entityName: `Target ${date}`,
    userId,
    request,
    metadata: { projectId, date, before: was, after: next },
  })
  emitOutletSalesChanged(projectId, null, date.slice(0, 7), userId)
  return { ok: true, value: { date, ...next } }
}

// ── Report settings (owner, 14 Oct 2026) ──────────────────────────────────────────────────────────────

/** How many reports of the outlet hold a figure for each item / community id. */
export async function reportUsage(projectId: string): Promise<Record<string, number>> {
  const rows = await prisma.outletSalesEvent.findMany({
    where: { projectId },
    select: { reportValues: true, rsvpWalkIn: true, rsvpTeam: true, rsvpPr: true, rsvpEo: true, hostingTeam: true, hostingPr: true, hostingEo: true },
  })
  const usage: Record<string, number> = {}
  for (const r of rows) for (const id of Object.keys(valuesOf(r))) usage[id] = (usage[id] ?? 0) + 1
  return usage
}

export async function loadOutletConfig(projectId: string) {
  const [config, usage] = await Promise.all([loadReportConfig(projectId), reportUsage(projectId)])
  return { config, usage }
}

/**
 * PUT …/config { config }: the outlet's RSVP items, Hosting items and Communities, in order. The client
 * sends the whole list; mergeReportConfig keeps every figure (a removed item with figures comes back
 * archived). Same people as the targets.
 */
export async function putOutletConfig(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
  request?: Request,
): Promise<WriteResult<{ config: OutletReportConfig; usage: Record<string, number> }>> {
  const { config: previous, usage } = await loadOutletConfig(projectId)
  const merged = mergeReportConfig(body.config, previous, new Set(Object.keys(usage)))
  if (!merged.ok) return { ok: false, status: 400, body: { ...merged.error } }
  const config = merged.config
  if (JSON.stringify(config) === JSON.stringify(previous)) return { ok: true, value: { config, usage } }
  await prisma.project.update({ where: { id: projectId }, data: { outletReportConfig: config as unknown as Prisma.InputJsonValue } })
  await logAudit({
    action: "update",
    entityType: "outlet_report_config",
    entityId: projectId,
    entityName: "Report settings",
    userId,
    request,
    metadata: { projectId, before: previous, after: config },
  })
  emitOutletSalesChanged(projectId, null, null, userId)
  return { ok: true, value: { config, usage } }
}
