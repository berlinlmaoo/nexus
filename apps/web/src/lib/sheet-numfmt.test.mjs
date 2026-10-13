// node --experimental-strip-types src/lib/sheet-numfmt.test.mjs   (from apps/web)
//
// Number formats: Sheets custom pattern syntax (sections, colours, conditions, digits, scaling,
// scientific, fractions, text, dates/times/durations) in both display locales, the explicit
// Format › Number kinds of formatWithStyle, locale-aware input parsing, the menu list, currencies and
// the date-pattern chip model.
import assert from "node:assert/strict"

const F = await import("./sheet-formula.ts")
const N = await import("./sheet-numfmt.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }
const fp = (v, p, loc = "id-ID") => N.formatPattern(v, p, loc).text
const col = (v, p, loc = "id-ID") => N.formatPattern(v, p, loc).color

// ── Digits, grouping, decimals (id-ID output) ───────────────────────────────────────────────────
eq(fp(1234.56, "0"), "1235", "0 rounds")
eq(fp(1234.56, "0.00"), "1234,56", "two decimals, Indonesian comma")
eq(fp(1234.56, "#,##0"), "1.235", "grouping")
eq(fp(1234.56, "#,##0.00"), "1.234,56", "grouping + decimals")
eq(fp(5, "000"), "005", "zero padding")
eq(fp(5, "???"), "  5", "space padding")
eq(fp(1.5, "0.##"), "1,5", "# drops trailing zeros")
eq(fp(0.5, ".00"), ",50", "no integer placeholder")
eq(fp(1500000, "#,##0,"), "1.500", "trailing comma scales by 1000")
eq(fp(1500000, '#,##0,,"M"'), "2M", "two commas scale by a million")
eq(fp(1.005, "0.00"), "1,01", "decimal rounding is not binary-floored")
eq(fp(-5, "0"), "-5", "one section: minus sign")
eq(fp(-1234.56, "$#,##0"), "-$1.235", "minus before the currency literal")

// ── Sections, colours, conditions ───────────────────────────────────────────────────────────────
eq(fp(1234.56, "#,##0_);(#,##0)"), "1.235 ", "_) pads like the closing bracket")
eq(fp(-1234.56, "#,##0_);(#,##0)"), "(1.235)", "negative section, no minus")
eq(fp(-1234.56, "#,##0_);[Red](#,##0)"), "(1.235)", "red negative text")
eq(col(-1234.56, "#,##0_);[Red](#,##0)"), "#ff0000", "red negative colour")
eq(col(1234.56, "#,##0_);[Red](#,##0)"), undefined, "positive has no colour")
eq(col(5, "[Blue]0"), "#0000ff", "[Blue]")
eq(col(5, "[Color10]0"), "#008000", "[Color10] from the 56 palette")
eq(fp(0, "0;-0;\"zero\""), "zero", "zero section")
eq(fp(0, "0;-0;;@"), "", "empty zero section")
eq(fp(0, "0.0;(0.0)"), "0,0", "two sections: zero uses the first")
eq(fp(1500000, '[>=1000]#,##0,"K";0'), "1.500K", "condition section")
eq(fp(500, '[>=1000]#,##0,"K";0'), "500", "condition falls through")
eq(fp(1234.56, "$#,##0.00_);($#,##0.00)"), "$1.234,56 ", "dollar preset")
eq(fp(1234.56, "[$€-407]#,##0.00"), "€1.234,56", "[$€] currency literal")
eq(fp(1234.56, '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)'), " $ 1.235 ", "accounting preset")
eq(fp(0, '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)'), " $ - ", "accounting zero dash")
eq(fp("abc", '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)'), " abc ", "accounting text section")

// ── Percent, scientific, fractions ──────────────────────────────────────────────────────────────
eq(fp(0.1234, "0%"), "12%", "percent")
eq(fp(0.1234, "0.00%"), "12,34%", "percent with decimals")
eq(fp(1234.56, "0.00E+00"), "1,23E+03", "scientific")
eq(fp(0.00123, "0.00E+00"), "1,23E-03", "negative exponent")
eq(fp(1234.56, "##0.0E+0"), "1,2E+3", "engineering exponent")
eq(fp(0, "0.00E+00"), "0,00E+00", "scientific zero")
eq(fp(1234.56, "# ?/?"), "1234 5/9", "fraction, one digit")
eq(fp(1234.56, "# ??/??"), "1234 14/25", "fraction, two digits")
eq(fp(0.75, "?/?"), "3/4", "improper fraction")
eq(fp(1.5, "# ?/8"), "1 4/8", "fixed denominator")
eq(fp(3, "# ?/?"), "3", "whole number drops the fraction")

// ── Text ────────────────────────────────────────────────────────────────────────────────────────
eq(fp("abc", '0;-0;0;"[" @ "]"'), "[ abc ]", "text section")
eq(fp("abc", "0.00"), "abc", "text without a text section is unchanged")
eq(fp(12, "@"), "12", "@ shows a number as plain text")
eq(fp(true, "0"), "TRUE", "booleans")
eq(fp(null, "0"), "", "empty")

// ── Dates, times, durations ─────────────────────────────────────────────────────────────────────
const D = N.DATE_SAMPLE // 1930-08-05 13:25:59, a Tuesday
eq(fp(D, "yyyy-mm-dd"), "1930-08-05", "ISO date")
eq(fp(D, "dd/mm/yyyy"), "05/08/1930", "day first")
eq(fp(D, "m/d/yy"), "8/5/30", "short US date")
eq(fp(D, "d-mmm"), "5-Agu", "Indonesian short month")
eq(fp(D, "dddd, dd mmmm yyyy"), "Selasa, 05 Agustus 1930", "Indonesian weekday + month")
eq(fp(D, "ddd mmmmm"), "Sel A", "short weekday, month initial")
eq(fp(D, "hh.mm.ss"), "13.25.59", "Indonesian time")
eq(fp(D, "h:mm:ss AM/PM"), "1:25:59 PM", "12-hour clock")
eq(fp(D, "h:mm a/p"), "1:25 p", "a/p lower case")
eq(fp(D, "mm:ss"), "25:59", "m before s is minutes")
eq(fp(D, 'dddd, dd mmmm yyyy "pukul" hh.mm.ss'), "Selasa, 05 Agustus 1930 pukul 13.25.59", "literal word")
eq(fp(1 + 1 / 1440, "[h]:mm:ss"), "24:01:00", "elapsed hours")
eq(fp(90 / 86400, "[mm]:ss"), "01:30", "elapsed minutes")
eq(fp(-0.5 / 24, "[h]:mm"), "-0:30", "negative duration")
eq(fp(3661.25 / 86400, "hh:mm:ss.000"), "01:01:01.250", "fractional seconds")
eq(fp(5, '0 "days"'), "5 days", "quoted words keep a number section numeric")

// ── en-US output ────────────────────────────────────────────────────────────────────────────────
eq(fp(1234.56, "#,##0.00", "en-US"), "1,234.56", "en grouping")
eq(fp(0.1234, "0.0%", "en-US"), "12.3%", "en percent")
eq(fp(1234.56, "0.00E+00", "en-US"), "1.23E+03", "en scientific")
eq(fp(D, "dddd, mmmm d, yyyy", "en-US"), "Tuesday, August 5, 1930", "en names")
eq(fp(D, "d mmm", "en-US"), "5 Aug", "en short month")
eq(F.getDisplayLocale(), "id-ID", "formatPattern restores the locale")

// ── formatWithStyle: every kind, both locales ───────────────────────────────────────────────────
const DT = F.ymdToSerial(2008, 9, 26) + (15 * 3600 + 59 * 60) / 86400
const ws = (v, nf, dp, pt) => F.formatWithStyle(v, nf, dp, null, pt)
eq(ws(1000.12, "num"), "1.000,12", "num")
eq(ws(0.1012, "pct"), "10,12%", "pct")
eq(ws(1010, "sci"), "1,01E+03", "sci")
eq(ws(1010, "sci", 1), "1,0E+03", "sci with one decimal")
eq(ws(-1000.12, "acct"), "Rp (1.000,12)", "acct negative")
eq(ws(1000.12, "acct"), "Rp 1.000,12 ", "acct positive")
eq(ws(-1000.12, "fin"), "(1.000,12)", "fin negative")
eq(ws(1000, "fin"), "1.000,00", "fin fixed decimals")
eq(ws(1000.12, "cur"), "Rp1.000,12", "cur")
eq(ws(-5, "cur"), "-Rp5,00", "cur negative")
eq(ws(1000.12, "cur0"), "Rp1.000", "cur0")
eq(ws(1500000, "idr", 0), "Rp 1.500.000", "idr unchanged")
eq(ws(DT, "date"), "26/09/2008", "date")
eq(ws(DT, "time"), "15.59.00", "time")
eq(ws(DT, "dt"), "26/09/2008 15.59.00", "date time")
eq(ws(1 + 1 / 1440, "dur"), "24:01:00", "duration")
eq(ws(2.25, "custom", undefined, "0.0"), "2,3", "custom pattern")
eq(ws(2.25, "custom"), null, "custom without a pattern")
eq(ws("abc", "custom", undefined, '0;0;0;"x"@'), "xabc", "custom text section formats text")
eq(ws("abc", "custom", undefined, "0.00"), null, "custom number pattern leaves text alone")
F.setDisplayLocale("en-US")
eq(ws(1000.12, "num"), "1,000.12", "en num")
eq(ws(0.1012, "pct"), "10.12%", "en pct")
eq(ws(1010, "sci"), "1.01E+03", "en sci")
eq(ws(-1000.12, "acct"), "$ (1,000.12)", "en acct")
eq(ws(-1000.12, "fin"), "(1,000.12)", "en fin")
eq(ws(1000.12, "cur"), "$1,000.12", "en cur")
eq(ws(1000.12, "cur0"), "$1,000", "en cur0")
eq(ws(DT, "date"), "9/26/2008", "en date")
eq(ws(DT, "time"), "3:59:00 PM", "en time")
eq(ws(DT, "dt"), "9/26/2008 15:59:00", "en date time")
eq(ws(1 + 1 / 1440, "dur"), "24:01:00", "en duration")
eq(F.formatDateSerial(46306), "Oct 11, 2026", "en date column")
eq(F.decimalsShown("1,500.25"), 2, "en decimals shown")

// ── en-US input parsing ─────────────────────────────────────────────────────────────────────────
eq(F.detectInput("1,500.25"), { kind: "number", v: 1500.25, nf: "num" }, "en grouped decimal")
eq(F.detectInput("0.256"), { kind: "number", v: 0.256, nf: "num" }, "en decimal")
eq(F.detectInput("1.5"), { kind: "number", v: 1.5, nf: "num" }, "en lone dot")
eq(F.parseLocaleNumber("1,500")?.n, 1500, "en lone comma + 3 digits groups")
eq(F.parseLocaleNumber("1.500")?.n, 1.5, "en 1.500 is one and a half")
eq(F.detectInput("12.5%"), { kind: "number", v: 0.125, nf: "pct" }, "en percent")
eq(F.detectInput("9/26/2008"), { kind: "number", v: F.ymdToSerial(2008, 9, 26), nf: "date" }, "en month-first date")
eq(F.detectInput("26/9/2008"), { kind: "text", v: "26/9/2008" }, "en day-first is not a date")
eq(F.detectInput(F.editTyped({ v: 46306, nf: "date" })), { kind: "number", v: 46306, nf: "date" }, "en date round-trips")
F.setDisplayLocale("id-ID")
eq(F.detectInput("26/09/2008"), { kind: "number", v: F.ymdToSerial(2008, 9, 26), nf: "date" }, "id day-first again")
eq(F.parseLocaleNumber("1.500")?.n, 1500, "id 1.500 groups again")

// ── computeSheet: locale option + custom pattern ────────────────────────────────────────────────
{
  const cols = [{ id: "a", type: "text" }, { id: "b", type: "text" }]
  const rows = [{ id: "x", cells: { a: 1234.5, b: 1234.5 }, styles: { a: { nf: "num", dp: 2 }, b: { nf: "custom", pt: "#,##0.0" } } }]
  const en = F.computeSheet(cols, rows, { locale: "en-US" })
  eq(en.x.a.d, "1,234.50", "computeSheet in en-US")
  eq(en.x.b.d, "1,234.5", "custom pattern in en-US")
  eq(F.getDisplayLocale(), "id-ID", "computeSheet restores the locale")
  eq(F.computeSheet(cols, rows).x.b.d, "1.234,5", "custom pattern in id-ID")
}

// ── Menu list, presets, currencies, date chips ──────────────────────────────────────────────────
{
  const id = N.numberFormatItems("id-ID")
  const ex = (items, key) => items.find((i) => i.key === key)?.example
  eq(id.map((i) => i.key).join(","), "auto,text,sep,num,pct,sci,sep,acct,fin,cur,cur0,sep,date,time,dt,dur,sep,customCurrency,customDate,customNumber", "menu order")
  eq([ex(id, "num"), ex(id, "pct"), ex(id, "sci"), ex(id, "acct"), ex(id, "fin"), ex(id, "cur"), ex(id, "cur0")],
    ["1.000,12", "10,12%", "1,01E+03", "Rp (1.000,12)", "(1.000,12)", "Rp1.000,12", "Rp1.000"], "id number examples")
  eq([ex(id, "date"), ex(id, "time"), ex(id, "dt"), ex(id, "dur")], ["26/09/2008", "15.59.00", "26/09/2008 15.59.00", "24:01:00"], "id date examples")
  const en = N.numberFormatItems("en-US")
  eq([ex(en, "num"), ex(en, "acct"), ex(en, "cur"), ex(en, "date"), ex(en, "time")], ["1,000.12", "$ (1,000.12)", "$1,000.12", "9/26/2008", "3:59:00 PM"], "en examples")
  eq(N.NUMBER_PRESETS.length >= 20, true, "custom number presets")
  eq(fp(N.NUMBER_SAMPLE, "0.00E+00"), "1,23E+03", "preset sample")
}
eq(N.currencyPattern("IDR"), '"Rp"#,##0', "Rupiah has no decimals")
eq(fp(1000.12, N.currencyPattern("IDR")), "Rp1.000", "Rupiah sample")
eq(fp(1000.12, N.currencyPattern("USD")), "$1.000,12", "dollar sample in id-ID")
eq(fp(1000.12, N.currencyPattern("KWD")), "din1.000,120", "three-decimal dinar")
eq(fp(1000.12, N.currencyPattern("JPY")), "¥1.000", "yen")
eq(fp(-5, N.currencyPattern("USD", "symbolParen")), "($5,00)", "brackets variant")
eq(col(-5, N.currencyPattern("USD", "symbolRed")), "#ff0000", "red variant")
eq(fp(1000, N.currencyPattern("EUR", "symbolAfter")), "1.000,00 €", "symbol after")
eq(fp(1000, N.currencyPattern("IDR", "code")), "IDR 1.000", "code variant")
eq(N.CURRENCIES.length >= 40, true, "currency list")
eq(new Set(N.CURRENCIES.map((c) => c.code)).size, N.CURRENCIES.length, "currency codes unique")
{
  const parts = N.parseDatePattern("yyyy-mm-dd")
  eq(parts.map((p) => (p.kind === "token" ? p.field : p.text)), ["year", "-", "month", "-", "day"], "date chips")
  eq(N.joinDatePattern(parts), "yyyy-mm-dd", "chips round-trip")
  eq(N.parseDatePattern("hh:mm").map((p) => (p.kind === "token" ? p.field : p.text)), ["hour", ":", "minute"], "minute after hour")
  eq(N.joinDatePattern([{ kind: "token", field: "weekday", code: "dddd" }, { kind: "lit", text: " pukul " }, { kind: "token", field: "hour", code: "hh" }]), 'dddd" pukul "hh', "word literals are quoted")
  eq(N.datePartSample("month", "mmm"), "Agu", "chip sample month")
  eq(N.datePartSample("minute", "mm"), "25", "chip sample minute")
  eq(N.datePartSample("year", "yyyy"), "1930", "chip sample year")
  eq(N.datePresets("id-ID").map((p) => fp(D, p)).includes("Selasa, 05 Agustus 1930 pukul 13.25.59"), true, "id presets")
}

console.log(`sheet-numfmt: ${n} checks passed`)
