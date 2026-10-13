// Version history (File ▸ Version history) built from the per-cell revision log — 1:1 port of the web's
// lib/sheet-versions.ts — and Find and replace's matcher (lib/sheet-datatools.ts buildMatcher / textMatches /
// replaceText). Foundation only; tested on Linux (Tests/SheetPanels).
//
// Sheets shows "versions": bursts of edits close together in time, grouped by day, newest first, with named
// versions kept apart. Looking at a version = the current cells with every later edit undone.
import Foundation

/// One SheetCellRevision as GET /api/sheets/:id/revisions answers it.
struct SPRevision {
    var id: String
    var rowId: String
    var columnId: String
    var oldValue: Any?
    var newValue: Any?
    var createdAt: String
    /// nil when the account was deleted (the author FK is SET NULL).
    var authorId: String?
    var authorName: String?
    var authorAvatar: String?

    init(id: String = "", rowId: String, columnId: String, oldValue: Any?, newValue: Any?, createdAt: String,
         authorId: String?, authorName: String?, authorAvatar: String? = nil) {
        self.id = id; self.rowId = rowId; self.columnId = columnId; self.oldValue = oldValue; self.newValue = newValue
        self.createdAt = createdAt; self.authorId = authorId; self.authorName = authorName; self.authorAvatar = authorAvatar
    }

    init?(json o: [String: Any]) {
        guard let rowId = o["rowId"] as? String, let columnId = o["columnId"] as? String,
              let createdAt = o["createdAt"] as? String else { return nil }
        id = o["id"] as? String ?? ""
        self.rowId = rowId
        self.columnId = columnId
        oldValue = o["oldValue"] is NSNull ? nil : o["oldValue"]
        newValue = o["newValue"] is NSNull ? nil : o["newValue"]
        self.createdAt = createdAt
        let author = o["author"] as? [String: Any]
        authorId = author?["id"] as? String
        authorName = author?["name"] as? String
        authorAvatar = author?["avatar"] as? String
    }
}

/// settings.versions[] — a name given to a moment.
struct SPNamedVersion {
    var id: String
    var name: String
    var at: String
}

enum SPVersions {
    struct Author: Equatable { var id: String; var name: String? }

    struct Entry: Equatable {
        /// ISO time of the version's last edit — the id used to select, name and restore it.
        var at: String
        /// ISO time of its first edit.
        var from: String
        var authors: [Author]
        var count: Int
        var name: String? = nil
        var current = false
    }

    struct Day: Equatable {
        var day: String
        var versions: [Entry]
    }

    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Milliseconds since 1970 of an ISO time; nil when unreadable (JS NaN).
    static func ms(_ iso: String) -> Double? {
        if let d = isoFrac.date(from: iso) ?? isoPlain.date(from: iso) { return (d.timeIntervalSince1970 * 1000).rounded() }
        return nil
    }

    static func date(_ iso: String) -> Date? { ms(iso).map { Date(timeIntervalSince1970: $0 / 1000) } }

    /// YYYY-MM-DD of an instant at a fixed UTC offset (Asia/Jakarta, +420 minutes, by default).
    static func dayKey(_ iso: String, _ offsetMinutes: Int = 420) -> String {
        guard let t = ms(iso) else { return "" }
        let d = Date(timeIntervalSince1970: t / 1000 + Double(offsetMinutes) * 60)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Newest first, stable (Array.prototype.sort is).
    private static func newestFirst(_ revisions: [SPRevision]) -> [SPRevision] {
        revisions.enumerated().compactMap { e in ms(e.element.createdAt).map { (e.offset, $0, e.element) } }
            .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }
            .map { $0.2 }
    }

    /// Group revisions into versions. A new version starts when consecutive edits are `gapMinutes` or more
    /// apart, at a day boundary, and at every named version. Days and versions come newest first; the first
    /// one is current.
    static func groupVersions(_ revisions: [SPRevision], _ named: [SPNamedVersion] = [], gapMinutes: Double = 30, offsetMinutes: Int = 420) -> [Day] {
        let gap = gapMinutes * 60_000
        let revs = newestFirst(revisions)
        let cuts = named.compactMap { ms($0.at) }
        var bursts: [[SPRevision]] = []
        for r in revs {
            let t = ms(r.createdAt) ?? 0
            if let prev = bursts.last?.last {
                let p = ms(prev.createdAt) ?? 0
                let split = p - t >= gap
                    || dayKey(prev.createdAt, offsetMinutes) != dayKey(r.createdAt, offsetMinutes)
                    || cuts.contains { t <= $0 && $0 < p }
                if split { bursts.append([r]) } else { bursts[bursts.count - 1].append(r) }
            } else {
                bursts.append([r])
            }
        }
        var versions: [Entry] = bursts.map { b in
            var authors: [Author] = []
            for r in b {
                let id = r.authorId ?? ""
                if !authors.contains(where: { $0.id == id }) { authors.append(Author(id: id, name: r.authorName)) }
            }
            return Entry(at: b[0].createdAt, from: b[b.count - 1].createdAt, authors: authors, count: b.count)
        }
        // A name sits on the newest version at or before its time; the latest naming wins.
        let sortedNames = named.enumerated().sorted { a, b in
            let x = ms(a.element.at) ?? .nan, y = ms(b.element.at) ?? .nan
            return x != y ? x < y : a.offset < b.offset
        }.map { $0.element }
        for n in sortedNames {
            guard let nt = ms(n.at) else { continue }
            if let i = versions.firstIndex(where: { (ms($0.at) ?? .infinity) <= nt }) { versions[i].name = n.name }
        }
        if !versions.isEmpty { versions[0].current = true }
        var days: [Day] = []
        for v in versions {
            let day = dayKey(v.at, offsetMinutes)
            if let last = days.last, last.day == day { days[days.count - 1].versions.append(v) } else { days.append(Day(day: day, versions: [v])) }
        }
        return days
    }

    struct RowCells {
        var id: String
        var cells: [String: Any]
    }

    static func sameJSON(_ a: Any?, _ b: Any?) -> Bool {
        func enc(_ v: Any?) -> Data? {
            let x: Any = (v == nil || v is NSNull) ? NSNull() : v!
            return try? JSONSerialization.data(withJSONObject: [x], options: [.sortedKeys, .fragmentsAllowed])
        }
        return enc(a) == enc(b)
    }

    /// The cells as they were at `at`: start from the current rows and undo every revision made after `at`,
    /// newest first (cell = oldValue; null removes it). Revisions for rows that no longer exist are skipped.
    /// `changed` lists "rowId:colId" of every cell that differs from now.
    static func stateAt(_ rows: [RowCells], _ revisions: [SPRevision], _ at: String) -> (rows: [RowCells], changed: Set<String>) {
        let t = ms(at) ?? .nan
        var out = rows
        var index: [String: Int] = [:]
        for (i, r) in out.enumerated() { index[r.id] = i }
        let later = newestFirst(revisions.filter { (ms($0.createdAt) ?? -.infinity) > t })
        var touched: [String] = []
        var touchedSet = Set<String>()
        for rev in later {
            guard let i = index[rev.rowId] else { continue }
            if rev.oldValue == nil || rev.oldValue is NSNull { out[i].cells.removeValue(forKey: rev.columnId) } else { out[i].cells[rev.columnId] = rev.oldValue }
            let k = "\(rev.rowId):\(rev.columnId)"
            if touchedSet.insert(k).inserted { touched.append(k) }
        }
        var changed = Set<String>()
        for key in touched {
            let (rowId, colId) = splitKey(key)
            let now = rows.first { $0.id == rowId }?.cells[colId]
            let then = index[rowId].flatMap { out[$0].cells[colId] }
            if !sameJSON(now, then) { changed.insert(key) }
        }
        return (out, changed)
    }

    static func splitKey(_ key: String) -> (String, String) {
        guard let i = key.firstIndex(of: ":") else { return (key, "") }
        return (String(key[..<i]), String(key[key.index(after: i)...]))
    }

    /// Cells edited in (after, upTo] mapped to the latest editor's id ("" when the account was deleted).
    static func changedBetween(_ revisions: [SPRevision], _ after: String?, _ upTo: String?) -> [String: String] {
        let a = after.flatMap { ms($0) } ?? -.infinity
        let b = upTo.flatMap { ms($0) } ?? .infinity
        var out: [String: String] = [:]
        let sorted = revisions.enumerated().sorted { x, y in
            let p = ms(x.element.createdAt) ?? .nan, q = ms(y.element.createdAt) ?? .nan
            return p != q ? p < q : x.offset < y.offset
        }.map { $0.element }
        for r in sorted {
            guard let t = ms(r.createdAt) else { continue }
            if t > a && t <= b { out["\(r.rowId):\(r.columnId)"] = r.authorId ?? "" }
        }
        return out
    }

    static func changedSince(_ revisions: [SPRevision], _ at: String) -> [String: String] { changedBetween(revisions, at, nil) }

    /// The `at` of the version just before `at` in a grouped list, or nil for the oldest one.
    static func previousVersionAt(_ days: [Day], _ at: String) -> String? {
        let all = days.flatMap { $0.versions }
        guard let i = all.firstIndex(where: { $0.at == at }), i + 1 < all.count else { return nil }
        return all[i + 1].at
    }

    /// A stable colour per editor (web SheetVersionPanel editorColor).
    static let EDITOR_COLORS = ["#1a73e8", "#e8710a", "#188038", "#a142f4", "#d93025", "#007b83", "#b06000", "#c5221f"]
    static func editorColor(_ id: String) -> String {
        var h: UInt32 = 0
        for ch in id.utf16 { h = h &* 31 &+ UInt32(ch) }
        return EDITOR_COLORS[Int(h % UInt32(EDITOR_COLORS.count))]
    }
}

/// Find and replace's matching (web lib/sheet-datatools.ts).
enum SPFind {
    struct Options {
        var find: String
        var replace: String = ""
        var matchCase = false
        var entire = false
        var regex = false
    }

    /// The search as a regular expression; nil for an empty search or an invalid regular expression.
    static func buildMatcher(_ o: Options) -> NSRegularExpression? {
        if o.find.isEmpty { return nil }
        let body = o.regex ? o.find : NSRegularExpression.escapedPattern(for: o.find)
        let pattern = o.entire ? "^(?:\(body))$" : body
        return try? NSRegularExpression(pattern: pattern, options: o.matchCase ? [] : [.caseInsensitive])
    }

    static func textMatches(_ text: String, _ o: Options) -> Bool {
        guard let re = buildMatcher(o) else { return false }
        return re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// Replace every match in one cell's text. With regex on, "$1" in the replacement refers to groups (as in
    /// Sheets). Returns the new text and how many matches were replaced.
    static func replaceText(_ text: String, _ o: Options) -> (text: String, count: Int) {
        guard let re = buildMatcher(o) else { return (text, 0) }
        let ns = text as NSString
        let matches = re.matches(in: text, range: NSRange(location: 0, length: ns.length))
        if matches.isEmpty { return (text, 0) }
        var out = ""
        var last = 0
        for m in matches {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            out += o.regex ? expand(o.replace, m, ns) : o.replace
            last = m.range.location + m.range.length
        }
        out += ns.substring(from: last)
        return (out, matches.count)
    }

    /// "$1", "$&" in a regex replacement.
    private static func expand(_ template: String, _ m: NSTextCheckingResult, _ ns: NSString) -> String {
        guard let tokens = try? NSRegularExpression(pattern: "\\$(\\d+|&)") else { return template }
        let t = template as NSString
        var out = ""
        var last = 0
        for tok in tokens.matches(in: template, range: NSRange(location: 0, length: t.length)) {
            out += t.substring(with: NSRange(location: last, length: tok.range.location - last))
            let g = t.substring(with: tok.range(at: 1))
            if g == "&" {
                out += ns.substring(with: m.range)
            } else if let n = Int(g), n >= 1, n < m.numberOfRanges, m.range(at: n).location != NSNotFound {
                out += ns.substring(with: m.range(at: n))
            }
            last = tok.range.location + tok.range.length
        }
        out += t.substring(from: last)
        return out
    }
}
