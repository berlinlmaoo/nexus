// Named ranges and protected sheets / ranges (Data ▸ Named ranges, Data ▸ Protect sheets and ranges) — the
// plain rules of the web's components/sheets/SheetRangesPanel.tsx and SheetGrid.tsx protectedHere, stored
// exactly as the web saves them in settings.namedRanges / settings.protections (narrowed by the server's
// readSheetSettings, which also enforces restricted ranges). Foundation only; tested in Tests/SheetPanels.
import Foundation

enum SheetRanges {
    // MARK: named ranges

    struct Named: Equatable {
        var id: String
        var name: String
        /// Stored id-space range "{col!row}:{col!row}".
        var range: String

        init(id: String, name: String, range: String) { self.id = id; self.name = name; self.range = range }
        init?(json: Any?) {
            guard let o = json as? [String: Any], let id = o["id"] as? String, let name = o["name"] as? String,
                  let range = o["range"] as? String else { return nil }
            self.id = id; self.name = name; self.range = range
        }
        var json: [String: Any] { ["id": id, "name": name, "range": range] }
    }

    private static let namePattern = try! NSRegularExpression(pattern: "^[A-Za-z_\\p{L}][A-Za-z0-9_.\\p{L}]*\\z")
    private static let cellLike = try! NSRegularExpression(pattern: "^[A-Za-z]{1,3}\\d+\\z")
    private static let r1c1Like = try! NSRegularExpression(pattern: "^R\\d*C\\d*\\z", options: [.caseInsensitive])

    private static func full(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    /// Why a named-range name is refused (English source text, translate in the UI), or nil when it's fine.
    /// Sheets' rules: starts with a letter or "_", only letters, digits, "_" and "."; can't look like a cell
    /// (A1, R1C1), can't be TRUE / FALSE, at most 250 characters, unique in the sheet (any case).
    static func validateRangeName(_ name: String, existing: [Named], selfId: String? = nil) -> String? {
        let n = SheetJS.trim(name)
        if n.isEmpty { return "Enter a name" }
        if n.utf16.count > 250 { return "Names can be at most 250 characters" }
        if !full(namePattern, n) { return "Names must start with a letter or underscore and contain only letters, numbers, underscores and periods" }
        if n.lowercased() == "true" || n.lowercased() == "false" { return "TRUE and FALSE can't be used as names" }
        if full(cellLike, n) || full(r1c1Like, n) { return "Names can't look like a cell reference, e.g. A1 or R1C1" }
        if existing.contains(where: { $0.id != selfId && $0.name.lowercased() == n.lowercased() }) { return "That name is already used by another range" }
        return nil
    }

    /// The next free "NamedRange1", "NamedRange2"… ("RentangBernama1" in Indonesian).
    static func nextName(_ ranges: [Named], base: String) -> String {
        var i = 1
        while true {
            let n = "\(base)\(i)"
            if !ranges.contains(where: { $0.name.lowercased() == n.lowercased() }) { return n }
            i += 1
        }
    }

    // MARK: protections

    struct Protection: Equatable {
        var id: String
        /// A protected range (stored id form), or nil for the whole sheet.
        var range: String?
        var sheet: Bool
        /// Whole sheet: ranges left editable.
        var except: [String]
        var desc: String?
        /// "warn" | "restrict"
        var mode: String
        var editors: [String]?
        /// Who made it (always allowed through).
        var by: String?

        init(id: String, range: String?, sheet: Bool, except: [String] = [], desc: String? = nil, mode: String,
             editors: [String]? = nil, by: String? = nil) {
            self.id = id; self.range = range; self.sheet = sheet; self.except = except; self.desc = desc
            self.mode = mode; self.editors = editors; self.by = by
        }

        init?(json: Any?) {
            guard let o = json as? [String: Any], let id = o["id"] as? String else { return nil }
            self.id = id
            range = o["range"] as? String
            sheet = (o["sheet"] as? Bool) == true
            if range == nil && !sheet { return nil }
            except = (o["except"] as? [String]) ?? []
            desc = o["desc"] as? String
            mode = (o["mode"] as? String) == "restrict" ? "restrict" : "warn"
            editors = o["editors"] as? [String]
            by = o["by"] as? String
        }

        var json: [String: Any] {
            var o: [String: Any] = ["id": id, "mode": mode]
            if sheet { o["sheet"] = true } else if let range { o["range"] = range }
            if sheet && !except.isEmpty { o["except"] = except }
            if let desc, !SheetJS.trim(desc).isEmpty { o["desc"] = SheetJS.trim(desc) }
            if let editors { o["editors"] = editors }
            if let by { o["by"] = by }
            return o
        }

        /// The editors list a saved protection carries: the owner plus the picked people when restricted.
        static func editorsFor(mode: String, owner: String, custom: Bool, picked: [String]) -> [String]? {
            guard mode == "restrict" else { return nil }
            var out = [owner]
            if custom { for p in picked where !out.contains(p) { out.append(p) } }
            return out
        }
    }

    enum Hit: Equatable { case warn, deny }

    /// What protects a cell (model indices) for this person: nil, a warning, or a refusal (web protectedHere).
    /// `rect` reads a stored range in model indices.
    static func protectedHere(_ list: [Protection], row: Int, col: Int, me: String, canManage: Bool,
                              rect: (String) -> SheetValidation.Rect?) -> Hit? {
        var out: Hit? = nil
        func inside(_ stored: String) -> Bool {
            guard let rc = rect(stored) else { return false }
            return row >= rc.top && row <= rc.bottom && col >= rc.left && col <= rc.right
        }
        for p in list {
            let hit: Bool
            if p.sheet { hit = !p.except.contains(where: inside) } else { hit = p.range.map(inside) ?? false }
            if !hit { continue }
            if p.mode == "restrict" {
                if (p.by != nil && p.by == me) || (p.editors ?? []).contains(me) || canManage { continue }
                return .deny
            }
            out = .warn
        }
        return out
    }
}
