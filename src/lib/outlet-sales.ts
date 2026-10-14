/**
 * Outlet Sales Dashboard (Project.type "OUTLET_SALES", owner 10 Oct 2026, for Ryan): the rules, without a
 * database. One project = one outlet. An outlet has monthly targets (sales in rupiah, pax) and events
 * (nights) with a report each — Ryan's form, in his order and words (OUTLET_FORM below).
 *
 * Everything a client shows that is not typed in is decided here, so web, iOS and Android say the same:
 * the totals (RSVP, hosting), the percentages, the event's status and the month's summary. Database side
 * and wire format: lib/outlet-sales-server.ts. Routes: src/app/api/projects/[projectId]/outlet-sales.
 * Spec for the apps: agents:~/handoff/chat/OUTLET-SALES.md.
 */

/** The company's day (WIB, UTC+7), "YYYY-MM-DD" — the same clock as the pipeline's. */
export function outletToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10)
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function isMonth(v: unknown): v is string {
  if (typeof v !== "string") return false
  const m = MONTH_RE.exec(v)
  return !!m && Number(m[1]) >= 2000 && Number(m[1]) <= 2100
}

/** "2026-10" → first day "2026-10-01" and the first day of the next month "2026-11-01". */
export function monthBounds(month: string): { start: string; next: string } {
  const [y, m] = month.split("-").map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return { start: `${month}-01`, next: `${ny}-${String(nm).padStart(2, "0")}-01` }
}

/**
 * Whole percent of a target reached, rounded DOWN so a night that is Rp1 short never reads 100%.
 * null = no target (or a target of 0), or nothing filled: clients then show no percentage at all.
 */
export function pctOf(actual: number | null | undefined, target: number | null | undefined): number | null {
  if (actual === null || actual === undefined || !target || target <= 0) return null
  return Math.floor((actual * 100) / target + 1e-9)
}

/** The sum of the parts that were filled; null when none was (RSVP – TOTAL / HOSTING – TOTAL). */
export function sumFilled(parts: (number | null | undefined)[]): number | null {
  let any = false
  let sum = 0
  for (const p of parts) {
    if (p === null || p === undefined) continue
    any = true
    sum += p
  }
  return any ? sum : null
}

/**
 * Where an event stands — the Board's three columns (derived, never dragged):
 * - REPORTED: both actuals (sales and pax) are filled, whatever the date.
 * - WAITING_REPORT: the day is over (before today, WIB) and an actual is still missing.
 * - UPCOMING: today or later and not reported yet. The night of the event itself is still upcoming: the
 *   report usually comes after closing, so it only starts waiting the next day.
 */
export type OutletEventStatus = "UPCOMING" | "WAITING_REPORT" | "REPORTED"
export const OUTLET_STATUSES: readonly OutletEventStatus[] = ["UPCOMING", "WAITING_REPORT", "REPORTED"]

export type OutletEventFacts = {
  date: string
  sales: number | null
  pax: number | null
}

export function missingOf(e: OutletEventFacts): ("sales" | "pax")[] {
  const out: ("sales" | "pax")[] = []
  if (e.sales === null) out.push("sales")
  if (e.pax === null) out.push("pax")
  return out
}

export function statusOf(e: OutletEventFacts, today: string): OutletEventStatus {
  if (missingOf(e).length === 0) return "REPORTED"
  return e.date < today ? "WAITING_REPORT" : "UPCOMING"
}

export type OutletMonthSummary = {
  month: string
  /** Sum of the month's events' actual sales / pax (an event not filled counts 0). */
  sales: number
  pax: number
  /** The month's target; null = none set. */
  salesTarget: number | null
  paxTarget: number | null
  salesPct: number | null
  paxPct: number | null
  eventCount: number
  reportedCount: number
  waitingCount: number
  upcomingCount: number
  rsvpTotal: number
  hostingTotal: number
}

export function summarizeMonth(
  month: string,
  events: { sales: number | null; pax: number | null; status: OutletEventStatus; rsvpTotal: number | null; hostingTotal: number | null }[],
  target: { salesTarget: number | null; paxTarget: number | null } | null,
): OutletMonthSummary {
  let sales = 0
  let pax = 0
  let rsvpTotal = 0
  let hostingTotal = 0
  const count = { UPCOMING: 0, WAITING_REPORT: 0, REPORTED: 0 }
  for (const e of events) {
    sales += e.sales ?? 0
    pax += e.pax ?? 0
    rsvpTotal += e.rsvpTotal ?? 0
    hostingTotal += e.hostingTotal ?? 0
    count[e.status]++
  }
  const salesTarget = target?.salesTarget ?? null
  const paxTarget = target?.paxTarget ?? null
  return {
    month,
    sales,
    pax,
    salesTarget,
    paxTarget,
    salesPct: pctOf(sales, salesTarget),
    paxPct: pctOf(pax, paxTarget),
    eventCount: events.length,
    reportedCount: count.REPORTED,
    waitingCount: count.WAITING_REPORT,
    upcomingCount: count.UPCOMING,
    rsvpTotal,
    hostingTotal,
  }
}

// ── The default form (Ryan, 10 Oct 2026) ───────────────────────────────────────────────────────────────

export type OutletFieldType = "text" | "date" | "money" | "count" | "longtext"
export type Bilingual = { en: string; id: string }
export type OutletFormField = {
  key: string
  type: OutletFieldType
  label: Bilingual
  required?: boolean
  /** A short note under the field (Ryan's definitions, 10 Oct 2026). */
  hint?: Bilingual
  /** Text: at most this many characters. Numbers: at most this value. */
  max: number
}
export type OutletFormSection = {
  key: string
  title: Bilingual
  /** A computed total shown in the section's title ("RSVP – TOTAL: 120"): the event's key that holds it. */
  total?: "rsvpTotal" | "hostingTotal"
  fields: OutletFormField[]
}

export const NAME_MAX = 120
export const TEXT_MAX = 2000
/** Guards against a typo, not rules: Rp1 trillion a night, a million people. */
export const MONEY_MAX = 1e12
export const COUNT_MAX = 1_000_000

/**
 * Ryan's questions, in his order and with his words (Indonesian), plus their English. Sent in the GET
 * responses as `form` so the apps can draw the form from it; a client that has its own copy may keep it.
 * The keys are the event's fields. Adding a question later = a new nullable column + an entry here.
 */
export const OUTLET_FORM: { version: number; sections: OutletFormSection[] } = {
  version: 1,
  sections: [
    {
      key: "event",
      title: { en: "Event", id: "Event" },
      fields: [
        { key: "name", type: "text", label: { en: "Event name", id: "Nama event" }, required: true, max: NAME_MAX },
        { key: "date", type: "date", label: { en: "Day/Date", id: "Hari/Tanggal" }, required: true, max: 0 },
      ],
    },
    {
      key: "sales",
      title: { en: "Sales", id: "Sales" },
      fields: [
        // Ryan (10 Oct 2026): the outlet's total revenue of the night, every transaction, after tax,
        // service charge and discounts. One number, not split.
        {
          key: "sales", type: "money", label: { en: "Sales", id: "Sales" }, max: MONEY_MAX,
          hint: { en: "Total revenue, after tax, service charge and discounts", id: "Total revenue, setelah pajak, service charge & diskon" },
        },
        { key: "salesTarget", type: "money", label: { en: "Sales target", id: "Target sales" }, max: MONEY_MAX },
      ],
    },
    {
      key: "pax",
      title: { en: "Pax", id: "Pax" },
      fields: [
        // The people who actually came: its own number, never derived from the RSVPs.
        { key: "pax", type: "count", label: { en: "Pax", id: "Pax" }, max: COUNT_MAX, hint: { en: "People who actually came", id: "Jumlah orang yang datang" } },
        { key: "paxTarget", type: "count", label: { en: "Pax target", id: "Target pax" }, max: COUNT_MAX },
      ],
    },
    {
      key: "rsvp",
      title: { en: "RSVP – TOTAL", id: "RSVP – TOTAL" },
      total: "rsvpTotal",
      fields: [
        { key: "rsvpWalkIn", type: "count", label: { en: "Walk-in RSVP", id: "Walk-in RSVP" }, max: COUNT_MAX },
        { key: "rsvpTeam", type: "count", label: { en: "RSVP Team", id: "RSVP Team" }, max: COUNT_MAX },
        { key: "rsvpPr", type: "count", label: { en: "RSVP PR", id: "RSVP PR" }, max: COUNT_MAX },
        { key: "rsvpEo", type: "count", label: { en: "RSVP EO", id: "RSVP EO" }, max: COUNT_MAX },
      ],
    },
    {
      key: "hosting",
      title: { en: "HOSTING – TOTAL", id: "HOSTING – TOTAL" },
      total: "hostingTotal",
      fields: [
        { key: "hostingTeam", type: "count", label: { en: "Hosting Team", id: "Hosting Team" }, max: COUNT_MAX },
        { key: "hostingPr", type: "count", label: { en: "Hosting PR", id: "Hosting PR" }, max: COUNT_MAX },
        { key: "hostingEo", type: "count", label: { en: "Hosting EO", id: "Hosting EO" }, max: COUNT_MAX },
      ],
    },
    {
      key: "success",
      title: { en: "What worked", id: "Hal yang berhasil" },
      fields: [
        { key: "successWhat", type: "longtext", label: { en: "What", id: "Apa" }, max: TEXT_MAX },
        { key: "successWhy", type: "longtext", label: { en: "Why it worked", id: "Kenapa berhasil" }, max: TEXT_MAX },
        { key: "successRepeat", type: "longtext", label: { en: "How to make it happen again", id: "Gimana biar bisa terulang lagi" }, max: TEXT_MAX },
      ],
    },
    {
      key: "fail",
      title: { en: "What didn't work", id: "Hal yang gagal" },
      fields: [
        { key: "failWhat", type: "longtext", label: { en: "What", id: "Apa" }, max: TEXT_MAX },
        { key: "failWhy", type: "longtext", label: { en: "Why it didn't work", id: "Kenapa gagal" }, max: TEXT_MAX },
        { key: "failPrevent", type: "longtext", label: { en: "How to keep it from happening again", id: "Gimana biar tidak kejadian lagi" }, max: TEXT_MAX },
      ],
    },
  ],
}

/** Every field of the form by key (the parser checks bodies against it). */
export const OUTLET_FIELDS: Record<string, OutletFormField> = Object.fromEntries(
  OUTLET_FORM.sections.flatMap((s) => s.fields).map((f) => [f.key, f]),
)

// ── Daily targets (owner, 14 Oct 2026, after a meeting with Ryan) ─────────────────────────────────────
//
// A date may have its own target for sales, for pax, or both; each part on its own. A part a date does not
// set falls back to the month's target for that part split evenly over the month's days (the monthly
// target is per metric, so the fallback is too). No monthly target for a part and no day target = no
// target for that part on that day. Clearing a day's part brings the fallback back.

/** 28–31. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Every "YYYY-MM-DD" of the month, in order. */
export function monthDates(month: string): string[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)
}

export type OutletTargetSource = "day" | "month" | null

export type OutletDayTargetRow = { date: string; salesTarget: number | null; paxTarget: number | null }

export type OutletDay = {
  date: string
  /** The day's actuals: the sum of its events' filled figures; null when no event of the day has one. */
  sales: number | null
  pax: number | null
  /** The target in force that day (the day's own, else the month's share), null = none. */
  salesTarget: number | null
  paxTarget: number | null
  /** Where each target comes from: "day" = set on this date, "month" = the month's share, null = none. */
  salesTargetSource: OutletTargetSource
  paxTargetSource: OutletTargetSource
  salesPct: number | null
  paxPct: number | null
}

/** The month's share for one day: target / days, kept to two decimals (clients round when they print). */
export function monthShare(target: number | null | undefined, month: string): number | null {
  if (target === null || target === undefined) return null
  return Math.round((target / daysInMonth(month)) * 100) / 100
}

/** One part of a day's target: its own when set, else the month's share. */
export function effectiveDayTarget(
  own: number | null | undefined,
  monthly: number | null | undefined,
  month: string,
): { value: number | null; source: OutletTargetSource } {
  if (own !== null && own !== undefined) return { value: own, source: "day" }
  const share = monthShare(monthly, month)
  return share === null ? { value: null, source: null } : { value: share, source: "month" }
}

/** Every day of the month with its actuals, its targets in force and the percentages against them. */
export function buildMonthDays(
  month: string,
  events: { date: string; sales: number | null; pax: number | null }[],
  monthTarget: { salesTarget: number | null; paxTarget: number | null } | null,
  dayTargets: OutletDayTargetRow[],
): OutletDay[] {
  const own = new Map(dayTargets.map((d) => [d.date, d]))
  const byDay = new Map<string, { sales: (number | null)[]; pax: (number | null)[] }>()
  for (const e of events) {
    const b = byDay.get(e.date) ?? { sales: [], pax: [] }
    b.sales.push(e.sales)
    b.pax.push(e.pax)
    byDay.set(e.date, b)
  }
  return monthDates(month).map((date) => {
    const b = byDay.get(date)
    const sales = b ? sumFilled(b.sales) : null
    const pax = b ? sumFilled(b.pax) : null
    const st = effectiveDayTarget(own.get(date)?.salesTarget, monthTarget?.salesTarget, month)
    const pt = effectiveDayTarget(own.get(date)?.paxTarget, monthTarget?.paxTarget, month)
    return {
      date,
      sales,
      pax,
      salesTarget: st.value,
      paxTarget: pt.value,
      salesTargetSource: st.source,
      paxTargetSource: pt.source,
      salesPct: pctOf(sales, st.value),
      paxPct: pctOf(pax, pt.value),
    }
  })
}

// ── The report's breakdown, per outlet (owner, 14 Oct 2026, after a meeting with Ryan) ────────────────
//
// Each outlet project sets up its own RSVP items, Hosting items and Communities (Project.outletReportConfig,
// JSON). The report's figures for them live per event by the item's stable id: the seven items every outlet
// started with keep their columns (rsvpWalkIn … hostingEo, the ids are the column names), every other item
// lives in OutletSalesEvent.reportValues (JSON). So released apps that send and read the old keys keep
// working, nothing is copied, and the two can never disagree.
//
// Renaming changes the label only. Removing an item that holds a figure in any report archives it: it
// leaves the form but stays in the config, in the reports that have it and in their totals. An item without
// any figure is simply dropped.

export type OutletItem = { id: string; label: string; archived?: boolean }
export type OutletCommunityMode = "total" | "breakdown"
export type OutletCommunity = { id: string; name: string; mode: OutletCommunityMode; items: OutletItem[]; archived?: boolean }
export type OutletReportConfig = { version: 1; rsvp: OutletItem[]; hosting: OutletItem[]; communities: OutletCommunity[] }
export type OutletValues = Record<string, number>

export const LEGACY_RSVP_IDS = ["rsvpWalkIn", "rsvpTeam", "rsvpPr", "rsvpEo"] as const
export const LEGACY_HOSTING_IDS = ["hostingTeam", "hostingPr", "hostingEo"] as const
export const LEGACY_ITEM_IDS: readonly string[] = [...LEGACY_RSVP_IDS, ...LEGACY_HOSTING_IDS]
export function isLegacyItemId(id: string): boolean {
  return LEGACY_ITEM_IDS.includes(id)
}

/** The labels of the seven original items: Ryan's words, the same in both languages. */
export const LEGACY_LABELS: Record<string, string> = {
  rsvpWalkIn: "Walk-in RSVP",
  rsvpTeam: "RSVP Team",
  rsvpPr: "RSVP PR",
  rsvpEo: "RSVP EO",
  hostingTeam: "Hosting Team",
  hostingPr: "Hosting PR",
  hostingEo: "Hosting EO",
}

export function defaultReportConfig(): OutletReportConfig {
  return {
    version: 1,
    rsvp: LEGACY_RSVP_IDS.map((id) => ({ id, label: LEGACY_LABELS[id] })),
    hosting: LEGACY_HOSTING_IDS.map((id) => ({ id, label: LEGACY_LABELS[id] })),
    communities: [],
  }
}

export const ITEM_LABEL_MAX = 60
export const ITEMS_MAX = 30
export const COMMUNITIES_MAX = 50
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/** A new stable id ("i_k3f9x2ab"). Never reused: ids only ever come from here or the seven columns. */
export function newItemId(prefix = "i"): string {
  let s = ""
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 10; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return `${prefix}_${s}`
}

function readItems(raw: unknown): OutletItem[] {
  if (!Array.isArray(raw)) return []
  const out: OutletItem[] = []
  for (const r of raw) {
    if (!r || typeof r !== "object") continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) continue
    const label = typeof o.label === "string" ? o.label : ""
    out.push(o.archived === true ? { id: o.id, label, archived: true } : { id: o.id, label })
  }
  return out
}

/** The stored JSON as a config, leniently: nothing stored (or unreadable) = the default seven items. */
export function readReportConfig(raw: unknown): OutletReportConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultReportConfig()
  const o = raw as Record<string, unknown>
  const communities: OutletCommunity[] = []
  if (Array.isArray(o.communities)) {
    for (const r of o.communities) {
      if (!r || typeof r !== "object") continue
      const c = r as Record<string, unknown>
      if (typeof c.id !== "string" || !ID_RE.test(c.id)) continue
      communities.push({
        id: c.id,
        name: typeof c.name === "string" ? c.name : "",
        mode: c.mode === "breakdown" ? "breakdown" : "total",
        items: readItems(c.items),
        ...(c.archived === true ? { archived: true } : {}),
      })
    }
  }
  return { version: 1, rsvp: readItems(o.rsvp), hosting: readItems(o.hosting), communities }
}

/** Every id the config knows (items, communities and their items, archived ones included). */
export function configIds(config: OutletReportConfig): Set<string> {
  const ids = new Set<string>()
  for (const i of config.rsvp) ids.add(i.id)
  for (const i of config.hosting) ids.add(i.id)
  for (const c of config.communities) {
    ids.add(c.id)
    for (const i of c.items) ids.add(i.id)
  }
  return ids
}

export type ConfigError = { field: string; error: string; code: string }

/**
 * Checks a config a client sends (PUT …/outlet-sales/config) against the one stored, and settles removals:
 * - every label trimmed, 1–60 characters; ids unique; a new item may come without an id (one is made);
 * - the seven original ids may only stay in their own group (their figures live in those columns);
 * - an item / community the client left out that holds a figure (`used`) comes back archived, at the end of
 *   its group, so no report loses a number; one without any figure is dropped;
 * - limits: 30 items per group, 50 communities.
 */
export function mergeReportConfig(
  body: unknown,
  previous: OutletReportConfig,
  used: Set<string>,
): { ok: true; config: OutletReportConfig } | { ok: false; error: ConfigError } {
  const bad = (field: string, error: string, code = "INVALID_CONFIG") => ({ ok: false as const, error: { field, error, code } })
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("config", "Pengaturan laporan tidak valid.")
  const o = body as Record<string, unknown>
  const seen = new Set<string>()
  const takeId = (raw: unknown, prefix: string): string | null => {
    if (raw === undefined || raw === null || raw === "") {
      let id = newItemId(prefix)
      while (seen.has(id)) id = newItemId(prefix)
      seen.add(id)
      return id
    }
    if (typeof raw !== "string" || !ID_RE.test(raw) || seen.has(raw)) return null
    seen.add(raw)
    return raw
  }
  const label = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null
    const s = raw.trim().replace(/\s+/g, " ")
    return s.length >= 1 && s.length <= ITEM_LABEL_MAX ? s : null
  }
  const items = (raw: unknown, field: string, legacyAllowed: readonly string[]): { ok: true; items: OutletItem[] } | { ok: false; error: ConfigError } => {
    if (raw === undefined) return { ok: true, items: [] }
    if (!Array.isArray(raw)) return bad(field, "Harus berupa daftar.")
    if (raw.length > ITEMS_MAX) return bad(field, `Maksimal ${ITEMS_MAX} item.`)
    const out: OutletItem[] = []
    for (const [i, r] of raw.entries()) {
      if (!r || typeof r !== "object") return bad(`${field}.${i}`, "Item tidak valid.")
      const x = r as Record<string, unknown>
      const id = takeId(x.id, "i")
      if (!id) return bad(`${field}.${i}`, "ID item tidak valid atau dobel.")
      if (isLegacyItemId(id) && !legacyAllowed.includes(id)) return bad(`${field}.${i}`, "Item bawaan tidak bisa dipindah ke grup lain.")
      const l = label(x.label)
      if (!l) return bad(`${field}.${i}`, `Nama item wajib diisi, maksimal ${ITEM_LABEL_MAX} karakter.`)
      out.push(x.archived === true ? { id, label: l, archived: true } : { id, label: l })
    }
    return { ok: true, items: out }
  }
  const rsvp = items(o.rsvp, "rsvp", LEGACY_RSVP_IDS)
  if (!rsvp.ok) return rsvp
  const hosting = items(o.hosting, "hosting", LEGACY_HOSTING_IDS)
  if (!hosting.ok) return hosting
  const communities: OutletCommunity[] = []
  if (o.communities !== undefined) {
    if (!Array.isArray(o.communities)) return bad("communities", "Harus berupa daftar.")
    if (o.communities.length > COMMUNITIES_MAX) return bad("communities", `Maksimal ${COMMUNITIES_MAX} komunitas.`)
    for (const [i, r] of o.communities.entries()) {
      if (!r || typeof r !== "object") return bad(`communities.${i}`, "Komunitas tidak valid.")
      const x = r as Record<string, unknown>
      const id = takeId(x.id, "c")
      if (!id || isLegacyItemId(id)) return bad(`communities.${i}`, "ID komunitas tidak valid atau dobel.")
      const name = label(x.name)
      if (!name) return bad(`communities.${i}`, `Nama komunitas wajib diisi, maksimal ${ITEM_LABEL_MAX} karakter.`)
      const mode: OutletCommunityMode = x.mode === "breakdown" ? "breakdown" : "total"
      const sub = items(x.items, `communities.${i}.items`, [])
      if (!sub.ok) return sub
      communities.push({ id, name, mode, items: sub.items, ...(x.archived === true ? { archived: true } : {}) })
    }
  }

  // Removed but holding figures: back, archived.
  const keep = (prev: OutletItem[], next: OutletItem[]) => {
    for (const p of prev) {
      if (seen.has(p.id) || !used.has(p.id)) continue
      seen.add(p.id)
      next.push({ id: p.id, label: p.label, archived: true })
    }
  }
  keep(previous.rsvp, rsvp.items)
  keep(previous.hosting, hosting.items)
  for (const pc of previous.communities) {
    const nc = communities.find((c) => c.id === pc.id)
    if (nc) { keep(pc.items, nc.items); continue }
    const usedSub = pc.items.filter((i) => used.has(i.id) && !seen.has(i.id))
    if (!used.has(pc.id) && usedSub.length === 0) continue
    seen.add(pc.id)
    for (const i of usedSub) seen.add(i.id)
    communities.push({ id: pc.id, name: pc.name, mode: pc.mode, items: usedSub.map((i) => ({ id: i.id, label: i.label, archived: true })), archived: true })
  }
  return { ok: true, config: { version: 1, rsvp: rsvp.items, hosting: hosting.items, communities } }
}

/** A community's figure for one report: its own number ("Total only") plus its sub-items, whatever was filled. */
export function communityTotal(c: OutletCommunity, values: OutletValues): number | null {
  return sumFilled([values[c.id], ...c.items.map((i) => values[i.id])])
}

export type OutletEventTotals = {
  rsvpTotal: number | null
  hostingTotal: number | null
  communityTotal: number | null
  /** Per community id: its total in this report (null = nothing filled). */
  communities: Record<string, number | null>
}

/**
 * The totals of one report. Every item counts, archived ones too: a report keeps the total it was filled
 * with after an item is retired. RSVP total = the sum of the RSVP items, Hosting likewise, Communities =
 * the sum of each community's total. null = nothing of that group was filled.
 */
export function eventTotals(config: OutletReportConfig, values: OutletValues): OutletEventTotals {
  const communities: Record<string, number | null> = {}
  for (const c of config.communities) communities[c.id] = communityTotal(c, values)
  return {
    rsvpTotal: sumFilled(config.rsvp.map((i) => values[i.id])),
    hostingTotal: sumFilled(config.hosting.map((i) => values[i.id])),
    communityTotal: sumFilled(Object.values(communities)),
    communities,
  }
}

export type OutletGuestLine = { id: string; label: string; archived: boolean; total: number }
export type OutletGuestCommunity = {
  id: string
  name: string
  mode: OutletCommunityMode
  archived: boolean
  total: number
  items: OutletGuestLine[]
}
export type OutletGuests = {
  /** How many of the period's reports have at least one guest figure. 0 = nothing reported yet. */
  reportCount: number
  rsvp: { total: number; items: OutletGuestLine[] }
  hosting: { total: number; items: OutletGuestLine[] }
  communities: { total: number; items: OutletGuestCommunity[] }
}

/**
 * The Overview's Guest overview for a period: per group its total and each item's total; per community its
 * total and (Breakdown) its sub-items'. Active items always show (0 when nothing came in); an archived one
 * only when the period has figures for it.
 */
export function summarizeGuests(config: OutletReportConfig, reports: OutletValues[]): OutletGuests {
  const sum = (id: string) => reports.reduce((a, v) => a + (v[id] ?? 0), 0)
  const lines = (items: OutletItem[]) =>
    items
      .map((i) => ({ id: i.id, label: i.label, archived: !!i.archived, total: sum(i.id) }))
      .filter((l) => !l.archived || l.total > 0)
  const ids = configIds(config)
  const reportCount = reports.filter((v) => Object.keys(v).some((k) => ids.has(k))).length
  const rsvp = lines(config.rsvp)
  const hosting = lines(config.hosting)
  const communities = config.communities
    .map((c) => {
      const items = lines(c.items)
      const total = sum(c.id) + c.items.reduce((a, i) => a + sum(i.id), 0)
      return { id: c.id, name: c.name, mode: c.mode, archived: !!c.archived, total, items }
    })
    .filter((c) => !c.archived || c.total > 0)
  return {
    reportCount,
    rsvp: { total: config.rsvp.reduce((a, i) => a + sum(i.id), 0), items: rsvp },
    hosting: { total: config.hosting.reduce((a, i) => a + sum(i.id), 0), items: hosting },
    communities: { total: communities.reduce((a, c) => a + c.total, 0), items: communities },
  }
}

/**
 * The form released apps draw (`form`), with this outlet's names: the RSVP and Hosting sections list only
 * the original items that are still active, under their current labels. Items added later are not in it —
 * those apps would not know where to read them — and stay out of their PATCH bodies.
 */
export function legacyFormFor(config: OutletReportConfig): typeof OUTLET_FORM {
  const active = new Map<string, string>()
  for (const i of [...config.rsvp, ...config.hosting]) if (!i.archived && isLegacyItemId(i.id)) active.set(i.id, i.label)
  return {
    version: OUTLET_FORM.version,
    sections: OUTLET_FORM.sections.map((s) => {
      if (s.key !== "rsvp" && s.key !== "hosting") return s
      const order = (s.key === "rsvp" ? config.rsvp : config.hosting).map((i) => i.id)
      const fields = s.fields
        .filter((f) => active.has(f.key))
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
        .map((f) => {
          const l = active.get(f.key)!
          return l === LEGACY_LABELS[f.key] ? f : { ...f, label: { en: l, id: l } }
        })
      return { ...s, fields }
    }),
  }
}
