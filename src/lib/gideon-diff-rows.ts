/**
 * QA final 19 Oct 2026 (D-10): a GIDEON card drew "Penjualan ~~Rp 120.000.000~~ → Rp 120.000.000" — a "change"
 * whose before equals its after. Rows with a `from` are the card's before → after rows; rows without one are
 * context (Project, Date, Recipient…). A before → after row whose two sides are the same (ignoring spacing and an
 * empty vs "—" side) is left out. When the card had before → after rows and every one of them was equal, and no
 * other row describes something new, Apply would change nothing: `noChange` (clients say so on the card).
 */
type Row = { field: string; from?: string | null; to?: string | null; fromDay?: string | null; toDay?: string | null }

/** Rows that only say where/what (never a change by themselves). */
const CONTEXT_FIELDS = new Set(["project", "date", "dates", "event", "platform", "task", "deal", "sheet", "chat", "recipient", "from", "to", "board"])

const norm = (v: string | null | undefined) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim()
  return s === "—" || s === "-" ? "" : s
}

export function changedDiffRows<T extends Row>(diff: T[]): { rows: T[]; noChange: boolean } {
  let compared = 0
  let same = 0
  const rows = diff.filter((r) => {
    if (r.from === undefined || r.from === null) return true
    compared++
    const eq = norm(r.from) === norm(r.to) && (r.fromDay ?? null) === (r.toDay ?? r.fromDay ?? null)
    if (eq) same++
    return !eq
  })
  const noChange = compared > 0 && same === compared && rows.every((r) => CONTEXT_FIELDS.has(r.field.trim().toLowerCase()))
  return { rows, noChange }
}
