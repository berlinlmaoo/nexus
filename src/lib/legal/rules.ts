// Legal: the pure half — who may invite whom, and how a series format becomes a printed number.
// No imports, so `node src/lib/legal/rules.test.mjs` can load it without the app's path aliases.

// ── Access (owner, 14 Oct 2026) ─────────────────────────────────────────────────────────────────────
//
//   - The root (Berlin, LEGAL_ROOT_EMAILS) always has Legal and may invite anyone.
//   - A BoD (or One Above All) member whom someone invited may invite staff: people below BoD.
//   - Staff who were invited may not invite anyone.
//   - Nobody else has Legal — not BoD, not One Above All, not a system admin — until invited.
// Revoking follows inviting: the root may revoke anyone; a BoD member only the people they invited.

export const DEFAULT_LEGAL_ROOT_EMAILS = ["bagasputro.bp@gmail.com"]

export type InvitePower = "ANY" | "STAFF" | "NONE"

const BOARD_ROLES = new Set(["BOD", "ONE_ABOVE_ALL"])

/** True for the roles whose members, once invited, may invite staff. */
export function isBoardRole(orgRole: string | null | undefined): boolean {
  return !!orgRole && BOARD_ROLES.has(orgRole)
}

/** `orgRole` is the person's role in the company workspace (null = not a company member). */
export function invitePowerOf(p: { isRoot: boolean; isMember: boolean; orgRole: string | null }): InvitePower {
  if (p.isRoot) return "ANY"
  if (p.isMember && isBoardRole(p.orgRole)) return "STAFF"
  return "NONE"
}

/** May someone with `power` invite a company member whose role is `targetOrgRole`? */
export function mayInvite(power: InvitePower, targetOrgRole: string | null): boolean {
  if (!targetOrgRole) return false // only people of the company
  if (power === "ANY") return true
  if (power === "STAFF") return !isBoardRole(targetOrgRole)
  return false
}

/** May `actor` revoke a membership that `invitedById` granted? */
export function mayRevoke(actor: { userId: string; power: InvitePower }, invitedById: string | null): boolean {
  if (actor.power === "ANY") return true
  if (actor.power === "STAFF") return !!invitedById && invitedById === actor.userId
  return false
}

export function parseRootEmails(raw: string | undefined | null): string[] {
  const list = (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  return list.length ? list : DEFAULT_LEGAL_ROOT_EMAILS
}

// ── Document types ──────────────────────────────────────────────────────────────────────────────────

export const LEGAL_DOC_TYPES = ["SURAT", "SP", "SK", "PKS", "SPK", "NDA", "MOU", "INVOICE", "PJM", "PGB", "OTHER"] as const
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number]
export const isLegalDocType = (v: unknown): v is LegalDocType =>
  typeof v === "string" && (LEGAL_DOC_TYPES as readonly string[]).includes(v)

export const LEGAL_STATUSES = ["DRAFT", "FINAL", "SENT", "SIGNED", "VOID"] as const
export type LegalStatus = (typeof LEGAL_STATUSES)[number]
export const isLegalStatus = (v: unknown): v is LegalStatus =>
  typeof v === "string" && (LEGAL_STATUSES as readonly string[]).includes(v)

// ── Number formats ──────────────────────────────────────────────────────────────────────────────────
//
// A series format is literal text with tokens:
//   {SEQ} / {SEQ:n}  the running number, zero-padded to n digits (default 3)
//   {ROMAWI}         month in Roman numerals (X)        {MM}  month, 2 digits (10)
//   {BLN}            month, 3-letter Indonesian (OKT)   {YYYY} / {YY}  year
//   {CO}             the issuing company's code
//   {ANY_NAME}       a form field of that name, upper-cased and stripped to [A-Z0-9-] (e.g. {KOTA})

export const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
export const BLN_MONTHS = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"]

const BUILTIN = new Set(["SEQ", "ROMAWI", "MM", "BLN", "YYYY", "YY", "CO"])
const TOKEN = /\{([A-Z][A-Z0-9_]*)(?::(\d))?\}/g

export type ResetPeriod = "YEAR" | "MONTH"
export const isResetPeriod = (v: unknown): v is ResetPeriod => v === "YEAR" || v === "MONTH"

/** The form fields a format needs ({KOTA} → "KOTA"), in order of appearance, without duplicates. */
export function formatFieldNames(format: string): string[] {
  const out: string[] = []
  for (const m of format.matchAll(TOKEN)) {
    if (!BUILTIN.has(m[1]) && !out.includes(m[1])) out.push(m[1])
  }
  return out
}

/** Why a format can't be saved, or null. Every format must carry {SEQ}: without it two documents of the
 *  same month would print the same number (owner, 14 Oct 2026: "tambah nomor urut di belakang"). */
export function formatProblem(format: string): string | null {
  const f = format.trim()
  if (!f) return "Format is empty"
  if (f.length > 120) return "Format is too long"
  if (!/\{SEQ(?::\d)?\}/.test(f)) return "Format must contain {SEQ}"
  const stray = f.replace(TOKEN, "")
  if (/[{}]/.test(stray)) return "Format has an unclosed or invalid {token}"
  if (/[^\x20-\x7E]/.test(stray)) return "Format may only contain plain characters"
  return null
}

/** formatProblem, plus what the reset period needs: a yearly counter must print the year, a monthly one the
 *  month too — otherwise next year's (or month's) 001 prints exactly like this one's. */
export function seriesProblem(format: string, resetPeriod: string): string | null {
  const p = formatProblem(format)
  if (p) return p
  if (!isResetPeriod(resetPeriod)) return "Reset must be YEAR or MONTH"
  if (!/\{(YYYY|YY)\}/.test(format)) return "Format must contain the year ({YYYY} or {YY})"
  if (resetPeriod === "MONTH" && !/\{(ROMAWI|MM|BLN)\}/.test(format)) return "A monthly counter needs the month in the format ({ROMAWI}, {MM} or {BLN})"
  return null
}

/** A form value as it may appear between the slashes of a number. */
export function numberSegment(raw: string): string {
  return raw
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
}

export type FormatInput = {
  format: string
  seq: number
  year: number
  /** 1-12 */
  month: number
  companyCode: string
  fields?: Record<string, unknown>
  /** Print missing fields as "____" instead of failing — for a preview only. */
  preview?: boolean
}

export class NumberFormatError extends Error {
  constructor(readonly missing: string[]) {
    super(`Number needs: ${missing.join(", ")}`)
  }
}

export function renderNumber(i: FormatInput): string {
  const missing: string[] = []
  const fieldOf = (name: string) => {
    const entry = Object.entries(i.fields ?? {}).find(([k]) => k.toUpperCase() === name)
    const v = entry && entry[1] != null ? numberSegment(String(entry[1])) : ""
    if (!v) {
      if (!i.preview) missing.push(name)
      return "____"
    }
    return v
  }
  const out = i.format.trim().replace(TOKEN, (_all, name: string, pad?: string) => {
    switch (name) {
      case "SEQ": return String(i.seq).padStart(pad ? Number(pad) : 3, "0")
      case "ROMAWI": return ROMAN_MONTHS[i.month - 1]
      case "MM": return String(i.month).padStart(2, "0")
      case "BLN": return BLN_MONTHS[i.month - 1]
      case "YYYY": return String(i.year)
      case "YY": return String(i.year % 100).padStart(2, "0")
      case "CO": return i.companyCode
      default: return fieldOf(name)
    }
  })
  if (missing.length) throw new NumberFormatError(missing)
  return out
}

/** Year and month of a date in Jakarta — a document dated late on the 31st must not land in next month. */
export function jakartaYearMonth(d: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(d)
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
  }
}
