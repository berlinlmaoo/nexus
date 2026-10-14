import { describe, expect, it } from "vitest"
import {
  BAR_COLORS,
  NUMBER_CURRENCIES,
  NUMBER_FORMATS,
  NUMBER_FORMAT_LABELS,
  filterNumberFormats,
  formatNumberField,
  formatNumberWith,
  normalizeNumberFieldValue,
  numberFieldFormat,
  numberFill,
  numberFormatLabel,
  numberOptions,
  numberOptionsToStore,
  rupiah,
  storedNumber,
  DEFAULT_NUMBER_OPTIONS,
  type NumberOptions,
} from "@/lib/custom-field-number"
import { normalizeCustomFieldOptions } from "@/lib/custom-fields"

const M = "−"
const opts = (numberFormat: string, decimals: number | null = null, extra: Partial<NumberOptions> = {}): NumberOptions => ({
  ...DEFAULT_NUMBER_OPTIONS,
  numberFormat,
  decimals,
  ...extra,
})
const fmt = (n: number, f: string, d: number | null = null) => formatNumberWith(n, opts(f, d))

describe("number formats: list and labels", () => {
  it("lists Notion's formats with Rupiah pinned under Percent and BTC last", () => {
    expect(NUMBER_FORMATS.slice(0, 5)).toEqual(["number", "number_with_separators", "percent", "IDR", "USD"])
    expect(NUMBER_FORMATS.at(-1)).toBe("BTC")
    expect(NUMBER_FORMATS.filter((f) => f === "IDR")).toHaveLength(1)
    expect(NUMBER_CURRENCIES).toHaveLength(41)
    for (const f of NUMBER_FORMATS) expect(NUMBER_FORMAT_LABELS[f], f).toBeTruthy()
  })
  it("short names for the Number format row, in both languages", () => {
    expect(numberFormatLabel("IDR", "en", true)).toBe("Rupiah")
    expect(numberFormatLabel("IDR", "en")).toBe("Rupiah (IDR)")
    expect(numberFormatLabel("percent", "id", true)).toBe("Persen")
    expect(numberFormatLabel("USD", "id")).toBe("Dolar AS (USD)")
    expect(numberFormatLabel("whatever", "en", true)).toBe("Number with separators")
  })
  it("Filter formats… is fuzzy, like Notion's 'rup'", () => {
    const r = filterNumberFormats("rup", "en")
    expect(r).toEqual(expect.arrayContaining(["INR", "IDR", "PKR", "UYU"]))
    expect(r).not.toContain("PEN")
    expect(filterNumberFormats("", "en")).toEqual([...NUMBER_FORMATS])
    expect(filterNumberFormats("dolar", "id")[0]).toBe("USD")
    expect(filterNumberFormats("persen", "id")).toEqual(["percent"])
    expect(filterNumberFormats("idr", "en")[0]).toBe("IDR")
    expect(filterNumberFormats("zzzz", "en")).toEqual([])
  })
})

describe("number formats: rendering (Indonesian grouping in every language)", () => {
  const cases: Array<[string, number | null, number, string]> = [
    // format, decimals, value, expected
    ["number", null, 1234567.891, "1.234.567,891"],
    ["number", 0, 1234567.891, "1.234.568"],
    ["number", 2, 42, "42,00"],
    ["number", 5, 0.5, "0,50000"],
    ["number", null, -1500.5, `${M}1.500,5`],
    ["number_with_separators", null, 1234567.891, "1.234.567,891"],
    ["number_with_separators", 1, -0.04, "0,0"],
    ["number_with_separators", 3, -2, `${M}2,000`],
    ["percent", null, 0.42, "42%"],
    ["percent", null, 0.4213, "42,13%"],
    ["percent", null, 0.07, "7%"],
    ["percent", 1, 0.42, "42,0%"],
    ["percent", null, 1234567.891, "123.456.789,1%"],
    ["percent", 0, -0.425, `${M}43%`],
    ["IDR", null, 1234567.891, "Rp 1.234.568"],
    ["IDR", 0, -1500.5, `${M}Rp 1.501`],
    ["IDR", 2, 1234567.891, "Rp 1.234.567,89"],
    ["IDR", 5, 42, "Rp 42,00000"],
    ["USD", null, 1234567.891, "US$1.234.567,89"],
    ["USD", 0, -1500.5, `${M}US$1.501`],
    ["EUR", null, 1234567.891, "€1.234.567,89"],
    ["EUR", 3, 1, "€1,000"],
    ["JPY", null, 1234567.891, "JP¥1.234.568"],
    ["JPY", 2, 5, "JP¥5,00"],
    ["BTC", null, 0.12345678, "₿0,12345678"],
    ["BTC", 5, 1234567.891, "₿1.234.567,89100"],
    ["BTC", null, -2, `${M}₿2`],
  ]
  it.each(cases)("%s, %s decimals: %s", (f, d, n, want) => {
    expect(fmt(n, f, d)).toBe(want)
  })
  it("every format × every decimals choice × sign gives a grouped, signed string", () => {
    for (const f of NUMBER_FORMATS) {
      for (const d of [null, 0, 1, 2, 3, 4, 5]) {
        const pos = fmt(1234567.891, f, d)
        const neg = fmt(-1234567.891, f, d)
        expect(pos, `${f}/${d}`).toMatch(/\d/)
        expect(neg, `${f}/${d}`).toBe(`${M}${pos}`)
        if (f !== "percent") expect(pos, `${f}/${d}`).toMatch(/1\.234\.56[78]/)
        if (d !== null && d > 0) expect(pos, `${f}/${d}`).toMatch(new RegExp(`,\\d{${d}}(?!\\d)`))
        expect(pos).not.toMatch(/[  ]/)
      }
    }
  })
  it("zero and non-finite values", () => {
    expect(fmt(0, "IDR")).toBe("Rp 0")
    expect(fmt(0, "percent")).toBe("0%")
    expect(fmt(Number.NaN, "number")).toBe("")
  })
  it("rupiah() for built-in screens", () => {
    expect(rupiah(6000000)).toBe("Rp 6.000.000")
    expect(rupiah(-5000)).toBe(`${M}Rp 5.000`)
  })
})

describe("number formats: stored values", () => {
  it("reads machine numbers as themselves and legacy Rupiah text with the typing rules", () => {
    expect(storedNumber("1.234", null)).toBe(1.234)
    expect(storedNumber("369.000", { format: "currency-idr" })).toBe(369000)
    // A machine fraction left from when the field showed decimals is no grouping (4+ digits before the dot).
    expect(storedNumber("1234.567", { format: "currency-idr" })).toBe(1234.567)
    expect(formatNumberField("1234.567", { format: "currency-idr" })).toBe("Rp 1.235")
    expect(storedNumber("1500.5", { numberFormat: "IDR", decimals: 2 })).toBe(1500.5)
    expect(storedNumber("", null)).toBeNull()
    expect(storedNumber("abc", null)).toBeNull()
    expect(formatNumberField("abc", null)).toBe("abc")
    expect(formatNumberField("1500000", null)).toBe("1.500.000")
    expect(formatNumberField("369.000", "rupiah")).toBe("Rp 369.000")
    expect(formatNumberField("0.42", { numberFormat: "percent" })).toBe("42%")
  })
  it("Rupiah keeps a fraction only with decimal places", () => {
    expect(normalizeNumberFieldValue("1.500,50", { format: "currency-idr" })).toBe("1501")
    expect(normalizeNumberFieldValue("1.500,50", { numberFormat: "IDR", decimals: 2 })).toBe("1500.5")
    expect(normalizeNumberFieldValue("1.500,555", { numberFormat: "IDR", decimals: 2 })).toBe("1500555")
    expect(normalizeNumberFieldValue("1,234", { numberFormat: "IDR", decimals: 1 })).toBe("1234")
    expect(normalizeNumberFieldValue("2,25", { numberFormat: "IDR", decimals: 1 })).toBe("2.3")
    expect(normalizeNumberFieldValue("1,5jt", { numberFormat: "IDR", decimals: 2 })).toBe("1500000")
  })
  it("a typed percent is the stored fraction", () => {
    expect(normalizeNumberFieldValue("42%", { numberFormat: "percent" })).toBe("0.42")
    expect(normalizeNumberFieldValue("12,5 %", null)).toBe("0.125")
    expect(normalizeNumberFieldValue("0.42", { numberFormat: "percent" })).toBe("0.42")
    expect(normalizeNumberFieldValue("50%", { format: "currency-idr" })).toBe("50")
  })
  it("currency marks typed with the amount are dropped", () => {
    expect(normalizeNumberFieldValue("US$1.500,25", { numberFormat: "USD" })).toBe("1500.25")
    expect(normalizeNumberFieldValue("€ 12", { numberFormat: "EUR" })).toBe("12")
  })
})

describe("number formats: Bar / Ring fill", () => {
  it("divides by Divide by and clamps to 0..1", () => {
    expect(numberFill(42, opts("number"))).toBeCloseTo(0.42)
    expect(numberFill(500, opts("number"))).toBe(1)
    expect(numberFill(-5, opts("number"))).toBe(0)
    expect(numberFill(5, opts("IDR", null, { divideBy: 10 }))).toBe(0.5)
    expect(numberFill(5, opts("number", null, { divideBy: 0 }))).toBe(0.05)
    expect(numberFill(Number.NaN, opts("number"))).toBe(0)
  })
  it("Percent ignores Divide by: the stored fraction is the fill", () => {
    expect(numberFill(0.42, opts("percent", null, { divideBy: 1000 }))).toBeCloseTo(0.42)
    expect(numberFill(1.7, opts("percent"))).toBe(1)
    expect(numberFill(-0.2, opts("percent"))).toBe(0)
  })
})

describe("number formats: options compat", () => {
  it("maps old options", () => {
    expect(numberOptions({ format: "currency-idr" }).numberFormat).toBe("IDR")
    expect(numberOptions("idr").numberFormat).toBe("IDR")
    expect(numberOptions({ format: "Rupiah" }).numberFormat).toBe("IDR")
    expect(numberOptions(null)).toEqual(DEFAULT_NUMBER_OPTIONS)
    expect(numberOptions({}).numberFormat).toBe("number_with_separators")
    expect(numberOptions({ numberFormat: "XYZ" }).numberFormat).toBe("number_with_separators")
    expect(numberOptions({ numberFormat: "USD", format: "currency-idr" }).numberFormat).toBe("USD")
    expect(numberFieldFormat({ numberFormat: "IDR" })).toBe("currency-idr")
    expect(numberFieldFormat({ numberFormat: "USD" })).toBe("plain")
  })
  it("fills defaults and drops invalid values on read", () => {
    const o = numberOptions({ numberFormat: "percent", decimals: 9, showAs: "pie", barColor: "teal", divideBy: -3, showNumber: "no" })
    expect(o).toEqual({ ...DEFAULT_NUMBER_OPTIONS, numberFormat: "percent" })
    expect(BAR_COLORS[0]).toBe("default")
  })
  it("write side: keeps valid keys, writes the legacy format only for Rupiah", () => {
    expect(numberOptionsToStore({ numberFormat: "IDR" })).toEqual({ format: "currency-idr", numberFormat: "IDR" })
    expect(numberOptionsToStore({ format: "currency-idr" })).toEqual({ format: "currency-idr", numberFormat: "IDR" })
    expect(numberOptionsToStore("rupiah")).toEqual({ format: "currency-idr", numberFormat: "IDR" })
    expect(numberOptionsToStore({ numberFormat: "USD", format: "currency-idr" })).toEqual({ numberFormat: "USD" })
    expect(numberOptionsToStore({ numberFormat: "percent", decimals: 1, showAs: "ring", barColor: "blue", divideBy: "250", showNumber: false })).toEqual({
      numberFormat: "percent", decimals: 1, showAs: "ring", barColor: "blue", divideBy: 250, showNumber: false,
    })
    expect(numberOptionsToStore({ decimals: 7, showAs: "number", barColor: "default", divideBy: 100, showNumber: true, junk: 1 })).toBeNull()
    expect(numberOptionsToStore(null)).toBeNull()
  })
  it("round-trips through the server's normalizeCustomFieldOptions", () => {
    const input = { numberFormat: "EUR", decimals: 0, showAs: "bar", barColor: "red", divideBy: 50, showNumber: false }
    const stored = normalizeCustomFieldOptions("NUMBER", input)
    expect(stored).toEqual(input)
    expect(numberOptions(stored)).toEqual(input)
    expect(normalizeCustomFieldOptions("NUMBER", stored)).toEqual(stored)
    expect(normalizeCustomFieldOptions("NUMBER", { format: "currency-idr" })).toEqual({ format: "currency-idr", numberFormat: "IDR" })
    expect(normalizeCustomFieldOptions("NUMBER", { numberFormat: "IDR", decimals: 2 })).toEqual({ format: "currency-idr", numberFormat: "IDR", decimals: 2 })
    expect(normalizeCustomFieldOptions("NUMBER", { numberFormat: "nope", decimals: "x" })).toBeNull()
  })
})

describe("view config: table footer calculations", () => {
  it("keeps known calculations on known props and drops the rest", async () => {
    const { sanitizeViewConfig } = await import("@/lib/project-views")
    const out = sanitizeViewConfig({ columnCalcs: { "cf:abc": "sum", due: "count_values", "cf:x": "bogus", "evil prop": "sum" } })
    expect(out.columnCalcs).toEqual({ "cf:abc": "sum", due: "count_values" })
    expect(sanitizeViewConfig({}).columnCalcs).toBeUndefined()
  })
})
