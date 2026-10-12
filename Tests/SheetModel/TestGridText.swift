import Foundation

// Font families, text rotation, automatic row height and the floating charts' anchors (SheetGridModel.swift
// SheetGridText / SheetChartPlace), against the web's sheet-palette.ts / sheet-style.ts / SheetGrid.tsx.

private func eq<T: Equatable>(_ a: T, _ b: T, _ what: String) {
    check(a == b, "\(what): got \(a), want \(b)")
}

func runGridTextTests() {
    let X = SheetGridText.self
    // fonts
    eq(X.family(nil), nil, "no style = default font")
    eq(X.family(["ff": "Default"]), nil, "Default is no family")
    eq(X.family(["ff": "Georgia"]), "Georgia", "stored family")
    eq(X.candidates("georgia"), ["Georgia", ":serif"], "known family, any case")
    eq(X.candidates("Roboto"), ["Roboto"], "unknown family is tried as is")
    eq(X.fontFamilies.count, 18, "the web's 18 named families (plus Default)")
    // rotation
    eq(X.rotation(nil), X.Rotation(), "no rotation")
    eq(X.rotation(["rt": 45]), X.Rotation(degrees: 45, vertical: false), "tilt up")
    eq(X.rotation(["rt": -90]), X.Rotation(degrees: -90, vertical: false), "rotate down")
    eq(X.rotation(["rt": 200]), X.Rotation(degrees: 90, vertical: false), "clamped to 90")
    eq(X.rotation(["rt": "v"]), X.Rotation(degrees: 0, vertical: true), "stacked")
    eq(X.rotation(["rt": "x"]).isNone, true, "unknown text = none")
    // rotatedBox (web: w = 0.55em per char, h = 1.25em per line)
    let flat = X.rotatedBox("abcd", X.Rotation(), px: 10)
    eq(flat.w, 22, "flat width")
    eq(flat.h, 12.5, "flat height")
    let up = X.rotatedBox("abcd", X.Rotation(degrees: 90, vertical: false), px: 10)
    check(abs(up.h - 22) < 1e-9 && abs(up.w - 12.5) < 1e-9, "90° swaps the box: \(up)")
    let v = X.rotatedBox("abc", X.Rotation(degrees: 0, vertical: true), px: 10)
    check(abs(v.w - 12) < 1e-9 && abs(v.h - 33) < 1e-9, "stacked: one column, 1.1em per char: \(v)")
    // auto row height
    eq(X.autoRowHeight([], defaultHeight: 32), nil, "nothing styled")
    eq(X.autoRowHeight([(style: ["b": 1], text: "x")], defaultHeight: 32), nil, "small font, no rotation")
    eq(X.autoRowHeight([(style: ["rt": 90], text: "Penjualan")], defaultHeight: 32), 72, "rotated text grows the row (9×13×0.55+8)")
    eq(X.autoRowHeight([(style: ["fp": 24], text: "")], defaultHeight: 32), 50, "big empty cell: 32px × 1.3 + 8")
    eq(X.autoRowHeight([(style: ["fp": 36], text: "Judul")], defaultHeight: 32), 70, "big font, one line")
    eq(X.autoRowHeight([(style: ["rt": "v"], text: String(repeating: "x", count: 100))], defaultHeight: 32), 400, "capped at 400")

    // chart anchors
    let P = SheetChartPlace.self
    eq(P.visibleColumn(model: 2, visCols: [0, 1, 2, 3]), 2, "visible anchor column")
    eq(P.visibleColumn(model: 2, visCols: [0, 1, 3]), 2, "hidden anchor column → the next visible one")
    eq(P.visibleColumn(model: 5, visCols: [0, 1, 3]), 3, "past the last column")
    let cols: [Double] = [0, 110, 220, 330], rows: [Double] = [0, 32, 64, 96]
    let a = P.anchor(x: 250, y: 40, colStarts: cols, rowStarts: rows)
    check(a.r == 1 && a.c == 2 && a.dx == 30 && a.dy == 8, "inside C2 + (30, 8): \(a)")
    let b = P.anchor(x: -12, y: -5, colStarts: cols, rowStarts: rows)
    check(b.r == 0 && b.c == 0 && b.dx == -12 && b.dy == -5, "above / left of the sheet: \(b)")
    let c = P.anchor(x: 999, y: 999, colStarts: cols, rowStarts: rows)
    check(c.r == 2 && c.c == 2 && c.dx == 779 && c.dy == 935, "past the end: last cell: \(c)")
    let d = P.anchor(x: 110, y: 32, colStarts: cols, rowStarts: rows)
    check(d.r == 1 && d.c == 1 && d.dx == 0 && d.dy == 0, "on an edge: the cell that starts there: \(d)")
}
