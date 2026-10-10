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
