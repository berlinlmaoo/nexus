import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import type { Prisma } from "@/generated/prisma/client"
import { checkProjectAccess, hasProjectLevel } from "@/lib/rbac"
import { logAudit } from "@/lib/audit"
import { emitSocialMediaChanged } from "@/lib/socket-emitter"
import {
  METRIC_KEYS,
  METRIC_MAX,
  NOTE_MAX,
  TARGET_MAX,
  buildSocialDays,
  isMonth,
  mergeSocialConfig,
  monthBounds,
  readSocialConfig,
  socialToday,
  summarizeSocial,
  type SocialMetric,
  type SocialReportConfig,
} from "@/lib/social-media"

/**
 * Database side of the Social Media Report (owner, 14 Oct 2026; rules in lib/social-media.ts): who may read
 * or write, the month's answer, how a body is checked, and the writes. The routes under
 * src/app/api/projects/[projectId]/social-media only authenticate and call these.
 *
 * Access follows the project's levels (lib/rbac.ts): View and Comment read, Edit records the figures and the
 * notes, Full manages the platforms and the targets (monthly and daily).
 */

export const SOCIAL_TYPE = "SOCIAL_MEDIA_REPORT"

type GateProject = { id: string; name: string; type: string; workspaceId: string }
export type SocialGate = { ok: true; project: GateProject } | { ok: false; response: NextResponse }

export async function socialGate(userId: string, projectId: string, need: "read" | "record" | "manage"): Promise<SocialGate> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, type: true, workspaceId: true },
  })
  if (!project) return { ok: false, response: NextResponse.json({ error: "Project not found" }, { status: 404 }) }
  const access = await checkProjectAccess(userId, projectId, ["VIEWER"])
  if (!access.allowed) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  if (project.type !== SOCIAL_TYPE) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Project ini bukan Laporan Media Sosial.", code: "NOT_SOCIAL_MEDIA_REPORT" }, { status: 400 }),
    }
  }
  if (need === "record" && !(await hasProjectLevel(userId, projectId, "EDIT"))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Butuh akses Can edit untuk mengisi laporan.", code: "NEEDS_EDIT_ACCESS" }, { status: 403 }),
    }
  }
  if (need === "manage" && !(await hasProjectLevel(userId, projectId, "FULL"))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Target dan platform hanya bisa diatur pemilik project atau BoD.", code: "SETTINGS_FORBIDDEN" }, { status: 403 }),
    }
  }
  return { ok: true, project }
}

/** What the viewer may do here, for the clients' buttons (the routes check again). */
export async function socialAbilities(userId: string, projectId: string): Promise<{ canRecord: boolean; canManage: boolean }> {
  const [canRecord, canManage] = await Promise.all([hasProjectLevel(userId, projectId, "EDIT"), hasProjectLevel(userId, projectId, "FULL")])
  return { canRecord, canManage }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

const personSelect = { select: { id: true, name: true, avatar: true } } as const

export function dayOut(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dayIn(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function validDay(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false
  const d = dayIn(v)
  if (Number.isNaN(d.getTime()) || dayOut(d) !== v) return false
  const y = Number(v.slice(0, 4))
  return y >= 2000 && y <= 2100
}

export type FieldError = { field: string; error: string; code: string }

/** A whole number ≥ 0 and ≤ max; null or "" = clear. Digit strings ("1.200") are read as numbers. */
function parseWhole(v: unknown, max: number, field: string): { ok: true; value: number | null } | { ok: false; error: FieldError } {
  if (v === null || v === "") return { ok: true, value: null }
  const n = typeof v === "string" ? Number(v.replace(/[.,\s]/g, "")) : v
  if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, error: { field, error: "Harus berupa angka.", code: "INVALID_FIELD" } }
  if (n < 0) return { ok: false, error: { field, error: "Tidak boleh negatif.", code: "INVALID_FIELD" } }
  if (!Number.isInteger(n)) return { ok: false, error: { field, error: "Harus bilangan bulat.", code: "INVALID_FIELD" } }
  if (n > max) return { ok: false, error: { field, error: "Angkanya terlalu besar.", code: "INVALID_FIELD" } }
  return { ok: true, value: n }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** The project's platforms (Instagram + TikTok when it never set any). */
export async function loadSocialConfig(projectId: string): Promise<SocialReportConfig> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { socialReportConfig: true } })
  return readSocialConfig(p?.socialReportConfig ?? null)
}

type WriteResult<T> = { ok: true; value: T } | { ok: false; status: number; body: Record<string, unknown> }
const fail = (status: number, error: FieldError) => ({ ok: false as const, status, body: { ...error } })

/** `platforms` of a body: every key a platform id of the config (archived ones included). */
function platformsOf(raw: unknown, config: SocialReportConfig): { ok: true; value: [string, Record<string, unknown>][] } | { ok: false; error: FieldError } {
  if (raw === undefined) return { ok: true, value: [] }
  const o = asObject(raw)
  if (!o) return { ok: false, error: { field: "platforms", error: "Harus berupa objek.", code: "INVALID_FIELD" } }
  const known = new Set(config.platforms.map((p) => p.id))
  const out: [string, Record<string, unknown>][] = []
  for (const [id, v] of Object.entries(o)) {
    if (!known.has(id)) {
      return { ok: false, error: { field: `platforms.${id}`, error: "Daftar platform baru saja berubah. Muat ulang, lalu isi lagi.", code: "CONFIG_CHANGED" } }
    }
    const x = asObject(v)
    if (!x) return { ok: false, error: { field: `platforms.${id}`, error: "Harus berupa objek.", code: "INVALID_FIELD" } }
    out.push([id, x])
  }
  return { ok: true, value: out }
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────

/** GET …/social-media?month=: the month's days, targets and Overview (to date). */
export async function loadSocialMonth(projectId: string, month: string, today: string = socialToday()) {
  const { start, next } = monthBounds(month)
  const range = { gte: dayIn(start), lt: dayIn(next) }
  const [config, rows, notes, targetRows, dayTargetRows] = await Promise.all([
    loadSocialConfig(projectId),
    prisma.socialMediaDay.findMany({ where: { projectId, date: range } }),
    prisma.socialMediaNote.findMany({ where: { projectId, date: range }, include: { updatedBy: personSelect } }),
    prisma.socialMediaTarget.findMany({ where: { projectId, month }, include: { updatedBy: personSelect } }),
    prisma.socialMediaDayTarget.findMany({ where: { projectId, date: range }, orderBy: { date: "asc" } }),
  ])
  const targets = targetRows.map((t) => ({
    platformId: t.platformId,
    engagementTarget: t.engagementTarget,
    postsTarget: t.postsTarget,
    updatedAt: t.updatedAt.toISOString(),
    updatedBy: t.updatedBy,
  }))
  const dayTargets = dayTargetRows.map((t) => ({ date: dayOut(t.date), platformId: t.platformId, engagementTarget: t.engagementTarget, postsTarget: t.postsTarget }))
  const days = buildSocialDays(
    month,
    config,
    rows.map((r) => ({ date: dayOut(r.date), platformId: r.platformId, views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, posts: r.posts })),
    notes.map((n) => ({ date: dayOut(n.date), worked: n.worked, didntWork: n.didntWork })),
    targets,
    dayTargets,
  )
  // Who last touched each day (figures or notes), for the day sheet's footer.
  const touched: Record<string, { at: string; by: { id: string; name: string | null; avatar: string | null } | null }> = {}
  const people = new Map(notes.filter((n) => n.updatedBy).map((n) => [n.updatedBy!.id, n.updatedBy!]))
  const missing = [...new Set(rows.map((r) => r.updatedById).filter((id): id is string => !!id && !people.has(id)))]
  if (missing.length) {
    for (const u of await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true, avatar: true } })) people.set(u.id, u)
  }
  for (const r of [...rows, ...notes]) {
    const d = dayOut(r.date)
    const at = r.updatedAt.toISOString()
    if (!touched[d] || touched[d].at < at) touched[d] = { at, by: r.updatedById ? people.get(r.updatedById) ?? null : null }
  }
  return {
    month,
    today,
    config,
    targets,
    dayTargets,
    days: days.map((d) => ({ ...d, updatedAt: touched[d.date]?.at ?? null, updatedBy: touched[d.date]?.by ?? null })),
    overview: summarizeSocial(month, today, config, days),
  }
}

// ── Writes: a day ─────────────────────────────────────────────────────────────────────────────────────

/**
 * PUT …/days/:date { platforms?: { [platformId]: { views?, likes?, comments?, shares?, posts? } }, worked?,
 * didntWork? }: change what is sent, nothing else — a key left out keeps its value, null or "" clears it.
 * Two people filling different platforms never undo each other. A day can't be in the future (WIB).
 * A platform whose five figures are all cleared has no row any more; the same for empty notes.
 */
export async function putSocialDay(
  userId: string,
  projectId: string,
  date: string,
  body: Record<string, unknown>,
  request?: Request,
) {
  if (!validDay(date)) return fail(400, { field: "date", error: "Tanggal harus YYYY-MM-DD.", code: "INVALID_FIELD" })
  if (date > socialToday()) return fail(400, { field: "date", error: "Tanggal ini belum lewat. Isi laporan setelah harinya.", code: "FUTURE_DATE" })
  const config = await loadSocialConfig(projectId)
  const plats = platformsOf(body.platforms, config)
  if (!plats.ok) return fail(400, plats.error)

  // Check everything before writing anything.
  const figures: [string, Partial<Record<SocialMetric, number | null>>][] = []
  for (const [pid, x] of plats.value) {
    const f: Partial<Record<SocialMetric, number | null>> = {}
    for (const k of METRIC_KEYS) {
      if (!(k in x)) continue
      const n = parseWhole(x[k], METRIC_MAX[k], `platforms.${pid}.${k}`)
      if (!n.ok) return fail(400, n.error)
      f[k] = n.value
    }
    figures.push([pid, f])
  }
  const noteData: { worked?: string; didntWork?: string } = {}
  for (const k of ["worked", "didntWork"] as const) {
    if (!(k in body)) continue
    const v = body[k]
    if (v === null) { noteData[k] = ""; continue }
    if (typeof v !== "string") return fail(400, { field: k, error: "Harus berupa teks.", code: "INVALID_FIELD" })
    const s = v.trim()
    if (s.length > NOTE_MAX) return fail(400, { field: k, error: `Maksimal ${NOTE_MAX} karakter.`, code: "INVALID_FIELD" })
    noteData[k] = s
  }

  const at = dayIn(date)
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  // One writer per project-day (race audit 16 Oct 2026, M9): two people filling different figures of the
  // same day each read the row, then wrote all five figures back — the second write put the first one's
  // figure back to what it read. Read-merge-write now happens under this lock, so nothing sent is lost.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`social|${projectId}|${date}`})::int8)`
    for (const [pid, f] of figures) {
      const where = { projectId_date_platformId: { projectId, date: at, platformId: pid } }
      const cur = await tx.socialMediaDay.findUnique({ where })
      const next: Record<SocialMetric, number | null> = {
        views: cur?.views ?? null, likes: cur?.likes ?? null, comments: cur?.comments ?? null, shares: cur?.shares ?? null, posts: cur?.posts ?? null,
      }
      const changed: SocialMetric[] = []
      for (const k of METRIC_KEYS) {
        if (!(k in f)) continue
        if (next[k] !== f[k]) { changed.push(k); next[k] = f[k] ?? null }
      }
      if (changed.length === 0) continue
      for (const k of changed) {
        before[`${pid}.${k}`] = cur ? cur[k] : null
        after[`${pid}.${k}`] = next[k]
      }
      if (METRIC_KEYS.every((k) => next[k] === null)) {
        if (cur) await tx.socialMediaDay.delete({ where })
      } else {
        await tx.socialMediaDay.upsert({
          where,
          create: { projectId, date: at, platformId: pid, ...next, updatedById: userId },
          update: { ...next, updatedById: userId },
        })
      }
    }
    if (Object.keys(noteData).length > 0) {
      const where = { projectId_date: { projectId, date: at } }
      const cur = await tx.socialMediaNote.findUnique({ where })
      const next = { worked: noteData.worked ?? cur?.worked ?? "", didntWork: noteData.didntWork ?? cur?.didntWork ?? "" }
      const was = { worked: cur?.worked ?? "", didntWork: cur?.didntWork ?? "" }
      if (next.worked !== was.worked || next.didntWork !== was.didntWork) {
        for (const k of ["worked", "didntWork"] as const) if (next[k] !== was[k]) { before[k] = was[k]; after[k] = next[k] }
        if (!next.worked && !next.didntWork) {
          if (cur) await tx.socialMediaNote.delete({ where })
        } else {
          await tx.socialMediaNote.upsert({
            where,
            create: { projectId, date: at, ...next, updatedById: userId },
            update: { ...next, updatedById: userId },
          })
        }
      }
    }
  })
  const changedKeys = Object.keys(after)
  if (changedKeys.length > 0) {
    await logAudit({
      action: "update",
      entityType: "social_media_day",
      entityId: `${projectId}:${date}`,
      entityName: date,
      userId,
      request,
      metadata: { projectId, date, fields: changedKeys, before, after },
    })
    emitSocialMediaChanged(projectId, date, date.slice(0, 7), userId)
  }
  return { ok: true as const, value: { date, changed: changedKeys } }
}

// ── Writes: targets ───────────────────────────────────────────────────────────────────────────────────

type TargetPatch = { engagementTarget?: number | null; postsTarget?: number | null }

function parseTargetParts(raw: [string, Record<string, unknown>][]): { ok: true; value: [string, TargetPatch][] } | { ok: false; error: FieldError } {
  const out: [string, TargetPatch][] = []
  for (const [pid, x] of raw) {
    const t: TargetPatch = {}
    for (const [k, max] of [["engagementTarget", TARGET_MAX.engagement], ["postsTarget", TARGET_MAX.posts]] as const) {
      if (!(k in x)) continue
      const n = parseWhole(x[k], max, `platforms.${pid}.${k}`)
      if (!n.ok) return { ok: false, error: { ...n.error, error: "Target harus bilangan bulat 0 atau lebih." } }
      t[k] = n.value
    }
    out.push([pid, t])
  }
  return { ok: true, value: out }
}

/**
 * PUT …/targets { month, platforms: { [platformId]: { engagementTarget?, postsTarget? } } }: a month's
 * targets per platform. A key left out keeps its value; null (or "") clears it — the row stays, with nulls.
 */
export async function putSocialTargets(userId: string, projectId: string, body: Record<string, unknown>, request?: Request) {
  const month = body.month
  if (!isMonth(month)) return fail(400, { field: "month", error: "Bulan harus YYYY-MM.", code: "INVALID_FIELD" })
  const config = await loadSocialConfig(projectId)
  const plats = platformsOf(body.platforms, config)
  if (!plats.ok) return fail(400, plats.error)
  const parts = parseTargetParts(plats.value)
  if (!parts.ok) return fail(400, parts.error)
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  // One writer per project-month (race audit M9): the same read-merge-write as a day's figures.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`socialtarget|${projectId}|${month}`})::int8)`
    for (const [pid, t] of parts.value) {
      const where = { projectId_month_platformId: { projectId, month, platformId: pid } }
      const cur = await tx.socialMediaTarget.findUnique({ where })
      const was = { engagementTarget: cur?.engagementTarget ?? null, postsTarget: cur?.postsTarget ?? null }
      const next = {
        engagementTarget: "engagementTarget" in t ? t.engagementTarget ?? null : was.engagementTarget,
        postsTarget: "postsTarget" in t ? t.postsTarget ?? null : was.postsTarget,
      }
      if (next.engagementTarget === was.engagementTarget && next.postsTarget === was.postsTarget) continue
      await tx.socialMediaTarget.upsert({
        where,
        create: { projectId, month, platformId: pid, ...next, updatedById: userId },
        update: { ...next, updatedById: userId },
      })
      before[pid] = was
      after[pid] = next
    }
  })
  if (Object.keys(after).length > 0) {
    await logAudit({
      action: "update",
      entityType: "social_media_target",
      entityId: `${projectId}:${month}`,
      entityName: `Target ${month}`,
      userId,
      request,
      metadata: { projectId, month, before, after },
    })
    emitSocialMediaChanged(projectId, null, month, userId)
  }
  return { ok: true as const, value: { month, changed: Object.keys(after) } }
}

/**
 * PUT …/day-targets { date, platforms: { [platformId]: { engagementTarget?, postsTarget? } } }: a date's
 * own targets. Each part on its own: a key left out keeps its value, null clears it and that part falls
 * back to the month's share. A row whose two parts are both cleared is deleted.
 */
export async function putSocialDayTargets(userId: string, projectId: string, body: Record<string, unknown>, request?: Request) {
  const date = body.date
  if (!validDay(date)) return fail(400, { field: "date", error: "Tanggal harus YYYY-MM-DD.", code: "INVALID_FIELD" })
  const config = await loadSocialConfig(projectId)
  const plats = platformsOf(body.platforms, config)
  if (!plats.ok) return fail(400, plats.error)
  const parts = parseTargetParts(plats.value)
  if (!parts.ok) return fail(400, parts.error)
  const at = dayIn(date)
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  // One writer per project-day's targets (race audit M9).
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`socialdaytarget|${projectId}|${date}`})::int8)`
    for (const [pid, t] of parts.value) {
      const where = { projectId_date_platformId: { projectId, date: at, platformId: pid } }
      const cur = await tx.socialMediaDayTarget.findUnique({ where })
      const was = { engagementTarget: cur?.engagementTarget ?? null, postsTarget: cur?.postsTarget ?? null }
      const next = {
        engagementTarget: "engagementTarget" in t ? t.engagementTarget ?? null : was.engagementTarget,
        postsTarget: "postsTarget" in t ? t.postsTarget ?? null : was.postsTarget,
      }
      if (next.engagementTarget === was.engagementTarget && next.postsTarget === was.postsTarget) continue
      if (next.engagementTarget === null && next.postsTarget === null) {
        if (cur) await tx.socialMediaDayTarget.delete({ where })
      } else {
        await tx.socialMediaDayTarget.upsert({
          where,
          create: { projectId, date: at, platformId: pid, ...next, updatedById: userId },
          update: { ...next, updatedById: userId },
        })
      }
      before[pid] = was
      after[pid] = next
    }
  })
  if (Object.keys(after).length > 0) {
    await logAudit({
      action: "update",
      entityType: "social_media_target",
      entityId: `${projectId}:${date}`,
      entityName: `Target ${date}`,
      userId,
      request,
      metadata: { projectId, date, before, after },
    })
    emitSocialMediaChanged(projectId, date, date.slice(0, 7), userId)
  }
  return { ok: true as const, value: { date, changed: Object.keys(after) } }
}

// ── Platforms (settings) ──────────────────────────────────────────────────────────────────────────────

/** Per platform id: how many day rows and targets hold something for it (a platform with any is archived, never dropped). */
export async function socialUsage(projectId: string): Promise<Record<string, number>> {
  const [days, targets, dayTargets] = await Promise.all([
    prisma.socialMediaDay.groupBy({ by: ["platformId"], where: { projectId }, _count: { _all: true } }),
    prisma.socialMediaTarget.groupBy({ by: ["platformId"], where: { projectId }, _count: { _all: true } }),
    prisma.socialMediaDayTarget.groupBy({ by: ["platformId"], where: { projectId }, _count: { _all: true } }),
  ])
  const usage: Record<string, number> = {}
  for (const r of [...days, ...targets, ...dayTargets]) usage[r.platformId] = (usage[r.platformId] ?? 0) + r._count._all
  return usage
}

export async function loadSocialSettings(projectId: string) {
  const [config, usage] = await Promise.all([loadSocialConfig(projectId), socialUsage(projectId)])
  return { config, usage }
}

/**
 * PUT …/config { config: { platforms: [...] } }: the whole list in order. Rename keeps the id (and every
 * figure); a platform left out that holds anything comes back archived (lib/social-media.ts mergeSocialConfig).
 */
export async function putSocialConfig(
  userId: string,
  projectId: string,
  body: Record<string, unknown>,
  request?: Request,
): Promise<WriteResult<{ config: SocialReportConfig; usage: Record<string, number> }>> {
  const { config: previous, usage } = await loadSocialSettings(projectId)
  const merged = mergeSocialConfig(body.config, previous, new Set(Object.keys(usage)))
  if (!merged.ok) return { ok: false, status: 400, body: { ...merged.error } }
  const config = merged.config
  if (JSON.stringify(config) === JSON.stringify(previous)) return { ok: true, value: { config, usage } }
  await prisma.project.update({ where: { id: projectId }, data: { socialReportConfig: config as unknown as Prisma.InputJsonValue } })
  await logAudit({
    action: "update",
    entityType: "social_media_config",
    entityId: projectId,
    entityName: "Platforms",
    userId,
    request,
    metadata: { projectId, before: previous, after: config },
  })
  emitSocialMediaChanged(projectId, null, null, userId)
  return { ok: true, value: { config, usage } }
}
