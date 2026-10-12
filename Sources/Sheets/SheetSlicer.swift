import Foundation

// Data ▸ Add a slicer (web SheetGrid addSlicer / SheetSlicerPanel.tsx / lib/sheet-model.ts Slicer): a chip
// floating over the grid at its `at` anchor that filters one column of a range for everyone. Stored in
// settings.slicers as { id, range, colId, at, w?, title?, crit?, bg? }; SheetStore.rebuild applies them
// (with the sheet's filter when it covers the same range, on their own otherwise).

/// One slicer as stored. Unknown keys are kept on save.
struct SheetSlicerSpec: Equatable {
    var id: String
    /// Stored range "{colId!rowId}:{colId!rowId}" (first row = the header).
    var range: String
    var colId: String
    /// Anchor: row id `r`, column id `c`, offsets `dx` / `dy`.
    var at: [String: Any]
    var w: Double?
    var title: String?
    var crit: SheetFilter.Crit?
    var bg: String?
    private var raw: [String: Any] = [:]

    static let defaultWidth = 200.0
    static let height = 36.0

    init(id: String, range: String, colId: String, at: [String: Any]) {
        self.id = id; self.range = range; self.colId = colId; self.at = at
    }

    init?(json: Any?) {
        guard let o = json as? [String: Any], let id = o["id"] as? String else { return nil }
        raw = o
        self.id = id
        range = o["range"] as? String ?? ""
        colId = o["colId"] as? String ?? ""
        at = o["at"] as? [String: Any] ?? [:]
        w = (o["w"] as? NSNumber)?.doubleValue
        title = o["title"] as? String
        crit = SheetFilter.Crit(json: o["crit"])
        bg = o["bg"] as? String
    }

    var json: [String: Any] {
        var o = raw
        o["id"] = id
        o["range"] = range
        o["colId"] = colId
        o["at"] = at
        func put(_ k: String, _ v: Any?) { if let v { o[k] = v } else { o.removeValue(forKey: k) } }
        put("w", w)
        put("title", title.flatMap { $0.isEmpty ? nil : $0 })
        put("crit", crit.flatMap { SheetFilter.critActive($0) ? $0.json : nil })
        put("bg", bg)
        return o
    }

    var width: Double { max(80, w ?? Self.defaultWidth) }

    static func == (a: SheetSlicerSpec, b: SheetSlicerSpec) -> Bool {
        a.id == b.id && a.range == b.range && a.colId == b.colId && a.w == b.w && a.title == b.title && a.crit == b.crit && a.bg == b.bg
            && (a.at["r"] as? String) == (b.at["r"] as? String) && (a.at["c"] as? String) == (b.at["c"] as? String)
            && (a.at["dx"] as? NSNumber)?.doubleValue == (b.at["dx"] as? NSNumber)?.doubleValue
            && (a.at["dy"] as? NSNumber)?.doubleValue == (b.at["dy"] as? NSNumber)?.doubleValue
    }

    /// The slicer editor's save: only the fields it changed (`edited` vs `initial`) onto the slicer as it is
    /// now (`current`), so a value picked in the chip's menu, or a move, made meanwhile is kept.
    static func mergeEdits(_ edited: SheetSlicerSpec, initial: SheetSlicerSpec, into current: SheetSlicerSpec) -> SheetSlicerSpec {
        var out = current
        if edited.range != initial.range { out.range = edited.range }
        if edited.colId != initial.colId {
            out.colId = edited.colId
            // Another column: the old column's values mean nothing there (web: crit dropped).
            out.crit = nil
        }
        if edited.title != initial.title { out.title = edited.title }
        if edited.bg != initial.bg { out.bg = edited.bg }
        return out
    }
}

extension SheetStore {
    var slicerSpecs: [SheetSlicerSpec] { ((settings["slicers"] as? [Any]) ?? []).compactMap { SheetSlicerSpec(json: $0) } }

    func slicer(_ id: String) -> SheetSlicerSpec? { slicerSpecs.first { $0.id == id } }

    /// Saves the list (nil when empty, as the web does), one undo step.
    private func saveSlicers(_ list: [SheetSlicerSpec], label: String) async {
        let value: Any? = list.isEmpty ? nil : list.map { $0.json }
        await setSettings(["slicers": value], label: label)
    }

    /// Data ▸ Add a slicer: over the filter's range when the sheet has a filter, else the data block around
    /// the selection; first column; placed right of the block on the selection's top row. Returns its id.
    @discardableResult
    func addSlicer() async -> String? {
        guard canEdit, let snapshot else { return nil }
        let shape = snapshot.shape
        var range: String?
        var rc: SheetValidation.Rect?
        if let f = SheetFilter.Spec(json: settings["filter"]), let r = SheetValidation.rangeRect(f.range, shape) {
            range = f.range
            rc = r
        } else {
            let region = currentRegion()
            if let t = modelRow(region.top), let b = modelRow(region.bottom), let l = modelCol(region.left), let r = modelCol(region.right) {
                rc = SheetValidation.Rect(top: t, bottom: b, left: l, right: r)
                range = storedRange(region)
            }
        }
        guard let range, let rc, rc.left < shape.columnIds.count, let anchorRow = rowId(max(0, selection.current.top)) else { return nil }
        let anchorCol = shape.columnIds[min(shape.columnIds.count - 1, rc.right + 1)]
        let at: [String: Any] = ["r": anchorRow, "c": anchorCol, "dx": 8, "dy": 4]
        let sl = SheetSlicerSpec(id: SPChart.newId("sl"), range: range, colId: shape.columnIds[rc.left], at: at)
        await saveSlicers(slicerSpecs + [sl], label: T("add slicer"))
        return sl.id
    }

    /// Changes one slicer as it is now in the settings.
    func updateSlicer(_ id: String, label: String, _ change: (inout SheetSlicerSpec) -> Void) async {
        var list = slicerSpecs
        guard canEdit, let i = list.firstIndex(where: { $0.id == id }) else { return }
        var next = list[i]
        change(&next)
        guard next != list[i] else { return }
        list[i] = next
        await saveSlicers(list, label: label)
    }

    func deleteSlicer(_ id: String) async {
        guard canEdit else { return }
        let list = slicerSpecs.filter { $0.id != id }
        await saveSlicers(list, label: T("delete slicer"))
    }

    /// Dragged on the grid: its new anchor cell and offset.
    func placeSlicer(_ id: String, rowId: String, colId: String, dx: Double, dy: Double) async {
        await updateSlicer(id, label: T("move slicer")) { s in
            s.at = ["r": rowId, "c": colId, "dx": dx.rounded(), "dy": dy.rounded()]
        }
    }

    /// The chip's value list applied (a custom formula saved in the stored form, like the filter's).
    func setSlicerCriteria(_ id: String, _ crit: SheetFilter.Crit?) async {
        var c = crit
        if let f = c?.cond, f.kind == "formula", let text = f.formula, let snapshot {
            c?.cond?.formula = SheetFormula.toStored(text, snapshot.shape)
        }
        let next: SheetFilter.Crit? = SheetFilter.critActive(c) ? c : nil
        await updateSlicer(id, label: T("slicer")) { s in s.crit = next }
    }

    /// Sort A → Z / Z → A from the chip's value list: the body rows of the slicer's range, by its column.
    func sortSlicer(_ id: String, ascending: Bool) async {
        guard let sl = slicer(id), let snapshot, let rc = SheetValidation.rangeRect(sl.range, snapshot.shape),
              let m = snapshot.shape.columnIds.firstIndex(of: sl.colId), let c = visCols.firstIndex(of: m),
              let lv = visCols.firstIndex(where: { $0 >= rc.left }), let rv = visCols.lastIndex(where: { $0 <= rc.right }) else { return }
        let body = visRows.indices.filter { visRows[$0] > rc.top && visRows[$0] <= rc.bottom }
        guard let a = body.first, let b = body.last, lv <= rv else { return }
        await sortRange(byColumn: c, ascending: ascending, within: SheetRange(SheetPos(r: a, c: lv), SheetPos(r: b, c: rv)))
    }

    /// The body row ids of a slicer's range and its header row (model index), when the range still exists.
    private func slicerBody(_ sl: SheetSlicerSpec) -> (head: Int, ids: [String])? {
        guard let snapshot, let rc = SheetValidation.rangeRect(sl.range, snapshot.shape), rows.indices.contains(rc.top) else { return nil }
        let last = min(rc.bottom, rows.count - 1)
        let ids: [String] = rc.top + 1 <= last ? rows[(rc.top + 1)...last].map { $0.id } : []
        return (rc.top, ids)
    }

    /// The header text of the slicer's column ("" = no column picked / no header).
    func slicerLabel(_ sl: SheetSlicerSpec) -> String {
        guard let snapshot, let body = slicerBody(sl), snapshot.shape.columnIds.contains(sl.colId) else { return "" }
        return snapshot.filterDisplay(rows[body.head].id, sl.colId)
    }

    /// "N of M" values shown while the slicer hides some values (web SlicerChip).
    func slicerCounts(_ sl: SheetSlicerSpec) -> (shown: Int, total: Int)? {
        guard let hidden = sl.crit?.hidden, !hidden.isEmpty, let snapshot, let body = slicerBody(sl) else { return nil }
        let total = SheetFilter.distinctValues(body.ids, sl.colId, snapshot.filterOpts().display).count
        return (max(0, total - hidden.count), total)
    }

    /// What the chip's value list shows (the same menu as a filter column's).
    func slicerMenuData(_ id: String) -> FilterMenuData? {
        guard let sl = slicer(id), let snapshot, let body = slicerBody(sl), let c = snapshot.shape.columnIds.firstIndex(of: sl.colId) else { return nil }
        let opts = snapshot.filterOpts()
        let head = snapshot.filterDisplay(rows[body.head].id, sl.colId)
        let colors = SheetFilter.colorsInColumn(body.ids, sl.colId, opts.styleOf)
        var crit = sl.crit
        if let f = crit?.cond?.formula { crit?.cond?.formula = SheetFormula.toDisplay(f, snapshot.shape) }
        let label = head.isEmpty ? T("Column %@").replacingOccurrences(of: "%@", with: SheetA1.letters(c)) : head
        return FilterMenuData(columnId: sl.colId, label: label, values: SheetFilter.distinctValues(body.ids, sl.colId, opts.display),
                              crit: crit, fills: colors.fills, texts: colors.texts)
    }

    /// The columns a slicer can filter: those of its range, by header text ("Column C" without one).
    func slicerColumns(range: String) -> [(colId: String, label: String)] {
        guard let snapshot, let rc = SheetValidation.rangeRect(range, snapshot.shape), rows.indices.contains(rc.top) else { return [] }
        let ids = snapshot.shape.columnIds
        guard rc.left <= rc.right, rc.right < ids.count else { return [] }
        return (rc.left...rc.right).map { c in
            let head = snapshot.filterDisplay(rows[rc.top].id, ids[c])
            return (ids[c], head.isEmpty ? T("Column %@").replacingOccurrences(of: "%@", with: SheetA1.letters(c)) : head)
        }
    }
}
