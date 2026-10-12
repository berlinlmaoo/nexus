// Spreadsheet clipboard, interoperable with Google Sheets and Excel — the pure parts of
// apps/nexus-lovable-ui/src/components/sheets/sheet-clipboard.ts. OUT: TSV of display strings
// (text/plain), an HTML <table> (text/html) and our own JSON (NEXUS_MIME) with raw values, formats
// and formulas. IN: our JSON when present, else an HTML table (colspan/rowspan expanded, <br> as a
// newline), else TSV. Reading/writing UIPasteboard is the UI's job; it passes strings in and out.
import Foundation

enum SheetClipboard {
    static let NEXUS_MIME = "application/x-nexus-sheet+json"

    /// One copied cell. `formula` is the A1 text as shown (Indonesian separators), when it is one.
    struct ClipCell {
        var text: String
        var raw: Any? = nil
        var formula: String? = nil
        var style: [String: Any]? = nil

        init(text: String, raw: Any? = nil, formula: String? = nil, style: [String: Any]? = nil) {
            self.text = text; self.raw = raw; self.formula = formula; self.style = style
        }
        init(json: [String: Any]) {
            text = json["text"] as? String ?? ""
            raw = json["raw"].flatMap { $0 is NSNull ? nil : $0 }
            formula = json["formula"] as? String
            style = json["style"] as? [String: Any]
        }
        var json: [String: Any] {
            var o: [String: Any] = ["text": text]
            if let r = raw { o["raw"] = r }
            if let f = formula { o["formula"] = f }
            if let s = style { o["style"] = s }
            return o
        }
    }

    /// A rule covering part of the block, as block-relative rectangles.
    struct ClipValidation {
        var rule: [String: Any]
        var r1: Int
        var r2: Int
        var c1: Int
        var c2: Int
        init(rule: [String: Any], r1: Int, r2: Int, c1: Int, c2: Int) { self.rule = rule; self.r1 = r1; self.r2 = r2; self.c1 = c1; self.c2 = c2 }
        init?(json: [String: Any]) {
            guard let rule = json["rule"] as? [String: Any] else { return nil }
            func n(_ k: String) -> Int { if case .number(let d) = SheetFormula.kind(json[k]), d.isFinite { return Int(d) }; return 0 }
            self.init(rule: rule, r1: n("r1"), r2: n("r2"), c1: n("c1"), c2: n("c2"))
        }
        var json: [String: Any] { ["rule": rule, "r1": r1, "r2": r2, "c1": c1, "c2": c2] }
    }

    struct ClipPayload {
        var v = 1
        /// Top-left of the copied block in the UNDERLYING order (A1 positions), for reference shifting.
        var origin: (r: Int, c: Int)
        var cut: Bool
        /// Column types of the source block.
        var types: [String]
        var cells: [[ClipCell]]
        var validations: [ClipValidation]? = nil
        var widths: [Double]? = nil
        var condFormats: [ClipValidation]? = nil

        var json: [String: Any] {
            var o: [String: Any] = [
                "v": v, "origin": ["r": origin.r, "c": origin.c], "cut": cut, "types": types,
                "cells": cells.map { $0.map { $0.json } },
            ]
            if let v = validations, !v.isEmpty { o["validations"] = v.map { $0.json } }
            if let w = widths { o["widths"] = w }
            if let c = condFormats, !c.isEmpty { o["condFormats"] = c.map { $0.json } }
            return o
        }
    }

    /// A pasted cell. `formulaR1C1` comes from foreign clipboards that carry one.
    struct PasteCell {
        var text: String
        var raw: Any? = nil
        var formula: String? = nil
        var formulaR1C1: String? = nil
        var style: [String: Any]? = nil
    }

    struct PasteBlock {
        var cells: [[PasteCell]]
        var origin: (r: Int, c: Int)? = nil
        var cut: Bool? = nil
        var types: [String]? = nil
        var `internal`: Bool
        var validations: [ClipValidation]? = nil
        var widths: [Double]? = nil
        var condFormats: [ClipValidation]? = nil
    }

    /// The last thing this app copied (a paste whose plain text matches falls back to it).
    static var lastCopy: (text: String, payload: ClipPayload)? = nil

    static func escapeHtml(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// Build the three clipboard representations of a block (and remember it as `lastCopy`).
    static func buildClipboard(_ cells: [[ClipCell]], origin: (r: Int, c: Int), cut: Bool, types: [String],
                               validations: [ClipValidation] = [], widths: [Double]? = nil, condFormats: [ClipValidation]? = nil) -> (text: String, html: String, json: String) {
        let text = SheetTypes.toTsv(cells.map { $0.map { $0.text } })
        var html = "<meta charset=\"utf-8\"><table data-nexus-sheet=\"1\" style=\"border-collapse:collapse\"><tbody>"
        for row in cells {
            html += "<tr>"
            for c in row {
                html += "<td style=\"border:1px solid #ccc;padding:2px 3px;vertical-align:bottom\">\(escapeHtml(c.text).replacingOccurrences(of: "\n", with: "<br>"))</td>"
            }
            html += "</tr>"
        }
        html += "</tbody></table>"
        let payload = ClipPayload(origin: origin, cut: cut, types: types, cells: cells,
                                  validations: validations.isEmpty ? nil : validations, widths: widths,
                                  condFormats: (condFormats?.isEmpty ?? true) ? nil : condFormats)
        lastCopy = (text, payload)
        let data = (try? JSONSerialization.data(withJSONObject: payload.json, options: [])) ?? Data()
        return (text, html, String(data: data, encoding: .utf8) ?? "{}")
    }

    private static func validations(_ v: Any?) -> [ClipValidation]? {
        (v as? [[String: Any]]).map { $0.compactMap { ClipValidation(json: $0) } }
    }

    /// Our own JSON payload -> a block (nil when it isn't one).
    static func fromPayload(_ json: String) -> PasteBlock? {
        guard let data = json.data(using: .utf8), let p = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        guard case .number(let v) = SheetFormula.kind(p["v"]), v == 1, let rows = p["cells"] as? [Any] else { return nil }
        let cells: [[PasteCell]] = rows.map { row in
            ((row as? [Any]) ?? []).map { c in
                let cc = ClipCell(json: c as? [String: Any] ?? [:])
                return PasteCell(text: cc.text, raw: cc.raw, formula: cc.formula, style: cc.style)
            }
        }
        var origin: (r: Int, c: Int)? = nil
        if let o = p["origin"] as? [String: Any], case .number(let r) = SheetFormula.kind(o["r"]), case .number(let c) = SheetFormula.kind(o["c"]) {
            origin = (Int(r), Int(c))
        }
        var cut: Bool? = nil
        if case .bool(let b) = SheetFormula.kind(p["cut"]) { cut = b }
        let widths = (p["widths"] as? [Any])?.compactMap { x -> Double? in if case .number(let n) = SheetFormula.kind(x) { return n }; return nil }
        return PasteBlock(cells: cells, origin: origin, cut: cut, types: p["types"] as? [String], internal: true,
                          validations: validations(p["validations"]), widths: widths, condFormats: validations(p["condFormats"]))
    }

    private static func block(_ p: ClipPayload) -> PasteBlock {
        PasteBlock(cells: p.cells.map { $0.map { PasteCell(text: $0.text, raw: $0.raw, formula: $0.formula, style: $0.style) } },
                   origin: p.origin, cut: p.cut, types: p.types, internal: true,
                   validations: p.validations, widths: p.widths, condFormats: p.condFormats)
    }

    // MARK: - HTML table (a tolerant tokenizer; no DOM on iOS/Linux Foundation)

    private static let entities: [String: String] = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{00A0}"]

    static func decodeEntities(_ s: String) -> String {
        SheetJS.replaceAll(SheetJS.re("&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);"), s) { g in
            let e = g[1] ?? ""
            if e.hasPrefix("#x") || e.hasPrefix("#X"), let n = UInt32(e.dropFirst(2), radix: 16), let u = UnicodeScalar(n) { return String(u) }
            if e.hasPrefix("#"), let n = UInt32(e.dropFirst()), let u = UnicodeScalar(n) { return String(u) }
            return entities[e.lowercased()] ?? (g[0] ?? "")
        }
    }

    private static func attr(_ tag: String, _ name: String) -> String? {
        let re = SheetJS.re("\\s\(name)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", true)
        guard let m = SheetJS.match(re, tag) else { return nil }
        return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "")
    }

    /// Text of a table cell as a person sees it: <br> and block ends become newlines.
    private static func cellText(_ inner: String) -> String {
        var s = SheetJS.replaceAll(SheetJS.re("<br\\s*/?>", true), inner) { _ in "\n" }
        s = SheetJS.replaceAll(SheetJS.re("</(p|div)>(?=[\\s\\S]*\\S)", true), s) { _ in "\n" }
        s = SheetJS.replaceAll(SheetJS.re("<style[\\s\\S]*?</style>|<[^>]*>", true), s) { _ in "" }
        s = decodeEntities(s).replacingOccurrences(of: "\u{00A0}", with: " ")
        while s.hasSuffix("\n") { s.removeLast() }
        return s
    }

    /// An HTML table to a grid, expanding colspan/rowspan; keeps Sheets' data-sheets-formula (R1C1).
    static func parseHtmlTable(_ html: String) -> [[PasteCell]]? {
        guard SheetJS.test(SheetJS.re("<table", true), html) else { return nil }
        guard let tableStart = html.range(of: "<table", options: .caseInsensitive) else { return nil }
        var body = String(html[tableStart.lowerBound...])
        if let end = body.range(of: "</table>", options: .caseInsensitive) { body = String(body[..<end.upperBound]) }
        var grid: [[PasteCell?]] = []
        var taken: [[Bool]] = []
        func ensure(_ r: Int) {
            while grid.count <= r { grid.append([]); taken.append([]) }
        }
        func isTaken(_ r: Int, _ c: Int) -> Bool { r < taken.count && c < taken[r].count && taken[r][c] }
        func put(_ r: Int, _ c: Int, _ cell: PasteCell) {
            ensure(r)
            while grid[r].count <= c { grid[r].append(nil); taken[r].append(false) }
            grid[r][c] = cell
            taken[r][c] = true
        }
        let rowRe = SheetJS.re("<tr\\b[^>]*>([\\s\\S]*?)(?=<tr\\b|</tbody|</thead|</tfoot|</table|$)", true)
        let cellRe = SheetJS.re("<(td|th)\\b([^>]*)>([\\s\\S]*?)(?=<td\\b|<th\\b|</tr|$)", true)
        let ns = body as NSString
        let rows = rowRe.matches(in: body, options: [], range: NSRange(location: 0, length: ns.length))
        for (r, rm) in rows.enumerated() {
            ensure(r)
            let rowHtml = ns.substring(with: rm.range(at: 1))
            let rns = rowHtml as NSString
            var c = 0
            for cm in cellRe.matches(in: rowHtml, options: [], range: NSRange(location: 0, length: rns.length)) {
                let attrs = " " + rns.substring(with: cm.range(at: 2))
                var inner = rns.substring(with: cm.range(at: 3))
                if let close = inner.range(of: "</t[dh]>", options: [.regularExpression, .caseInsensitive]) { inner = String(inner[..<close.lowerBound]) }
                while isTaken(r, c) { c += 1 }
                let colspan = max(1, min(50, Int(attr(attrs, "colspan") ?? "") ?? 1))
                let rowspan = max(1, min(500, Int(attr(attrs, "rowspan") ?? "") ?? 1))
                var cell = PasteCell(text: cellText(inner))
                if let f = attr(attrs, "data-sheets-formula"), f.hasPrefix("=") { cell.formulaR1C1 = f }
                for dr in 0..<rowspan {
                    for dc in 0..<colspan { put(r + dr, c + dc, dr == 0 && dc == 0 ? cell : PasteCell(text: "")) }
                }
                c += colspan
            }
        }
        let width = grid.map { $0.count }.max() ?? 0
        var out: [[PasteCell]] = grid.map { row in (0..<width).map { i in (i < row.count ? row[i] : nil) ?? PasteCell(text: "") } }
        while let last = out.last, last.allSatisfy({ $0.text.isEmpty }) { out.removeLast() }
        return out.isEmpty ? nil : out
    }

    /// What a paste carries, best source first. `getData(type)` returns the pasteboard string for a
    /// MIME type ("text/plain", "text/html", NEXUS_MIME) or nil.
    static func readClipboard(_ getData: (String) -> String?) -> PasteBlock? {
        if let json = getData(NEXUS_MIME), !json.isEmpty, let p = fromPayload(json) { return p }
        let text = getData("text/plain") ?? ""
        if !text.isEmpty, let last = lastCopy, text == last.text { return block(last.payload) }
        if let html = getData("text/html"), !html.isEmpty, !html.contains("data-nexus-sheet"), let grid = parseHtmlTable(html) {
            return PasteBlock(cells: grid, internal: false)
        }
        if text.isEmpty { return nil }
        let rows = SheetTypes.parseTsv(text)
        return rows.isEmpty ? nil : PasteBlock(cells: rows.map { $0.map { PasteCell(text: $0) } }, internal: false)
    }

    /// A foreign R1C1 formula placed at (row, col), 0-based, as A1.
    static func foreignFormulaAt(_ f: String, _ row: Int, _ col: Int) -> String { SheetFormula.r1c1ToA1(f, row, col) }

    /// Forget a cut once it has been pasted (a cut pastes once; later pastes are copies).
    static func consumeCut() {
        if var last = lastCopy, last.payload.cut {
            last.payload.cut = false
            lastCopy = last
        }
    }
}
