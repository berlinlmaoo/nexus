// Port of apps/web/src/lib/sheet-formula.test.mjs (same cases, same expected values).
import Foundation

func runFormulaTests() {
    typealias F = SheetFormula
    F.setDisplayLocale(.idID)

    // ── Numbers as typed in Indonesia
    let numP = { (s: String) -> Double? in F.parseLocaleNumber(s)?.n }
    eq(numP("1.500.000"), 1500000, "dots group thousands")
    eq(numP("1.500"), 1500, "a single dot + 3 digits groups")
    eq(numP("1.5"), 1.5, "a single dot + not-3 digits is decimal")
    eq(numP("0.500"), 0.5, "0.xxx is decimal")
    eq(numP("1,5"), 1.5, "comma is decimal")
    eq(numP("1.500.000,50"), 1500000.5, "id full form")
    eq(numP("1,500,000.50"), 1500000.5, "en full form")
    eq(numP("(250)"), -250, "accounting negative")
    eq(numP("-1.234"), -1234, "negative grouped")
    eq(numP("abc"), nil, "text is not a number")
    eq(numP("1.2.3"), nil, "version strings are not numbers")
    eq(numP("1,"), nil, "dangling separator")

    let det = F.detectInput
    eq(det("Rp 1.500.000"), .number(1500000, .idr), "Rupiah")
    eq(det("Rp1.500.000,-"), .number(1500000, .idr), "Rupiah with ,-")
    eq(det("-Rp 5.000"), .number(-5000, .idr), "negative Rupiah")
    eq(det("IDR 2.500"), .number(2500, .idr), "IDR")
    eq(det("15%"), .number(0.15, .pct), "percent")
    eq(det("1,5%"), .number(0.015, .pct), "decimal percent")
    eq(det("1.500.000"), .number(1500000, .num), "grouped number keeps its format")
    eq(det("1500"), .number(1500, nil), "bare number")
    eq(det("1,5"), .number(1.5, .num), "decimal comma")
    eq(det("11/10/2026"), .number(F.ymdToSerial(2026, 10, 11), .date), "dd/mm/yyyy is day first")
    eq(det("11 Okt 2026").v, F.ymdToSerial(2026, 10, 11), "Indonesian month name")
    eq(det("2026-10-11").nf, .date, "ISO date")
    eq(det("31/02/2026").kind, "text", "impossible date stays text")
    eq(det("08123456789").kind, "text", "leading zero stays text (phone)")
    eq(det("+6281234567890").kind, "text", "leading + stays text")
    eq(det("3201234567890001").kind, "text", "16-digit NIK stays text")
    eq(det("abc").kind, "text", "plain text")
    eq(det("Q4 2026").kind, "text", "mixed text")
    eq(det("  ").kind, "empty", "blank")

    // ── Dates
    eq(F.ymdToSerial(2026, 10, 11), 46306, "serial matches Sheets/Excel")
    eq(F.serialToIso(46306), "2026-10-11", "serial back to ISO")
    eq(F.formatDateSerial(46306), "11 Okt 2026", "date display")
    let iso = ISO8601DateFormatter()
    eq(F.todaySerial(iso.date(from: "2026-10-11T17:30:00Z")!), F.ymdToSerial(2026, 10, 12), "TODAY is Jakarta: 00:30 WIB is already the 12th")
    eq(F.todaySerial(iso.date(from: "2026-10-11T16:59:00Z")!), F.ymdToSerial(2026, 10, 11), "23:59 WIB is still the 11th")

    // ── Formatting
    eq(F.formatValue(num(1500000), .idr), "Rp 1.500.000", "Rupiah")
    eq(F.formatValue(num(0.15), .pct), "15%", "percent")
    eq(F.formatValue(num(1500000), .num), "1.500.000", "grouped")
    eq(F.formatValue(num(1.5), nil), "1,5", "general number uses a decimal comma")
    eq(F.editTyped(.init(v: 1500000, nf: .idr)), "Rp 1.500.000", "Rupiah edits as typed")
    eq(F.detectInput(F.editTyped(.init(v: 0.125, nf: .pct))), .number(0.125, .pct), "percent round-trips")
    eq(F.detectInput(F.editTyped(.init(v: 46306, nf: .date))), .number(46306, .date), "date round-trips")
    eq(F.formatScalar("currency", 2500), "Rp 2.500", "currency column")
    eq(F.formatScalar("date", "2026-10-11"), "11 Okt 2026", "date column")
    eq(F.formatScalar("date", "11/10/2026"), "11 Okt 2026", "date column with a day-first legacy value")
    eq(F.formatScalar("text", ["v": 1500000, "nf": "idr"]), "Rp 1.500.000", "typed cell in a text column")
    eq(F.formatScalar("text", ["v": 46306, "nf": "date"]), "11/10/2026", "a typed date keeps the style it was typed in")
    eq(F.detectInput("Rp1.500.000,50"), .number(1500000.5, .idr), "Rp without space, with decimals")
    eq(F.detectInput("1.5"), .number(1.5, .num), "1.5 is a decimal, never a date")

    // ── A1 <-> stored
    let shape = SheetShape(columnIds: ["ca", "cb", "cc", "cd"], rowIds: ["r1", "r2", "r3", "r4", "r5"])
    eq(F.toStored("=IF(A2=\"Q4\";B2;0)", shape), "=IF({ca!r2}=\"Q4\",{cb!r2},0)", "quoted text is never a reference; stored neutral")
    eq(F.toDisplay("=IF({ca!r2}=\"Q4\",{cb!r2}*1.5,0)", shape), "=IF(A2=\"Q4\";B2*1,5;0)", "shown with Indonesian separators")
    eq(F.canonicalFormula("=IF(A1>1,\"y\",\"n\")"), "=IF(A1>1,\"y\",\"n\")", "',' still separates when it can't be a decimal")
    eq(F.canonicalFormula("=SUM(A1,B1)"), "=SUM(A1,B1)", "SUM(A1,B1)")
    eq(F.canonicalFormula("=A1*1,5"), "=A1*1.5", "',' between digits is a decimal")
    eq(F.canonicalFormula("=IF(A1;\"a,b\";1,5)"), "=IF(A1,\"a,b\",1.5)", "';' formula with a decimal comma; commas in strings untouched")
    eq(F.canonicalFormula("=IF(A1>1,1,5)"), nil, "ambiguous commas are refused")
    eq(F.toStored("=IF(A1>1,1,5)", shape), "=?IF({ca!r1}>1,1,5)", "ambiguous formula kept as typed")
    eq(F.toDisplay("=?IF({ca!r1}>1,1,5)", shape), "=IF(A1>1,1,5)", "and shown as typed so it can be fixed")
    eq(F.localizeFormula("=STDEV.S(A1:A3)+0.5"), "=STDEV.S(A1:A3)+0,5", "dots in function names are not decimals")
    eq(F.toStored("=SUM($A$1:A$3)", shape), "=SUM({$ca!$r1}:{ca!$r3})", "$ is kept")
    eq(F.toStored("=SUM(B:B)", shape), "=SUM({cb!*}:{cb!*})", "whole column")
    eq(F.toStored("=LOG10(A1)", shape), "=LOG10({ca!r1})", "function names with digits are not cells")
    eq(F.toStored("=A99", shape), "=A99", "outside the sheet stays A1")
    eq(F.toDisplay("=SUM({$ca!$r1}:{ca!$r3})", shape), "=SUM($A$1:A$3)", "display keeps $")
    eq(F.toDisplay("=SUM({cb!*}:{cc!*})", shape), "=SUM(B:C)", "whole columns display")
    eq(F.toDisplay("={gone!r1}+{ca!gone}", shape), "=#REF!+#REF!", "deleted ids are #REF!")

    // ── Relative references on copy/paste/fill
    eq(F.shiftFormula("=A1+$B$2+B$3+$C4", 2, 1), "=B3+$B$2+C$3+$C6", "relative parts move, $ parts stay")
    eq(F.shiftFormula("=SUM(A1:A3)", 1, 0), "=SUM(A2:A4)", "ranges move")
    eq(F.shiftFormula("=A1", -1, 0), "=#REF!", "off the top is #REF!")
    eq(F.shiftFormula("=IF(A1=\"A1\";1;0)", 1, 0), "=IF(A2=\"A1\";1;0)", "strings untouched")
    eq(F.shiftFormula("=SUM(A:A)", 5, 1), "=SUM(B:B)", "whole column shifts sideways only")
    eq(F.r1c1ToA1("=R[0]C[-1]*2", 4, 2), "=B5*2", "Sheets R1C1 relative")
    eq(F.r1c1ToA1("=SUM(R1C1:R[-1]C)", 4, 2), "=SUM($A$1:C4)", "Sheets R1C1 absolute and mixed")

    // ── Range shrink on delete
    eq(F.rewriteForDeletion("=SUM({ca!r1}:{ca!r3})", shape, rows: ["r1"]), "=SUM({ca!r2}:{ca!r3})", "top corner deleted")
    eq(F.rewriteForDeletion("=SUM({ca!r1}:{ca!r3})", shape, rows: ["r3"]), "=SUM({ca!r1}:{ca!r2})", "bottom corner deleted")
    eq(F.rewriteForDeletion("=SUM({ca!r1}:{ca!r3})", shape, rows: ["r1", "r2", "r3"]), "=SUM(#REF!)", "everything deleted")
    eq(F.rewriteForDeletion("=SUM({ca!r1}:{cc!r3})", shape, cols: ["cc"]), "=SUM({ca!r1}:{cb!r3})", "corner column deleted")
    eq(F.rewriteForDeletion("=SUM({ca!r2}:{ca!r3})", shape, rows: ["r1"]), "=SUM({ca!r2}:{ca!r3})", "untouched range")

    // ── Evaluation
    do {
        let s = TestSheet([
            [10, "Rp 1.500.000", ["v": 2500, "nf": "idr"], "=A1*2"],
            [20, "1.500", "abc", "=SUM(A1:A3)"],
            [30, nil, "2026-10-11", "=SUM(A:A)"],
        ])
        eq(s.at("D1"), num(20), "arithmetic")
        eq(s.at("D2"), num(60), "SUM range")
        eq(s.at("D3"), num(60), "A:A whole column")
    }
    do {
        let s = TestSheet([
            ["Q4", 5, "=IF(A1=\"Q4\";B1*2;0)", "=IF(A1=\"Q4\",\"y\",\"n\")"],
            ["1.500.000", "Rp 2.000", "=SUM(A2:B2)", "=A2+B2"],
            [["v": 0.1, "nf": "pct"], 200, "=B3*A3", "=50%*B3"],
            ["x", "=1,5*2", "=ROUND(1,005;2)", "=2^3^2", "=IF(A1>1,1,5)"],
        ])
        eq(s.at("C1"), num(10), "';' separators and quoted text")
        eq(s.at("D1"), txt("y"), "',' separators still work")
        eq(s.at("C2"), num(1502000), "numeric text in a SUM range counts (legacy text columns)")
        eq(s.at("D2"), num(1502000), "numeric text in arithmetic")
        near(s.at("C3").number, 20, "typed percent")
        eq(s.at("D3"), num(100), "% operator")
        eq(s.at("B4"), num(3), "'1,5' between digits is a decimal")
        eq(s.at("E4"), txt(F.ERR.error), "ambiguous commas evaluate to #ERROR!")
        eq(s.at("C4"), num(1.01), "'1,005' is a decimal in a ';' formula; ROUND is not fooled by float error")
        eq(s.at("D4"), num(64), "^ is left-associative like Excel")
    }
    do {
        let s = TestSheet([["=B1", "=A1", "=IFERROR(A1;7)"]])
        eq(s.at("C1"), num(7), "a cell that only READS a loop can catch its error")
        eq(s.at("A1"), txt(F.ERR.cycle), "the loop itself stays circular in any order")
    }
    do {
        let s = TestSheet([["=1/0", "=A1+1", "=XYZ(1)", "=\"a\"+1", "=A9"]])
        eq(s.at("A1"), txt(F.ERR.div), "#DIV/0!")
        eq(s.at("B1"), txt(F.ERR.div), "errors propagate")
        eq(s.at("C1"), txt(F.ERR.name), "#NAME?")
        eq(s.at("D1"), txt(F.ERR.value), "#VALUE!")
        eq(s.at("E1"), txt(F.ERR.ref), "reference outside the sheet")
    }
    do {
        let s = TestSheet([
            ["2026-10-01", "2026-10-11", "=B1-A1", "=A1+30", "=TODAY()"],
            ["=EOMONTH(A1;0)", "=NETWORKDAYS(A1;B1)", "=DATE(2026;12;31)", "=YEAR(B1)", "=TEXT(B1;\"dd/mm/yyyy\")"],
            ["=EDATE(A1;1)", "=WORKDAY(A1;5)", "=TEXT(1500000;\"#,##0\")", "=TEXT(0,256;\"0,0%\")", "=DATEDIF(A1;B1;\"D\")"],
        ], types: ["date", "date", "text", "text", "text"])
        eq(s.at("C1"), num(10), "date difference in days")
        eq(s.fmt("C1"), nil, "a date difference is a number")
        eq(s.at("D1"), num(F.ymdToSerial(2026, 10, 31)), "date + days")
        eq(s.fmt("D1"), .date, "date + days is a date")
        eq(s.fmt("E1"), .date, "TODAY is a date")
        eq(s.at("A2"), num(F.ymdToSerial(2026, 10, 31)), "EOMONTH via formulajs")
        eq(s.at("B2"), num(7), "NETWORKDAYS via formulajs (Thu 1 – Sun 11 Oct 2026)")
        eq(s.at("C2"), num(F.ymdToSerial(2026, 12, 31)), "DATE")
        eq(s.at("D2"), num(2026), "YEAR")
        eq(s.at("E2"), txt("11/10/2026"), "TEXT date")
        eq(s.at("A3"), num(F.ymdToSerial(2026, 11, 1)), "EDATE")
        eq(s.at("B3"), num(F.ymdToSerial(2026, 10, 8)), "WORKDAY")
        eq(s.at("C3"), txt("1.500.000"), "TEXT number in Indonesian")
        eq(s.at("D3"), txt("25,6%"), "TEXT percent with ';' formula decimals")
        eq(s.at("E3"), num(10), "DATEDIF")
    }
    do {
        let s = TestSheet([
            ["apel", 100, "=XLOOKUP(\"jeruk\";A1:A3;B1:B3)", "=INDEX(B1:B3;MATCH(\"mangga\";A1:A3;0))"],
            ["jeruk", 200, "=VLOOKUP(\"JERUK\";A1:B3;2;FALSE)", "=XLOOKUP(\"x\";A1:A3;B1:B3;\"-\")"],
            ["mangga", 300, "=SUMPRODUCT(B1:B3;B1:B3)", "=COUNTIFS(A1:A3;\"*a*\";B1:B3;\">=200\")"],
        ])
        eq(s.at("C1"), num(200), "XLOOKUP")
        eq(s.at("D1"), num(300), "INDEX/MATCH via formulajs")
        eq(s.at("C2"), num(200), "VLOOKUP is case-insensitive")
        eq(s.at("D2"), txt("-"), "XLOOKUP not found")
        eq(s.at("C3"), num(140000), "SUMPRODUCT")
        eq(s.at("D3"), num(1), "COUNTIFS with wildcard + number criteria")
    }
    do {
        let s = TestSheet([[["v": 1500000, "nf": "idr"], "=A1*2", "=SUM(A1:A1)", "=A1/A1"]])
        eq(s.fmt("B1"), .idr, "Rupiah * 2 is Rupiah")
        eq(s.fmt("C1"), .idr, "SUM of Rupiah is Rupiah")
        eq(s.fmt("D1"), nil, "Rupiah / Rupiah is a ratio")
    }
    do {
        let s = TestSheet([[["v": 1000, "nf": "idr"], "=A1*2"], [["v": 2000, "nf": "idr"], "=A2*2"], [nil, "=SUM(B1:B2)"]])
        eq(s.fmt("B3"), .idr, "SUM over formula results keeps their format")
    }
    do {
        let s = TestSheet([[1, "=A1*2", 5, "=C1+1"]])
        eq(s.at("B1"), num(2), "before")
        eq(s.at("D1"), num(6), "before")
        var cells = s.data.cells
        cells["r0"]?["c0"] = 10
        var next = s.data
        next.cells = cells
        let e2 = s.e.derive(next)
        eq(e2.values["r0\u{1}c3"] != nil, true, "unrelated formula result carried over")
        eq(e2.values["r0\u{1}c1"] != nil, false, "dependent invalidated")
        eq(e2.value("r0", "c1"), num(20), "dependent recomputed")
    }

    // ── Server computed view
    do {
        let columns: [(id: String, type: String)] = [("a", "currency"), ("b", "text"), ("c", "date")]
        let shp = SheetShape(columnIds: ["a", "b", "c"], rowIds: ["x", "y"])
        let rows: [(id: String, cells: [String: Any], styles: [String: [String: Any]]?)] = [
            ("x", ["a": 1500000, "b": ["f": F.toStored("=A1*2", shp)], "c": "2026-10-11"], nil),
            ("y", ["b": ["f": F.toStored("=C1+1", shp)]], nil),
        ]
        let out = F.computeSheet(columns, rows)
        eq(out["x"]?["a"], SheetComputedCell(v: num(1500000), d: "Rp 1.500.000", nf: .idr), "currency cell")
        eq(out["x"]?["b"], SheetComputedCell(v: num(3000000), d: "Rp 3.000.000", nf: .idr, formula: true), "formula takes the Rupiah format")
        eq(out["x"]?["c"], SheetComputedCell(v: num(46306), d: "11 Okt 2026", nf: .date), "date column as serial + text")
        eq(out["y"]?["b"]?.d, "12/10/2026", "date arithmetic in a text column displays day-first")
    }

    // ── Explicit number formats from the toolbar
    eq(F.formatWithStyle(num(1500000), "idr", 0), "Rp 1.500.000", "Rupiah, no decimals")
    eq(F.formatWithStyle(num(0.1234), "pct", 1), "12,3%", "percent with one decimal")
    eq(F.formatWithStyle(num(2.5), nil, 3), "2,500", "decimals on an automatic number")
    eq(F.formatWithStyle(num(46306), "date", nil), "11/10/2026", "a number shown as a date")
    eq(F.formatWithStyle(txt("abc"), "idr", 0), nil, "text is not reformatted")
    eq(F.formatWithStyle(num(5), "auto", nil), nil, "automatic leaves the default")
    eq(F.decimalsShown("Rp 1.500,25"), 2, "decimals shown")
    do {
        let out = F.computeSheet([("a", "text")], [("x", ["a": 0.256], ["a": ["nf": "pct", "dp": 1]])])
        eq(out["x"]?["a"]?.d, "25,6%", "computed view honours the cell's number format")
    }

    // Named ranges
    do {
        let cols: [(id: String, type: String)] = [("a", "number"), ("b", "text")]
        let rows: [(id: String, cells: [String: Any], styles: [String: [String: Any]]?)] = [
            ("r1", ["a": 2], nil), ("r2", ["a": 3], nil),
            ("r3", ["b": ["f": "=SUM(Total)*2"]], nil),
            ("r4", ["b": ["f": "=CONCAT(\"Total\";\"x\")"]], nil),
            ("r5", ["b": ["f": "=SUM(Nope)"]], nil),
        ]
        let out = F.computeSheet(cols, rows, names: [("Total", "{a!r1}:{a!r2}")])
        eq(out["r3"]?["b"]?.v, num(10), "a named range evaluates as its range (case-insensitive)")
        eq(out["r4"]?["b"]?.v, txt("Totalx"), "a name inside a string stays text")
        eq(out["r5"]?["b"]?.v, txt("#NAME?"), "an undefined name is #NAME?")
        eq(F.resolveNames("=SUM(total;SUM(1))", ["TOTAL": "{a!r1}:{a!r2}"]), "=SUM({a!r1}:{a!r2};SUM(1))", "function calls are not names")
    }
}
