// Number formats for the spreadsheet: Format › Number (and the toolbar's "123" menu), the custom
// number / date-time / currency dialogs' presets, and the date-pattern chip model. Pure (no React);
// every example is rendered through sheet-formula's own formatter in the SHEET locale, so the grey
// sample next to a menu item is exactly what the cell will show. Tested in sheet-numfmt.test.mjs.
import {
  formatNumberPattern, formatWithStyle, getDisplayLocale, setDisplayLocale, ymdToSerial,
  type PatternResult,
} from "./sheet-formula.ts";
import type { NumberFormatKind, SheetLocaleCode } from "./sheet-model.ts";

/** Run `fn` with the display locale switched, restoring it after (formatting is module-global). */
export function withLocale<T>(locale: SheetLocaleCode, fn: () => T): T {
  const before = getDisplayLocale();
  setDisplayLocale(locale);
  try { return fn(); } finally { setDisplayLocale(before); }
}

/** A value under a Sheets custom number format, in `locale`. `color` is "#rrggbb" from [Red] etc. */
export function formatPattern(value: number | string | boolean | null, pattern: string, locale: SheetLocaleCode = "id-ID"): PatternResult {
  return withLocale(locale, () => formatNumberPattern(value, pattern));
}

// ── Format › Number menu ────────────────────────────────────────────────────────────────────────

export type NumberFormatMenuKey = NumberFormatKind | "customCurrency" | "customDate" | "customNumber" | "sep";
export type NumberFormatItem = { key: NumberFormatMenuKey; /** English source text for t() */ label: string; example: string };

const SAMPLE_NUM = 1000.12;
/** 26 Sep 2008 15:59:00 — Sheets' own sample. */
const SAMPLE_DT = ymdToSerial(2008, 9, 26) + (15 * 3600 + 59 * 60) / 86400;
/** 24:01:00 */
const SAMPLE_DUR = 1 + 1 / 1440;

/** Sheets' Format › Number list, in order, with right-aligned examples in the sheet locale. */
export function numberFormatItems(locale: SheetLocaleCode = "id-ID"): NumberFormatItem[] {
  return withLocale(locale, () => {
    const ex = (nf: NumberFormatKind, v: number) => (formatWithStyle(v, nf, undefined) ?? "").trim();
    const sep: NumberFormatItem = { key: "sep", label: "", example: "" };
    return [
      { key: "auto", label: "Automatic", example: "" },
      { key: "text", label: "Plain text", example: "" },
      sep,
      { key: "num", label: "Number", example: ex("num", SAMPLE_NUM) },
      { key: "pct", label: "Percent", example: ex("pct", 0.1012) },
      { key: "sci", label: "Scientific", example: ex("sci", 1010) },
      sep,
      { key: "acct", label: "Accounting", example: ex("acct", -SAMPLE_NUM) },
      { key: "fin", label: "Financial", example: ex("fin", -SAMPLE_NUM) },
      { key: "cur", label: "Currency", example: ex("cur", SAMPLE_NUM) },
      { key: "cur0", label: "Currency rounded", example: ex("cur0", SAMPLE_NUM) },
      sep,
      { key: "date", label: "Date", example: ex("date", SAMPLE_DT) },
      { key: "time", label: "Time", example: ex("time", SAMPLE_DT) },
      { key: "dt", label: "Date time", example: ex("dt", SAMPLE_DT) },
      { key: "dur", label: "Duration", example: ex("dur", SAMPLE_DUR) },
      sep,
      { key: "customCurrency", label: "Custom currency", example: "" },
      { key: "customDate", label: "Custom date and time", example: "" },
      { key: "customNumber", label: "Custom number format", example: "" },
    ];
  });
}

// ── Custom number format presets (inventory 4.21) ───────────────────────────────────────────────

/** The sample the custom number dialog renders each preset with. */
export const NUMBER_SAMPLE = 1234.56;
export const NUMBER_PRESETS: string[] = [
  "0",
  "0.00",
  "#,##0",
  "#,##0.00",
  "#,##0_);(#,##0)",
  "#,##0_);[Red](#,##0)",
  "#,##0.00_);(#,##0.00)",
  "#,##0.00_);[Red](#,##0.00)",
  "$#,##0_);($#,##0)",
  "$#,##0_);[Red]($#,##0)",
  "$#,##0.00_);($#,##0.00)",
  "$#,##0.00_);[Red]($#,##0.00)",
  "@",
  "0%",
  "0.00%",
  "0.00E+00",
  "##0.0E+0",
  "# ?/?",
  "# ??/??",
  '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)',
  '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
  '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
  '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)',
];

// ── Date/time presets and the chip model ────────────────────────────────────────────────────────

/** 5 Aug 1930 13:25:59 (a Tuesday) — the sample of the date/time dialog. */
export const DATE_SAMPLE = ymdToSerial(1930, 8, 5) + (13 * 3600 + 25 * 60 + 59) / 86400;

/** The date/time dialog's preset list (Sheets' order); the last one carries a localized "at". */
export function datePresets(locale: SheetLocaleCode = "id-ID"): string[] {
  return [
    "yyyy-mm-dd",
    "mm-dd-yyyy",
    "m/d/yy",
    "mm-dd-yy",
    "m/d",
    "mm-dd",
    "d-mmm",
    "dd-mmm-yyyy",
    "mmmm d yyyy",
    "mmmm d, yyyy",
    "dd/mm/yyyy",
    "d mmm yyyy",
    "dddd, dd mmmm yyyy",
    "dddd",
    "h:mm:ss AM/PM",
    "h:mm AM/PM",
    "hh:mm",
    "hh:mm:ss",
    "hh.mm.ss",
    "[h]:mm:ss",
    "yyyy-mm-dd hh:mm:ss",
    "dd/mm/yyyy hh.mm.ss",
    locale === "en-US" ? 'dddd, mmmm d, yyyy "at" h:mm:ss AM/PM' : 'dddd, dd mmmm yyyy "pukul" hh.mm.ss',
  ];
}
export const DATE_PRESETS: string[] = datePresets("id-ID");

export type DateField = "year" | "month" | "day" | "weekday" | "hour" | "minute" | "second" | "ampm" | "elapsedH" | "elapsedM" | "elapsedS";
export type DatePart = { kind: "token"; field: DateField; code: string } | { kind: "lit"; text: string };

/** Each field's English label (for t()) and its representations, in the dropdown's order. */
export const DATE_FIELDS: { field: DateField; label: string; codes: string[] }[] = [
  { field: "year", label: "Year", codes: ["yyyy", "yy"] },
  { field: "month", label: "Month", codes: ["m", "mm", "mmm", "mmmm", "mmmmm"] },
  { field: "day", label: "Day", codes: ["d", "dd"] },
  { field: "weekday", label: "Day of week", codes: ["ddd", "dddd"] },
  { field: "hour", label: "Hour", codes: ["h", "hh"] },
  { field: "minute", label: "Minute", codes: ["m", "mm"] },
  { field: "second", label: "Second", codes: ["s", "ss"] },
  { field: "ampm", label: "AM/PM", codes: ["AM/PM", "A/P"] },
  { field: "elapsedH", label: "Elapsed hours", codes: ["[h]", "[hh]"] },
  { field: "elapsedM", label: "Elapsed minutes", codes: ["[m]", "[mm]"] },
  { field: "elapsedS", label: "Elapsed seconds", codes: ["[s]", "[ss]"] },
];

/** A date pattern as chips + literal separators ("yyyy-mm-dd" → Year, "-", Month, "-", Day). */
export function parseDatePattern(pattern: string): DatePart[] {
  const raw: DatePart[] = [];
  const lit = (s: string) => {
    const last = raw[raw.length - 1];
    if (last && last.kind === "lit") last.text += s;
    else raw.push({ kind: "lit", text: s });
  };
  const re = /"([^"]*)"|\\(.)|\[(h+|m+|s+)\]|(am\/pm|a\/p)|(y+|m+|d+|h+|s+)|([\s\S])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern))) {
    if (m[1] !== undefined) lit(m[1]);
    else if (m[2] !== undefined) lit(m[2]);
    else if (m[3]) {
      const u = m[3][0].toLowerCase();
      raw.push({ kind: "token", field: u === "h" ? "elapsedH" : u === "m" ? "elapsedM" : "elapsedS", code: `[${m[3].toLowerCase()}]` });
    } else if (m[4]) raw.push({ kind: "token", field: "ampm", code: m[4].length > 3 ? "AM/PM" : "A/P" });
    else if (m[5]) {
      const code = m[5].toLowerCase();
      const c = code[0];
      const field: DateField = c === "y" ? "year" : c === "d" ? (code.length >= 3 ? "weekday" : "day") : c === "h" ? "hour" : c === "s" ? "second" : "month";
      raw.push({ kind: "token", field, code: c === "y" ? (code.length <= 2 ? "yy" : "yyyy") : code });
    } else lit(m[6]);
  }
  // "m"/"mm" right after an hour or right before a second are minutes.
  const toks = raw.filter((p): p is Extract<DatePart, { kind: "token" }> => p.kind === "token");
  toks.forEach((t, i) => {
    if (t.field !== "month" || t.code.length > 2) return;
    const prev = toks[i - 1], next = toks[i + 1];
    if ((prev && (prev.field === "hour" || prev.field === "elapsedH")) || (next && (next.field === "second" || next.field === "elapsedS"))) t.field = "minute";
  });
  return raw;
}

/** Chips back to a pattern; literals that contain letters/digits are quoted. */
export function joinDatePattern(parts: DatePart[]): string {
  return parts.map((p) => {
    if (p.kind === "token") return p.code;
    if (!p.text) return "";
    return /^[\s\-/:.,()]*$/.test(p.text) ? p.text : `"${p.text.replace(/"/g, "")}"`;
  }).join("");
}

/** How one chip renders the sample ("Bulan (08)"): minutes and months share codes, so render in context. */
export function datePartSample(field: DateField, code: string, locale: SheetLocaleCode = "id-ID", sample = DATE_SAMPLE): string {
  if (field === "minute") return formatPattern(sample, `h:${code}`, locale).text.split(":")[1] ?? "";
  if (field === "hour" && code.length === 1) return formatPattern(sample, "h", locale).text;
  return formatPattern(sample, code, locale).text;
}

// ── Currencies (ISO 4217 minor units) ───────────────────────────────────────────────────────────

export type Currency = { code: string; nameEn: string; nameId: string; symbol: string; decimals: number };
export const CURRENCIES: Currency[] = [
  { code: "IDR", nameEn: "Indonesian Rupiah", nameId: "Rupiah Indonesia", symbol: "Rp", decimals: 0 },
  { code: "USD", nameEn: "US Dollar", nameId: "Dolar AS", symbol: "$", decimals: 2 },
  { code: "EUR", nameEn: "Euro", nameId: "Euro", symbol: "€", decimals: 2 },
  { code: "SGD", nameEn: "Singapore Dollar", nameId: "Dolar Singapura", symbol: "S$", decimals: 2 },
  { code: "MYR", nameEn: "Malaysian Ringgit", nameId: "Ringgit Malaysia", symbol: "RM", decimals: 2 },
  { code: "JPY", nameEn: "Japanese Yen", nameId: "Yen Jepang", symbol: "¥", decimals: 0 },
  { code: "GBP", nameEn: "British Pound", nameId: "Pound Inggris", symbol: "£", decimals: 2 },
  { code: "AUD", nameEn: "Australian Dollar", nameId: "Dolar Australia", symbol: "A$", decimals: 2 },
  { code: "CNY", nameEn: "Chinese Yuan", nameId: "Yuan Tiongkok", symbol: "CN¥", decimals: 2 },
  { code: "KRW", nameEn: "South Korean Won", nameId: "Won Korea Selatan", symbol: "₩", decimals: 0 },
  { code: "THB", nameEn: "Thai Baht", nameId: "Baht Thailand", symbol: "฿", decimals: 2 },
  { code: "INR", nameEn: "Indian Rupee", nameId: "Rupee India", symbol: "₹", decimals: 2 },
  { code: "KWD", nameEn: "Kuwaiti Dinar", nameId: "Dinar Kuwait", symbol: "din", decimals: 3 },
  { code: "HKD", nameEn: "Hong Kong Dollar", nameId: "Dolar Hong Kong", symbol: "HK$", decimals: 2 },
  { code: "TWD", nameEn: "New Taiwan Dollar", nameId: "Dolar Taiwan Baru", symbol: "NT$", decimals: 2 },
  { code: "PHP", nameEn: "Philippine Peso", nameId: "Peso Filipina", symbol: "₱", decimals: 2 },
  { code: "VND", nameEn: "Vietnamese Dong", nameId: "Dong Vietnam", symbol: "₫", decimals: 0 },
  { code: "BND", nameEn: "Brunei Dollar", nameId: "Dolar Brunei", symbol: "B$", decimals: 2 },
  { code: "NZD", nameEn: "New Zealand Dollar", nameId: "Dolar Selandia Baru", symbol: "NZ$", decimals: 2 },
  { code: "CAD", nameEn: "Canadian Dollar", nameId: "Dolar Kanada", symbol: "CA$", decimals: 2 },
  { code: "CHF", nameEn: "Swiss Franc", nameId: "Franc Swiss", symbol: "CHF", decimals: 2 },
  { code: "SAR", nameEn: "Saudi Riyal", nameId: "Riyal Saudi", symbol: "SR", decimals: 2 },
  { code: "AED", nameEn: "UAE Dirham", nameId: "Dirham Uni Emirat Arab", symbol: "AED", decimals: 2 },
  { code: "QAR", nameEn: "Qatari Riyal", nameId: "Riyal Qatar", symbol: "QR", decimals: 2 },
  { code: "BHD", nameEn: "Bahraini Dinar", nameId: "Dinar Bahrain", symbol: "din", decimals: 3 },
  { code: "OMR", nameEn: "Omani Rial", nameId: "Rial Oman", symbol: "Rial", decimals: 3 },
  { code: "TRY", nameEn: "Turkish Lira", nameId: "Lira Turki", symbol: "₺", decimals: 2 },
  { code: "RUB", nameEn: "Russian Ruble", nameId: "Rubel Rusia", symbol: "₽", decimals: 2 },
  { code: "BRL", nameEn: "Brazilian Real", nameId: "Real Brasil", symbol: "R$", decimals: 2 },
  { code: "MXN", nameEn: "Mexican Peso", nameId: "Peso Meksiko", symbol: "MX$", decimals: 2 },
  { code: "ZAR", nameEn: "South African Rand", nameId: "Rand Afrika Selatan", symbol: "R", decimals: 2 },
  { code: "EGP", nameEn: "Egyptian Pound", nameId: "Pound Mesir", symbol: "E£", decimals: 2 },
  { code: "PKR", nameEn: "Pakistani Rupee", nameId: "Rupee Pakistan", symbol: "Rs", decimals: 2 },
  { code: "BDT", nameEn: "Bangladeshi Taka", nameId: "Taka Bangladesh", symbol: "৳", decimals: 2 },
  { code: "LKR", nameEn: "Sri Lankan Rupee", nameId: "Rupee Sri Lanka", symbol: "Rs", decimals: 2 },
  { code: "SEK", nameEn: "Swedish Krona", nameId: "Krona Swedia", symbol: "kr", decimals: 2 },
  { code: "NOK", nameEn: "Norwegian Krone", nameId: "Krone Norwegia", symbol: "kr", decimals: 2 },
  { code: "DKK", nameEn: "Danish Krone", nameId: "Krone Denmark", symbol: "kr", decimals: 2 },
  { code: "PLN", nameEn: "Polish Zloty", nameId: "Zloty Polandia", symbol: "zł", decimals: 2 },
  { code: "ILS", nameEn: "Israeli New Shekel", nameId: "Shekel Baru Israel", symbol: "₪", decimals: 2 },
  { code: "MMK", nameEn: "Myanmar Kyat", nameId: "Kyat Myanmar", symbol: "K", decimals: 2 },
  { code: "KHR", nameEn: "Cambodian Riel", nameId: "Riel Kamboja", symbol: "៛", decimals: 2 },
];

/** The custom currency dialog's format dropdown: symbol position, decimals, negative style. */
export const CURRENCY_VARIANTS = ["symbol", "symbolRounded", "symbolParen", "symbolRed", "symbolAfter", "code"] as const;
export type CurrencyVariant = (typeof CURRENCY_VARIANTS)[number];

/** The Sheets pattern for a currency in a variant ("IDR" → "\"Rp\"#,##0"). Unknown codes use the code as symbol. */
export function currencyPattern(code: string, variant: CurrencyVariant = "symbol"): string {
  const c = CURRENCIES.find((x) => x.code === code) ?? { code, symbol: code, decimals: 2 };
  const dec = variant === "symbolRounded" ? 0 : c.decimals;
  const num = `#,##0${dec ? "." + "0".repeat(dec) : ""}`;
  const sym = `"${c.symbol.replace(/"/g, "")}"`;
  switch (variant) {
    case "symbolParen": return `${sym}${num};(${sym}${num})`;
    case "symbolRed": return `${sym}${num};[Red]-${sym}${num}`;
    case "symbolAfter": return `${num} ${sym}`;
    case "code": return `"${c.code} "${num}`;
    default: return `${sym}${num}`;
  }
}
