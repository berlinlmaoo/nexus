/**
 * How every number on screen reads, in both languages (owner, UI tour run 13): Indonesian dot grouping
 * ("2.597", "3.800 / 18.000"), Rupiah as "Rp 6.000.000" with a plain space after "Rp", and a true minus
 * sign ("−32") for negatives. English uses the same grouping: "Rp6,000,000" or "1,000" read like dollars.
 * Not for the Legal document engine, which keeps its own "Rp. 25.000.000,00".
 */

/** The minus sign (U+2212), not the hyphen: it lines up with the digits in tabular figures. */
export const MINUS = "−";

const GROUPED = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const decimals = new Map<number, Intl.NumberFormat>();
function grouped(maxFractionDigits: number): Intl.NumberFormat {
  if (maxFractionDigits === 0) return GROUPED;
  let f = decimals.get(maxFractionDigits);
  if (!f) {
    f = new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxFractionDigits });
    decimals.set(maxFractionDigits, f);
  }
  return f;
}

/** "2.597", "−32", "1,5" (with fraction digits). A whole number unless `maxFractionDigits` says otherwise. */
export function formatCount(n: number, maxFractionDigits = 0): string {
  const f = grouped(maxFractionDigits);
  // Rounding first: -0.2 must not print as "−0".
  const abs = f.format(Math.abs(n));
  return n < 0 && abs.replace(/[0.,]/g, "") !== "" ? `${MINUS}${abs}` : abs;
}

/** "+12", "−32", "0": a change, where the sign is the information. */
export function formatSigned(n: number, maxFractionDigits = 0): string {
  const s = formatCount(n, maxFractionDigits);
  return n > 0 && s.replace(/[0.,]/g, "") !== "" ? `+${s}` : s;
}

/** "Rp 6.000.000", "−Rp 5.000". Whole Rupiah. */
export function formatRupiah(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? MINUS : ""}Rp ${GROUPED.format(Math.abs(r))}`;
}
