// Legal: the pure half — who may invite whom, and how a series format becomes a printed number.
// No imports, so `node src/lib/legal/rules.test.mjs` can load it without the app's path aliases.

// ── Access (owner, 14 Oct 2026) ─────────────────────────────────────────────────────────────────────
//
//   - The root (the owner, LEGAL_ROOT_EMAILS) always has Legal and may invite anyone.
//   - A BoD (or One Above All) member whom the root invited may invite staff: people below BoD. (Staff a
//     BoD member invited who are later promoted to BoD don't gain it: the power comes from the root.)
//   - Staff who were invited may not invite anyone.
//   - Nobody else has Legal — not BoD, not One Above All, not a system admin — until invited.
// Revoking follows inviting: the root may revoke anyone; a BoD member only the people they invited.


export type InvitePower = "ANY" | "STAFF" | "NONE"

const BOARD_ROLES = new Set(["BOD", "ONE_ABOVE_ALL"])

/** True for the roles whose members, once invited, may invite staff. */
export function isBoardRole(orgRole: string | null | undefined): boolean {
  return !!orgRole && BOARD_ROLES.has(orgRole)
}

/** `orgRole` is the person's role in the company workspace (null = not a company member); `invitedByRoot`:
 *  their membership was granted by the root. */
export function invitePowerOf(p: { isRoot: boolean; isMember: boolean; orgRole: string | null; invitedByRoot?: boolean }): InvitePower {
  if (p.isRoot) return "ANY"
  if (p.isMember && p.invitedByRoot && isBoardRole(p.orgRole)) return "STAFF"
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

/** LEGAL_ROOT_EMAILS, comma-separated. Unset or empty = no root: nobody has Legal until it is configured. */
export function parseRootEmails(raw: string | undefined | null): string[] {
  return (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
}

// ── Document types ──────────────────────────────────────────────────────────────────────────────────

export const LEGAL_DOC_TYPES = ["SURAT", "SP", "SK", "PKS", "SPK", "NDA", "MOU", "ADD", "INVOICE", "PJM", "PGB", "OTHER"] as const

/** An addendum: made from a signed document, numbered after it (parent number + "/ADD-n"). */
export const ADDENDUM_DOC_TYPE = "ADD"

/** How an addendum names the document it amends ("ADDENDUM PERTAMA ATAS PERJANJIAN KERJA SAMA NOMOR …"). */
export const DOC_TYPE_FULL_NAMES: Record<string, string> = {
  SURAT: "Surat", SP: "Surat Peringatan", SK: "Surat Kuasa", PKS: "Perjanjian Kerja Sama", SPK: "Surat Perjanjian Kerja",
  NDA: "Perjanjian Kerahasiaan", MOU: "Nota Kesepahaman", ADD: "Addendum", INVOICE: "Invoice", PJM: "Surat Perjanjian Peminjaman Barang",
  PGB: "Berita Acara Pengembalian Barang", OTHER: "Dokumen",
}
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number]
export const isLegalDocType = (v: unknown): v is LegalDocType =>
  typeof v === "string" && (LEGAL_DOC_TYPES as readonly string[]).includes(v)

export const LEGAL_STATUSES = ["DRAFT", "FINAL", "SENT", "SIGNED", "VOID"] as const
export type LegalStatus = (typeof LEGAL_STATUSES)[number]
export const isLegalStatus = (v: unknown): v is LegalStatus =>
  typeof v === "string" && (LEGAL_STATUSES as readonly string[]).includes(v)

/**
 * Why a document may not move from `from` to `to`, or null (owner, 14 Oct 2026):
 *   - VOID is one-way: never back to DRAFT or any other status.
 *   - SIGNED is locked: it can only be voided.
 *   - A generated document becomes SIGNED only by uploading its signed copy (`viaSignedUpload`).
 */
export function statusChangeProblem(from: string, to: string, opts: { source?: string; viaSignedUpload?: boolean } = {}): string | null {
  if (from === to) return null
  if (from === "VOID") return "A void document can't change status. Void is final."
  if (from === "SIGNED" && to !== "VOID") return "A signed document is locked. It can only be voided."
  if (to === "SIGNED" && opts.source !== "UPLOADED" && !opts.viaSignedUpload) return "Upload the signed copy to mark this document signed."
  if (to === "SIGNED" && opts.viaSignedUpload && from !== "FINAL" && from !== "SENT") return "Only a final or sent document can get its signed copy."
  return null
}

/** Why a document can't get a new version (edit, GIDEON, upload, restore, PDF remake), or null. */
export function lockProblem(status: string): string | null {
  if (status === "SIGNED") return "A signed document is locked: no more edits."
  return null
}

/** Voiding gives the number back only when the document holds a series number and was never signed — a
 *  number that is on a signed paper is never printed again. */
export function releasesNumberOnVoid(doc: { documentNumberId: string | null; signedAt: Date | string | null; status: string }): boolean {
  return !!doc.documentNumberId && !doc.signedAt && doc.status !== "SIGNED"
}

/**
 * The next running number of a counter: the lowest number a voided document gave back, else max + 1
 * (owner, 14 Oct 2026). `rows`: every number of the counter, with whether it is released.
 */
export function pickSeq(rows: { seq: number; released: boolean }[]): { seq: number; reuse: boolean } {
  let lowestFree = Infinity
  let max = 0
  for (const r of rows) {
    if (r.released && r.seq < lowestFree) lowestFree = r.seq
    if (r.seq > max) max = r.seq
  }
  return Number.isFinite(lowestFree) ? { seq: lowestFree, reuse: true } : { seq: max + 1, reuse: false }
}

/** The printed number of a parent's n-th addendum. */
export const addendumNumber = (parentNumber: string, n: number) => `${parentNumber}/ADD-${n}`

const KE_WORDS = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"]

/** 1 → "Pertama", 2 → "Kedua", 12 → "Kedua Belas", 21 → "Kedua Puluh Satu" (for "ADDENDUM KEDUA"). */
export function ordinalWord(n: number): string {
  if (n === 1) return "Pertama"
  const words = (k: number): string => {
    if (k < 12) return KE_WORDS[k]
    if (k < 20) return `${KE_WORDS[k - 10]} belas`
    if (k < 100) return `${KE_WORDS[Math.floor(k / 10)]} puluh${k % 10 ? ` ${KE_WORDS[k % 10]}` : ""}`
    return String(k)
  }
  const w = `ke${words(n)}`
  return w.replace(/(^|\s)\p{Ll}/gu, (m) => m.toUpperCase())
}

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

// ── File names (owner, 14 Oct 2026) ─────────────────────────────────────────────────────────────────
// Only the file NAME carries the revision; nothing is printed inside the document:
//   "<number> - <title> REV 2.pdf"  a saved version of a document that is not final yet (REV = version)
//   "<number> - <title> FINAL.pdf"  the final version, once the status is FINAL, SENT or SIGNED
//   "<number> - <title> SIGNED.pdf" the uploaded signed copy

const FINAL_OR_LATER = new Set(["FINAL", "SENT", "SIGNED"])

export function revisionLabel(doc: { status: string; currentVersion: number; finalVersion: number | null; signedVersion: number | null }, version: number): string {
  if (doc.signedVersion && version === doc.signedVersion) return "SIGNED"
  if (FINAL_OR_LATER.has(doc.status)) {
    const final = doc.finalVersion ?? (doc.signedVersion ? doc.signedVersion - 1 : doc.currentVersion)
    if (version === final) return "FINAL"
  }
  return `REV ${version}`
}

/** "PKS/PATS/2026/001" + "Kontrak Venue" + "REV 2" → "PKS-PATS-2026-001 - Kontrak Venue REV 2" (no extension). */
export function downloadBaseName(number: string, title: string, label: string): string {
  const head = number ? `${number.replace(/\//g, "-")} - ` : ""
  const name = `${head}${title}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 140)
  return `${name || "document"} ${label}`
}
