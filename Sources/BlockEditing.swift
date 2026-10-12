import Foundation
import Observation

// ─────────────────────────────────────────────────────────────────────────────
// Editing block documents in the app (owner, 12 Oct 2026: pages and task descriptions, same block set as
// the reader). The app never talks Yjs: it keeps the document it loaded (`base`) and sends it with the edited
// one to POST /api/collab/edit, which merges the change block by block into the LIVE room so web
// collaborators see it at once (server lib/block-merge.ts). A block the app did not touch is sent back as
// the exact JSON it arrived as, so the merge sees it unchanged and its formatting, mentions and dates stay.
//
// Editable: paragraphs, headings 1–3, bullet / numbered / to-do items, toggles (their title), quotes. Every
// other block (callout, code, table, image, file, bookmark, divider) is kept as it is and can be moved or
// deleted. An edited line is plain text (marks inside a CHANGED line are not kept, as when an older client
// edits the description).
//
// Offline-safe: an edit that cannot be sent waits in BlockEditOutbox (a file in Application Support) and is
// sent with the same base the next time the app is online; a conflict is then asked about, never lost.
// ─────────────────────────────────────────────────────────────────────────────

typealias RawJSON = [String: Any]

enum BlockKind: String, CaseIterable, Identifiable, Sendable {
    case paragraph, h1, h2, h3, bullet, numbered, todo, toggle, quote, other
    var id: String { rawValue }

    var label: String {
        switch self {
        case .paragraph: return T("Text")
        case .h1: return T("Heading 1")
        case .h2: return T("Heading 2")
        case .h3: return T("Heading 3")
        case .bullet: return T("Bulleted list")
        case .numbered: return T("Numbered list")
        case .todo: return T("To-do list")
        case .toggle: return T("Toggle")
        case .quote: return T("Quote")
        case .other: return T("Block")
        }
    }
    var symbol: String {
        switch self {
        case .paragraph: return "text.alignleft"
        case .h1: return "textformat.size.larger"
        case .h2: return "textformat.size"
        case .h3: return "textformat.size.smaller"
        case .bullet: return "list.bullet"
        case .numbered: return "list.number"
        case .todo: return "checklist"
        case .toggle: return "chevron.right.circle"
        case .quote: return "text.quote"
        case .other: return "square.dashed"
        }
    }
    var isList: Bool { self == .bullet || self == .numbered || self == .todo }
    /// The kinds a row can be turned into.
    static let editable: [BlockKind] = [.paragraph, .h1, .h2, .h3, .bullet, .numbered, .todo, .toggle, .quote]
}

/// One editable line of the document.
struct BlockRow: Identifiable, Equatable {
    let id = UUID()
    var kind: BlockKind
    var text: String
    var checked = false
    /// What it arrived as, to send back untouched when nothing changed.
    var originalKind: BlockKind
    var originalText: String
    var originalChecked = false
    /// The node it came from (a block, or a list item for list rows). nil = made in the app.
    var raw: RawJSON? = nil
    /// The list it came from: its attrs (e.g. `start`) and a number shared by its items.
    var listAttrs: RawJSON? = nil
    var listGroup: Int? = nil

    static func == (a: BlockRow, b: BlockRow) -> Bool {
        a.id == b.id && a.kind == b.kind && a.text == b.text && a.checked == b.checked
    }

    var isUnchanged: Bool { raw != nil && kind == originalKind && text == originalText && checked == originalChecked }

    static func new(_ kind: BlockKind, _ text: String = "") -> BlockRow {
        BlockRow(kind: kind, text: text, originalKind: kind, originalText: "\u{0}")
    }
}

enum BlockConvert {
    // MARK: reading

    static func inlineText(_ nodes: [Any]?) -> String {
        (nodes ?? []).map { n -> String in
            guard let o = n as? RawJSON else { return "" }
            let type = o["type"] as? String ?? ""
            let attrs = o["attrs"] as? RawJSON
            switch type {
            case "text": return o["text"] as? String ?? ""
            case "hardBreak": return "\n"
            case "mention": return "@" + ((attrs?["label"] as? String) ?? "")
            case "dateChip": return (attrs?["date"] as? String) ?? ""
            default: return inlineText(o["content"] as? [Any])
            }
        }.joined()
    }

    /// The text of a list item / quote / toggle part: its paragraphs, one per line.
    static func blockText(_ node: RawJSON) -> String {
        let kids = node["content"] as? [Any] ?? []
        let paras = kids.compactMap { $0 as? RawJSON }.filter { ($0["type"] as? String) == "paragraph" || ($0["type"] as? String) == "heading" }
        if paras.isEmpty { return inlineText(kids) }
        return paras.map { inlineText($0["content"] as? [Any]) }.joined(separator: "\n")
    }

    static func rows(from blocks: [RawJSON]) -> [BlockRow] {
        var out: [BlockRow] = []
        var group = 0
        for b in blocks {
            let type = b["type"] as? String ?? ""
            let attrs = b["attrs"] as? RawJSON
            switch type {
            case "paragraph":
                let t = inlineText(b["content"] as? [Any])
                out.append(BlockRow(kind: .paragraph, text: t, originalKind: .paragraph, originalText: t, raw: b))
            case "heading":
                let level = (attrs?["level"] as? Int) ?? Int((attrs?["level"] as? Double) ?? 1)
                let k: BlockKind = level <= 1 ? .h1 : (level == 2 ? .h2 : .h3)
                let t = inlineText(b["content"] as? [Any])
                out.append(BlockRow(kind: k, text: t, originalKind: k, originalText: t, raw: b))
            case "bulletList", "orderedList", "taskList":
                group += 1
                let k: BlockKind = type == "bulletList" ? .bullet : (type == "orderedList" ? .numbered : .todo)
                for item in (b["content"] as? [Any] ?? []).compactMap({ $0 as? RawJSON }) {
                    let t = firstParagraphText(item)
                    let checked = ((item["attrs"] as? RawJSON)?["checked"] as? Bool) ?? false
                    out.append(BlockRow(kind: k, text: t, checked: checked, originalKind: k, originalText: t,
                                        originalChecked: checked, raw: item, listAttrs: attrs, listGroup: group))
                }
            case "details":
                let summary = (b["content"] as? [Any] ?? []).compactMap { $0 as? RawJSON }.first { ($0["type"] as? String) == "detailsSummary" }
                let t = inlineText(summary?["content"] as? [Any])
                out.append(BlockRow(kind: .toggle, text: t, originalKind: .toggle, originalText: t, raw: b))
            case "blockquote":
                let t = blockText(b)
                out.append(BlockRow(kind: .quote, text: t, originalKind: .quote, originalText: t, raw: b))
            default:
                out.append(BlockRow(kind: .other, text: "", originalKind: .other, originalText: "", raw: b))
            }
        }
        return out
    }

    private static func firstParagraphText(_ item: RawJSON) -> String {
        let kids = (item["content"] as? [Any] ?? []).compactMap { $0 as? RawJSON }
        if let p = kids.first(where: { ($0["type"] as? String) == "paragraph" }) { return inlineText(p["content"] as? [Any]) }
        return ""
    }

    // MARK: writing

    /// Plain text → inline nodes (lines joined by hard breaks).
    static func inline(_ text: String) -> [Any] {
        var out: [Any] = []
        let lines = text.components(separatedBy: "\n")
        for (i, line) in lines.enumerated() {
            if i > 0 { out.append(["type": "hardBreak"]) }
            if !line.isEmpty { out.append(["type": "text", "text": line]) }
        }
        return out
    }

    static func paragraph(_ text: String) -> RawJSON {
        let c = inline(text)
        return c.isEmpty ? ["type": "paragraph"] : ["type": "paragraph", "content": c]
    }

    private static func listItem(_ row: BlockRow) -> RawJSON {
        if row.isUnchanged, let raw = row.raw { return raw }
        // Keep what the item held under its first line (a nested list) when only the line changed.
        var rest: [Any] = []
        if let raw = row.raw, row.originalKind.isList {
            let kids = raw["content"] as? [Any] ?? []
            var skipped = false
            for k in kids {
                if !skipped, let o = k as? RawJSON, (o["type"] as? String) == "paragraph" { skipped = true; continue }
                rest.append(k)
            }
        }
        var item: RawJSON = ["type": row.kind == .todo ? "taskItem" : "listItem", "content": [paragraph(row.text)] + rest]
        if row.kind == .todo { item["attrs"] = ["checked": row.checked] }
        return item
    }

    /// The rows back into top-level blocks. Untouched rows give back the JSON they came from; consecutive
    /// list rows of one kind form one list (keeping the first original list's attrs).
    static func blocks(from rows: [BlockRow]) -> [RawJSON] {
        var out: [RawJSON] = []
        var i = 0
        while i < rows.count {
            let r = rows[i]
            if r.kind.isList {
                var items: [BlockRow] = [r]
                var group: Int? = r.listGroup
                var j = i + 1
                // A list from the server ends where its group ends; rows made in the app join the list
                // around them.
                while j < rows.count, rows[j].kind == r.kind {
                    if let g = rows[j].listGroup, let g0 = group, g != g0 { break }
                    if group == nil { group = rows[j].listGroup }
                    items.append(rows[j])
                    j += 1
                }
                let type = r.kind == .bullet ? "bulletList" : (r.kind == .numbered ? "orderedList" : "taskList")
                var list: RawJSON = ["type": type, "content": items.map(listItem)]
                if let source = items.first(where: { $0.listAttrs != nil }), source.originalKind == r.kind, let attrs = source.listAttrs {
                    list["attrs"] = attrs
                }
                out.append(list)
                i = j
                continue
            }
            out.append(block(r))
            i += 1
        }
        return out.isEmpty ? [["type": "paragraph"]] : out
    }

    private static func block(_ r: BlockRow) -> RawJSON {
        if r.isUnchanged, let raw = r.raw { return raw }
        switch r.kind {
        case .paragraph: return paragraph(r.text)
        case .h1, .h2, .h3:
            let level = r.kind == .h1 ? 1 : (r.kind == .h2 ? 2 : 3)
            var h: RawJSON = ["type": "heading", "attrs": ["level": level]]
            let c = inline(r.text)
            if !c.isEmpty { h["content"] = c }
            return h
        case .quote:
            return ["type": "blockquote", "content": r.text.components(separatedBy: "\n").map { paragraph($0) }]
        case .toggle:
            // A toggle keeps its hidden content; only its title changes.
            var body: [Any] = [["type": "detailsContent", "content": [["type": "paragraph"]]]]
            if let raw = r.raw, r.originalKind == .toggle {
                body = (raw["content"] as? [Any] ?? []).filter { (($0 as? RawJSON)?["type"] as? String) != "detailsSummary" }
            }
            var summary: RawJSON = ["type": "detailsSummary"]
            let c = inline(r.text)
            if !c.isEmpty { summary["content"] = c }
            return ["type": "details", "content": [summary] + body]
        case .other:
            return r.raw ?? ["type": "paragraph"]
        case .bullet, .numbered, .todo:
            return paragraph(r.text)   // not reached: lists are grouped above
        }
    }

    static func doc(_ blocks: [RawJSON]) -> RawJSON { ["type": "doc", "content": blocks] }
}

// MARK: - server calls

/// What the server says about an edit.
enum BlockSaveOutcome {
    case saved(RawJSON)
    case conflict(RawJSON)
    /// Not sent (offline): kept in the outbox.
    case queued
    case failed(String)
}

/// Which body: a page or a task's description.
struct BlockBodyRef: Codable, Hashable, Sendable {
    let kind: String   // "doc" | "taskbody"
    let id: String
}

extension APIClient {
    /// The document as JSON (pages: GET /api/docs/:id; tasks: GET /api/tasks/:id/body).
    func blockBody(_ ref: BlockBodyRef) async throws -> (doc: RawJSON, canEdit: Bool) {
        let path = ref.kind == "doc" ? "/api/docs/\(ref.id)" : "/api/tasks/\(ref.id)/body"
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(makeRequest(path)) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? RawJSON else { throw APIError.decoding }
        if ref.kind == "doc" {
            let doc = obj["doc"] as? RawJSON
            let content = doc?["content"] as? RawJSON
            return (content ?? BlockConvert.doc([["type": "paragraph"]]), true)
        }
        return ((obj["doc"] as? RawJSON) ?? BlockConvert.doc([["type": "paragraph"]]), (obj["canEdit"] as? Bool) ?? false)
    }

    /// POST /api/collab/edit — merged into the live document (see the server's lib/block-merge.ts).
    func applyBlockEdit(_ ref: BlockBodyRef, base: RawJSON, doc: RawJSON, keepBoth: Bool) async throws -> BlockSaveOutcome {
        var req = makeRequest("/api/collab/edit", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["kind": ref.kind, "id": ref.id, "base": base, "doc": doc, "keepBoth": keepBoth])
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await perform(req) } catch { throw APIError.nothingAnswered(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? RawJSON
        if http.statusCode == 409, let live = obj?["doc"] as? RawJSON { return .conflict(live) }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, Self.serverMessage(data)) }
        return .saved((obj?["doc"] as? RawJSON) ?? doc)
    }
}

/// Edits that could not be sent yet, kept on disk per body (one pending edit each: the latest wins, with the
/// FIRST base, so the merge still knows what the app started from).
@MainActor
final class BlockEditOutbox {
    static let shared = BlockEditOutbox()
    private struct Pending: Codable { let ref: BlockBodyRef; let base: Data; let doc: Data; let savedAt: Date }
    private var items: [String: Pending] = [:]
    private let url: URL? = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
        .appendingPathComponent("block-edit-outbox.json")
    private var flushing = false

    private init() {
        if let url, let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode([String: Pending].self, from: data) {
            items = decoded
        }
    }

    private func key(_ ref: BlockBodyRef) -> String { "\(ref.kind):\(ref.id)" }

    func hasPending(_ ref: BlockBodyRef) -> Bool { items[key(ref)] != nil }

    /// The edit waiting for this body, if any: (base, doc).
    func pending(_ ref: BlockBodyRef) -> (base: RawJSON, doc: RawJSON)? {
        guard let p = items[key(ref)],
              let base = (try? JSONSerialization.jsonObject(with: p.base)) as? RawJSON,
              let doc = (try? JSONSerialization.jsonObject(with: p.doc)) as? RawJSON else { return nil }
        return (base, doc)
    }

    func keep(_ ref: BlockBodyRef, base: RawJSON, doc: RawJSON) {
        let firstBase = items[key(ref)]?.base ?? (try? JSONSerialization.data(withJSONObject: base)) ?? Data()
        guard let docData = try? JSONSerialization.data(withJSONObject: doc) else { return }
        items[key(ref)] = Pending(ref: ref, base: firstBase, doc: docData, savedAt: Date())
        write()
    }

    func drop(_ ref: BlockBodyRef) {
        items[key(ref)] = nil
        write()
    }

    private func write() {
        guard let url else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(items) { try? data.write(to: url, options: .atomic) }
    }

    /// Sends what waits; a conflict stays here until its page is opened, where the person decides.
    func flush() async {
        guard !flushing, !items.isEmpty else { return }
        flushing = true
        defer { flushing = false }
        for (_, p) in items {
            guard let base = (try? JSONSerialization.jsonObject(with: p.base)) as? RawJSON,
                  let doc = (try? JSONSerialization.jsonObject(with: p.doc)) as? RawJSON else { drop(p.ref); continue }
            if let outcome = try? await APIClient.shared.applyBlockEdit(p.ref, base: base, doc: doc, keepBoth: false),
               case .saved = outcome {
                drop(p.ref)
            }
        }
    }
}

/// The editing state of one body.
@MainActor
@Observable
final class BlockEditorModel {
    let ref: BlockBodyRef
    private(set) var base: RawJSON = BlockConvert.doc([["type": "paragraph"]])
    var rows: [BlockRow] = []
    private(set) var loaded = false
    private(set) var canEdit = true
    private(set) var saving = false
    /// Shown under the page: why the edit is not on the server yet, or a failure.
    var note: String?
    /// The live document when a save met someone else's change to the same block.
    var conflictDoc: RawJSON?

    init(ref: BlockBodyRef) { self.ref = ref }

    var currentDoc: RawJSON { BlockConvert.doc(BlockConvert.blocks(from: rows)) }
    var isDirty: Bool { rows.contains { !$0.isUnchanged } || rows.count != BlockConvert.rows(from: blocks(of: base)).count }

    private func blocks(of doc: RawJSON) -> [RawJSON] { (doc["content"] as? [Any] ?? []).compactMap { $0 as? RawJSON } }

    func load() async {
        do {
            let r = try await APIClient.shared.blockBody(ref)
            canEdit = r.canEdit
            if let waiting = BlockEditOutbox.shared.pending(ref) {
                // An edit made offline: shown again on its own base, and sent now.
                base = waiting.base
                rows = BlockConvert.rows(from: blocks(of: waiting.doc))
                loaded = true
                await save()
                return
            }
            set(r.doc)
        } catch {
            if let waiting = BlockEditOutbox.shared.pending(ref) {
                base = waiting.base
                rows = BlockConvert.rows(from: blocks(of: waiting.doc))
                note = T("Offline: your changes are kept on this phone and sent when you are back online.")
            } else {
                note = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the page.")
            }
        }
        loaded = true
    }

    private func set(_ doc: RawJSON) {
        base = doc
        rows = BlockConvert.rows(from: blocks(of: doc))
        if rows.isEmpty { rows = [BlockRow.new(.paragraph)] }
        loaded = true
    }

    /// Sends the edit. `keepBoth` answers a conflict by keeping the other version too.
    @discardableResult
    func save(keepBoth: Bool = false) async -> Bool {
        guard loaded, canEdit, !saving else { return false }
        let doc = currentDoc
        guard keepBoth || isDirty || BlockEditOutbox.shared.hasPending(ref) else { return true }
        saving = true
        defer { saving = false }
        do {
            switch try await APIClient.shared.applyBlockEdit(ref, base: base, doc: doc, keepBoth: keepBoth) {
            case .saved(let live):
                BlockEditOutbox.shared.drop(ref)
                conflictDoc = nil
                note = nil
                set(live)
                return true
            case .conflict(let live):
                BlockEditOutbox.shared.keep(ref, base: base, doc: doc)
                conflictDoc = live
                return false
            case .queued:
                return false
            case .failed(let m):
                note = m
                return false
            }
        } catch let failure as APIError where failure.nobodyAnswered {
            BlockEditOutbox.shared.keep(ref, base: base, doc: doc)
            note = T("Offline: your changes are kept on this phone and sent when you are back online.")
            return false
        } catch {
            BlockEditOutbox.shared.keep(ref, base: base, doc: doc)
            note = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the page. Your changes are kept on this phone.")
            return false
        }
    }

    /// Throw this device's edit away and show the document as it is now.
    func discardMine() {
        BlockEditOutbox.shared.drop(ref)
        if let live = conflictDoc { set(live) }
        conflictDoc = nil
    }

    /// Sends what is typed without waiting (the screen is closing).
    func saveOnClose() {
        guard loaded, canEdit, isDirty else { return }
        BlockEditOutbox.shared.keep(ref, base: base, doc: currentDoc)
        Task { await BlockEditOutbox.shared.flush() }
    }

    // MARK: row edits

    func insert(after id: UUID?, _ row: BlockRow) {
        if let id, let i = rows.firstIndex(where: { $0.id == id }) { rows.insert(row, at: i + 1) } else { rows.append(row) }
    }
    func remove(_ id: UUID) {
        rows.removeAll { $0.id == id }
        if rows.isEmpty { rows = [BlockRow.new(.paragraph)] }
    }
    func move(_ id: UUID, by d: Int) {
        guard let i = rows.firstIndex(where: { $0.id == id }), rows.indices.contains(i + d) else { return }
        rows.swapAt(i, i + d)
    }
    func turn(_ id: UUID, into kind: BlockKind) {
        guard let i = rows.firstIndex(where: { $0.id == id }), rows[i].kind != .other else { return }
        rows[i].kind = kind
        if kind != rows[i].originalKind { rows[i].listGroup = nil }
    }
}
