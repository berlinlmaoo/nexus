/**
 * Social Media Report (Project.type "SOCIAL_MEDIA_REPORT", owner 14 Oct 2026): the rules, without a
 * database. One project = one brand's social accounts. Per day and per platform the team records Views,
 * Likes, Comments, Shares and Posts published; per day two notes ("What worked" / "What didn't work").
 * Targets per platform: a monthly engagement target and posts target, and optionally a date's own.
 *
 * Engagement = Likes + Comments + Shares. Views are recorded and shown, but are NOT engagement.
 *
 * Modelled on the Outlet Sales Dashboard (lib/outlet-sales.ts): the same WIB day, the same month helpers,
 * the same fallback for a date without its own target (the month's target split evenly over its days).
 * Database side and wire format: lib/social-media-server.ts. Routes:
 * src/app/api/projects/[projectId]/social-media. Android spec: apps/android/docs/SOCIAL-MEDIA-REPORT.md.
 */

import { daysInMonth, effectiveDayTarget, isMonth, monthBounds, monthDates, outletToday, pctOf, sumFilled, type OutletTargetSource } from "@/lib/outlet-sales"

export { daysInMonth, isMonth, monthBounds, monthDates, pctOf, sumFilled }
export type SocialTargetSource = OutletTargetSource

/** The company's day (WIB), "YYYY-MM-DD" — the outlet's clock. */
export const socialToday = outletToday

// ── Platforms (per project, configurable) ─────────────────────────────────────────────────────────────

export type SocialPlatform = { id: string; name: string; archived?: boolean }
export type SocialReportConfig = { version: 1; platforms: SocialPlatform[] }

/** The two every report starts with. Their ids are stable words, every later one gets a made-up id. */
export function defaultSocialConfig(): SocialReportConfig {
  return { version: 1, platforms: [{ id: "instagram", name: "Instagram" }, { id: "tiktok", name: "TikTok" }] }
}

export const PLATFORM_NAME_MAX = 40
export const PLATFORMS_MAX = 12
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/** A new stable id ("p_k3f9x2ab01"). Never reused. */
export function newPlatformId(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789"
  let s = ""
  for (let i = 0; i < 10; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return `p_${s}`
}

/** The stored JSON as a config, leniently: nothing stored (or unreadable, or empty) = Instagram + TikTok. */
export function readSocialConfig(raw: unknown): SocialReportConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultSocialConfig()
  const list = (raw as Record<string, unknown>).platforms
  if (!Array.isArray(list)) return defaultSocialConfig()
  const out: SocialPlatform[] = []
  const seen = new Set<string>()
  for (const r of list) {
    if (!r || typeof r !== "object") continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== "string" || !ID_RE.test(o.id) || seen.has(o.id)) continue
    seen.add(o.id)
    const name = typeof o.name === "string" && o.name.trim() ? o.name : o.id
    out.push(o.archived === true ? { id: o.id, name, archived: true } : { id: o.id, name })
  }
  return out.length ? { version: 1, platforms: out } : defaultSocialConfig()
}

export function activePlatforms(config: SocialReportConfig): SocialPlatform[] {
  return config.platforms.filter((p) => !p.archived)
}

export type SocialConfigError = { field: string; error: string; code: string }

/**
 * Checks a config a client sends (PUT …/social-media/config) against the one stored:
 * - names trimmed, 1–40 characters; ids unique; a new platform may come without an id (one is made);
 * - a platform the client left out that holds figures or targets (`used`) comes back archived, at the end,
 *   so no day loses a number; one without anything is dropped;
 * - at least one active platform; at most 12 in all.
 */
export function mergeSocialConfig(
  body: unknown,
  previous: SocialReportConfig,
  used: Set<string>,
): { ok: true; config: SocialReportConfig } | { ok: false; error: SocialConfigError } {
  const bad = (field: string, error: string, code = "INVALID_CONFIG") => ({ ok: false as const, error: { field, error, code } })
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("config", "Pengaturan platform tidak valid.")
  const raw = (body as Record<string, unknown>).platforms
  if (!Array.isArray(raw)) return bad("platforms", "Harus berupa daftar.")
  if (raw.length > PLATFORMS_MAX) return bad("platforms", `Maksimal ${PLATFORMS_MAX} platform.`)
  const seen = new Set<string>()
  const out: SocialPlatform[] = []
  for (const [i, r] of raw.entries()) {
    if (!r || typeof r !== "object") return bad(`platforms.${i}`, "Platform tidak valid.")
    const x = r as Record<string, unknown>
    let id: string
    if (x.id === undefined || x.id === null || x.id === "") {
      id = newPlatformId()
      while (seen.has(id)) id = newPlatformId()
    } else {
      if (typeof x.id !== "string" || !ID_RE.test(x.id) || seen.has(x.id)) return bad(`platforms.${i}`, "ID platform tidak valid atau dobel.")
      id = x.id
    }
    seen.add(id)
    const name = typeof x.name === "string" ? x.name.trim().replace(/\s+/g, " ") : ""
    if (name.length < 1 || name.length > PLATFORM_NAME_MAX) return bad(`platforms.${i}`, `Nama platform wajib diisi, maksimal ${PLATFORM_NAME_MAX} karakter.`)
    out.push(x.archived === true ? { id, name, archived: true } : { id, name })
  }
  for (const p of previous.platforms) {
    if (seen.has(p.id) || !used.has(p.id)) continue
    seen.add(p.id)
    out.push({ id: p.id, name: p.name, archived: true })
  }
  if (out.length > PLATFORMS_MAX) return bad("platforms", `Maksimal ${PLATFORMS_MAX} platform.`)
  if (!out.some((p) => !p.archived)) return bad("platforms", "Minimal satu platform aktif.", "PLATFORM_REQUIRED")
  return { ok: true, config: { version: 1, platforms: out } }
}

// ── Figures ───────────────────────────────────────────────────────────────────────────────────────────

export const METRIC_KEYS = ["views", "likes", "comments", "shares", "posts"] as const
export type SocialMetric = (typeof METRIC_KEYS)[number]
export type SocialFigures = Record<SocialMetric, number | null>

/** Guards against a typo, not rules: a billion views a day on one platform, ten thousand posts. */
export const METRIC_MAX: Record<SocialMetric, number> = {
  views: 1_000_000_000,
  likes: 1_000_000_000,
  comments: 1_000_000_000,
  shares: 1_000_000_000,
  posts: 10_000,
}
export const NOTE_MAX = 2000
/** Targets are whole numbers (a Postgres integer each). */
export const TARGET_MAX = { engagement: 2_000_000_000, posts: 1_000_000 } as const

export function emptyFigures(): SocialFigures {
  return { views: null, likes: null, comments: null, shares: null, posts: null }
}

/** Engagement = Likes + Comments + Shares (views are not engagement). null when none of the three is filled. */
export function engagementOf(f: Pick<SocialFigures, "likes" | "comments" | "shares">): number | null {
  return sumFilled([f.likes, f.comments, f.shares])
}

// ── Targets ───────────────────────────────────────────────────────────────────────────────────────────
//
// Per platform, a month may have an engagement target and a posts target. A date may set its own for
// either part (or both); a part a date does not set falls back to the month's target for that part split
// evenly over the month's days (lib/outlet-sales.ts effectiveDayTarget). No monthly target and no own =
// no target for that part on that day.

export type SocialTargetPair = { engagementTarget: number | null; postsTarget: number | null }
export type SocialMonthTargetRow = SocialTargetPair & { platformId: string }
export type SocialDayTargetRow = SocialTargetPair & { date: string; platformId: string }
export type SocialDayRow = SocialFigures & { date: string; platformId: string }
export type SocialNoteRow = { date: string; worked: string; didntWork: string }

export type SocialPlatformDay = SocialFigures & {
  engagement: number | null
  /** The targets in force that day (its own, else the month's share), null = none. */
  engagementTarget: number | null
  postsTarget: number | null
  engagementTargetSource: SocialTargetSource
  postsTargetSource: SocialTargetSource
  engagementPct: number | null
  postsPct: number | null
}

export type SocialDay = {
  date: string
  /** Per platform id: the day's figures and its targets in force (every configured platform, archived ones too). */
  platforms: Record<string, SocialPlatformDay>
  /** All platforms together; null when nothing of that kind was filled on the day. */
  engagement: number | null
  views: number | null
  posts: number | null
  worked: string
  didntWork: string
  /** Anything recorded that day: a figure or a note. */
  recorded: boolean
}

/** Every day of the month with each platform's figures, its targets in force and the percentages. */
export function buildSocialDays(
  month: string,
  config: SocialReportConfig,
  rows: SocialDayRow[],
  notes: SocialNoteRow[],
  monthTargets: SocialMonthTargetRow[],
  dayTargets: SocialDayTargetRow[],
): SocialDay[] {
  const fig = new Map(rows.map((r) => [`${r.date}|${r.platformId}`, r]))
  const own = new Map(dayTargets.map((t) => [`${t.date}|${t.platformId}`, t]))
  const monthly = new Map(monthTargets.map((t) => [t.platformId, t]))
  const noteOf = new Map(notes.map((n) => [n.date, n]))
  return monthDates(month).map((date) => {
    const platforms: Record<string, SocialPlatformDay> = {}
    const eng: (number | null)[] = []
    const views: (number | null)[] = []
    const posts: (number | null)[] = []
    for (const p of config.platforms) {
      const r = fig.get(`${date}|${p.id}`)
      const f: SocialFigures = r ? { views: r.views, likes: r.likes, comments: r.comments, shares: r.shares, posts: r.posts } : emptyFigures()
      const engagement = engagementOf(f)
      const o = own.get(`${date}|${p.id}`)
      const m = monthly.get(p.id)
      const et = effectiveDayTarget(o?.engagementTarget, m?.engagementTarget, month)
      const pt = effectiveDayTarget(o?.postsTarget, m?.postsTarget, month)
      platforms[p.id] = {
        ...f,
        engagement,
        engagementTarget: et.value,
        postsTarget: pt.value,
        engagementTargetSource: et.source,
        postsTargetSource: pt.source,
        engagementPct: pctOf(engagement, et.value),
        postsPct: pctOf(f.posts, pt.value),
      }
      eng.push(engagement)
      views.push(f.views)
      posts.push(f.posts)
    }
    const n = noteOf.get(date)
    const worked = n?.worked ?? ""
    const didntWork = n?.didntWork ?? ""
    const engagement = sumFilled(eng)
    const v = sumFilled(views)
    const ps = sumFilled(posts)
    return {
      date,
      platforms,
      engagement,
      views: v,
      posts: ps,
      worked,
      didntWork,
      recorded: engagement !== null || v !== null || ps !== null || worked !== "" || didntWork !== "",
    }
  })
}

/**
 * The last day the Overview counts for a month: the whole month when it is over, today when it is this
 * month, and null when it has not started (nothing is "to date" yet).
 */
export function cutoffOf(month: string, today: string): string | null {
  const dates = monthDates(month)
  const last = dates[dates.length - 1]
  if (today > last) return last
  if (today < dates[0]) return null
  return today
}

/** Sum of a target part over days; null when no day had one (so "no target" stays "no target"). */
export function sumTargets(values: (number | null)[]): number | null {
  const s = sumFilled(values)
  return s === null ? null : Math.round(s * 100) / 100
}

export type SocialPlatformOverview = {
  platformId: string
  name: string
  archived: boolean
  /** Month to date (up to `cutoff`). */
  engagement: number
  views: number
  posts: number
  likes: number
  comments: number
  shares: number
  /** Sum of each day's target in force up to `cutoff`; null = no target on any of those days. */
  engagementTargetToDate: number | null
  postsTargetToDate: number | null
  engagementPct: number | null
  postsPct: number | null
  /** The whole month's target (sum of every day's target in force); null = none. */
  engagementTargetMonth: number | null
  postsTargetMonth: number | null
  /** Engagement per day from the 1st to `cutoff` (0 for a day with nothing): the sparkline. */
  trend: number[]
  /** Days up to `cutoff` with any figure on this platform. */
  recordedDays: number
}

export type SocialOverview = {
  month: string
  /** The last day counted, "YYYY-MM-DD"; null = the month has not started. */
  cutoff: string | null
  /** Days up to `cutoff` with anything recorded (any platform or a note). 0 = the empty state. */
  recordedDays: number
  platforms: SocialPlatformOverview[]
}

/**
 * The Overview of a month, to date: per platform the engagement, views and posts from the 1st up to the
 * cutoff, against the sum of the daily targets in force over the same days. Active platforms always show;
 * an archived one only when the month has figures for it.
 */
export function summarizeSocial(month: string, today: string, config: SocialReportConfig, days: SocialDay[]): SocialOverview {
  const cutoff = cutoffOf(month, today)
  const counted = cutoff === null ? [] : days.filter((d) => d.date <= cutoff)
  const platforms: SocialPlatformOverview[] = []
  for (const p of config.platforms) {
    let engagement = 0, views = 0, posts = 0, likes = 0, comments = 0, shares = 0, recordedDays = 0
    const trend: number[] = []
    const et: (number | null)[] = []
    const pt: (number | null)[] = []
    for (const d of counted) {
      const x = d.platforms[p.id]
      if (!x) { trend.push(0); continue }
      engagement += x.engagement ?? 0
      views += x.views ?? 0
      posts += x.posts ?? 0
      likes += x.likes ?? 0
      comments += x.comments ?? 0
      shares += x.shares ?? 0
      trend.push(x.engagement ?? 0)
      if (x.engagement !== null || x.views !== null || x.posts !== null) recordedDays++
      et.push(x.engagementTarget)
      pt.push(x.postsTarget)
    }
    if (p.archived && recordedDays === 0) continue
    const engagementTargetToDate = sumTargets(et)
    const postsTargetToDate = sumTargets(pt)
    platforms.push({
      platformId: p.id,
      name: p.name,
      archived: !!p.archived,
      engagement,
      views,
      posts,
      likes,
      comments,
      shares,
      engagementTargetToDate,
      postsTargetToDate,
      engagementPct: pctOf(engagement, engagementTargetToDate),
      postsPct: pctOf(posts, postsTargetToDate),
      engagementTargetMonth: sumTargets(days.map((d) => d.platforms[p.id]?.engagementTarget ?? null)),
      postsTargetMonth: sumTargets(days.map((d) => d.platforms[p.id]?.postsTarget ?? null)),
      trend,
      recordedDays,
    })
  }
  return { month, cutoff, recordedDays: counted.filter((d) => d.recorded).length, platforms }
}
