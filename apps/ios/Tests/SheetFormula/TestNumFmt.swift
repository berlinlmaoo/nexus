// Port of apps/web/src/lib/sheet-numfmt.test.mjs (same cases, same expected values).
import Foundation

func runNumFmtTests() {
    typealias F = SheetFormula
    typealias N = SheetNumFmt
    F.setDisplayLocale(.idID)
    func val(_ v: Any?) -> SheetCellValue {
        switch v {
        case let d as Double: return .number(d)
        case let i as Int: return .number(Double(i))
        case let s as String: return .text(s)
        case let b as Bool: return .bool(b)
        default: return .empty
        }
    }
    let fp = { (v: Any?, p: String, loc: String) -> String in N.formatPattern(val(v), p, loc).text }
    let col = { (v: Any?, p: String, loc: String) -> String? in N.formatPattern(val(v), p, loc).color }
    let id = "id-ID", en = "en-US"

    // ── Digits, grouping, decimals (id-ID output)
    eq(fp(1234.56, "0", id), "1235", "0 rounds")
    eq(fp(1234.56, "0.00", id), "1234,56", "two decimals, Indonesian comma")
    eq(fp(1234.56, "#,##0", id), "1.235", "grouping")
    eq(fp(1234.56, "#,##0.00", id), "1.234,56", "grouping + decimals")
    eq(fp(5, "000", id), "005", "zero padding")
    eq(fp(5, "???", id), "  5", "space padding")
    eq(fp(1.5, "0.##", id), "1,5", "# drops trailing zeros")
    eq(fp(0.5, ".00", id), ",50", "no integer placeholder")
    eq(fp(1500000, "#,##0,", id), "1.500", "trailing comma scales by 1000")
    eq(fp(1500000, "#,##0,,\"M\"", id), "2M", "two commas scale by a million")
    eq(fp(1.005, "0.00", id), "1,01", "decimal rounding is not binary-floored")
    eq(fp(-5, "0", id), "-5", "one section: minus sign")
    eq(fp(-1234.56, "$#,##0", id), "-$1.235", "minus before the currency literal")

    // ── Sections, colours, conditions
    eq(fp(1234.56, "#,##0_);(#,##0)", id), "1.235 ", "_) pads like the closing bracket")
    eq(fp(-1234.56, "#,##0_);(#,##0)", id), "(1.235)", "negative section, no minus")
    eq(fp(-1234.56, "#,##0_);[Red](#,##0)", id), "(1.235)", "red negative text")
    eq(col(-1234.56, "#,##0_);[Red](#,##0)", id), "#ff0000", "red negative colour")
    eq(col(1234.56, "#,##0_);[Red](#,##0)", id), nil, "positive has no colour")
    eq(col(5, "[Blue]0", id), "#0000ff", "[Blue]")
    eq(col(5, "[Color10]0", id), "#008000", "[Color10] from the 56 palette")
    eq(fp(0, "0;-0;\"zero\"", id), "zero", "zero section")
    eq(fp(0, "0;-0;;@", id), "", "empty zero section")
    eq(fp(0, "0.0;(0.0)", id), "0,0", "two sections: zero uses the first")
    eq(fp(1500000, "[>=1000]#,##0,\"K\";0", id), "1.500K", "condition section")
    eq(fp(500, "[>=1000]#,##0,\"K\";0", id), "500", "condition falls through")
    eq(fp(1234.56, "$#,##0.00_);($#,##0.00)", id), "$1.234,56 ", "dollar preset")
    eq(fp(1234.56, "[$€-407]#,##0.00", id), "€1.234,56", "[$€] currency literal")
    let acct = "_($* #,##0_);_($* (#,##0);_($* \"-\"_);_(@_)"
    eq(fp(1234.56, acct, id), " $ 1.235 ", "accounting preset")
    eq(fp(0, acct, id), " $ - ", "accounting zero dash")
    eq(fp("abc", acct, id), " abc ", "accounting text section")

    // ── Percent, scientific, fractions
    eq(fp(0.1234, "0%", id), "12%", "percent")
    eq(fp(0.1234, "0.00%", id), "12,34%", "percent with decimals")
    eq(fp(1234.56, "0.00E+00", id), "1,23E+03", "scientific")
    eq(fp(0.00123, "0.00E+00", id), "1,23E-03", "negative exponent")
    eq(fp(1234.56, "##0.0E+0", id), "1,2E+3", "engineering exponent")
    eq(fp(0, "0.00E+00", id), "0,00E+00", "scientific zero")
    eq(fp(1234.56, "# ?/?", id), "1234 5/9", "fraction, one digit")
    eq(fp(1234.56, "# ??/??", id), "1234 14/25", "fraction, two digits")
    eq(fp(0.75, "?/?", id), "3/4", "improper fraction")
    eq(fp(1.5, "# ?/8", id), "1 4/8", "fixed denominator")
    eq(fp(3, "# ?/?", id), "3", "whole number drops the fraction")

    // ── Text
    eq(fp("abc", "0;-0;0;\"[\" @ \"]\"", id), "[ abc ]", "text section")
    eq(fp("abc", "0.00", id), "abc", "text without a text section is unchanged")
    eq(fp(12, "@", id), "12", "@ shows a number as plain text")
    eq(fp(true, "0", id), "TRUE", "booleans")
    eq(fp(nil, "0", id), "", "empty")

    // ── Dates, times, durations
    let D = N.DATE_SAMPLE
    eq(fp(D, "yyyy-mm-dd", id), "1930-08-05", "ISO date")
    eq(fp(D, "dd/mm/yyyy", id), "05/08/1930", "day first")
    eq(fp(D, "m/d/yy", id), "8/5/30", "short US date")
    eq(fp(D, "d-mmm", id), "5-Agu", "Indonesian short month")
    eq(fp(D, "dddd, dd mmmm yyyy", id), "Selasa, 05 Agustus 1930", "Indonesian weekday + month")
    eq(fp(D, "ddd mmmmm", id), "Sel A", "short weekday, month initial")
    eq(fp(D, "hh.mm.ss", id), "13.25.59", "Indonesian time")
    eq(fp(D, "h:mm:ss AM/PM", id), "1:25:59 PM", "12-hour clock")
    eq(fp(D, "h:mm a/p", id), "1:25 p", "a/p lower case")
    eq(fp(D, "mm:ss", id), "25:59", "m before s is minutes")
    eq(fp(D, "dddd, dd mmmm yyyy \"pukul\" hh.mm.ss", id), "Selasa, 05 Agustus 1930 pukul 13.25.59", "literal word")
    eq(fp(1 + 1 / 1440.0, "[h]:mm:ss", id), "24:01:00", "elapsed hours")
    eq(fp(90 / 86400.0, "[mm]:ss", id), "01:30", "elapsed minutes")
    eq(fp(-0.5 / 24, "[h]:mm", id), "-0:30", "negative duration")
    eq(fp(3661.25 / 86400, "hh:mm:ss.000", id), "01:01:01.250", "fractional seconds")
    eq(fp(5, "0 \"days\"", id), "5 days", "quoted words keep a number section numeric")

    // ── en-US output
    eq(fp(1234.56, "#,##0.00", en), "1,234.56", "en grouping")
    eq(fp(0.1234, "0.0%", en), "12.3%", "en percent")
    eq(fp(1234.56, "0.00E+00", en), "1.23E+03", "en scientific")
    eq(fp(D, "dddd, mmmm d, yyyy", en), "Tuesday, August 5, 1930", "en names")
    eq(fp(D, "d mmm", en), "5 Aug", "en short month")
    eq(F.getDisplayLocale(), .idID, "formatPattern restores the locale")

    // ── formatWithStyle: every kind, both locales
    let DT = F.ymdToSerial(2008, 9, 26) + 57_540.0 / 86_400 // 15:59:00
    let ws = { (v: Any?, nf: String?, dp: Int?, pt: String?) -> String? in F.formatWithStyle(val(v), nf, dp, nil, pt) }
    eq(ws(1000.12, "num", nil, nil), "1.000,12", "num")
    eq(ws(0.1012, "pct", nil, nil), "10,12%", "pct")
    eq(ws(1010, "sci", nil, nil), "1,01E+03", "sci")
    eq(ws(1010, "sci", 1, nil), "1,0E+03", "sci with one decimal")
    eq(ws(-1000.12, "acct", nil, nil), "Rp (1.000,12)", "acct negative")
    eq(ws(1000.12, "acct", nil, nil), "Rp 1.000,12 ", "acct positive")
    eq(ws(-1000.12, "fin", nil, nil), "(1.000,12)", "fin negative")
    eq(ws(1000, "fin", nil, nil), "1.000,00", "fin fixed decimals")
    eq(ws(1000.12, "cur", nil, nil), "Rp1.000,12", "cur")
    eq(ws(-5, "cur", nil, nil), "-Rp5,00", "cur negative")
    eq(ws(1000.12, "cur0", nil, nil), "Rp1.000", "cur0")
    eq(ws(1500000, "idr", 0, nil), "Rp 1.500.000", "idr unchanged")
    eq(ws(DT, "date", nil, nil), "26/09/2008", "date")
    eq(ws(DT, "time", nil, nil), "15.59.00", "time")
    eq(ws(DT, "dt", nil, nil), "26/09/2008 15.59.00", "date time")
    eq(ws(1 + 1 / 1440.0, "dur", nil, nil), "24:01:00", "duration")
    eq(ws(2.25, "custom", nil, "0.0"), "2,3", "custom pattern")
    eq(ws(2.25, "custom", nil, nil), nil, "custom without a pattern")
    eq(ws("abc", "custom", nil, "0;0;0;\"x\"@"), "xabc", "custom text section formats text")
    eq(ws("abc", "custom", nil, "0.00"), nil, "custom number pattern leaves text alone")
    F.setDisplayLocale(.enUS)
    eq(ws(1000.12, "num", nil, nil), "1,000.12", "en num")
    eq(ws(0.1012, "pct", nil, nil), "10.12%", "en pct")
    eq(ws(1010, "sci", nil, nil), "1.01E+03", "en sci")
    eq(ws(-1000.12, "acct", nil, nil), "$ (1,000.12)", "en acct")
    eq(ws(-1000.12, "fin", nil, nil), "(1,000.12)", "en fin")
    eq(ws(1000.12, "cur", nil, nil), "$1,000.12", "en cur")
    eq(ws(1000.12, "cur0", nil, nil), "$1,000", "en cur0")
    eq(ws(DT, "date", nil, nil), "9/26/2008", "en date")
    eq(ws(DT, "time", nil, nil), "3:59:00 PM", "en time")
    eq(ws(DT, "dt", nil, nil), "9/26/2008 15:59:00", "en date time")
    eq(ws(1 + 1 / 1440.0, "dur", nil, nil), "24:01:00", "en duration")
    eq(F.formatDateSerial(46306), "Oct 11, 2026", "en date column")
    eq(F.decimalsShown("1,500.25"), 2, "en decimals shown")

    // ── en-US input parsing
    eq(F.detectInput("1,500.25"), .number(1500.25, .num), "en grouped decimal")
    eq(F.detectInput("0.256"), .number(0.256, .num), "en decimal")
    eq(F.detectInput("1.5"), .number(1.5, .num), "en lone dot")
    eq(F.parseLocaleNumber("1,500")?.n, 1500, "en lone comma + 3 digits groups")
    eq(F.parseLocaleNumber("1.500")?.n, 1.5, "en 1.500 is one and a half")
    eq(F.detectInput("12.5%"), .number(0.125, .pct), "en percent")
    eq(F.detectInput("9/26/2008"), .number(F.ymdToSerial(2008, 9, 26), .date), "en month-first date")
    eq(F.detectInput("26/9/2008"), .text("26/9/2008"), "en day-first is not a date")
    eq(F.detectInput(F.editTyped(.init(v: 46306, nf: .date))), .number(46306, .date), "en date round-trips")
    F.setDisplayLocale(.idID)
    eq(F.detectInput("26/09/2008"), .number(F.ymdToSerial(2008, 9, 26), .date), "id day-first again")
    eq(F.parseLocaleNumber("1.500")?.n, 1500, "id 1.500 groups again")

    // ── computeSheet: locale option + custom pattern
    do {
        let cols: [(id: String, type: String)] = [("a", "text"), ("b", "text")]
        let rows: [(id: String, cells: [String: Any], styles: [String: [String: Any]]?)] = [
            ("x", ["a": 1234.5, "b": 1234.5], ["a": ["nf": "num", "dp": 2], "b": ["nf": "custom", "pt": "#,##0.0"]]),
        ]
        let enOut = F.computeSheet(cols, rows, locale: .enUS)
        eq(enOut["x"]?["a"]?.d, "1,234.50", "computeSheet in en-US")
        eq(enOut["x"]?["b"]?.d, "1,234.5", "custom pattern in en-US")
        eq(F.getDisplayLocale(), .idID, "computeSheet restores the locale")
        eq(F.computeSheet(cols, rows)["x"]?["b"]?.d, "1.234,5", "custom pattern in id-ID")
    }

    // ── Menu list, presets, currencies, date chips
    do {
        let idItems = N.numberFormatItems("id-ID")
        let ex = { (items: [N.NumberFormatItem], key: String) -> String in items.first { $0.key == key }?.example ?? "?" }
        eq(idItems.map { $0.key }.joined(separator: ","), "auto,text,sep,num,pct,sci,sep,acct,fin,cur,cur0,sep,date,time,dt,dur,sep,customCurrency,customDate,customNumber", "menu order")
        eq(["num", "pct", "sci", "acct", "fin", "cur", "cur0"].map { ex(idItems, $0) },
           ["1.000,12", "10,12%", "1,01E+03", "Rp (1.000,12)", "(1.000,12)", "Rp1.000,12", "Rp1.000"], "id number examples")
        eq(["date", "time", "dt", "dur"].map { ex(idItems, $0) }, ["26/09/2008", "15.59.00", "26/09/2008 15.59.00", "24:01:00"], "id date examples")
        let enItems = N.numberFormatItems("en-US")
        eq(["num", "acct", "cur", "date", "time"].map { ex(enItems, $0) }, ["1,000.12", "$ (1,000.12)", "$1,000.12", "9/26/2008", "3:59:00 PM"], "en examples")
        eq(N.NUMBER_PRESETS.count >= 20, true, "custom number presets")
        eq(fp(N.NUMBER_SAMPLE, "0.00E+00", id), "1,23E+03", "preset sample")
    }
    eq(N.currencyPattern("IDR"), "\"Rp\"#,##0", "Rupiah has no decimals")
    eq(fp(1000.12, N.currencyPattern("IDR"), id), "Rp1.000", "Rupiah sample")
    eq(fp(1000.12, N.currencyPattern("USD"), id), "$1.000,12", "dollar sample in id-ID")
    eq(fp(1000.12, N.currencyPattern("KWD"), id), "din1.000,120", "three-decimal dinar")
    eq(fp(1000.12, N.currencyPattern("JPY"), id), "¥1.000", "yen")
    eq(fp(-5, N.currencyPattern("USD", "symbolParen"), id), "($5,00)", "brackets variant")
    eq(col(-5, N.currencyPattern("USD", "symbolRed"), id), "#ff0000", "red variant")
    eq(fp(1000, N.currencyPattern("EUR", "symbolAfter"), id), "1.000,00 €", "symbol after")
    eq(fp(1000, N.currencyPattern("IDR", "code"), id), "IDR 1.000", "code variant")
    eq(N.CURRENCIES.count >= 40, true, "currency list")
    eq(Set(N.CURRENCIES.map { $0.code }).count, N.CURRENCIES.count, "currency codes unique")
    do {
        func show(_ parts: [N.DatePart]) -> [String] {
            parts.map { p in
                switch p {
                case .token(let f, _): return f.rawValue
                case .lit(let t): return t
                }
            }
        }
        let parts = N.parseDatePattern("yyyy-mm-dd")
        eq(show(parts), ["year", "-", "month", "-", "day"], "date chips")
        eq(N.joinDatePattern(parts), "yyyy-mm-dd", "chips round-trip")
        eq(show(N.parseDatePattern("hh:mm")), ["hour", ":", "minute"], "minute after hour")
        eq(N.joinDatePattern([.token(field: .weekday, code: "dddd"), .lit(" pukul "), .token(field: .hour, code: "hh")]), "dddd\" pukul \"hh", "word literals are quoted")
        eq(N.datePartSample(.month, "mmm"), "Agu", "chip sample month")
        eq(N.datePartSample(.minute, "mm"), "25", "chip sample minute")
        eq(N.datePartSample(.year, "yyyy"), "1930", "chip sample year")
        eq(N.datePresets("id-ID").map { fp(D, $0, id) }.contains("Selasa, 05 Agustus 1930 pukul 13.25.59"), true, "id presets")
    }
}
