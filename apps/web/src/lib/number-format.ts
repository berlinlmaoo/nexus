/**
 * How every number on screen reads, in both languages (owner, UI tour run 13): Indonesian dot grouping
 * ("2.597", "3.800 / 18.000"), Rupiah as "Rp 6.000.000" with a plain space after "Rp", and a true minus
 * sign ("−32") for negatives. English uses the same grouping: "Rp6,000,000" or "1,000" read like dollars.
 * The decimal mark follows the interface language (owner, 25 Oct 2026): "11,9" in Indonesian, "11.9" in
 * English. English keeps decimals only below 1.000, so a dot never means both things in one number.
 * Not for the Legal document engine, which keeps its own "Rp. 25.000.000,00".
 */

export type NumberLang = "id" | "en";
let numberLang: NumberLang = "id";
/** Set by lib/lang.ts whenever the interface language changes (kept here so this file imports nothing). */
export function setNumberLang(l: NumberLang) {
  numberLang = l;
}

/** The minus sign (U+2212), not the hyphen: it lines up with the digits in tabular figures. */
export const MINUS = "−";

const GROUPED = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const decimals = new Map<string, Intl.NumberFormat>();
function grouped(maxFractionDigits: number, lang: NumberLang): Intl.NumberFormat {
  if (maxFractionDigits === 0) return GROUPED;
  const key = `${lang}${maxFractionDigits}`;
  let f = decimals.get(key);
  if (!f) {
    // en-US with grouping off: only used below 1.000, where it is "11.9".
    f = lang === "en"
      ? new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits, useGrouping: false })
      : new Intl.NumberFormat("id-ID", { maximumFractionDigits: maxFractionDigits });
    decimals.set(key, f);
  }
  return f;
}

/**
 * "2.597", "−32", "1,5" / "1.5" (with fraction digits, by interface language). A whole number unless
 * `maxFractionDigits` says otherwise. `lang` defaults to the interface language.
 */
export function formatCount(n: number, maxFractionDigits = 0, lang: NumberLang = numberLang): string {
  const digits = lang === "en" && Math.abs(n) >= 999.5 ? 0 : maxFractionDigits;
  const f = grouped(digits, lang);
  // Rounding first: -0.2 must not print as "−0".
  const abs = f.format(Math.abs(n));
  return n < 0 && abs.replace(/[0.,]/g, "") !== "" ? `${MINUS}${abs}` : abs;
}

/** "+12", "−32", "0": a change, where the sign is the information. */
export function formatSigned(n: number, maxFractionDigits = 0, lang: NumberLang = numberLang): string {
  const s = formatCount(n, maxFractionDigits, lang);
  return n > 0 && s.replace(/[0.,]/g, "") !== "" ? `+${s}` : s;
}

/** "Rp 6.000.000", "−Rp 5.000". Whole Rupiah. */
export function formatRupiah(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? MINUS : ""}Rp ${GROUPED.format(Math.abs(r))}`;
}
