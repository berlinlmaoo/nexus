import SwiftUI
import UIKit

// The one place the screen talks to the formula engine port (SheetFormula*, SheetTypes, SheetValidation,
// SheetCF, SheetClipboard — mirrors of the web's lib/sheet-*.ts and components/sheets/sheet-types.ts). The
// grid and the store only see `SheetBridge.Snapshot` and `SheetCellDisplay`, so a change in the port touches
// this file and nothing else.

/// One dropdown choice as a chip.
struct SheetChip {
    let text: String
    let background: UIColor
    let foreground: UIColor

    /// A choice colour (web CHIP_COLORS names, or a hex) as fill / text.
    static func fillColor(_ key: String?) -> Color { Color(uiColor: uiFill(key)) }
    static func textColor(_ key: String?) -> Color { Color(uiColor: uiText(key)) }

    static func uiFill(_ key: String?) -> UIColor {
        if let key, let hex = SheetBridge.hexColor(key) { return hex.withAlphaComponent(0.22) }
        return SheetBridge.paletteColor(key ?? "slate").withAlphaComponent(0.18)
    }

    static func uiText(_ key: String?) -> UIColor {
        if let key, let hex = SheetBridge.hexColor(key) { return hex }
        return SheetBridge.paletteColor(key ?? "slate")
    }
}

/// How one cell is drawn.
struct SheetCellDisplay {
    var text = ""
    var alignment: NSTextAlignment = .left
    var bold = false
    var italic = false
    var strike = false
    var underline = false
    var textColor: UIColor?
    var fill: UIColor?
    var wrap = false
    var isError = false
    var isLink = false
    /// nil = not a checkbox cell.
    var checkbox: Bool?
    var chips: [SheetChip] = []
    var invalid = false
    /// Has unresolved comments (amber corner, as on the web).
    var commented = false
    var fontSize: CGFloat?
    /// 0 top, 1 middle, 2 bottom (Sheets' default).
    var verticalAlign = 2
    /// "o" overflow (default), "w" wrap, "c" clip.
    var wrapMode = "o"
    /// The computed value is a number (numbers never overflow into neighbours).
    var numeric = false
    /// Nothing stored in the cell (an empty neighbour that overflowing text may run over).
    var blank = true
    /// A validation rule or a dropdown column covers the cell (text never runs over it).
    var hasRule = false
    /// Rotated text (never overflows).
    var rotated = false
    /// Drawn borders (bx, legacy bd).
    var borders = SheetGridStyle.Borders()
    /// The header row of the filter: nil = not a filter header, false / true = the column filters nothing / something.
    var filterHead: Bool?
}

/// The active cell's dropdown.
struct SheetDropdown {
    let options: [String]
    let colors: [String: String]
    let multiple: Bool
    let picked: [String]
}

@MainActor
enum SheetBridge {
    /// The engine and lookups for one version of the sheet. Rebuilt on every change; the engine is derived
    /// from the previous one so only what changed recomputes.
    final class Snapshot {
        let columns: [SheetColumn]
        let rows: [SheetRowModel]
        let shape: SheetShape
        let engine: SheetEngine
        private let ruleAt: (Int, Int) -> SheetValidation.ValidationRule?
        private let condAt: (Int, Int) -> SheetCF.CondStyle?
        private let locale: SheetFormula.SheetLocale

        init(columns: [SheetColumn], rows: [SheetRowModel], settings: SheetJSON, previous: Snapshot?) {
            self.columns = columns
            self.rows = rows
            let localeName = settings["locale"] as? String ?? "id-ID"
            SheetFormula.setDisplayLocale(localeName)
            locale = localeName == "en-US" ? .en : .id
            var names: [(name: String, range: String)] = []
            for n in (settings["namedRanges"] as? [SheetJSON]) ?? [] {
                if let name = n["name"] as? String, let range = n["range"] as? String { names.append((name, range)) }
            }
            let data = SheetData(columns: columns.map { ($0.id, $0.type) }, rows: rows.map { ($0.id, $0.cells) },
                                 names: names.isEmpty ? nil : names)
            shape = data.shape
            engine = SheetFormula.engineFor(data, previous?.engine)
            let rules = ((settings["validations"] as? [SheetJSON]) ?? []).compactMap { SheetValidation.ValidationRule(json: $0) }
            ruleAt = SheetValidation.buildRuleIndex(rules, data.shape)
            let conds = ((settings["condFormats"] as? [SheetJSON]) ?? []).compactMap { SheetCF.CondRule(json: $0) }
            condAt = conds.isEmpty ? { _, _ in nil } : SheetCF.buildCondFormatter(conds, data.shape, engine)
        }

        // MARK: rules

        /// The validation rule of a cell: an explicit rule, else a dropdown column's own choices (web SheetMobile).
        func rule(row: Int, col: Int) -> SheetValidation.ValidationRule? {
            if let r = ruleAt(row, col) { return r }
            guard columns.indices.contains(col) else { return nil }
            let c = columns[col]
            guard c.type == "select" || c.type == "multiselect" else { return nil }
            let options = c.options ?? []
            var colors: [String: String] = [:]
            for (i, o) in options.enumerated() {
                colors[o] = c.optionColors?[o] ?? SheetTypes.CHIP_COLORS[i % SheetTypes.CHIP_COLORS.count]
            }
            return SheetValidation.ValidationRule(id: "col:\(c.id)", ranges: [], kind: .list, values: options,
                                                  colors: colors, multiple: c.type == "multiselect")
        }

        // MARK: display

        func display(row: Int, col: Int) -> SheetCellDisplay {
            guard rows.indices.contains(row), columns.indices.contains(col) else { return SheetCellDisplay() }
            let r = rows[row], c = columns[col]
            let raw = r.cells[c.id]
            let st = r.styles[c.id] ?? [:]
            let computed = engine.value(r.id, c.id)
            var d = SheetCellDisplay()

            let rule = self.rule(row: row, col: col)
            if c.type == "checkbox" {
                d.checkbox = SheetFormula.jsTruthy(raw)
            } else if let rule, rule.kind == .checkbox {
                d.checkbox = SheetValidation.isChecked(rule, raw)
            } else if let rule, SheetValidation.isDropdown(rule) {
                let picked = rule.multiple == true ? SheetValidation.pickedValues(raw) : SheetTypes.readMulti(raw).isEmpty ? [] : [editText(row: row, col: col)]
                d.chips = picked.filter { !$0.isEmpty }.map { v in
                    let key = rule.colors?[v]
                    return SheetChip(text: v, background: SheetChip.uiFill(key), foreground: SheetChip.uiText(key))
                }
            }
            if let rule {
                d.invalid = !SheetValidation.validateCell(rule, raw, computed, engine: engine, shape: shape, at: (row, col))
                d.hasRule = true
            }
            if let s = raw as? String { d.blank = s.isEmpty } else { d.blank = raw == nil || raw is NSNull }
            d.numeric = Self.isNumber(computed)
            d.borders = SheetGridStyle.cellBorders(st)

            d.text = text(raw: raw, computed: computed, column: c, rowId: r.id, style: st)
            d.isError = SheetFormula.isError(computed)
            d.isLink = SheetTypes.isLinkCell(raw)
            apply(style: st, to: &d, isNumber: Self.isNumber(computed))

            // Column rules (first match wins), then conditional formatting on top, as on the web.
            if let hit = SheetTypes.matchRule(c.ruleList, computed) { Self.applyRule(hit.style, to: &d) }
            if let cf = condAt(row, col) {
                if cf.b { d.bold = true }
                if cf.i { d.italic = true }
                if cf.u { d.underline = true }
                if cf.s { d.strike = true }
                if let fc = cf.fc, let color = hexColor(fc) { d.textColor = color }
                if let bg = cf.bg, let color = hexColor(bg) { d.fill = color }
            }
            if d.checkbox != nil { d.alignment = .center }
            return d
        }

        private func text(raw: Any?, computed: SheetCellValue, column c: SheetColumn, rowId: String, style st: [String: Any]) -> String {
            if c.type == "multiselect" { return SheetTypes.readMulti(raw).joined(separator: ", ") }
            let inferred: SheetFormula.NumFmt? = SheetFormula.isFormulaCell(raw) ? engine.format(rowId, c.id) : (c.type == "currency" ? .idr : nil)
            let dp = (st["dp"] as? NSNumber)?.intValue
            if let styled = SheetFormula.formatWithStyle(computed, st["nf"] as? String, dp, inferred, st["pt"] as? String) {
                return styled
            }
            return SheetTypes.displayCell(c.type, raw, (engine: engine, rowId: rowId, colId: c.id))
        }

        private static func isNumber(_ v: SheetCellValue) -> Bool {
            if case .number = v { return true }
            return false
        }

        private func apply(style st: [String: Any], to d: inout SheetCellDisplay, isNumber: Bool) {
            d.bold = SheetFormula.jsTruthy(st["b"])
            d.italic = SheetFormula.jsTruthy(st["i"])
            d.strike = SheetFormula.jsTruthy(st["s"])
            d.underline = SheetFormula.jsTruthy(st["u"])
            if let fc = st["fc"] as? String { d.textColor = SheetBridge.hexColor(fc) ?? SheetBridge.paletteColor(fc) }
            if let bg = st["bg"] as? String { d.fill = SheetBridge.hexColor(bg) ?? SheetBridge.paletteColor(bg).withAlphaComponent(0.18) }
            switch st["ha"] as? String {
            case "l": d.alignment = .left
            case "c": d.alignment = .center
            case "r": d.alignment = .right
            default: d.alignment = isNumber ? .right : .left
            }
            switch st["va"] as? String {
            case "t": d.verticalAlign = 0
            case "m": d.verticalAlign = 1
            default: d.verticalAlign = 2
            }
            d.wrapMode = SheetGridStyle.wrapMode(st)
            d.wrap = d.wrapMode == "w"
            if let px = SheetGridStyle.fontPx(st) { d.fontSize = CGFloat(min(max(px, 8), 96)) }
            d.rotated = st["rt"] != nil
            // A hex fill without a text colour gets black or white text, so a light fill stays readable in
            // dark mode (web styleInline).
            if st["fc"] == nil, let bg = st["bg"] as? String, SheetGridStyle.isHex(bg),
               let readable = SheetBridge.hexColor(SheetGridStyle.readableText(bg)) {
                d.textColor = readable
            }
        }

        private static func applyRule(_ style: String, to d: inout SheetCellDisplay) {
            switch style {
            case "bold": d.bold = true
            case "red": d.textColor = .systemRed; d.fill = UIColor.systemRed.withAlphaComponent(0.10)
            case "amber": d.textColor = .systemOrange; d.fill = UIColor.systemOrange.withAlphaComponent(0.12)
            case "green": d.textColor = .systemGreen; d.fill = UIColor.systemGreen.withAlphaComponent(0.12)
            case "blue": d.textColor = .systemBlue; d.fill = UIColor.systemBlue.withAlphaComponent(0.10)
            default: d.textColor = .secondaryLabel; d.fill = UIColor.secondarySystemFill
            }
        }

        private func hexColor(_ s: String) -> UIColor? { SheetBridge.hexColor(s) }

        // MARK: filter (lib/sheet-filter.ts through SheetFilter)

        private lazy var rowIndex: [String: Int] = {
            var o: [String: Int] = [:]
            for (i, r) in rows.enumerated() { o[r.id] = i }
            return o
        }()
        private lazy var colIndex: [String: Int] = {
            var o: [String: Int] = [:]
            for (i, c) in columns.enumerated() { o[c.id] = i }
            return o
        }()

        /// The text "Filter by values" compares (web displayCell, not the number-format text).
        func filterDisplay(_ rowId: String, _ colId: String) -> String {
            guard let r = rowIndex[rowId], let c = colIndex[colId] else { return "" }
            return SheetTypes.displayCell(columns[c].type, rows[r].cells[colId], (engine: engine, rowId: rowId, colId: colId))
        }

        /// The fill / text colour a cell shows (conditional formatting over its own format), as hex.
        func filterStyle(_ rowId: String, _ colId: String) -> (bg: String?, fc: String?)? {
            guard let r = rowIndex[rowId], let c = colIndex[colId] else { return nil }
            let own = rows[r].styles[colId]
            let cf = condAt(r, c)
            let bg = cf?.bg ?? SheetGridStyle.toHex(own?["bg"] as? String)
            let fc = cf?.fc ?? SheetGridStyle.toHex(own?["fc"] as? String)
            return bg != nil || fc != nil ? (bg, fc) : nil
        }

        func filterOpts(slicers: [(colId: String, crit: SheetFilter.Crit?)] = []) -> SheetFilter.Opts {
            SheetFilter.Opts(shape: shape, engine: engine,
                             display: { r, c in self.filterDisplay(r, c) },
                             styleOf: { r, c in self.filterStyle(r, c) },
                             slicers: slicers)
        }

        func value(_ rowId: String, _ colId: String) -> SheetCellValue { engine.value(rowId, colId) }

        // MARK: editing

        /// What the formula bar shows: a formula in A1 (the sheet's separators), else the value as typed.
        func editText(row: Int, col: Int) -> String {
            guard rows.indices.contains(row), columns.indices.contains(col) else { return "" }
            let raw = rows[row].cells[columns[col].id]
            return SheetTypes.editFormula(raw, shape, locale) ?? SheetTypes.editValue(columns[col].type, raw)
        }

        /// Typed text → the value to store (nil = clear).
        func input(text: String, row: Int, col: Int) -> Any? {
            guard rows.indices.contains(row), columns.indices.contains(col) else { return nil }
            let c = columns[col]
            return SheetTypes.inputToCell(c, text, shape, rows[row].cells[c.id])
        }

        func same(_ a: Any?, _ b: Any?) -> Bool { SheetTypes.sameCell(a, b) }

        /// The next value of a checkbox cell, or nil when the cell is not one.
        func toggledCheckbox(row: Int, col: Int) -> Any? {
            guard rows.indices.contains(row), columns.indices.contains(col) else { return nil }
            let c = columns[col]
            let raw = rows[row].cells[c.id]
            if c.type == "checkbox" { return !SheetFormula.jsTruthy(raw) }
            guard let rule = rule(row: row, col: col), rule.kind == .checkbox else { return nil }
            return SheetValidation.checkboxValue(rule, !SheetValidation.isChecked(rule, raw)) ?? NSNull()
        }

        func dropdown(row: Int, col: Int) -> SheetDropdown? {
            guard rows.indices.contains(row), columns.indices.contains(col),
                  let rule = rule(row: row, col: col), SheetValidation.isDropdown(rule) else { return nil }
            let raw = rows[row].cells[columns[col].id]
            let picked = rule.multiple == true ? SheetValidation.pickedValues(raw) : (editText(row: row, col: col).isEmpty ? [] : [editText(row: row, col: col)])
            return SheetDropdown(options: SheetValidation.dropdownOptions(rule, engine, shape), colors: rule.colors ?? [:],
                                 multiple: rule.multiple == true, picked: picked)
        }

        func number(row: Int, col: Int) -> Double? {
            guard rows.indices.contains(row), columns.indices.contains(col) else { return nil }
            if case .number(let n) = engine.value(rows[row].id, columns[col].id) { return n }
            return nil
        }

        func formatNumber(_ n: Double) -> String { SheetFormula.formatValue(.number(n), nil) }

        // MARK: clipboard

        /// The block as TSV (what other apps read), HTML and NEXUS JSON (values, formulas, formats).
        func copy(rows rowIdx: [Int], cols colIdx: [Int], cut: Bool) -> (tsv: String, html: String, json: String) {
            var cells: [[SheetClipboard.ClipCell]] = []
            for r in rowIdx {
                var line: [SheetClipboard.ClipCell] = []
                for c in colIdx {
                    let row = rows[r], col = columns[c]
                    let raw = row.cells[col.id]
                    line.append(SheetClipboard.ClipCell(text: display(row: r, col: c).text, raw: raw,
                                                        formula: SheetTypes.editFormula(raw, shape, .id),
                                                        style: row.styles[col.id]))
                }
                cells.append(line)
            }
            let out = SheetClipboard.buildClipboard(cells, origin: (rowIdx.first ?? 0, colIdx.first ?? 0), cut: cut,
                                                    types: colIdx.map { columns[$0].type })
            return (out.text, out.html, out.json)
        }

        /// What the pasteboard holds, as a block (NEXUS JSON first, then an HTML table, then TSV).
        static func readPaste(json: String?, html: String?, text: String?) -> SheetClipboard.PasteBlock? {
            SheetClipboard.readClipboard { mime in
                switch mime {
                case SheetClipboard.NEXUS_MIME: return json
                case "text/html": return html
                case "text/plain": return text
                default: return nil
                }
            }
        }

        /// The values to store for a pasted block at (row, col): NEXUS formulas move with the paste (relative
        /// references shift), foreign R1C1 formulas are placed, everything else is read like typing.
        func pasteValues(_ block: SheetClipboard.PasteBlock, row r0: Int, col c0: Int) -> [[Any?]] {
            var out: [[Any?]] = []
            for (dr, line) in block.cells.enumerated() {
                var vals: [Any?] = []
                for (dc, cell) in line.enumerated() {
                    let r = r0 + dr, c = c0 + dc
                    guard columns.indices.contains(c) else { vals.append(nil); continue }
                    let col = columns[c]
                    if block.internal, let f = cell.formula, let origin = block.origin {
                        let moved = SheetFormula.shiftFormula(f, r - (origin.r + dr), c - (origin.c + dc))
                        vals.append(["f": SheetFormula.toStored(moved, shape)])
                    } else if let f = cell.formulaR1C1 {
                        let a1 = SheetClipboard.foreignFormulaAt(f, r, c)
                        vals.append(["f": SheetFormula.toStored(a1, shape)])
                    } else if block.internal, let raw = cell.raw, block.types?.indices.contains(dc) == true, block.types?[dc] == col.type {
                        vals.append(raw)
                    } else {
                        let prev = rows.indices.contains(r) ? rows[r].cells[col.id] : nil
                        vals.append(SheetTypes.inputToCell(col, cell.text, shape, prev))
                    }
                }
                out.append(vals)
            }
            return out
        }
    }

    static func snapshot(columns: [SheetJSON], rows: [SheetRowModel], settings: SheetJSON, previous: Snapshot?) -> Snapshot {
        Snapshot(columns: columns.compactMap { SheetColumn(json: $0) }, rows: rows, settings: settings, previous: previous)
    }

    // MARK: colours

    nonisolated static func hexColor(_ s: String) -> UIColor? {
        var h = s.trimmingCharacters(in: .whitespaces)
        guard h.hasPrefix("#") else { return nil }
        h.removeFirst()
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }

    /// Named palette colours (cell styles, chip colours) in the system's adaptive tints.
    nonisolated static func paletteColor(_ name: String) -> UIColor {
        switch name {
        case "red", "rose": return .systemRed
        case "orange": return .systemOrange
        case "amber", "yellow": return .systemYellow
        case "green": return .systemGreen
        case "teal": return .systemTeal
        case "blue": return .systemBlue
        case "violet", "purple": return .systemPurple
        case "pink": return .systemPink
        case "black": return .label
        default: return .systemGray
        }
    }
}
