/**
 * Dates a ticket names in its own words — "PRESENCE OUT 15 SEPT 26", "tanggal 21", "3 September",
 * "2026-09-13", "13/9". Used as a fence around GIDEON: a proposal it files must be for one of these
 * days when the ticket names any. On 16 Sep 2026 it proposed for the FILING date (16) on a ticket
 * titled 15 SEPT, a BoD approved it, and 120 XP went back for the wrong day.
 *
 * Best effort by design: anything not recognised is simply not a fence. The fence only ever REFUSES
 * a mismatch; it never picks the date for the model.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, aug: 8, ags: 8,
  sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
}

function daysIn(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function key(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/** `ref` = the day the ticket was filed, as YYYY-MM-DD in the attendance timezone. */
export function extractExplicitDates(text: string, ref: string): string[] {
  const out = new Set<string>()
  const [ry, rm, rd] = ref.split("-").map(Number)
  const t = (text || "").toLowerCase()

  // 2026-09-15
  for (const m of t.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
    const k = key(Number(m[1]), Number(m[2]), Number(m[3])); if (k) out.add(k)
  }
  // 15 sept 26 · 15 september 2026 · 3 sep
  for (const m of t.matchAll(/\b(\d{1,2})\s*(jan|feb|mar|apr|mei|may|jun|jul|agu|aug|ags|sep|okt|oct|nov|des|dec)[a-z]*\.?(?:\s+(\d{4}|\d{2})(?!\d))?/g)) {
    const d = Number(m[1]); const mo = MONTHS[m[2]]
    let y = ry
    if (m[3]) y = m[3].length === 4 ? Number(m[3]) : 2000 + Number(m[3])
    const k = key(y, mo, d); if (k) out.add(k)
  }
  // 15/9 · 15/09/26 · 15-9-2026 (day first, as written here)
  for (const m of t.matchAll(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}|\d{2})(?!\d))?\b/g)) {
    const d = Number(m[1]); const mo = Number(m[2])
    let y = ry
    if (m[3]) y = m[3].length === 4 ? Number(m[3]) : 2000 + Number(m[3])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { const k = key(y, mo, d); if (k) out.add(k) }
  }
  // tanggal 21 · tgl 3 — the ticket's own month; a day later than the filing day means last month
  for (const m of t.matchAll(/\b(?:tanggal|tgl)\.?\s*(\d{1,2})\b/g)) {
    const d = Number(m[1])
    let y = ry, mo = rm
    if (d > rd) { mo -= 1; if (mo === 0) { mo = 12; y -= 1 } }
    const k = key(y, mo, d); if (k) out.add(k)
  }
  return Array.from(out).sort()
}
