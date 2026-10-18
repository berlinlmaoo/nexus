import Foundation
import Observation
#if canImport(UIKit)
import UIKit
#endif

/// One step of undo history: how to reverse a user action and how to do it again (web use-sheet-undo.ts).
struct SheetUndoEntry {
    let label: String
    let undo: @MainActor () async -> Void
    let redo: @MainActor () async -> Void
}

/// The project's spreadsheet on screen: its tabs, the open sheet, the selection and the editor, undo, the
/// per-sheet save queue (kept on disk while offline) and live updates from the sheet's room.
@MainActor
@Observable
final class SheetStore {
    let projectId: String

    // tabs
    var tabs: [SheetTabInfo] = []
    var sheetId: String?

    // the open sheet
    var name = ""
    var columns: [SheetJSON] = []
    var rows: [SheetRowModel] = []
    var settings: SheetJSON = [:]
    var canEdit = false
    var canManage = false
    var loading = true
    var loadError: String?
    /// Bumped on every change the grid has to redraw.
    var structureVersion: Int?
    var version = 0
    /// Bumped when only the selection moved (the grid redraws its selection, not its cells).
    var selVersion = 0

    // derived (rebuilt with `version`)
    private(set) var snapshot: SheetBridge.Snapshot?
    /// Model indices of the rows / columns shown (hidden ones left out). Frozen rows come first, then the
    /// rest (filtered, and ordered by the filter's sort when it has one).
    private(set) var visRows: [Int] = []
    private(set) var visCols: [Int] = []
    /// How many of the visible rows / columns are frozen (settings.frozenRows / frozenCols, in the
    /// underlying order: hidden ones among the first N don't count).
    private(set) var frozenRowCount = 0
    private(set) var frozenColCount = 0
    /// Merged blocks in VISIBLE positions (settings.merges); empty while the filter's sort reorders rows.
    private(set) var merges: [SheetRange] = []
    /// The filter in force for this viewer (an open filter view, else the sheet's filter) and its block
    /// in model indices (first row = the header).
    private(set) var activeFilter: SheetFilter.Spec?
    private(set) var filterRect: SheetValidation.Rect?
    /// A filter view opened by this viewer (filter views are personal; the list is shared).
    private(set) var activeFilterView: String?

    /// Opens a filter view for this viewer (nil = back to the sheet's own filter).
    func openFilterView(_ id: String?) {
        guard id != activeFilterView else { return }
        activeFilterView = id
        rebuild()
    }
    /// Hidden rows / columns (settings.hiddenRows / hiddenCols) just before a visible index (unhide arrows).
    private(set) var rowGaps: [Int: [Int]] = [:]
    /// Automatic heights (model row → points) of rows without a height of their own: wrapped text (in
    /// the column width), rotated text and large fonts grow the row, like the web's autoHeights.
    private(set) var autoHeights: [Int: CGFloat] = [:]
    /// Per row id: the signature of what decided its automatic height, and that height (nil = default).
    @ObservationIgnored private var autoHeightCache: [String: (sig: Int, h: CGFloat?)] = [:]
    /// A "Show a warning" protected range is about to be edited: the screen asks first (centred alert).
    var protectPrompt: SheetProtectPrompt?
    /// "Don't show this again for 5 minutes" (web protectMuteUntil).
    @ObservationIgnored var protectMuteUntil = Date.distantPast
    private(set) var colGaps: [Int: [Int]] = [:]
    @ObservationIgnored var settingsInFlight = 0
    /// Merging needs the rows in sheet order (the filter's sort reorders them on screen only).
    private(set) var mergesAllowed = true

    // selection + editor
    var selection = SheetSelection()
    var editing = false
    var draft = ""
    private var draftOrigin = ""
    var cursor = SheetEntryCursor()
    /// One-line notice under the grid ("Undid: delete 3 rows", errors).
    var notice: String?

    // saving
    private(set) var pendingCount = 0
    var saving = false
    var offline = false

    // undo, per sheet
    private var past: [String: [SheetUndoEntry]] = [:]
    private var future: [String: [SheetUndoEntry]] = [:]
    private var undoBusy = false
    private var collecting: [SheetUndoEntry]?

    @ObservationIgnored private let outbox = SheetOutbox.shared
    @ObservationIgnored private(set) var meId: String?

    init(projectId: String, meId: String?) {
        self.projectId = projectId
        self.meId = meId
        outbox.onChange = { [weak self] in self?.refreshPending() }
    }

    // MARK: derived

    var rowCount: Int { visRows.count }
    var colCount: Int { visCols.count }

    func columnId(_ c: Int) -> String? { visCols.indices.contains(c) ? columns[visCols[c]]["id"] as? String : nil }
    func rowId(_ r: Int) -> String? { visRows.indices.contains(r) ? rows[visRows[r]].id : nil }
    func modelRow(_ r: Int) -> Int? { visRows.indices.contains(r) ? visRows[r] : nil }
    func modelCol(_ c: Int) -> Int? { visCols.indices.contains(c) ? visCols[c] : nil }

    func columnName(_ c: Int) -> String { (modelCol(c).map { columns[$0]["name"] as? String ?? "" }) ?? "" }
    func columnType(_ c: Int) -> String { (modelCol(c).map { columns[$0]["type"] as? String ?? "text" }) ?? "text" }

    func columnWidth(_ c: Int) -> CGFloat {
        guard let m = modelCol(c), let w = (columns[m]["width"] as? NSNumber)?.doubleValue, w > 0 else { return 110 }
        return CGFloat(min(max(w, 30), 600))
    }

    func rowHeight(_ r: Int) -> CGFloat {
        guard let m = modelRow(r) else { return 32 }
        guard let h = rows[m].height, h > 0 else { return autoHeights[m] ?? 32 }
        return CGFloat(min(max(h, 20), 400))
    }

    /// Rows that grow on their own (no height set): wrapped text (measured in each cell's font and its
    /// column's width), rotated text and large fonts. Cheap on every rebuild: a row is measured again only
    /// when what decides its height changed (its sized cells' text, style or column width).
    private func computeAutoHeights(_ snap: SheetBridge.Snapshot) -> [Int: CGFloat] {
        var colIndex: [String: Int] = [:]
        var colWidth: [String: Double] = [:]
        for (i, c) in columns.enumerated() {
            guard let id = c["id"] as? String else { continue }
            colIndex[id] = i
            let w = (c["width"] as? NSNumber)?.doubleValue ?? 0
            colWidth[id] = w > 0 ? min(max(w, 30), 600) : 110
        }
        var out: [Int: CGFloat] = [:]
        var seen = Set<String>()
        for (r, row) in rows.enumerated() where row.height == nil && !row.styles.isEmpty {
            var cells: [SheetGridText.AutoCell] = []
            var sig = 0
            for (cid, st) in row.styles {
                let px = SheetGridStyle.fontPx(st) ?? 13
                let wrap = SheetGridStyle.wrapMode(st) == "w"
                guard px > 14 || wrap || st["rt"] != nil, let c = colIndex[cid] else { continue }
                let text = snap.display(row: r, col: c).text
                let width = colWidth[cid] ?? 110
                cells.append(SheetGridText.AutoCell(style: st, text: text, width: width))
                var hs = Hasher()
                hs.combine(cid)
                hs.combine(text)
                hs.combine(width)
                hs.combine(px)
                hs.combine(wrap)
                hs.combine(SheetFormula.jsTruthy(st["b"]))
                hs.combine(SheetFormula.jsTruthy(st["i"]))
                hs.combine(st["ff"] as? String ?? "")
                hs.combine(st["rt"].map { "\($0)" } ?? "")
                // Order-free: the cells of a dictionary come in any order.
                sig = sig &+ hs.finalize()
            }
            if cells.isEmpty { continue }
            seen.insert(row.id)
            if let hit = autoHeightCache[row.id], hit.sig == sig {
                if let h = hit.h { out[r] = h }
                continue
            }
            let h = SheetGridText.autoRowHeight(cells, defaultHeight: 32, measure: Self.textMeasure).map { CGFloat($0) }
            autoHeightCache[row.id] = (sig, h)
            if let h { out[r] = h }
        }
        if autoHeightCache.count > seen.count { autoHeightCache = autoHeightCache.filter { seen.contains($0.key) } }
        return out
    }

    /// The width of a run of text in the cell's font, as the grid draws it (nil off UIKit: estimated).
    private static var textMeasure: SheetGridText.Measure? {
        #if canImport(UIKit)
        return { text, st, px in
            // Measured during rebuild(), which runs on the main actor (SheetGridFonts caches there).
            MainActor.assumeIsolated {
                let font = SheetGridFonts.font(size: CGFloat(min(max(px, 8), 96)), bold: SheetFormula.jsTruthy(st["b"]),
                                               italic: SheetFormula.jsTruthy(st["i"]), family: SheetGridText.family(st))
                return Double((text as NSString).size(withAttributes: [.font: font]).width)
            }
        }
        #else
        return nil
        #endif
    }

    var canUndo: Bool { !(past[sheetId ?? ""] ?? []).isEmpty }
    var canRedo: Bool { !(future[sheetId ?? ""] ?? []).isEmpty }

    /// The selected block's address as the name box shows it ("B3", "A1:C4").
    var nameBox: String {
        let r = selection.current
        guard let t = modelRow(r.top), let l = modelCol(r.left), let b = modelRow(r.bottom), let rt = modelCol(r.right) else { return "" }
        return SheetA1.range(top: t, left: l, bottom: b, right: rt)
    }

    func rebuild() {
        let hiddenRows = Set((settings["hiddenRows"] as? [String]) ?? [])
        let hiddenCols = Set((settings["hiddenCols"] as? [String]) ?? [])
        let rowIds = rows.map(\.id)
        let colIds = columns.map { $0["id"] as? String ?? "" }
        let groupRows = Self.collapsedGroups(settings["rowGroups"], ids: rowIds)
        let groupCols = Self.collapsedGroups(settings["colGroups"], ids: colIds)
        let snap = SheetBridge.snapshot(columns: columns, rows: rows, settings: settings, previous: snapshot)
        snapshot = snap
        autoHeights = computeAutoHeights(snap)

        // The filter (and slicers) hide body rows; the header row of the range always stays.
        var filtered = Set<String>()
        let spec = activeFilterView.flatMap { id in ((settings["filterViews"] as? [Any]) ?? []).compactMap { SheetFilter.Spec(json: $0) }.first { $0.id == id } }
            ?? SheetFilter.Spec(json: settings["filter"])
        activeFilter = spec
        filterRect = nil
        let slicers: [(range: String, colId: String, crit: SheetFilter.Crit?)] = ((settings["slicers"] as? [SheetJSON]) ?? []).compactMap { o in
            guard let r = o["range"] as? String, let c = o["colId"] as? String else { return nil }
            return (r, c, SheetFilter.Crit(json: o["crit"]))
        }
        if let spec {
            let own = slicers.filter { $0.range == spec.range }.map { (colId: $0.colId, crit: $0.crit) }
            let res = SheetFilter.applyFilter(spec, snap.filterOpts(slicers: own))
            filtered.formUnion(res.hidden)
            filterRect = res.rect
        }
        for sl in slicers where sl.range != spec?.range && sl.crit != nil {
            filtered.formUnion(SheetFilter.applyFilter(SheetFilter.Spec(range: sl.range), snap.filterOpts(slicers: [(colId: sl.colId, crit: sl.crit)])).hidden)
        }

        let frozenSetting = min((settings["frozenRows"] as? NSNumber)?.intValue ?? 0, rows.count)
        let shown = rows.indices.filter { !hiddenRows.contains(rows[$0].id) && !groupRows.contains(rows[$0].id) && !filtered.contains(rows[$0].id) }
        let fixed = shown.filter { $0 < frozenSetting }
        var rest = shown.filter { $0 >= frozenSetting }
        // The filter's sort (a filter view grouped by a column) orders the rows of its range, in view only.
        if let sort = spec?.sort, let rc = filterRect {
            let inside = rest.filter { $0 > rc.top && $0 <= rc.bottom }
            let order = SheetFilter.sortedRowIds(inside.map { rows[$0].id }, [sort]) { snap.value($0, $1) }
            var at: [String: Int] = [:]
            for i in inside { at[rows[i].id] = i }
            var k = 0
            rest = rest.map { i in
                guard i > rc.top && i <= rc.bottom, k < order.count, let j = at[order[k]] else { return i }
                k += 1
                return j
            }
        }
        visRows = fixed + rest
        frozenRowCount = fixed.count
        visCols = columns.indices.filter { !hiddenCols.contains(colIds[$0]) && !groupCols.contains(colIds[$0]) }
        let frozenColSetting = min((settings["frozenCols"] as? NSNumber)?.intValue ?? 0, columns.count)
        frozenColCount = visCols.filter { $0 < frozenColSetting }.count

        let natural = zip(visRows, visRows.dropFirst()).allSatisfy { $0 < $1 }
        mergesAllowed = natural
        let specs = ((settings["merges"] as? [Any]) ?? []).compactMap { SheetMerges.Spec(json: $0) }
        merges = natural ? SheetMerges.resolve(specs, rowIds: rowIds, colIds: colIds, visRows: visRows, visCols: visCols) : []
        rowGaps = SheetHiddenGaps.gaps(visible: visRows, count: rows.count) { hiddenRows.contains(rowIds[$0]) }
        colGaps = SheetHiddenGaps.gaps(visible: visCols, count: columns.count) { hiddenCols.contains(colIds[$0]) }
        selection.clamp(rows: visRows.count, cols: visCols.count)
        version += 1
    }

    /// Ids inside collapsed groups (View › Group: { from, to, collapsed }).
    private static func collapsedGroups(_ raw: Any?, ids: [String]) -> Set<String> {
        var out = Set<String>()
        for g in (raw as? [SheetJSON]) ?? [] where SheetFormula.jsTruthy(g["collapsed"]) {
            guard let f = g["from"] as? String, let t = g["to"] as? String,
                  let a = ids.firstIndex(of: f), let b = ids.firstIndex(of: t) else { continue }
            for i in min(a, b)...max(a, b) { out.insert(ids[i]) }
        }
        return out
    }

    func display(_ p: SheetPos) -> SheetCellDisplay {
        guard let snapshot, let r = modelRow(p.r), let c = modelCol(p.c) else { return SheetCellDisplay() }
        var d = snapshot.display(row: r, col: c)
        if let rc = filterRect, r == rc.top, c >= rc.left, c <= rc.right, let cid = columnId(p.c) {
            d.filterHead = SheetFilter.critActive(activeFilter?.criteria[cid])
        }
        return d
    }

    // MARK: loading

    func loadTabs() async {
        do {
            let list = try await APIClient.shared.projectSheets(projectId)
            tabs = list.sorted { $0.position < $1.position }
            let remembered = UserDefaults.standard.string(forKey: "nexus.sheet.\(projectId)")
            let visible = tabs.filter { !$0.hidden }
            let pick = visible.first { $0.id == sheetId } ?? visible.first { $0.id == remembered } ?? visible.first ?? tabs.first
            if let pick, pick.id != sheetId {
                await open(pick.id)
            } else if pick == nil {
                loading = false
            }
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the spreadsheet.")
            loading = false
        }
    }

    func open(_ id: String) async {
        if editing { commitEdit(move: nil) }
        sheetId = id
        UserDefaults.standard.set(id, forKey: "nexus.sheet.\(projectId)")
        selection = SheetSelection()
        rows = []
        structureVersion = nil
        columns = []
        settings = [:]
        activeFilterView = nil
        rebuild()
        loading = true
        outbox.activeStore = self
        await reload()
    }

    /// The whole sheet from the server, with this device's unsent writes laid over it.
    func reload() async {
        guard let id = sheetId else { return }
        do {
            let o = try await APIClient.shared.loadSheet(id)
            guard id == sheetId else { return }
            apply(sheet: o)
            loadError = nil
        } catch {
            if rows.isEmpty { loadError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the spreadsheet.") }
            if (error as? APIError)?.nobodyAnswered == true { offline = true }
        }
        loading = false
    }

    private func apply(sheet o: SheetJSON) {
        structureVersion = o["structureVersion"] as? Int
        name = o["name"] as? String ?? ""
        columns = (o["columns"] as? [SheetJSON]) ?? []
        settings = (o["settings"] as? SheetJSON) ?? [:]
        canEdit = o["canEdit"] as? Bool ?? false
        canManage = o["canManage"] as? Bool ?? false
        var list = ((o["rows"] as? [SheetJSON]) ?? []).compactMap(SheetRowModel.init)
        // Writes not yet on the server stay visible (offline edits, a save in flight).
        if let id = sheetId {
            let pending = outbox.pending(id)
            for i in list.indices {
                for (col, v) in pending.values[list[i].id] ?? [:] {
                    if v is NSNull { list[i].cells[col] = nil } else { list[i].cells[col] = v }
                }
                for (col, v) in pending.styles[list[i].id] ?? [:] {
                    if let st = v as? [String: Any] { list[i].styles[col] = st } else { list[i].styles[col] = nil }
                }
            }
        }
        rows = list
        if let i = tabs.firstIndex(where: { $0.id == sheetId }) { tabs[i].name = name }
        rebuild()
        refreshPending()
    }

    // MARK: realtime (sheet:<id> room)

    /// `sheet-cells`: other people's saves (and this person's other devices). Skips this app's own echo
    /// (originTab), never replaces the cell open in the editor, never applies an older row over a newer one.
    func receiveCells(_ payload: SheetJSON) {
        if let tab = payload["originTab"] as? String {
            if tab == APIClient.sheetTabId { return }
        } else if let actor = payload["actorId"] as? String, actor == meId {
            return
        }
        let incoming = ((payload["rows"] as? [SheetJSON]) ?? [])
        guard !incoming.isEmpty else { return }
        let editingCell = editing ? (rowId(selection.active.r), columnId(selection.active.c)) : (nil, nil)
        var changed = false
        for inc in incoming {
            guard let id = inc["id"] as? String, let i = rows.firstIndex(where: { $0.id == id }) else { continue }
            let at = inc["updatedAt"] as? String ?? ""
            if !at.isEmpty, !rows[i].updatedAt.isEmpty, at < rows[i].updatedAt { continue }
            var cells = (inc["cells"] as? SheetJSON) ?? [:]
            if editingCell.0 == id, let col = editingCell.1 { cells[col] = rows[i].cells[col] }
            // Unsent local writes win until they are sent.
            if let sid = sheetId {
                for (col, v) in outbox.pending(sid).values[id] ?? [:] { cells[col] = v is NSNull ? nil : v }
            }
            rows[i].cells = cells
            if let st = inc["styles"] as? [String: [String: Any]] { rows[i].styles = st }
            if !at.isEmpty { rows[i].updatedAt = at }
            changed = true
        }
        if changed { rebuild() }
    }

    /// `sheet-structure`: rows or columns changed elsewhere — read the sheet again.
    func receiveStructure(_ payload: SheetJSON) {
        if let tab = payload["originTab"] as? String, tab == APIClient.sheetTabId { return }
        if payload["originTab"] == nil, let actor = payload["actorId"] as? String, actor == meId { return }
        Task { await reload() }
    }

    // MARK: selection + keyboard

    func select(_ p: SheetPos, extend: Bool = false, add: Bool = false) {
        guard rowCount > 0, colCount > 0 else { return }
        if editing {
            // Building a formula: a tap puts the cell's address in it (a drag, the range's) instead of moving
            // away. Not the cell being edited itself: that would be a circular reference.
            if draft.hasPrefix("="), !add {
                if extend {
                    if let anchor = refAnchor { insertReference(from: anchor, to: p) }
                } else if p != selection.active || refAnchor != nil {
                    insertReference(p)
                }
                return
            }
            commitEdit(move: nil)
        }
        let q = SheetPos(r: min(max(0, p.r), rowCount - 1), c: min(max(0, p.c), colCount - 1))
        if extend { selection.extend(to: q) } else if add { selection.add(q) } else { selection.select(q) }
        snapToMerges()
        cursor.tabStartColumn = nil
        selVersion += 1
    }

    /// Sheets never selects half a merged block: the active cell goes to its top-left, ranges grow over it.
    private func snapToMerges() {
        guard !merges.isEmpty else { return }
        if let m = SheetMerges.at(selection.active, in: merges) { selection.active = SheetPos(r: m.top, c: m.left) }
        if let i = selection.ranges.indices.last {
            let cur = selection.ranges[i]
            if cur.isSingle, let m = SheetMerges.at(cur.a, in: merges) {
                selection.ranges[i] = SheetRange(SheetPos(r: m.top, c: m.left), SheetPos(r: m.bottom, c: m.right))
            } else {
                selection.ranges[i] = SheetMerges.expand(cur, with: merges)
            }
        }
    }

    /// Where an arrow step starts from: the far edge of the merged block the cell is in.
    private func stepOrigin(_ p: SheetPos, dr: Int, dc: Int) -> SheetPos {
        guard let m = SheetMerges.at(p, in: merges) else { return p }
        return SheetPos(r: dr > 0 ? m.bottom : (dr < 0 ? m.top : p.r), c: dc > 0 ? m.right : (dc < 0 ? m.left : p.c))
    }

    /// Arrow keys: one step, or (with extend) grow the current range from its far corner.
    func move(dr: Int, dc: Int, extend: Bool = false) {
        guard rowCount > 0, colCount > 0 else { return }
        if extend {
            let b = stepOrigin(selection.current.b, dr: dr, dc: dc)
            selection.extend(to: SheetPos(r: min(max(0, b.r + dr), rowCount - 1), c: min(max(0, b.c + dc), colCount - 1)))
        } else {
            let a = stepOrigin(selection.active, dr: dr, dc: dc)
            selection.select(SheetPos(r: min(max(0, a.r + dr), rowCount - 1), c: min(max(0, a.c + dc), colCount - 1)))
        }
        snapToMerges()
        selVersion += 1
    }

    /// Tab / Shift-Tab and Enter / Shift-Enter, with Enter returning to the column a Tab run began in.
    func advance(tab: Bool, back: Bool) {
        let a = selection.active
        if tab {
            if cursor.tabStartColumn == nil { cursor.tabStartColumn = a.c }
            move(dr: 0, dc: back ? -1 : 1)
        } else {
            let col = cursor.tabStartColumn ?? a.c
            cursor.tabStartColumn = nil
            let from = stepOrigin(a, dr: back ? -1 : 1, dc: 0)
            let r = min(max(0, from.r + (back ? -1 : 1)), max(0, rowCount - 1))
            selection.select(SheetPos(r: r, c: col))
            snapToMerges()
            selVersion += 1
        }
    }

    /// ⌘-arrow: to the edge of the sheet that way.
    func jump(dr: Int, dc: Int, extend: Bool) {
        guard rowCount > 0, colCount > 0 else { return }
        let from = extend ? selection.current.b : selection.active
        let target = SheetPos(r: dr < 0 ? 0 : (dr > 0 ? rowCount - 1 : from.r), c: dc < 0 ? 0 : (dc > 0 ? colCount - 1 : from.c))
        if extend { selection.extend(to: target) } else { selection.select(target) }
        snapToMerges()
        selVersion += 1
    }

    /// ⌘B / ⌘I and the toolbar's toggles: on for every selected cell unless the active one already has it.
    func toggleStyleFlag(_ key: String, label: String) {
        guard canEdit else { return }
        let on = activeStyle[key] == nil
        setStyles(label: label) { st in
            var next = st
            if on { next[key] = 1 } else { next[key] = nil }
            return next
        }
    }

    /// The active cell's stored format.
    var activeStyle: [String: Any] {
        guard let r = modelRow(selection.active.r), let cid = columnId(selection.active.c) else { return [:] }
        return rows[r].styles[cid] ?? [:]
    }

    func selectAll() {
        guard rowCount > 0, colCount > 0 else { return }
        selection.active = SheetPos(r: 0, c: 0)
        selection.ranges = [SheetRange(SheetPos(r: 0, c: 0), SheetPos(r: rowCount - 1, c: colCount - 1))]
        selVersion += 1
    }

    func selectColumn(_ c: Int, extend: Bool = false) {
        guard rowCount > 0 else { return }
        if extend {
            let a = selection.current.a
            selection.ranges = [SheetRange(SheetPos(r: 0, c: a.c), SheetPos(r: rowCount - 1, c: c))]
        } else {
            selection.active = SheetPos(r: 0, c: c)
            selection.ranges = [SheetRange(SheetPos(r: 0, c: c), SheetPos(r: rowCount - 1, c: c))]
        }
        selVersion += 1
    }

    func selectRow(_ r: Int, extend: Bool = false) {
        guard colCount > 0 else { return }
        if extend {
            let a = selection.current.a
            selection.ranges = [SheetRange(SheetPos(r: a.r, c: 0), SheetPos(r: r, c: colCount - 1))]
        } else {
            selection.active = SheetPos(r: r, c: 0)
            selection.ranges = [SheetRange(SheetPos(r: r, c: 0), SheetPos(r: r, c: colCount - 1))]
        }
        selVersion += 1
    }

    // MARK: editor

    /// What the formula bar shows for the active cell when not editing.
    var activeEditText: String {
        guard let snapshot, let r = modelRow(selection.active.r), let c = modelCol(selection.active.c) else { return "" }
        return snapshot.editText(row: r, col: c)
    }

    func beginEdit(with text: String? = nil) {
        guard canEdit, rowCount > 0, colCount > 0 else { return }
        guardProtected([selection.active]) { [weak self] in self?.openEditor(with: text) }
    }

    private func openEditor(with text: String?) {
        guard canEdit, rowCount > 0, colCount > 0 else { return }
        lastInsertedRef = nil
        refAnchor = nil
        draftOrigin = activeEditText
        draft = text ?? draftOrigin
        editing = true
    }

    func cancelEdit() {
        draft = draftOrigin
        editing = false
    }

    /// Saves the draft into the active cell, then moves (nil = stay).
    func commitEdit(move: (dr: Int, dc: Int)?) {
        guard editing else { return }
        editing = false
        let text = draft
        if text != draftOrigin, let snapshot, let r = modelRow(selection.active.r), let c = modelCol(selection.active.c),
           let rid = rowId(selection.active.r), let cid = columnId(selection.active.c) {
            let value = snapshot.input(text: text, row: r, col: c)
            if !snapshot.same(rows[r].cells[cid], value) {
                setCells([(rid, cid, value)], label: T("edit cell"))
            }
        }
        if let move {
            if move.dc != 0 { advance(tab: true, back: move.dc < 0) } else if move.dr != 0 { advance(tab: false, back: move.dr < 0) }
        }
    }

    /// The address of `p` into the formula being typed (replacing a reference just inserted).
    func insertReference(_ p: SheetPos) {
        refAnchor = p
        insertReference(from: p, to: p)
    }

    /// A range's address into the formula ("B2:C5"), replacing the reference inserted just before.
    func insertReference(from a: SheetPos, to b: SheetPos) {
        let range = SheetRange(a, b)
        guard let t = modelRow(range.top), let l = modelCol(range.left), let bt = modelRow(range.bottom), let rt = modelCol(range.right) else { return }
        let ref = SheetA1.range(top: t, left: l, bottom: bt, right: rt)
        if let last = lastInsertedRef, draft.hasSuffix(last) {
            draft.removeLast(last.count)
        }
        draft += ref
        lastInsertedRef = ref
    }
    @ObservationIgnored private var lastInsertedRef: String?
    @ObservationIgnored private var refAnchor: SheetPos?

    /// The person typed in the bar: the next tapped cell adds a reference instead of replacing the last one.
    func draftChanged() {
        if let last = lastInsertedRef, draft.hasSuffix(last) { return }
        lastInsertedRef = nil
        refAnchor = nil
    }

    // MARK: writing cells

    /// Writes cells locally at once, queues them for the server and records one undo step.
    /// `changes`: (rowId, columnId, value or nil to clear).
    func setCells(_ changes: [(String, String, Any?)], label: String, record: Bool = true) {
        guard let sid = sheetId, !changes.isEmpty else { return }
        var before: [(String, String, Any?)] = []
        for (rid, cid, value) in changes {
            guard let i = rows.firstIndex(where: { $0.id == rid }) else { continue }
            before.append((rid, cid, rows[i].cells[cid]))
            if let value { rows[i].cells[cid] = value } else { rows[i].cells[cid] = nil }
            outbox.put(sheet: sid, row: rid, col: cid, value: value)
        }
        rebuild()
        outbox.flushSoon(sid)
        if record {
            let after = changes
            push(SheetUndoEntry(label: label,
                                undo: { [weak self] in self?.setCells(before, label: label, record: false) },
                                redo: { [weak self] in self?.setCells(after, label: label, record: false) }))
        }
    }

    /// Formatting (bold, alignment, wrap, number format…) for every selected cell: `edit` changes a copy of
    /// each cell's style. One undo step.
    func setStyles(label: String, record: Bool = true, _ edit: ([String: Any]) -> [String: Any]) {
        if record && refusedByProtection(selection.ranges.flatMap { $0.positions }) { return }
        var changes: [(String, String, [String: Any]?)] = []
        for range in selection.ranges {
            for p in range.positions {
                guard let r = modelRow(p.r), let cid = columnId(p.c) else { continue }
                let old = rows[r].styles[cid] ?? [:]
                let new = edit(old)
                changes.append((rows[r].id, cid, new.isEmpty ? nil : new))
            }
        }
        applyStyles(changes, label: label, record: record)
    }

    func applyStyles(_ changes: [(String, String, [String: Any]?)], label: String, record: Bool) {
        guard let sid = sheetId, !changes.isEmpty else { return }
        var before: [(String, String, [String: Any]?)] = []
        for (rid, cid, st) in changes {
            guard let i = rows.firstIndex(where: { $0.id == rid }) else { continue }
            before.append((rid, cid, rows[i].styles[cid]))
            rows[i].styles[cid] = st
            outbox.putStyle(sheet: sid, row: rid, col: cid, style: st)
        }
        rebuild()
        outbox.flushSoon(sid)
        if record {
            push(SheetUndoEntry(label: label,
                                undo: { [weak self] in self?.applyStyles(before, label: label, record: false) },
                                redo: { [weak self] in self?.applyStyles(changes, label: label, record: false) }))
        }
    }

    /// Delete / Backspace: empties every selected cell.
    func clearSelection() {
        guard canEdit else { return }
        guardProtected(selection.ranges.flatMap { $0.positions }) { [weak self] in self?.clearSelectionNow() }
    }

    private func clearSelectionNow() {
        guard canEdit else { return }
        var changes: [(String, String, Any?)] = []
        for range in selection.ranges {
            for p in range.positions {
                guard let r = modelRow(p.r), let cid = columnId(p.c), rows[r].cells[cid] != nil else { continue }
                changes.append((rows[r].id, cid, nil))
            }
        }
        setCells(changes, label: T("clear cells"))
    }

    /// Ticks / unticks a checkbox cell (a checkbox column or a checkbox validation rule).
    func toggleCheckbox(_ p: SheetPos) {
        guard canEdit, let snapshot, let r = modelRow(p.r), let c = modelCol(p.c), let cid = columnId(p.c),
              let next = snapshot.toggledCheckbox(row: r, col: c) else { return }
        let rid = rows[r].id
        guardProtected([p]) { [weak self] in self?.setCells([(rid, cid, next)], label: T("edit cell")) }
    }

    /// A dropdown's choice(s) for the active cell.
    func pick(_ values: [String]) {
        guard canEdit, let r = modelRow(selection.active.r), let cid = columnId(selection.active.c) else { return }
        let next: Any? = values.isEmpty ? nil : values.joined(separator: ", ")
        if let snapshot, snapshot.same(rows[r].cells[cid], next) { return }
        // The "Heads up!" was asked before the picker opened; a restricted range still refuses here.
        if refusedByProtection([selection.active]) { return }
        setCells([(rows[r].id, cid, next)], label: T("edit cell"))
    }

    // MARK: clipboard

    /// The selection as TSV (display text), HTML and NEXUS JSON (values, formulas, formats).
    func copyPayload(cut: Bool) -> (tsv: String, html: String, json: String)? {
        guard let snapshot, selection.ranges.count == 1 else {
            if selection.ranges.count > 1 { notice = T("Copy works on one range at a time.") }
            return nil
        }
        let range = selection.current
        let rowsIdx = (range.top...range.bottom).compactMap { modelRow($0) }
        let colsIdx = (range.left...range.right).compactMap { modelCol($0) }
        return snapshot.copy(rows: rowsIdx, cols: colsIdx, cut: cut)
    }

    /// Pastes at the active cell. A block wider / taller than what is left of the sheet adds columns / rows
    /// first (one undo step with the paste, web: paste auto-expands).
    func paste(json: String?, html: String?, text: String?) async {
        guard canEdit else { return }
        guard let block = SheetBridge.Snapshot.readPaste(json: json, html: html, text: text), !block.cells.isEmpty else { return }
        let height = block.cells.count, width = block.cells.map(\.count).max() ?? 0
        let a = selection.active
        var target: [SheetPos] = []
        for r in a.r..<min(rowCount, a.r + height) { for c in a.c..<min(colCount, a.c + width) { target.append(SheetPos(r: r, c: c)) } }
        switch protection(at: target) {
        case .deny?:
            notice = T("This cell is protected. Ask its owner if you need to change it.")
        case .warn? where Date() >= protectMuteUntil:
            protectPrompt = SheetProtectPrompt { [weak self] in
                guard let self else { return }
                Task { await self.pasteBlock(block) }
            }
        default:
            await pasteBlock(block)
        }
    }

    private func pasteBlock(_ block: SheetClipboard.PasteBlock) async {
        guard canEdit, let sid = sheetId, let r0 = modelRow(selection.active.r), let c0 = modelCol(selection.active.c) else { return }
        let height = block.cells.count, width = block.cells.map(\.count).max() ?? 0
        await group(T("paste")) {
            let needCols = c0 + width - self.columns.count
            if needCols > 0 { await self.appendColumns(needCols) }
            let needRows = r0 + height - self.rows.count
            if needRows > 0 { await self.addRows(count: needRows, after: self.rows.last?.id) }
            guard sid == self.sheetId, let snapshot = self.snapshot else { return }
            let values = snapshot.pasteValues(block, row: r0, col: c0)
            var changes: [(String, String, Any?)] = []
            for (dr, line) in values.enumerated() {
                guard self.rows.indices.contains(r0 + dr) else { continue }
                for (dc, value) in line.enumerated() where self.columns.indices.contains(c0 + dc) {
                    guard let cid = self.columns[c0 + dc]["id"] as? String else { continue }
                    changes.append((self.rows[r0 + dr].id, cid, value))
                }
            }
            self.setCells(changes, label: T("paste"))
            SheetClipboard.consumeCut()
            // The pasted block is the new selection.
            if let top = self.visRows.firstIndex(of: r0), let left = self.visCols.firstIndex(of: c0) {
                let bottom = self.visRows.firstIndex(of: min(r0 + height - 1, self.rows.count - 1)) ?? top
                let right = self.visCols.firstIndex(of: min(c0 + width - 1, self.columns.count - 1)) ?? left
                self.selection.active = SheetPos(r: top, c: left)
                self.selection.ranges = [SheetRange(SheetPos(r: top, c: left), SheetPos(r: bottom, c: right))]
                self.selVersion += 1
            }
        }
    }

    // MARK: rows and columns

    /// Adds rows after `after` (nil = at the end), or before `before`. Undo deletes them.
    func addRows(count: Int, after: String?, before: String? = nil, record: Bool = true) async {
        guard canEdit, let sid = sheetId else { return }
        do {
            let created = try await APIClient.shared.addSheetRows(sid, count: count, afterRowId: after, beforeRowId: before)
            guard sid == sheetId else { return }
            let models = created.compactMap(SheetRowModel.init)
            var list = rows + models
            list.sort { $0.position < $1.position }
            rows = list
            rebuild()
            if record {
                let ids = models.map(\.id)
                push(SheetUndoEntry(label: T("insert rows"),
                                    undo: { [weak self] in await self?.deleteRows(ids: ids, record: false) },
                                    redo: { [weak self] in await self?.addRows(count: count, after: after, before: before, record: false) }))
            }
        } catch {
            fail(error, T("Couldn't add rows."))
        }
    }

    func insertRows(above: Bool) async {
        let range = selection.current
        let n = range.rowCount
        if above {
            await addRows(count: n, after: nil, before: modelRow(range.top).map { rows[$0].id })
        } else {
            await addRows(count: n, after: modelRow(range.bottom).map { rows[$0].id })
        }
    }

    /// Deletes the selected rows. Undo puts them back with their values and formats (new ids, same places).
    func deleteSelectedRows() async {
        var ids: [String] = []
        for range in selection.ranges { for r in range.top...range.bottom { if let m = modelRow(r), !ids.contains(rows[m].id) { ids.append(rows[m].id) } } }
        await deleteRows(ids: ids, record: true)
    }

    func deleteRows(ids: [String], record: Bool) async {
        guard canEdit, let sid = sheetId, !ids.isEmpty else { return }
        let gone = rows.filter { ids.contains($0.id) }
        do {
            try await APIClient.shared.deleteSheetRows(sid, rowIds: ids)
            outbox.drop(sheet: sid, rows: Set(ids))
            guard sid == sheetId else { return }
            rows.removeAll { ids.contains($0.id) }
            rebuild()
            // Formulas elsewhere that the server shrank or turned to #REF!.
            await reload()
            if record {
                push(SheetUndoEntry(label: T("delete rows"),
                                    undo: { [weak self] in await self?.restoreRows(gone) },
                                    redo: { [weak self] in
                                        guard let self else { return }
                                        let now = self.rows.filter { r in gone.contains { $0.position == r.position } }.map(\.id)
                                        await self.deleteRows(ids: now, record: false)
                                    }))
            }
        } catch {
            fail(error, T("Couldn't delete the rows."))
        }
    }

    /// Re-creates deleted rows at their old positions with their values and formats.
    private func restoreRows(_ gone: [SheetRowModel]) async {
        guard let sid = sheetId, !gone.isEmpty else { return }
        do {
            var body: SheetJSON = ["count": gone.count, "rows": gone.map(\.cells), "positions": gone.map(\.position)]
            body["styles"] = gone.map { $0.styles as Any }
            _ = try await APIClient.shared.patchSheetRowsInsert(sid, body: body)
            await reload()
        } catch {
            fail(error, T("Couldn't put the rows back."))
        }
    }

    /// Adds `count` blank columns at the end (a paste wider than the sheet).
    func appendColumns(_ count: Int) async {
        await insertColumns(at: columns.count, count: count)
    }

    func insertColumns(left: Bool) async {
        let range = selection.current
        guard let at = modelCol(left ? range.left : range.right) else { return }
        await insertColumns(at: left ? at : at + 1, count: range.colCount)
    }

    /// New blank columns at a model index. Undo deletes them; redo brings back the same ids.
    func insertColumns(at index: Int, count: Int, ids: [String]? = nil, record: Bool = true) async {
        guard canEdit, let sid = sheetId, count > 0 else { return }
        var next = columns
        let fresh: [SheetJSON] = (0..<count).map { i in
            var c: SheetJSON = ["name": "", "type": "text"]
            if let ids, ids.indices.contains(i) { c["id"] = ids[i] }
            return c
        }
        next.insert(contentsOf: fresh, at: min(max(0, index), next.count))
        do {
            let o = try await APIClient.shared.patchSheet(sid, body: ["columns": next], structureVersion: structureVersion)
            structureVersion = o["structureVersion"] as? Int
            guard sid == sheetId else { return }
            let saved = (o["columns"] as? [SheetJSON]) ?? next
            let known = Set(columns.compactMap { $0["id"] as? String })
            let newIds = saved.compactMap { $0["id"] as? String }.filter { !known.contains($0) }
            columns = saved
            rebuild()
            if record {
                push(SheetUndoEntry(label: T("insert columns"),
                                    undo: { [weak self] in await self?.deleteColumns(ids: newIds, record: false) },
                                    redo: { [weak self] in await self?.insertColumns(at: index, count: count, ids: newIds, record: false) }))
            }
        } catch {
            fail(error, T("Couldn't add the column."))
        }
    }

    func deleteSelectedColumns() async {
        var ids: [String] = []
        for range in selection.ranges { for c in range.left...range.right { if let id = columnId(c), !ids.contains(id) { ids.append(id) } } }
        await deleteColumns(ids: ids, record: true)
    }

    /// Deletes columns. Undo restores EXACTLY: the definitions with their old ids, every value and format,
    /// every formula elsewhere the server rewrote, and the validation rules it shrank (web S-BUG-6).
    func deleteColumns(ids: [String], record: Bool) async {
        guard canEdit, let sid = sheetId, !ids.isEmpty else { return }
        if ids.count >= columns.count { notice = T("A sheet needs at least one column."); return }
        let gone = columns.enumerated().filter { ids.contains($0.element["id"] as? String ?? "") }.map { (index: $0.offset, col: $0.element) }
        var formulas: [String: [String: Any]] = [:]
        var values: [String: [String: Any]] = [:]
        var styles: [String: [String: Any]] = [:]
        for row in rows {
            for (cid, v) in row.cells {
                if ids.contains(cid) { values[row.id, default: [:]][cid] = v }
                else if let o = v as? [String: Any], o["f"] != nil { formulas[row.id, default: [:]][cid] = o }
            }
            for (cid, st) in row.styles where ids.contains(cid) { styles[row.id, default: [:]][cid] = st }
        }
        let validations = settings["validations"]
        do {
            for id in ids { try await APIClient.shared.deleteSheetColumn(sid, columnId: id) }
            await reload()
            if record {
                push(SheetUndoEntry(label: ids.count == 1 ? T("delete column") : T("delete columns"),
                                    undo: { [weak self] in
                                        await self?.restoreColumns(gone, values: values, styles: styles, formulas: formulas, validations: validations)
                                    },
                                    redo: { [weak self] in await self?.deleteColumns(ids: ids, record: false) }))
            }
        } catch {
            fail(error, T("Couldn't delete the column."))
            await reload()
        }
    }

    private func restoreColumns(_ gone: [(index: Int, col: SheetJSON)], values: [String: [String: Any]], styles: [String: [String: Any]],
                                formulas: [String: [String: Any]], validations: Any?) async {
        guard let sid = sheetId else { return }
        var restored = columns
        for g in gone.sorted(by: { $0.index < $1.index }) {
            let id = g.col["id"] as? String ?? ""
            if restored.contains(where: { ($0["id"] as? String) == id }) { continue }
            restored.insert(g.col, at: min(g.index, restored.count))
        }
        do {
            let o = try await APIClient.shared.patchSheet(sid, body: ["columns": restored], structureVersion: structureVersion)
            structureVersion = o["structureVersion"] as? Int
            await reload()
            var edits: [SheetCellEdit] = []
            for row in rows {
                var put = values[row.id] ?? [:]
                for (cid, f) in formulas[row.id] ?? [:] {
                    if let snapshot, snapshot.same(row.cells[cid], f) { continue }
                    put[cid] = f
                }
                if !put.isEmpty { edits.append(SheetCellEdit(rowId: row.id, values: put)) }
            }
            let styleEdits = rows.compactMap { r in styles[r.id].map { SheetCellEdit(rowId: r.id, values: $0) } }
            if !edits.isEmpty || !styleEdits.isEmpty {
                for chunk in stride(from: 0, to: max(edits.count, styleEdits.count), by: 200) {
                    let e = Array(edits[min(chunk, edits.count)..<min(chunk + 200, edits.count)])
                    let s = Array(styleEdits[min(chunk, styleEdits.count)..<min(chunk + 200, styleEdits.count)])
                    try await APIClient.shared.patchSheetCells(sid, edits: e, styles: s)
                }
            }
            if let validations {
                try await APIClient.shared.patchSheet(sid, body: ["settings": ["validations": validations]])
            }
            await reload()
        } catch {
            fail(error, T("Couldn't put the column back."))
        }
    }

    /// Renames a column (blank = its letter).
    func renameColumn(_ c: Int, to newName: String) async {
        guard canEdit, let sid = sheetId, let m = modelCol(c) else { return }
        var next = columns
        next[m]["name"] = newName.trimmingCharacters(in: .whitespaces)
        do {
            let o = try await APIClient.shared.patchSheet(sid, body: ["columns": next], structureVersion: structureVersion)
            structureVersion = o["structureVersion"] as? Int
            columns = (o["columns"] as? [SheetJSON]) ?? next
            rebuild()
        } catch {
            fail(error, T("Couldn't rename the column."))
        }
    }

    // MARK: sheet tabs

    func addSheet() async {
        do {
            if let id = try await APIClient.shared.createSheet(projectId, name: nil) {
                tabs = try await APIClient.shared.projectSheets(projectId).sorted { $0.position < $1.position }
                await open(id)
            }
        } catch {
            fail(error, T("Couldn't add a sheet."))
        }
    }

    func duplicateSheet(_ id: String) async {
        do {
            if let newId = try await APIClient.shared.createSheet(projectId, name: nil, duplicateOf: id) {
                tabs = try await APIClient.shared.projectSheets(projectId).sorted { $0.position < $1.position }
                await open(newId)
            }
        } catch {
            fail(error, T("Couldn't duplicate the sheet."))
        }
    }

    func renameSheet(_ id: String, to newName: String) async {
        let n = newName.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        do {
            try await APIClient.shared.patchSheet(id, body: ["name": n])
            if let i = tabs.firstIndex(where: { $0.id == id }) { tabs[i].name = n }
            if id == sheetId { name = n }
        } catch {
            fail(error, T("Couldn't rename the sheet."))
        }
    }

    func deleteSheet(_ id: String) async {
        do {
            try await APIClient.shared.deleteSheet(id)
            tabs.removeAll { $0.id == id }
            past[id] = nil
            future[id] = nil
            if id == sheetId, let next = tabs.first(where: { !$0.hidden }) ?? tabs.first { await open(next.id) }
        } catch {
            fail(error, T("Couldn't delete the sheet."))
        }
    }

    // MARK: undo

    func push(_ entry: SheetUndoEntry) {
        if undoBusy { return }
        if collecting != nil { collecting?.append(entry); return }
        let key = sheetId ?? ""
        var p = past[key] ?? []
        p.append(entry)
        if p.count > 50 { p.removeFirst() }
        past[key] = p
        future[key] = []
    }

    /// Everything pushed while `body` runs becomes ONE step (a paste that grows the sheet, then writes).
    func group(_ label: String, _ body: () async -> Void) async {
        if collecting != nil { await body(); return }
        collecting = []
        await body()
        let parts = collecting ?? []
        collecting = nil
        if parts.count == 1 {
            push(SheetUndoEntry(label: label, undo: parts[0].undo, redo: parts[0].redo))
        } else if parts.count > 1 {
            push(SheetUndoEntry(label: label,
                                undo: { for p in parts.reversed() { await p.undo() } },
                                redo: { for p in parts { await p.redo() } }))
        }
    }

    func undo() async { await runUndo(fromPast: true) }
    func redo() async { await runUndo(fromPast: false) }

    private func runUndo(fromPast: Bool) async {
        guard !undoBusy else { return }
        if editing { cancelEdit() }
        let key = sheetId ?? ""
        var src = (fromPast ? past[key] : future[key]) ?? []
        guard let entry = src.popLast() else { return }
        if fromPast { past[key] = src } else { future[key] = src }
        undoBusy = true
        if fromPast { await entry.undo() } else { await entry.redo() }
        undoBusy = false
        var dst = (fromPast ? future[key] : past[key]) ?? []
        dst.append(entry)
        if fromPast { future[key] = dst } else { past[key] = dst }
        notice = (fromPast ? T("Undid: %@") : T("Redid: %@")).replacingOccurrences(of: "%@", with: entry.label)
        version += 1
    }

    // MARK: saving

    func refreshPending() {
        guard let sid = sheetId else { pendingCount = 0; return }
        pendingCount = outbox.pending(sid).count
        saving = outbox.isFlushing(sid)
        offline = outbox.offline
    }

    /// The server's answer to a save: its updatedAt (and any value it normalised) for cells not edited since.
    func savedRows(_ list: [SheetJSON], sheet: String) {
        guard sheet == sheetId else { return }
        var changed = false
        let pending = outbox.pending(sheet)
        for o in list {
            guard let id = o["id"] as? String, let i = rows.firstIndex(where: { $0.id == id }) else { continue }
            // The same-cell race (web f661bfb): someone else's save may have landed after ours and already
            // reached this screen live. The server's updatedAt strictly increases, so an answer older than
            // the row on screen is stale — keep the newer row, never put this request's value back over it.
            let at = o["updatedAt"] as? String ?? ""
            if !at.isEmpty, !rows[i].updatedAt.isEmpty, at < rows[i].updatedAt { continue }
            if !at.isEmpty { rows[i].updatedAt = at }
            if let cells = o["cells"] as? SheetJSON, pending.values[id] == nil {
                let editingCol = editing && rowId(selection.active.r) == id ? columnId(selection.active.c) : nil
                var next = cells
                if let editingCol { next[editingCol] = rows[i].cells[editingCol] }
                if let snapshot, !Self.sameRow(rows[i].cells, next, snapshot) { rows[i].cells = next; changed = true }
            }
        }
        if changed { rebuild() }
    }

    private static func sameRow(_ a: SheetJSON, _ b: SheetJSON, _ snap: SheetBridge.Snapshot) -> Bool {
        guard Set(a.keys) == Set(b.keys) else { return false }
        return a.allSatisfy { snap.same($0.value, b[$0.key]) }
    }

    func saveRefused(_ message: String) {
        notice = message
        Task { await reload() }
    }

    func fail(_ error: Error, _ fallback: String) {
        if let sheetError = error as? SheetAPIError, case .structureChanged(let current) = sheetError {
            columns = current["columns"] as? [SheetJSON] ?? columns
            settings = current["settings"] as? SheetJSON ?? settings
            structureVersion = current["structureVersion"] as? Int
            rebuild()
            notice = error.localizedDescription
            Task { await reload() }
            return
        }
        if (error as? APIError)?.nobodyAnswered == true {
            notice = T("You're offline. Rows, columns and sheets can be changed once you're back online.")
            offline = true
        } else {
            notice = (error as? LocalizedError)?.errorDescription ?? fallback
        }
    }

    /// Called by the outbox after each send so this screen can follow (only for the open sheet).
    func outboxSent(sheet: String, rows list: [SheetJSON]) { savedRows(list, sheet: sheet) }

    // MARK: protected ranges (settings.protections; the server enforces "restrict" anyway)

    var protections: [SheetRanges.Protection] {
        ((settings["protections"] as? [Any]) ?? []).compactMap { SheetRanges.Protection(json: $0) }
    }

    /// The strongest protection over some visible cells for this person: nil, a warning or a refusal.
    func protection(at positions: [SheetPos]) -> SheetRanges.Hit? {
        let list = protections
        guard !list.isEmpty, let snapshot, !positions.isEmpty else { return nil }
        var rects: [String: SheetValidation.Rect] = [:]
        for p in list {
            var stored = p.except
            if let r = p.range { stored.append(r) }
            for s in stored { if let rc = SheetValidation.rangeRect(s, snapshot.shape) { rects[s] = rc } }
        }
        let known = rects
        let me = meId ?? ""
        var out: SheetRanges.Hit? = nil
        for pos in positions {
            guard let r = modelRow(pos.r), let c = modelCol(pos.c) else { continue }
            let hit = SheetRanges.protectedHere(list, row: r, col: c, me: me, canManage: canManage) { known[$0] }
            if hit == .deny { return .deny }
            if hit == .warn { out = .warn }
        }
        return out
    }

    /// Runs an edit of these cells, unless a restricted range refuses it; a warning range asks first
    /// (web guardProtected: "Heads up!", and "Don't show this again for 5 minutes").
    func guardProtected(_ positions: [SheetPos], _ go: @escaping @MainActor () -> Void) {
        switch protection(at: positions) {
        case .deny?:
            notice = T("This cell is protected. Ask its owner if you need to change it.")
        case .warn? where Date() < protectMuteUntil:
            go()
        case .warn?:
            protectPrompt = SheetProtectPrompt(go: go)
        case nil:
            go()
        }
    }

    /// Formatting can't wait for an answer: a restricted range refuses it here (the server would too).
    func refusedByProtection(_ positions: [SheetPos]) -> Bool {
        guard protection(at: positions) == .deny else { return false }
        notice = T("This cell is protected. Ask its owner if you need to change it.")
        return true
    }

    /// The "Heads up!" answer: go ahead (optionally quiet for five minutes) or drop the edit.
    func answerProtectPrompt(_ ok: Bool, mute: Bool = false) {
        let prompt = protectPrompt
        protectPrompt = nil
        guard ok, let prompt else { return }
        if mute { protectMuteUntil = Date().addingTimeInterval(5 * 60) }
        prompt.go()
    }
}

/// An edit waiting for the "Heads up!" answer on a "Show a warning" protected range.
struct SheetProtectPrompt: Identifiable {
    let id = UUID()
    let go: @MainActor () -> Void
}

extension APIClient {
    /// POST rows with explicit cells / styles / positions (undo of a row delete).
    func patchSheetRowsInsert(_ sheetId: String, body: SheetJSON) async throws -> SheetJSON {
        var req = makeRequest("/api/sheets/\(sheetId.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? sheetId)/rows", method: "POST")
        req.setValue(Self.sheetTabId, forHTTPHeaderField: "X-Nexus-Tab")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(req) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        return ((try? JSONSerialization.jsonObject(with: data)) as? SheetJSON) ?? [:]
    }
}
