import Foundation

// Pure, Foundation-only pieces of the grid's Sheets parity (13 Oct 2026): borders (the web's
// components/sheets/sheet-style.ts applyBorderPreset / cellBorders / clearNeighbourEdge / patchStyle),
// merged cells in screen space, long-text overflow into empty neighbours, colours (lib/sheet-palette.ts)
// and the freeze rules. Tested on Linux in Tests/SheetModel.

// MARK: - styles and borders

enum SheetGridStyle {
    static let borderLines = ["thin", "medium", "thick", "dotted", "dashed", "double"]

    /// One drawn edge: line style + colour (nil colour = the text colour).
    struct Edge: Equatable {
        var s: String
        var c: String? = nil

        init(s: String, c: String? = nil) { self.s = s; self.c = c }
        init?(json: Any?) {
            guard let o = json as? [String: Any], let s = o["s"] as? String, SheetGridStyle.borderLines.contains(s) else { return nil }
            self.s = s
            c = o["c"] as? String
        }
        var json: [String: Any] { c.map { ["s": s, "c": $0] } ?? ["s": s] }
    }

    /// t / b / l / r edges of one cell.
    struct Borders: Equatable {
        var t: Edge? = nil
        var b: Edge? = nil
        var l: Edge? = nil
        var r: Edge? = nil
        var isEmpty: Bool { t == nil && b == nil && l == nil && r == nil }
        var json: [String: Any] {
            var o: [String: Any] = [:]
            if let t { o["t"] = t.json }
            if let b { o["b"] = b.json }
            if let l { o["l"] = l.json }
            if let r { o["r"] = r.json }
            return o
        }
    }

    /// Every drawn edge of a cell: `bx` per side, the legacy `bd` sides (thin, text colour) where bx has none.
    static func cellBorders(_ st: [String: Any]?) -> Borders {
        var out = Borders()
        for side in (st?["bd"] as? String) ?? "" {
            switch side {
            case "t": out.t = Edge(s: "thin")
            case "b": out.b = Edge(s: "thin")
            case "l": out.l = Edge(s: "thin")
            case "r": out.r = Edge(s: "thin")
            default: break
            }
        }
        if let bx = st?["bx"] as? [String: Any] {
            if let e = Edge(json: bx["t"]) { out.t = e }
            if let e = Edge(json: bx["b"]) { out.b = e }
            if let e = Edge(json: bx["l"]) { out.l = e }
            if let e = Edge(json: bx["r"]) { out.r = e }
        }
        return out
    }

    /// Apply a patch to a style; keys set to nil / NSNull / false / "" / "auto" are removed. Empty → nil.
    static func patchStyle(_ st: [String: Any]?, _ patch: [String: Any?]) -> [String: Any]? {
        var next = st ?? [:]
        for (k, v) in patch {
            guard let v, !(v is NSNull) else { next[k] = nil; continue }
            if let b = v as? Bool, !b { next[k] = nil; continue }
            if let s = v as? String, s.isEmpty || s == "auto" { next[k] = nil; continue }
            next[k] = v
        }
        return next.isEmpty ? nil : next
    }

    /// The ten presets of the Borders panel, in Sheets' order.
    static let presets = ["all", "inner", "horizontal", "vertical", "outer", "left", "top", "right", "bottom", "clear"]

    struct Rect: Equatable {
        var top: Int, bottom: Int, left: Int, right: Int
        init(top: Int, bottom: Int, left: Int, right: Int) { self.top = top; self.bottom = bottom; self.left = left; self.right = right }
    }

    /// The new `bx` of the cell at (r, c) when `preset` is applied to the block `rect` (nil = none). The
    /// legacy `bd` is always dropped by the caller. An edge between two cells of the block is stored ONCE —
    /// as the bottom of the upper cell / the right of the left cell.
    static func applyBorderPreset(_ preset: String, r: Int, c: Int, rect: Rect, current: [String: Any]?,
                                  line: String = "thin", color: String? = nil) -> Borders? {
        if preset == "clear" { return nil }
        var spec = cellBorders(current)
        let edge: Edge = color.flatMap { isHex($0) ? Edge(s: line, c: $0.lowercased()) : nil } ?? Edge(s: line)
        let top = r == rect.top, bottom = r == rect.bottom, left = c == rect.left, right = c == rect.right
        switch preset {
        case "all":
            spec.b = edge; spec.r = edge
            spec.t = top ? edge : nil
            spec.l = left ? edge : nil
        case "inner":
            if !bottom { spec.b = edge }
            if !right { spec.r = edge }
            if !top { spec.t = nil }
            if !left { spec.l = nil }
        case "horizontal":
            if !bottom { spec.b = edge }
            if !top { spec.t = nil }
        case "vertical":
            if !right { spec.r = edge }
            if !left { spec.l = nil }
        case "outer":
            if top { spec.t = edge }
            if bottom { spec.b = edge }
            if left { spec.l = edge }
            if right { spec.r = edge }
        case "left": if left { spec.l = edge }
        case "top": if top { spec.t = edge }
        case "right": if right { spec.r = edge }
        case "bottom": if bottom { spec.b = edge }
        default: break
        }
        return spec.isEmpty ? nil : spec
    }

    /// The side of a NEIGHBOUR sharing the block's edge ("b" of the cell above, "r" of the cell to the
    /// left): its borders without that side, or `.none` when it carries nothing there (nothing to change).
    static func clearNeighbourEdge(_ neighbour: [String: Any]?, side: String) -> Borders?? {
        var spec = cellBorders(neighbour)
        if side == "b" { if spec.b == nil { return .none }; spec.b = nil }
        else { if spec.r == nil { return .none }; spec.r = nil }
        return .some(spec.isEmpty ? nil : spec)
    }

    /// A style with new borders (bx) and the legacy bd dropped; nil when nothing is left.
    static func withBorders(_ st: [String: Any]?, _ b: Borders?) -> [String: Any]? {
        patchStyle(st, ["bx": b.map { $0.json as Any }, "bd": nil])
    }

    /// The style changes of a Borders preset over a block of MODEL positions (rows / cols are the model
    /// indices of the block, in screen order), plus the neighbours above / to the left that share its edge.
    /// `styleAt(row, col)` reads a cell's current style. Returns (rowIndex, colIndex, new style).
    static func borderChanges(preset: String, rows: [Int], cols: [Int], above: Int?, leftCol: Int?,
                              line: String, color: String?, styleAt: (Int, Int) -> [String: Any]?) -> [(Int, Int, [String: Any]?)] {
        guard !rows.isEmpty, !cols.isEmpty else { return [] }
        let rect = Rect(top: 0, bottom: rows.count - 1, left: 0, right: cols.count - 1)
        var out: [(Int, Int, [String: Any]?)] = []
        for (ri, r) in rows.enumerated() {
            for (ci, c) in cols.enumerated() {
                let cur = styleAt(r, c)
                let b = applyBorderPreset(preset, r: ri, c: ci, rect: rect, current: cur, line: line, color: color)
                out.append((r, c, withBorders(cur, b)))
            }
        }
        if ["clear", "all", "outer", "top"].contains(preset), let above {
            for c in cols {
                let cur = styleAt(above, c)
                if case .some(let b) = clearNeighbourEdge(cur, side: "b") { out.append((above, c, withBorders(cur, b))) }
            }
        }
        if ["clear", "all", "outer", "left"].contains(preset), let leftCol {
            for r in rows {
                let cur = styleAt(r, leftCol)
                if case .some(let b) = clearNeighbourEdge(cur, side: "r") { out.append((r, leftCol, withBorders(cur, b))) }
            }
        }
        return out
    }

    // MARK: colours (lib/sheet-palette.ts)

    static func isHex(_ s: String?) -> Bool {
        guard let s, s.count == 7, s.hasPrefix("#") else { return false }
        return UInt32(s.dropFirst(), radix: 16) != nil
    }

    static let legacyHex: [String: String] = [
        "black": "#000000", "slate": "#94a3b8", "red": "#ef4444", "orange": "#f97316", "amber": "#fbbf24", "green": "#22c55e",
        "teal": "#14b8a6", "blue": "#3b82f6", "violet": "#8b5cf6", "pink": "#ec4899", "rose": "#f43f5e",
    ]

    /// Any stored colour (hex, short hex, legacy name) → "#rrggbb" lower case; nil when unknown / empty.
    static func toHex(_ c: String?) -> String? {
        guard let c else { return nil }
        let v = c.trimmingCharacters(in: .whitespaces)
        if v.isEmpty { return nil }
        if isHex(v) { return v.lowercased() }
        if v.count == 4, v.hasPrefix("#"), UInt32(v.dropFirst(), radix: 16) != nil {
            return ("#" + v.dropFirst().map { "\($0)\($0)" }.joined()).lowercased()
        }
        return legacyHex[v.lowercased()]
    }

    private static func luminance(_ hex: String) -> Double {
        let chars = Array(hex)
        func ch(_ i: Int) -> Double {
            let v = Double(UInt8(String(chars[i...(i + 1)]), radix: 16) ?? 0) / 255
            return v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5)
    }

    /// Black or white, whichever reads better on this background (WCAG contrast).
    static func readableText(_ bg: String?) -> String {
        guard let h = toHex(bg) else { return "#000000" }
        let l = luminance(h)
        return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff"
    }

    /// Sheets' 10×8 swatch grid (greys, pure hues, light 3/2/1, dark 1/2/3).
    static let palette: [[String]] = [
        ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
        ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
        ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
        ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
        ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
        ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
        ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
        ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
    ]

    // MARK: fonts and numbers

    static let fontSizesPt = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36]
    static let defaultFontPt = 10

    /// The size the toolbar shows, in points (`fp` wins over the legacy `fs` px; default 10).
    static func fontPt(_ st: [String: Any]?) -> Double {
        if let fp = (st?["fp"] as? NSNumber)?.doubleValue, fp > 0 { return fp }
        if let fs = (st?["fs"] as? NSNumber)?.doubleValue, fs > 0 { return (fs * 3 / 4 * 2).rounded() / 2 }
        return Double(defaultFontPt)
    }

    /// The cell's font size in px (points × 4/3), when it has one.
    static func fontPx(_ st: [String: Any]?) -> Double? {
        if let fp = (st?["fp"] as? NSNumber)?.doubleValue, fp > 0 { return fp * 4 / 3 }
        if let fs = (st?["fs"] as? NSNumber)?.doubleValue, fs > 0 { return fs }
        return nil
    }

    /// Overflow (default), wrap or clip. The legacy `w: 1` flag means wrap; `wr` wins.
    static func wrapMode(_ st: [String: Any]?) -> String {
        if let wr = st?["wr"] as? String, ["o", "w", "c"].contains(wr) { return wr }
        return SheetFormula.jsTruthy(st?["w"]) ? "w" : "o"
    }

    /// How many decimals a shown number has ("1.234,50" → 2 in id-ID; "12.5%" → 1 in en-US).
    static func decimalsShown(_ text: String, english: Bool) -> Int {
        var t = text
        if t.hasSuffix("%") { t.removeLast() }
        let sep: Character = english ? "." : ","
        guard let i = t.firstIndex(of: sep) else { return 0 }
        return t[t.index(after: i)...].prefix { $0.isASCII && $0.isNumber }.count
    }
}

// MARK: - merged cells

enum SheetMerges {
    /// settings.merges: anchor row / column ids and spans in the UNDERLYING order.
    struct Spec: Equatable {
        var r: String, c: String, rs: Int, cs: Int
        init(r: String, c: String, rs: Int, cs: Int) { self.r = r; self.c = c; self.rs = rs; self.cs = cs }
        init?(json: Any?) {
            guard let o = json as? [String: Any], let r = o["r"] as? String, let c = o["c"] as? String else { return nil }
            self.r = r; self.c = c
            rs = max(1, (o["rs"] as? NSNumber)?.intValue ?? 1)
            cs = max(1, (o["cs"] as? NSNumber)?.intValue ?? 1)
        }
        var json: [String: Any] { ["r": r, "c": c, "rs": rs, "cs": cs] }
    }

    /// The merges as blocks of VISIBLE positions. Hidden rows / columns inside a merge are skipped; a merge
    /// left with one visible cell is dropped. Only meaningful while rows are in sheet order (`visRows`
    /// ascending) — callers pass [] otherwise (web: merges are drawn in natural order only).
    static func resolve(_ specs: [Spec], rowIds: [String], colIds: [String], visRows: [Int], visCols: [Int]) -> [SheetRange] {
        guard !specs.isEmpty else { return [] }
        var rowAt: [String: Int] = [:]
        for (i, id) in rowIds.enumerated() { rowAt[id] = i }
        var colAt: [String: Int] = [:]
        for (i, id) in colIds.enumerated() { colAt[id] = i }
        var visRowOf: [Int: Int] = [:]
        for (v, m) in visRows.enumerated() { visRowOf[m] = v }
        var visColOf: [Int: Int] = [:]
        for (v, m) in visCols.enumerated() { visColOf[m] = v }
        var out: [SheetRange] = []
        for m in specs {
            guard let r0 = rowAt[m.r], let c0 = colAt[m.c] else { continue }
            let vr = (r0..<min(rowIds.count, r0 + m.rs)).compactMap { visRowOf[$0] }
            let vc = (c0..<min(colIds.count, c0 + m.cs)).compactMap { visColOf[$0] }
            guard let top = vr.first, let bottom = vr.last, let left = vc.first, let right = vc.last else { continue }
            if top == bottom && left == right { continue }
            out.append(SheetRange(SheetPos(r: top, c: left), SheetPos(r: bottom, c: right)))
        }
        return out
    }

    /// The merged block a position belongs to.
    static func at(_ p: SheetPos, in merges: [SheetRange]) -> SheetRange? {
        merges.first { $0.contains(p) }
    }

    /// A range grown until it holds every merged block it touches (Sheets never selects half a merge).
    static func expand(_ r: SheetRange, with merges: [SheetRange]) -> SheetRange {
        guard !merges.isEmpty else { return r }
        var top = r.top, bottom = r.bottom, left = r.left, right = r.right
        var grew = true
        while grew {
            grew = false
            for m in merges where m.top <= bottom && m.bottom >= top && m.left <= right && m.right >= left {
                if m.top < top { top = m.top; grew = true }
                if m.bottom > bottom { bottom = m.bottom; grew = true }
                if m.left < left { left = m.left; grew = true }
                if m.right > right { right = m.right; grew = true }
            }
        }
        // Keep the anchor corner where it was so ⇧-arrows keep growing from the far corner.
        let a = SheetPos(r: r.a.r <= r.b.r ? top : bottom, c: r.a.c <= r.b.c ? left : right)
        let b = SheetPos(r: r.a.r <= r.b.r ? bottom : top, c: r.a.c <= r.b.c ? right : left)
        return SheetRange(a, b)
    }

    /// Freezing must not cut through a merged block (Sheets: "Sorry, you can't freeze rows that contain
    /// only part of a merged cell."). `index` = the model index of the merge's anchor row (or column).
    static func freezeCuts(_ specs: [Spec], n: Int, rows: Bool, index: (Spec) -> Int?) -> Bool {
        guard n > 0 else { return false }
        return specs.contains { m in
            guard let i = index(m) else { return false }
            let span = rows ? m.rs : m.cs
            return i < n && i + span > n
        }
    }
}

// MARK: - long text overflowing into empty neighbours

enum SheetSpill {
    /// One cell of a row, in screen order, as the overflow rule needs it.
    struct Cell {
        var width: Double
        /// Nothing in it (no value, no checkbox / dropdown, not part of a merge).
        var empty: Bool
        /// Text that may overflow: overflow wrap mode, not a number, not rotated, not merged.
        var canSpill: Bool
        /// The text's drawn width (0 when there is none).
        var textWidth: Double
        /// "l" | "c" | "r"
        var align: String
    }

    struct Extent: Equatable {
        var left: Double = 0
        var right: Double = 0
    }

    /// For every cell: how far its text runs over its neighbours, and which right-hand gridlines the text
    /// covers (Sheets hides the line under a spill). Text stops at the first non-empty neighbour, and never
    /// crosses the frozen-column edge (`barrier` = first scrolled column; 0 = none). Left-aligned text runs
    /// right, right-aligned runs left, centred runs both ways by the same amount. `padding` is the cell's
    /// inner horizontal padding (both sides together).
    static func row(_ cells: [Cell], barrier: Int = 0, padding: Double = 10, cap: Double = 2000) -> (extents: [Extent], hideRightLine: [Bool]) {
        var ext = [Extent](repeating: Extent(), count: cells.count)
        var hide = [Bool](repeating: false, count: cells.count)
        func sameSide(_ a: Int, _ b: Int) -> Bool { barrier <= 0 || (a < barrier) == (b < barrier) }
        for (i, cell) in cells.enumerated() where cell.canSpill && !cell.empty {
            let need = cell.textWidth + padding - cell.width
            guard need > 0.5 else { continue }
            switch cell.align {
            case "r":
                var got = 0.0, k = i - 1
                while k >= 0, got < need, got < cap, cells[k].empty, sameSide(k, i) { got += cells[k].width; k -= 1 }
                if got > 0 {
                    ext[i].left = got
                    for j in (k + 1)..<i { hide[j] = true }
                }
            case "c":
                let half = need / 2
                var l = 0.0, lk = i - 1
                while lk >= 0, l < half, l < cap, cells[lk].empty, sameSide(lk, i) { l += cells[lk].width; lk -= 1 }
                var r = 0.0, rk = i + 1
                while rk < cells.count, r < half, r < cap, cells[rk].empty, sameSide(rk, i) { r += cells[rk].width; rk += 1 }
                // Symmetric, so the text stays centred on its own cell.
                let both = min(l, r)
                if both > 0 {
                    ext[i].left = both
                    ext[i].right = both
                    // A right-hand line is covered when it lies strictly inside the text's span.
                    var acc = 0.0, j = i - 1
                    while j >= 0, acc < both { hide[j] = true; acc += cells[j].width; j -= 1 }
                    hide[i] = true
                    acc = 0; j = i + 1
                    while j < cells.count, acc + cells[j].width < both { acc += cells[j].width; hide[j] = true; j += 1 }
                }
            default:
                var got = 0.0, k = i + 1
                while k < cells.count, got < need, got < cap, cells[k].empty, sameSide(k, i) { got += cells[k].width; k += 1 }
                if got > 0 {
                    ext[i].right = got
                    for j in i..<(k - 1) { hide[j] = true }
                }
            }
        }
        return (ext, hide)
    }
}

// MARK: - hidden rows / columns between visible ones

enum SheetHiddenGaps {
    /// For each visible index (and one past the end): the model indices hidden just BEFORE it (by the
    /// sheet's hiddenRows / hiddenCols only — not by a filter or a collapsed group). Visible indices
    /// without hidden neighbours are absent.
    static func gaps(visible: [Int], count: Int, hidden: (Int) -> Bool) -> [Int: [Int]] {
        var out: [Int: [Int]] = [:]
        var prev = -1
        for (v, m) in visible.enumerated() {
            let between = ((prev + 1)..<max(prev + 1, m)).filter(hidden)
            if !between.isEmpty { out[v] = between }
            prev = m
        }
        let tail = ((prev + 1)..<max(prev + 1, count)).filter(hidden)
        if !tail.isEmpty { out[visible.count] = tail }
        return out
    }
}

// MARK: - font families, text rotation, auto row height (web lib/sheet-palette.ts, sheet-style.ts)

enum SheetGridText {
    /// "Default" (stored as nothing) = the app's own font.
    static let defaultFont = "Default"

    /// The web's FONT_FAMILIES (what a cell stores in `ff`), each with the iOS / Mac fonts tried in order;
    /// a name ending in ":serif" / ":mono" / ":rounded" is a system design used as the last resort.
    static let fontFamilies: [(name: String, ios: [String])] = [
        ("Arial", ["Arial", "Helvetica"]),
        ("Calibri", ["Calibri", "Carlito"]),
        ("Cambria", ["Cambria", "Caladea", "Georgia", ":serif"]),
        ("Comic Sans MS", ["Comic Sans MS", "Chalkboard SE", ":rounded"]),
        ("Consolas", ["Consolas", "Menlo", ":mono"]),
        ("Courier New", ["Courier New", "Courier", ":mono"]),
        ("Georgia", ["Georgia", ":serif"]),
        ("Helvetica", ["Helvetica", "Helvetica Neue"]),
        ("Impact", ["Impact", "Futura", "Avenir Next Condensed"]),
        ("Lucida Console", ["Lucida Console", "Monaco", "Menlo", ":mono"]),
        ("Segoe UI", ["Segoe UI"]),
        ("Tahoma", ["Tahoma", "Verdana"]),
        ("Times New Roman", ["Times New Roman", "Times", ":serif"]),
        ("Trebuchet MS", ["Trebuchet MS"]),
        ("Verdana", ["Verdana"]),
        ("Serif", [":serif"]),
        ("Sans Serif", []),
        ("Monospace", [":mono"]),
    ]

    /// The stored family of a style (nil = the default font).
    static func family(_ st: [String: Any]?) -> String? {
        guard let ff = st?["ff"] as? String, !SheetJS.trim(ff).isEmpty, ff.lowercased() != defaultFont.lowercased() else { return nil }
        return ff
    }

    /// The fonts to try for a stored family: the known list's, else the name itself (web fontStack).
    static func candidates(_ family: String) -> [String] {
        if let f = fontFamilies.first(where: { $0.name.lowercased() == family.lowercased() }) { return f.ios }
        return [family]
    }

    /// Text rotation `rt`: degrees counter-clockwise (−90…90), or "v" = stacked vertically.
    struct Rotation: Equatable {
        var degrees: Double = 0
        var vertical = false
        var isNone: Bool { !vertical && degrees == 0 }
    }

    static func rotation(_ st: [String: Any]?) -> Rotation {
        guard let rt = st?["rt"] else { return Rotation() }
        if let s = rt as? String { return s == "v" ? Rotation(degrees: 0, vertical: true) : Rotation() }
        if case .number(let n) = SheetFormula.kind(rt), n.isFinite { return Rotation(degrees: min(max(n, -90), 90), vertical: false) }
        return Rotation()
    }

    /// The rotation menu's presets (web RotationMenu), English labels.
    static let rotationPresets: [(value: Any?, label: String)] = [
        (nil, "None"), (45, "Tilt up"), (-45, "Tilt down"), ("v", "Stack vertically"), (90, "Rotate up"), (-90, "Rotate down"),
    ]

    /// Rough box a rotated text needs (web rotatedBox, for the automatic row height): ≈ 0.55em per character.
    static func rotatedBox(_ text: String, _ rot: Rotation, px: Double) -> (w: Double, h: Double) {
        let lines = text.components(separatedBy: "\n")
        let longest = Double(lines.map { $0.utf16.count }.max() ?? 0)
        let w = longest * px * 0.55
        let h = Double(lines.count) * px * 1.25
        if rot.vertical {
            let chars = Double(lines.map { $0.count }.max() ?? 0)
            return (Double(lines.count) * px * 1.2, chars * px * 1.1)
        }
        if rot.degrees == 0 { return (w, h) }
        let a = abs(rot.degrees) * Double.pi / 180
        return (w * cos(a) + h * sin(a), w * sin(a) + h * cos(a))
    }

    /// Automatic row height of a row without a height of its own (web autoHeights, without measuring
    /// wrapped text): rotated text and large fonts grow the row. `cells` = (style, shown text) of the row's
    /// styled cells. nil = the default height.
    static func autoRowHeight(_ cells: [(style: [String: Any], text: String)], defaultHeight: Double, maxHeight: Double = 400) -> Double? {
        var h = 0.0
        for (st, text) in cells {
            let px = SheetGridStyle.fontPx(st) ?? 13
            let big = px > 14
            let rot = rotation(st)
            if !big && rot.isNone { continue }
            if text.isEmpty { if big { h = max(h, (px * 1.3 + 8).rounded()) }; continue }
            if !rot.isNone { h = max(h, (rotatedBox(text, rot, px: px).h + 8).rounded()); continue }
            // Wrapped text is not measured here: one line is the floor (web measures the lines).
            h = max(h, (px * 1.3 + 8).rounded())
        }
        return h > defaultHeight ? min(maxHeight, h) : nil
    }
}

// MARK: - charts floating on the grid (web SheetGrid anchorXY / anchorFromXY)

enum SheetChartPlace {
    /// The visible column a chart anchored at model column `model` starts in: that column, or the next
    /// visible one when it is hidden (a hidden column has no width); `visCols.count` = past the last one.
    static func visibleColumn(model: Int, visCols: [Int]) -> Int {
        visCols.firstIndex { $0 >= model } ?? visCols.count
    }

    /// A point in the sheet (content coordinates) as an anchor: the cell it falls in and the offset from
    /// that cell's top-left (`starts` = the running edges, first 0). Points above / left of the sheet
    /// anchor to the first row / column with a negative offset, like the web.
    static func anchor(x: Double, y: Double, colStarts: [Double], rowStarts: [Double]) -> (r: Int, c: Int, dx: Double, dy: Double) {
        var c = 0
        while c < colStarts.count - 2 && colStarts[c + 1] <= x { c += 1 }
        var r = 0
        while r < rowStarts.count - 2 && rowStarts[r + 1] <= y { r += 1 }
        let left = colStarts.isEmpty ? 0 : colStarts[min(c, colStarts.count - 1)]
        let top = rowStarts.isEmpty ? 0 : rowStarts[min(r, rowStarts.count - 1)]
        return (r, c, (x - left).rounded(), (y - top).rounded())
    }

    static let minWidth = 120.0
    static let minHeight = 80.0
}
