import Foundation

// Plain value types of the native spreadsheet: rows as the server sends them, cell positions, ranges and
// the selection. Foundation only, so they are tested on Linux with the formula engine.

typealias SheetJSON = [String: Any]

/// One edit of the cells route: the row and its changed values (NSNull = clear) or styles.
struct SheetCellEdit {
    let rowId: String
    var values: [String: Any]

    var json: SheetJSON { ["rowId": rowId, "values": values] }
}

/// One SheetRow: `cells` / `styles` keyed by column id, exactly as the server stores them.
struct SheetRowModel {
    let id: String
    var position: Double
    var cells: [String: Any]
    var styles: [String: [String: Any]]
    var height: Int?
    var updatedAt: String

    init?(_ o: [String: Any]) {
        guard let id = o["id"] as? String else { return nil }
        self.id = id
        position = (o["position"] as? NSNumber)?.doubleValue ?? 0
        cells = (o["cells"] as? [String: Any]) ?? [:]
        styles = (o["styles"] as? [String: [String: Any]]) ?? [:]
        height = (o["height"] as? NSNumber)?.intValue
        updatedAt = o["updatedAt"] as? String ?? ""
    }

    init(id: String, position: Double, cells: [String: Any] = [:], styles: [String: [String: Any]] = [:]) {
        self.id = id
        self.position = position
        self.cells = cells
        self.styles = styles
        height = nil
        updatedAt = ""
    }

    var json: [String: Any] {
        var o: [String: Any] = ["id": id, "position": position, "cells": cells, "updatedAt": updatedAt]
        if !styles.isEmpty { o["styles"] = styles }
        if let height { o["height"] = height }
        return o
    }
}

/// A cell by its place on screen: the index among the VISIBLE rows / columns.
struct SheetPos: Hashable {
    var r: Int
    var c: Int
}

/// A rectangle of cells, from its anchor `a` (where the drag started) to `b`.
struct SheetRange: Equatable {
    var a: SheetPos
    var b: SheetPos

    init(_ a: SheetPos, _ b: SheetPos) { self.a = a; self.b = b }
    init(_ p: SheetPos) { self.a = p; self.b = p }

    var top: Int { min(a.r, b.r) }
    var bottom: Int { max(a.r, b.r) }
    var left: Int { min(a.c, b.c) }
    var right: Int { max(a.c, b.c) }
    var rowCount: Int { bottom - top + 1 }
    var colCount: Int { right - left + 1 }
    var isSingle: Bool { a == b }

    func contains(_ p: SheetPos) -> Bool { p.r >= top && p.r <= bottom && p.c >= left && p.c <= right }

    /// Every position, row by row.
    var positions: [SheetPos] {
        var out: [SheetPos] = []
        for r in top...bottom { for c in left...right { out.append(SheetPos(r: r, c: c)) } }
        return out
    }
}

/// The selection: the active cell plus one or more ranges (⌘-click adds one, like Sheets).
struct SheetSelection: Equatable {
    var active: SheetPos
    var ranges: [SheetRange]

    init(_ p: SheetPos = SheetPos(r: 0, c: 0)) {
        active = p
        ranges = [SheetRange(p)]
    }

    var current: SheetRange { ranges.last ?? SheetRange(active) }
    var isSingleCell: Bool { ranges.count == 1 && current.isSingle }

    func contains(_ p: SheetPos) -> Bool { ranges.contains { $0.contains(p) } }

    /// Plain click / tap / arrow: one cell.
    mutating func select(_ p: SheetPos) {
        active = p
        ranges = [SheetRange(p)]
    }

    /// Shift-click, shift-arrow, drag: the current range runs from its anchor to `p`; the active cell stays.
    mutating func extend(to p: SheetPos) {
        let anchor = current.a
        if ranges.isEmpty { ranges = [SheetRange(anchor, p)] } else { ranges[ranges.count - 1] = SheetRange(anchor, p) }
    }

    /// ⌘-click: another range, which becomes the current one.
    mutating func add(_ p: SheetPos) {
        active = p
        ranges.append(SheetRange(p))
    }

    /// Keep everything inside a sheet of this size (rows / cols removed elsewhere).
    mutating func clamp(rows: Int, cols: Int) {
        let maxR = max(0, rows - 1), maxC = max(0, cols - 1)
        func fix(_ p: SheetPos) -> SheetPos { SheetPos(r: min(max(0, p.r), maxR), c: min(max(0, p.c), maxC)) }
        active = fix(active)
        ranges = ranges.map { SheetRange(fix($0.a), fix($0.b)) }
        if ranges.isEmpty { ranges = [SheetRange(active)] }
    }
}

/// Where Enter goes after Tab (Sheets: back to the column the Tab run started in).
struct SheetEntryCursor: Equatable {
    var tabStartColumn: Int?
}

/// Cell writes waiting for the server, per sheet: the newest value per (row, column) wins. NSNull = clear.
/// Pure so its merging is tested on Linux; the store owns the network side.
struct SheetPendingWrites {
    /// rowId → columnId → value
    private(set) var values: [String: [String: Any]] = [:]
    private(set) var styles: [String: [String: Any]] = [:]
    /// Row order of first appearance, so a batch goes out in the order it was made.
    private(set) var order: [String] = []

    var isEmpty: Bool { values.isEmpty && styles.isEmpty }
    var count: Int { values.values.reduce(0) { $0 + $1.count } + styles.values.reduce(0) { $0 + $1.count } }

    mutating func put(row: String, col: String, value: Any?) {
        if values[row] == nil && styles[row] == nil { order.append(row) }
        values[row, default: [:]][col] = value ?? NSNull()
    }

    mutating func putStyle(row: String, col: String, style: [String: Any]?) {
        if values[row] == nil && styles[row] == nil { order.append(row) }
        styles[row, default: [:]][col] = style ?? NSNull()
    }

    /// Takes up to `maxRows` rows out for one request.
    mutating func take(maxRows: Int) -> (values: [SheetCellEdit], styles: [SheetCellEdit]) {
        let rows = Array(order.prefix(maxRows))
        order.removeFirst(rows.count)
        var v: [SheetCellEdit] = [], s: [SheetCellEdit] = []
        for row in rows {
            if let vals = values.removeValue(forKey: row), !vals.isEmpty { v.append(SheetCellEdit(rowId: row, values: vals)) }
            if let st = styles.removeValue(forKey: row), !st.isEmpty { s.append(SheetCellEdit(rowId: row, values: st)) }
        }
        return (v, s)
    }

    /// A batch that could not be sent goes back UNDER anything written since (newer values win).
    mutating func restore(values v: [SheetCellEdit], styles s: [SheetCellEdit]) {
        var front: [String] = []
        for e in v {
            var merged = e.values
            for (k, val) in values[e.rowId] ?? [:] { merged[k] = val }
            values[e.rowId] = merged
            if !front.contains(e.rowId) { front.append(e.rowId) }
        }
        for e in s {
            var merged = e.values
            for (k, val) in styles[e.rowId] ?? [:] { merged[k] = val }
            styles[e.rowId] = merged
            if !front.contains(e.rowId) { front.append(e.rowId) }
        }
        order = front + order.filter { !front.contains($0) }
    }

    /// Rows deleted on the server: their writes are moot.
    mutating func drop(rows: Set<String>) {
        for r in rows { values[r] = nil; styles[r] = nil }
        order.removeAll { rows.contains($0) }
    }

    /// The pending value of a cell, if any (`.some(nil)` = a pending clear).
    func pendingValue(row: String, col: String) -> Any?? {
        guard let v = values[row]?[col] else { return nil }
        return .some(v is NSNull ? nil : v)
    }

    // MARK: disk

    var json: [String: Any] { ["values": values, "styles": styles, "order": order] }

    init() {}

    init(json o: [String: Any]) {
        values = (o["values"] as? [String: [String: Any]]) ?? [:]
        styles = (o["styles"] as? [String: [String: Any]]) ?? [:]
        let known = Set(values.keys).union(styles.keys)
        order = ((o["order"] as? [String]) ?? []).filter { known.contains($0) }
        for k in known.sorted() where !order.contains(k) { order.append(k) }
    }
}

/// A1 address of a visible position, through the model indices (letters follow the UNDERLYING column order).
enum SheetA1 {
    static func letters(_ index: Int) -> String {
        var n = index + 1, out = ""
        while n > 0 {
            let rem = (n - 1) % 26
            out = String(UnicodeScalar(UInt8(65 + rem))) + out
            n = (n - 1) / 26
        }
        return out
    }

    static func address(row: Int, col: Int) -> String { "\(letters(col))\(row + 1)" }

    static func range(top: Int, left: Int, bottom: Int, right: Int) -> String {
        let a = address(row: top, col: left)
        if top == bottom && left == right { return a }
        return a + ":" + address(row: bottom, col: right)
    }
}
