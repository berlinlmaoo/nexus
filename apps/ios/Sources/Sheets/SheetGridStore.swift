import Foundation

// The grid's Sheets-parity actions on the store (13 Oct 2026, web SheetGrid.tsx): sheet settings (freeze,
// hidden rows / columns, merges, filter, filter views, gridlines), column widths and row heights, borders,
// colours, font size, decimals and range sorting. Every one is ONE undo step, saved through the same
// routes as the web (PATCH /api/sheets/:id settings / columns, PATCH …/rows heights, PATCH …/cells), and
// realtime-safe: the server stamps this app's X-Nexus-Tab on the sheet-structure event, so only other
// devices re-read the sheet.

extension SheetStore {
    // MARK: settings

    /// Merges `patch` into the sheet's settings (nil / NSNull removes a key; the server merges per key the
    /// same way), shown at once, saved with PATCH, undone by putting the old values back.
    func setSettings(_ patch: [String: Any?], label: String, record: Bool = true) async {
        guard canEdit, let sid = sheetId, !patch.isEmpty else { return }
        var before: [String: Any?] = [:]
        for k in patch.keys { before.updateValue(settings[k], forKey: k) }
        func put(_ p: [String: Any?]) {
            for (k, v) in p { if let v, !(v is NSNull) { settings[k] = v } else { settings[k] = nil } }
        }
        put(patch)
        rebuild()
        var body: [String: Any] = [:]
        for (k, v) in patch { body[k] = v ?? NSNull() }
        settingsInFlight += 1
        do {
            let o = try await APIClient.shared.patchSheet(sid, body: ["settings": body])
            settingsInFlight -= 1
            // The server's narrowed settings, unless another change of ours is still on its way.
            if sid == sheetId, settingsInFlight == 0, let saved = o["settings"] as? SheetJSON {
                settings = saved
                rebuild()
            }
            if record {
                push(SheetUndoEntry(label: label,
                                    undo: { [weak self] in await self?.setSettings(before, label: label, record: false) },
                                    redo: { [weak self] in await self?.setSettings(patch, label: label, record: false) }))
            }
        } catch {
            settingsInFlight -= 1
            if sid == sheetId { put(before); rebuild() }
            fail(error, T("Couldn't save the change."))
        }
    }

    var frozenRowsSetting: Int { (settings["frozenRows"] as? NSNumber)?.intValue ?? 0 }
    var frozenColsSetting: Int { (settings["frozenCols"] as? NSNumber)?.intValue ?? 0 }
    var showGridlines: Bool { !SheetFormula.jsTruthy(settings["noGrid"]) }
    var mergeSpecs: [SheetMerges.Spec] { ((settings["merges"] as? [Any]) ?? []).compactMap { SheetMerges.Spec(json: $0) } }

    // MARK: freeze

    /// View › Freeze › n rows (0 = none). Refused when the line would cut through a merged block.
    func freezeRows(_ n: Int) async {
        let rowIds = rows.map(\.id)
        if SheetMerges.freezeCuts(mergeSpecs, n: n, rows: true, index: { rowIds.firstIndex(of: $0.r) }) {
            notice = T("Sorry, you can't freeze rows that contain only part of a merged cell.")
            return
        }
        await setSettings(["frozenRows": n > 0 ? min(n, 20) : nil], label: n > 0 ? T("freeze rows") : T("unfreeze rows"))
    }

    func freezeCols(_ n: Int) async {
        let colIds = columns.map { $0["id"] as? String ?? "" }
        if SheetMerges.freezeCuts(mergeSpecs, n: n, rows: false, index: { colIds.firstIndex(of: $0.c) }) {
            notice = T("Sorry, you can't freeze columns that contain only part of a merged cell.")
            return
        }
        await setSettings(["frozenCols": n > 0 ? min(n, 10) : nil], label: n > 0 ? T("freeze columns") : T("unfreeze columns"))
    }

    /// The active cell's row / column number, for "Up to row 5" / "Up to column C".
    var activeRowNumber: Int { (modelRow(selection.active.r) ?? 0) + 1 }
    var activeColNumber: Int { (modelCol(selection.active.c) ?? 0) + 1 }

    func toggleGridlines() async {
        await setSettings(["noGrid": showGridlines ? true : nil], label: T("gridlines"))
    }

    // MARK: hide / unhide

    private var selectedRowIds: [String] {
        var ids: [String] = []
        for range in selection.ranges { for r in range.top...range.bottom { if let id = rowId(r), !ids.contains(id) { ids.append(id) } } }
        return ids
    }

    private var selectedColumnIds: [String] {
        var ids: [String] = []
        for range in selection.ranges { for c in range.left...range.right { if let id = columnId(c), !ids.contains(id) { ids.append(id) } } }
        return ids
    }

    func hideSelectedRows() async {
        let ids = selectedRowIds
        guard !ids.isEmpty else { return }
        var next = (settings["hiddenRows"] as? [String]) ?? []
        for id in ids where !next.contains(id) { next.append(id) }
        await setSettings(["hiddenRows": next], label: T("hide rows"))
    }

    func hideSelectedColumns() async {
        let ids = selectedColumnIds
        guard !ids.isEmpty else { return }
        // Never hide every column.
        if ids.count >= colCount { notice = T("At least one column has to stay visible."); return }
        var next = (settings["hiddenCols"] as? [String]) ?? []
        for id in ids where !next.contains(id) { next.append(id) }
        await setSettings(["hiddenCols": next], label: T("hide columns"))
    }

    var hiddenRowCount: Int { ((settings["hiddenRows"] as? [String]) ?? []).count }
    var hiddenColCount: Int { ((settings["hiddenCols"] as? [String]) ?? []).count }

    func unhideAllRows() async { await setSettings(["hiddenRows": nil], label: T("unhide rows")) }
    func unhideAllColumns() async { await setSettings(["hiddenCols": nil], label: T("unhide columns")) }

    /// The arrows on a header edge: the hidden rows just before visible row `at` (rowCount = after the last).
    func unhideRows(before at: Int) async {
        let ids = (rowGaps[at] ?? []).compactMap { rows.indices.contains($0) ? rows[$0].id : nil }
        guard !ids.isEmpty else { return }
        let next = ((settings["hiddenRows"] as? [String]) ?? []).filter { !ids.contains($0) }
        await setSettings(["hiddenRows": next.isEmpty ? nil : next], label: T("unhide rows"))
    }

    func unhideColumns(before at: Int) async {
        let ids = (colGaps[at] ?? []).compactMap { columns.indices.contains($0) ? columns[$0]["id"] as? String : nil }
        guard !ids.isEmpty else { return }
        let next = ((settings["hiddenCols"] as? [String]) ?? []).filter { !ids.contains($0) }
        await setSettings(["hiddenCols": next.isEmpty ? nil : next], label: T("unhide columns"))
    }

    // MARK: merge

    /// Merged blocks the current range touches.
    var mergedHere: [SheetRange] {
        let r = selection.current
        return merges.filter { $0.top <= r.bottom && $0.bottom >= r.top && $0.left <= r.right && $0.right >= r.left }
    }

    var canMerge: Bool {
        guard canEdit, mergesAllowed else { return false }
        let r = selection.current
        return !mergedHere.isEmpty || r.rowCount > 1 || r.colCount > 1
    }

    /// Format › Merge cells: all, one block per column (vertical) or per row (horizontal), or unmerge.
    func merge(_ kind: String) async {
        guard canEdit, mergesAllowed else { return }
        let rect = selection.current
        let rowIds = rows.map(\.id)
        let colIds = columns.map { $0["id"] as? String ?? "" }
        // The stored merges that show inside the selection.
        let raw = (settings["merges"] as? [Any]) ?? []
        var keep: [Any] = []
        var touched = false
        for m in raw {
            guard let spec = SheetMerges.Spec(json: m) else { continue }
            let shown = SheetMerges.resolve([spec], rowIds: rowIds, colIds: colIds, visRows: visRows, visCols: visCols)
            if let b = shown.first, b.top <= rect.bottom, b.bottom >= rect.top, b.left <= rect.right, b.right >= rect.left {
                touched = true
            } else {
                keep.append(m)
            }
        }
        if kind == "unmerge" || (kind == "all" && touched) {
            guard touched else { return }
            await setSettings(["merges": keep.isEmpty ? nil : keep], label: T("unmerge cells"))
            return
        }
        guard let t = modelRow(rect.top), let b = modelRow(rect.bottom), let l = modelCol(rect.left), let r = modelCol(rect.right) else { return }
        let rs = b - t + 1, cs = r - l + 1
        var added: [SheetMerges.Spec] = []
        switch kind {
        case "vertical":
            for c in rect.left...rect.right { if let id = columnId(c) { added.append(SheetMerges.Spec(r: rows[t].id, c: id, rs: rs, cs: 1)) } }
        case "horizontal":
            for v in rect.top...rect.bottom { if let id = rowId(v) { added.append(SheetMerges.Spec(r: id, c: colIds[l], rs: 1, cs: cs)) } }
        default:
            added = [SheetMerges.Spec(r: rows[t].id, c: colIds[l], rs: rs, cs: cs)]
        }
        let next = keep + added.filter { $0.rs * $0.cs > 1 }.map { $0.json as Any }
        await setSettings(["merges": next.isEmpty ? nil : next], label: T("merge cells"))
        select(SheetPos(r: rect.top, c: rect.left))
        if rect.rowCount > 1 || rect.colCount > 1 { select(SheetPos(r: rect.bottom, c: rect.right), extend: true) }
    }

    // MARK: sizes

    /// Column widths (Sheets: drag the header edge; several selected columns take the same width).
    func setColumnWidths(_ visible: [Int], width: Double) async {
        let w = min(max(width.rounded(), 30), 600)
        var change: [String: Double?] = [:]
        for c in visible where abs(Double(columnWidth(c)) - w) >= 1 { if let id = columnId(c) { change[id] = w } }
        await applyColumnWidths(change, label: T("resize columns"))
    }

    func applyColumnWidths(_ change: [String: Double?], label: String, record: Bool = true) async {
        guard canEdit, let sid = sheetId, !change.isEmpty else { return }
        var before: [String: Double?] = [:]
        var next = columns
        for i in next.indices {
            guard let id = next[i]["id"] as? String, let w = change[id] else { continue }
            before.updateValue((next[i]["width"] as? NSNumber)?.doubleValue, forKey: id)
            if let w { next[i]["width"] = w } else { next[i]["width"] = nil }
        }
        let old = columns
        columns = next
        rebuild()
        do {
            let o = try await APIClient.shared.patchSheet(sid, body: ["columns": next], structureVersion: structureVersion)
            structureVersion = o["structureVersion"] as? Int
            if sid == sheetId, let saved = o["columns"] as? [SheetJSON] { columns = saved; rebuild() }
            if record {
                push(SheetUndoEntry(label: label,
                                    undo: { [weak self] in await self?.applyColumnWidths(before, label: label, record: false) },
                                    redo: { [weak self] in await self?.applyColumnWidths(change, label: label, record: false) }))
            }
        } catch {
            if sid == sheetId { columns = old; rebuild() }
            fail(error, T("Couldn't resize the column."))
        }
    }

    /// Row heights (drag the row number's bottom edge). nil = back to the default.
    func setRowHeights(_ visible: [Int], height: Double?) async {
        let h = height.map { Int(min(max($0.rounded(), 20), 400)) }
        let list: [(String, Int?)] = visible.compactMap { r in
            guard let id = rowId(r), h.map({ abs(Double(rowHeight(r)) - Double($0)) >= 1 }) ?? true else { return nil }
            return (id, h)
        }
        await applyRowHeights(list, label: T("resize rows"))
    }

    func applyRowHeights(_ list: [(String, Int?)], label: String, record: Bool = true) async {
        guard canEdit, let sid = sheetId, !list.isEmpty else { return }
        var before: [(String, Int?)] = []
        for (id, h) in list {
            guard let i = rows.firstIndex(where: { $0.id == id }) else { continue }
            before.append((id, rows[i].height))
            rows[i].height = h
        }
        rebuild()
        do {
            for start in stride(from: 0, to: list.count, by: 200) {
                try await APIClient.shared.resizeSheetRows(sid, heights: Array(list[start..<min(start + 200, list.count)]))
            }
            if record {
                push(SheetUndoEntry(label: label,
                                    undo: { [weak self] in await self?.applyRowHeights(before, label: label, record: false) },
                                    redo: { [weak self] in await self?.applyRowHeights(list, label: label, record: false) }))
            }
        } catch {
            if sid == sheetId {
                for (id, h) in before { if let i = rows.firstIndex(where: { $0.id == id }) { rows[i].height = h } }
                rebuild()
            }
            fail(error, T("Couldn't resize the row."))
        }
    }

    // MARK: formats

    /// Format › Borders: a preset with a line style and colour over the current range (shared edges
    /// stored once, the neighbour above / to the left loses the edge it shared — web applyBorders10).
    func applyBorders(_ preset: String, line: String, color: String?) {
        guard canEdit else { return }
        let rect = selection.current
        if refusedByProtection(rect.positions) { return }
        let rowIdx = (rect.top...rect.bottom).compactMap { modelRow($0) }
        let colIdx = (rect.left...rect.right).compactMap { modelCol($0) }
        let above = rect.top > 0 ? modelRow(rect.top - 1) : nil
        let leftCol = rect.left > 0 ? modelCol(rect.left - 1) : nil
        let out = SheetGridStyle.borderChanges(preset: preset, rows: rowIdx, cols: colIdx, above: above, leftCol: leftCol,
                                               line: line, color: color) { r, c in
            guard let id = self.columns[c]["id"] as? String else { return nil }
            return self.rows[r].styles[id]
        }
        let changes: [(String, String, [String: Any]?)] = out.compactMap { r, c, st in
            guard let id = columns[c]["id"] as? String else { return nil }
            return (rows[r].id, id, st)
        }
        applyStyles(changes, label: T("borders"), record: true)
    }

    /// A style patch (patchStyle rules) on every selected cell.
    func patchSelection(_ patch: [String: Any?], label: String) {
        guard canEdit else { return }
        setStyles(label: label) { st in SheetGridStyle.patchStyle(st, patch) ?? [:] }
    }

    func setTextColor(_ hex: String?) { patchSelection(["fc": hex], label: T("text colour")) }
    func setFillColor(_ hex: String?) { patchSelection(["bg": hex], label: T("fill colour")) }
    func setWrapMode(_ mode: String) { patchSelection(["wr": mode == "o" ? nil : mode, "w": nil], label: T("text wrapping")) }
    func setVerticalAlign(_ va: String) { patchSelection(["va": va == "b" ? nil : va], label: T("alignment")) }

    /// Font size in points (10 = the default, stored as nothing; the legacy px size is dropped).
    func setFontSize(_ pt: Int) {
        patchSelection(["fp": pt == SheetGridStyle.defaultFontPt ? nil : pt, "fs": nil], label: T("font size"))
    }

    var activeFontPt: Double { SheetGridStyle.fontPt(activeStyle) }

    /// Increase / decrease decimal places (from what the active cell shows when it has no explicit count).
    func changeDecimals(_ delta: Int) {
        guard canEdit else { return }
        let english = (settings["locale"] as? String) == "en-US"
        let shown = display(selection.active).text
        let current = (activeStyle["dp"] as? NSNumber)?.intValue ?? SheetGridStyle.decimalsShown(shown, english: english)
        let dp = min(max(current + delta, 0), 10)
        patchSelection(["dp": dp], label: T("decimal places"))
    }

    // MARK: sorting a range (Data › Sort range, the filter menu's Sort A → Z)

    /// Sorts the rows of `within` (visible positions; default the current range) by one column. Values and
    /// formats move (formulas shift with them); rows outside the block's columns stay. One undo step.
    func sortRange(byColumn c: Int, ascending: Bool, within: SheetRange? = nil, header: Bool = false) async {
        guard canEdit, let snapshot, let sortCol = columnId(c) else { return }
        let rect = within ?? selection.current
        let top = rect.top + (header ? 1 : 0)
        guard top <= rect.bottom else { return }
        let vis = Array(top...rect.bottom)
        let keyed: [(r: Int, k: SheetTypes.SortKey?)] = vis.map { r in (r, rowId(r).flatMap { SheetTypes.sortKey(snapshot.value($0, sortCol)) }) }
        let dir = ascending ? 1 : -1
        let order = SheetFilter.stableSorted(keyed) { (x: (r: Int, k: SheetTypes.SortKey?), y: (r: Int, k: SheetTypes.SortKey?)) -> Int in
            guard let a = x.k, let b = y.k else { return x.k == nil && y.k == nil ? 0 : (x.k == nil ? 1 : -1) }
            switch (a, b) {
            case (.n(let p), .n(let q)): return p == q ? 0 : (p < q ? -dir : dir)
            case (.n, .s): return -dir
            case (.s, .n): return dir
            case (.s(let p), .s(let q)): return Self.baseCompare(p, q) * dir
            }
        }.map { $0.r }
        await permuteBlock(top: top, order: order, left: rect.left, right: rect.right, label: T("sort range"))
    }

    /// localeCompare(…, "id", { sensitivity: "base" }): case and accents ignored.
    static func baseCompare(_ a: String, _ b: String) -> Int {
        let fold: (String) -> String = { $0.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX")) }
        return SheetJS.localeCompare(fold(a), fold(b))
    }

    /// Row `top + i` of the block takes what row `order[i]` held, between columns left…right.
    private func permuteBlock(top: Int, order: [Int], left: Int, right: Int, label: String) async {
        guard let snapshot else { return }
        var cells: [(String, String, Any?)] = []
        var styles: [(String, String, [String: Any]?)] = []
        for (i, src) in order.enumerated() {
            let dst = top + i
            guard src != dst, let fm = modelRow(src), let tm = modelRow(dst) else { continue }
            for c in left...right {
                guard let cid = columnId(c) else { continue }
                let raw = rows[fm].cells[cid]
                var value: Any? = raw
                if let f = SheetFormula.formulaOf(raw) {
                    let text = SheetFormula.toDisplay(f, snapshot.shape)
                    value = ["f": SheetFormula.toStored(SheetFormula.shiftFormula(text, tm - fm, 0), snapshot.shape)]
                }
                if !snapshot.same(rows[tm].cells[cid], value) { cells.append((rows[tm].id, cid, value)) }
                let st = rows[fm].styles[cid]
                if !NSDictionary(dictionary: st ?? [:]).isEqual(to: rows[tm].styles[cid] ?? [:]) { styles.append((rows[tm].id, cid, st)) }
            }
        }
        guard !cells.isEmpty || !styles.isEmpty else { return }
        await group(label) {
            self.setCells(cells, label: label)
            self.applyStyles(styles, label: label, record: true)
        }
    }

    // MARK: filter

    /// The block around the selection that holds data (Sheets picks it for "Create a filter" on one cell).
    func currentRegion() -> SheetRange {
        let rect = selection.current
        guard selection.isSingleCell else { return rect }
        var top = rect.top, bottom = rect.bottom, left = rect.left, right = rect.right
        func filled(_ r: Int, _ c: Int) -> Bool {
            guard let m = modelRow(r), let cid = columnId(c), let v = rows[m].cells[cid] else { return false }
            if let s = v as? String { return !s.isEmpty }
            return !(v is NSNull)
        }
        var grew = true
        while grew {
            grew = false
            if top > 0, (left...right).contains(where: { filled(top - 1, $0) }) { top -= 1; grew = true }
            if bottom < rowCount - 1, (left...right).contains(where: { filled(bottom + 1, $0) }) { bottom += 1; grew = true }
            if left > 0, (top...bottom).contains(where: { filled($0, left - 1) }) { left -= 1; grew = true }
            if right < colCount - 1, (top...bottom).contains(where: { filled($0, right + 1) }) { right += 1; grew = true }
        }
        return SheetRange(SheetPos(r: top, c: left), SheetPos(r: bottom, c: right))
    }

    /// A visible block in the stored id form "{colId!rowId}:{colId!rowId}".
    func storedRange(_ r: SheetRange) -> String? {
        guard let a = rowId(r.top), let b = rowId(r.bottom), let l = columnId(r.left), let rt = columnId(r.right) else { return nil }
        return "{\(l)!\(a)}:{\(rt)!\(b)}"
    }

    var hasFilter: Bool { settings["filter"] != nil }

    /// Data › Create a filter / Remove filter (shared by everyone, like Sheets).
    func toggleFilter() async {
        guard canEdit else { return }
        if hasFilter { await setSettings(["filter": nil], label: T("remove filter")); return }
        guard let range = storedRange(currentRegion()) else { return }
        await setSettings(["filter": ["range": range]], label: T("create filter"))
    }

    var filterViews: [SheetFilter.Spec] { ((settings["filterViews"] as? [Any]) ?? []).compactMap { SheetFilter.Spec(json: $0) } }

    /// Data › Filter views › Create new filter view (opened for this viewer at once).
    func createFilterView() async {
        guard let range = storedRange(currentRegion()) else { return }
        var view = SheetFilter.Spec(range: range)
        view.id = "fv_" + String(UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(8))
        view.name = T("Filter %d").replacingOccurrences(of: "%d", with: "\(filterViews.count + 1)")
        let list = ((settings["filterViews"] as? [Any]) ?? []) + [view.json]
        await setSettings(["filterViews": list], label: T("create filter view"))
        openFilterView(view.id)
    }

    /// One column's criteria (nil = none), saved on the open filter view, else on the sheet's filter.
    func setFilterCriteria(column cid: String, _ crit: SheetFilter.Crit?) async {
        guard var spec = activeFilter else { return }
        var c = crit
        if let f = c?.cond, f.kind == "formula", let text = f.formula, let snapshot {
            c?.cond?.formula = SheetFormula.toStored(text, snapshot.shape)
        }
        if let c, SheetFilter.critActive(c) { spec.criteria[cid] = c } else { spec.criteria[cid] = nil }
        if let view = activeFilterView {
            let list: [Any] = ((settings["filterViews"] as? [Any]) ?? []).map { raw in
                guard let v = SheetFilter.Spec(json: raw), v.id == view else { return raw }
                var next = spec
                next.id = v.id
                next.name = v.name
                return next.json
            }
            await setSettings(["filterViews": list], label: T("filter"))
        } else {
            var plain = spec
            plain.id = nil
            plain.name = nil
            await setSettings(["filter": plain.json], label: T("filter"))
        }
    }

    /// Everything the filter menu of one column shows.
    struct FilterMenuData {
        let columnId: String
        let label: String
        let values: [(text: String, count: Int)]
        let crit: SheetFilter.Crit?
        let fills: [String]
        let texts: [String]
    }

    func filterMenuData(column c: Int) -> FilterMenuData? {
        guard let snapshot, let rc = filterRect, let cid = columnId(c) else { return nil }
        let last = min(rc.bottom, rows.count - 1)
        let ids: [String] = rc.top + 1 <= last ? rows[(rc.top + 1)...last].map { $0.id } : []
        let opts = snapshot.filterOpts()
        let head = rows.indices.contains(rc.top) ? snapshot.filterDisplay(rows[rc.top].id, cid) : ""
        let letter = SheetA1.letters(modelCol(c) ?? c)
        let colors = SheetFilter.colorsInColumn(ids, cid, opts.styleOf)
        var crit = activeFilter?.criteria[cid]
        if let f = crit?.cond?.formula { crit?.cond?.formula = SheetFormula.toDisplay(f, snapshot.shape) }
        return FilterMenuData(columnId: cid, label: head.isEmpty ? T("Column %@").replacingOccurrences(of: "%@", with: letter) : head,
                              values: SheetFilter.distinctValues(ids, cid, opts.display), crit: crit,
                              fills: colors.fills, texts: colors.texts)
    }

    /// The filter menu's Sort A → Z / Z → A: the body rows of the filter's block are sorted for real.
    func sortFilter(column c: Int, ascending: Bool) async {
        guard let rc = filterRect, let lv = visCols.firstIndex(of: rc.left), let rv = visCols.firstIndex(of: rc.right) else { return }
        let body = visRows.indices.filter { visRows[$0] > rc.top && visRows[$0] <= rc.bottom }
        guard let a = body.first, let b = body.last else { return }
        await sortRange(byColumn: c, ascending: ascending, within: SheetRange(SheetPos(r: a, c: lv), SheetPos(r: b, c: rv)))
    }

    // MARK: charts on the grid (settings.charts `at` / `w` / `h`, web SheetGrid saveChart)

    var chartSpecs: [SPChartSpec] { ((settings["charts"] as? [SheetJSON]) ?? []).compactMap { SPChartSpec(json: $0) } }

    /// A chart dragged or resized on the grid: its new anchor cell (row / column id), offset and size.
    func placeChart(_ id: String, rowId: String, colId: String, dx: Double, dy: Double, w: Double, h: Double, label: String) async {
        var list = (settings["charts"] as? [SheetJSON]) ?? []
        guard canEdit, let i = list.firstIndex(where: { ($0["id"] as? String) == id }) else { return }
        var o = list[i]
        let at: [String: Any] = ["r": rowId, "c": colId, "dx": dx.rounded(), "dy": dy.rounded()]
        o["at"] = at
        o["w"] = max(SheetChartPlace.minWidth, w.rounded())
        o["h"] = max(SheetChartPlace.minHeight, h.rounded())
        list[i] = o
        await setSettings(["charts": list], label: label)
    }

    /// Delete on a selected chart, or its menu (one undo step).
    func deleteChart(_ id: String) async {
        let list = ((settings["charts"] as? [SheetJSON]) ?? []).filter { ($0["id"] as? String) != id }
        let value: Any? = list.isEmpty ? nil : list
        await setSettings(["charts": value], label: T("delete chart"))
    }

    /// A copy of a chart, 24 points down and right (web onCopy).
    func duplicateChart(_ id: String) async {
        var list = (settings["charts"] as? [SheetJSON]) ?? []
        guard let src = list.first(where: { ($0["id"] as? String) == id }) else { return }
        var copy = src
        copy["id"] = SPChart.newId("ch")
        var at = (src["at"] as? [String: Any]) ?? [:]
        at["dx"] = ((at["dx"] as? NSNumber)?.doubleValue ?? 0) + 24
        at["dy"] = ((at["dy"] as? NSNumber)?.doubleValue ?? 0) + 24
        copy["at"] = at
        list.append(copy)
        await setSettings(["charts": list], label: T("copy chart"))
    }

    // MARK: fonts, rotation, custom number formats

    func setFontFamily(_ name: String?) {
        let v: String? = (name == nil || name == SheetGridText.defaultFont) ? nil : name
        patchSelection(["ff": v], label: T("font"))
    }

    /// Text rotation: degrees (−90…90; 0 = none) or "v" (stacked).
    func setRotation(_ value: Any?) {
        var v: Any? = value
        if let n = value as? Int { v = n == 0 ? nil : min(max(n, -90), 90) }
        patchSelection(["rt": v], label: T("text rotation"))
    }

    /// Format › Number › Custom…: the pattern on every selected cell (nf "custom", decimals dropped).
    func setCustomFormat(_ pattern: String) {
        let p = SheetJS.trim(pattern)
        guard !p.isEmpty else { return }
        patchSelection(["nf": "custom", "pt": p, "dp": nil], label: T("number format"))
    }

    /// The active cell's number for a format preview (a date for the date dialog), when it holds one.
    var activeNumber: Double? {
        guard let snapshot, let r = modelRow(selection.active.r), let c = modelCol(selection.active.c) else { return nil }
        return snapshot.number(row: r, col: c)
    }

    /// The custom pattern on the active cell, if any.
    var activeCustomPattern: String? {
        (activeStyle["nf"] as? String) == "custom" ? activeStyle["pt"] as? String : nil
    }

    var sheetLocale: String { (settings["locale"] as? String) == "en-US" ? "en-US" : "id-ID" }
}
