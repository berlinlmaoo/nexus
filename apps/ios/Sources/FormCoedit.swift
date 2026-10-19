import Foundation

/// Field-level operations and a three-way rebase. Unknown JSON keys survive every merge.
/// Delete wins over edit; independently changed question/settings keys never replace one another.
enum FormCoedit {
    typealias Object = [String: FormJSON]
    static func rows(_ value: FormJSON?) -> [Object] { (value?.array ?? []).compactMap(\.object) }
    static func id(_ row: Object) -> String { row["id"]?.string ?? "" }
    static func keys(_ objects: Object...) -> [String] { Array(Set(objects.flatMap { $0.keys })).sorted() }
    static func patch(_ base: FormJSON?, _ mine: FormJSON?) -> FormJSON? {
        guard base != mine else { return nil }
        guard let m = mine?.object, !m.isEmpty else { return .null }
        let b = base?.object ?? [:]
        return .object(Dictionary(uniqueKeysWithValues: keys(b, m).filter { b[$0] != m[$0] }.map { ($0, m[$0] ?? .null) }))
    }
    static func diff(_ base: Object, _ mine: Object) -> [Object] {
        var ops: [Object] = []
        if base["name"] != mine["name"] { ops.append(["op": .string("set_title"), "value": mine["name"] ?? .string("")]) }
        if base["description"] != mine["description"] { ops.append(["op": .string("set_description"), "value": mine["description"] ?? .null]) }
        var settings: Object = ["op": .string("set_settings")]
        for key in ["isPublic", "requireAuth", "accessSchedule"] where base[key] != mine[key] { settings[key] = mine[key] ?? .null }
        for key in ["branding", "settings"] { if let p = patch(base[key], mine[key]) { settings[key] = p } }
        if settings.count > 1 { ops.append(settings) }
        let b = rows(base["fields"]), m = rows(mine["fields"])
        let byID = Dictionary(b.map { (id($0), $0) }, uniquingKeysWith: { a, _ in a })
        let ids = m.map(id), mineIDs = Set(ids)
        for row in b where !mineIDs.contains(id(row)) { ops.append(["op": .string("delete_question"), "id": .string(id(row))]) }
        var simulated = b.map(id).filter { mineIDs.contains($0) }
        for (i, row) in m.enumerated() {
            let key = id(row)
            guard let old = byID[key] else {
                ops.append(["op": .string("add_question"), "question": .object(row), "afterId": i == 0 ? .null : .string(ids[i - 1])])
                let at = i == 0 ? 0 : (simulated.firstIndex(of: ids[i - 1]).map { $0 + 1 } ?? simulated.count)
                simulated.insert(key, at: at); continue
            }
            var changed: Object = [:]; var unset: [FormJSON] = []
            for k in keys(old, row) where k != "id" && old[k] != row[k] {
                if let v = row[k] { changed[k] = v } else { unset.append(.string(k)) }
            }
            if !changed.isEmpty || !unset.isEmpty { ops.append(["op": .string("update_question"), "id": .string(key), "fields": .object(changed), "unset": .array(unset)]) }
        }
        let positions = Dictionary(simulated.enumerated().map { ($0.element, $0.offset) }, uniquingKeysWith: { a, _ in a })
        let sequence = ids.map { positions[$0] ?? -1 }
        let keep = longestRun(sequence)
        for (i, key) in ids.enumerated() where !keep.contains(i) { ops.append(["op": .string("move_question"), "id": .string(key), "afterId": i == 0 ? .null : .string(ids[i - 1])]) }
        return ops
    }
    private static func longestRun(_ sequence: [Int]) -> Set<Int> {
        var tails: [Int] = [], prev = Array(repeating: -1, count: sequence.count)
        for i in sequence.indices {
            var lo = 0, hi = tails.count
            while lo < hi { let mid = (lo + hi) / 2; if sequence[tails[mid]] < sequence[i] { lo = mid + 1 } else { hi = mid } }
            if lo > 0 { prev[i] = tails[lo - 1] }
            if lo == tails.count { tails.append(i) } else { tails[lo] = i }
        }
        var result: Set<Int> = []; var at = tails.last ?? -1
        while at >= 0 { result.insert(at); at = prev[at] }
        return result
    }
    /// Advance the acknowledged base for a bounded batch; later batches remain unsaved.
    static func applying(_ ops: [Object], to document: Object) -> Object {
        var out = document
        var fields = rows(out["fields"])
        for op in ops {
            switch op["op"]?.string {
            case "set_title": out["name"] = op["value"]
            case "set_description": out["description"] = op["value"]
            case "set_settings":
                for (key, value) in op where key != "op" {
                    if ["branding", "settings"].contains(key), let patch = value.object {
                        var o = out[key]?.object ?? [:]
                        for (k, v) in patch { if v.isNull { o.removeValue(forKey: k) } else { o[k] = v } }
                        out[key] = o.isEmpty ? .null : .object(o)
                    } else { out[key] = value }
                }
            case "delete_question": fields.removeAll { id($0) == op["id"]?.string }
            case "update_question":
                if let at = fields.firstIndex(where: { id($0) == op["id"]?.string }) {
                    for (k, v) in op["fields"]?.object ?? [:] where k != "id" { fields[at][k] = v }
                    for key in op["unset"]?.array ?? [] { if let k = key.string, k != "id" { fields[at].removeValue(forKey: k) } }
                }
            case "add_question", "move_question":
                let row: Object
                if op["op"]?.string == "add_question", let q = op["question"]?.object {
                    if fields.contains(where: { id($0) == id(q) }) { continue }; row = q
                } else if let at = fields.firstIndex(where: { id($0) == op["id"]?.string }) { row = fields.remove(at: at) }
                else { continue }
                let at = op["afterId"]?.isNull == true ? 0 : op["afterId"]?.string.flatMap { anchor in fields.firstIndex(where: { id($0) == anchor }).map { $0 + 1 } } ?? fields.count
                fields.insert(row, at: at)
            default: break
            }
        }
        out["fields"] = .array(fields.map(FormJSON.object)); return out
    }

    static func mergeObject(_ base: Object, _ mine: Object, _ theirs: Object) -> Object {
        var out: Object = [:]
        for k in keys(base, mine, theirs) { out[k] = mine[k] == base[k] ? theirs[k] : mine[k] }
        return out
    }
    static func rebase(_ base: Object, _ mine: Object, _ theirs: Object) -> Object {
        var out = mergeObject(base, mine, theirs)
        for k in ["branding", "settings"] {
            if mine[k] == base[k] { out[k] = theirs[k] }
            else if theirs[k] == base[k] { out[k] = mine[k] }
            else { let merged = mergeObject(base[k]?.object ?? [:], mine[k]?.object ?? [:], theirs[k]?.object ?? [:]).filter { !$0.value.isNull }; out[k] = merged.isEmpty ? .null : .object(merged) }
        }
        let b = rows(base["fields"]), m = rows(mine["fields"]), t = rows(theirs["fields"])
        let bm = Dictionary(b.map { (id($0), $0) }, uniquingKeysWith: { a, _ in a })
        let mm = Dictionary(m.map { (id($0), $0) }, uniquingKeysWith: { a, _ in a })
        let tm = Dictionary(t.map { (id($0), $0) }, uniquingKeysWith: { a, _ in a })
        let keep = Set(t.filter { mm[id($0)] != nil || bm[id($0)] == nil }.map(id) + m.filter { bm[id($0)] == nil }.map(id))
        let baseIDs = b.map(id), mineIDs = m.map(id), theirIDs = t.map(id)
        let reordered = mineIDs.filter { bm[$0] != nil } != baseIDs.filter { mm[$0] != nil }
        let lead = reordered ? mineIDs : theirIDs, other = reordered ? theirIDs : mineIDs
        var order = lead.filter { keep.contains($0) }
        for (i, key) in other.enumerated() where keep.contains(key) && !order.contains(key) {
            var at = 0
            for previous in other.prefix(i).reversed() { if let p = order.firstIndex(of: previous) { at = p + 1; break } }
            order.insert(key, at: at)
        }
        out["fields"] = .array(order.compactMap { key in
            if let b = bm[key], let m = mm[key], let t = tm[key] { return .object(mergeObject(b, m, t)) }
            return (mm[key] ?? tm[key]).map(FormJSON.object)
        })
        // A deleted branching target must not leave a question permanently hidden.
        if let fields = out["fields"]?.array {
            out["fields"] = .array(fields.map { row in
                guard var o = row.object, let target = o["showIf"]?.object?["fieldId"]?.string, !keep.contains(target) else { return row }
                o.removeValue(forKey: "showIf"); return .object(o)
            })
        }
        return out
    }
    static func decodeObject(_ value: Any) -> Object {
        guard let data = try? JSONSerialization.data(withJSONObject: value), let obj = try? JSONDecoder().decode(FormJSON.self, from: data).object else { return [:] }; return obj
    }
}

struct FormOpsReply: Decodable { let form: BuilderForm; let version: Int }
struct FormOpsEvent: Decodable { let formId: String; let version: Int; let originTab: String?; let form: BuilderForm }
struct FormEditor: Decodable, Identifiable { let userId: String; let name: String; let avatar: String?; let color: String?; let questionId: String?; var id: String { userId } }
struct FormPresenceEvent: Decodable { let formId: String; let members: [FormEditor] }
