import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Bagan IP & Divisi — GET /api/admin/org-chart and the tree the Control Room tab draws from it.
//
// The rules are the web chart's (apps/web/src/components/OrgChart.tsx), which the
// owner signed off on 5 Oct 2026:
// - a GROUP only arranges cards: no logo, no people, no leader. A card inside a group belongs to the
//   nearest card above the group(s), whose BoD/Manager lead it;
// - a card's people split into a BoD box, a Manager box, a staff box, and one "di bawah <leader>"
//   box per leader for the people placed under that leader in this card;
// - in a card's row, the sub-units a leader leads and the "di bawah" boxes come first, in the order
//   of their leaders; then the other sub-units, with every group side by side; the staff box sits in
//   the middle but never between two groups.
// Positions dragged on the web are a web-only thing: every view here is laid out automatically.
//
// The chart grants nothing — no project access, no attendance rule.
// ─────────────────────────────────────────────────────────────────────────────

struct OrgChartData: Decodable, Sendable {
    let workspaceId: String?
    let units: [OrgUnitDTO]
    let people: [OrgPersonDTO]
}

struct OrgUnitDTO: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    /// "IP" (has a logo), "DIVISION" (no logo) or "GROUP" (only arranges cards).
    let kind: String
    let logoUrl: String?
    let parentId: String?
    let position: Int?
    let leadUserId: String?

    var isGroup: Bool { kind == "GROUP" }
    var isIP: Bool { kind == "IP" }
}

/// POST /api/admin/org-chart and PATCH …/units/:id answer `{ unit }`.
struct OrgUnitEnvelope: Decodable, Sendable { let unit: OrgUnitDTO }

struct OrgPersonDTO: Decodable, Identifiable, Hashable, Sendable {
    let userId: String
    let name: String?
    let email: String?
    let avatar: String?
    /// The company-workspace role: ONE_ABOVE_ALL, BOD, MANAGER or STAFF.
    let role: String?
    let unitIds: [String]
    /// Job title per card: `{ unitId: "CEO" }`.
    let titles: [String: String]?
    /// Who they sit under, per card: `{ unitId: leaderUserId }`.
    let reportsTo: [String: String]?

    var id: String { userId }
    var displayName: String {
        if let name, !name.trimmingCharacters(in: .whitespaces).isEmpty { return name }
        return email ?? "?"
    }
    var initial: String { String(displayName.prefix(1)).uppercased() }
    var firstName: String { displayName.split(separator: " ").first.map(String.init) ?? displayName }
    var isSenior: Bool { role == "BOD" || role == "ONE_ABOVE_ALL" }
    var isLeader: Bool { isSenior || role == "MANAGER" }
    func title(in unitId: String) -> String? {
        guard let t = titles?[unitId]?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return nil }
        return t
    }
}

/// One card's people, split the way the chart draws them.
struct OrgUnitPeople {
    var bods: [OrgPersonDTO] = []
    var managers: [OrgPersonDTO] = []
    var staff: [OrgPersonDTO] = []
    /// One box per leader with the people placed under them in this card, in the leaders' order.
    var under: [OrgUnderBox] = []
    /// BoD first, then managers — the order of the chips in the boxes.
    var leaderOrder: [String: Int] = [:]
}

struct OrgUnderBox: Identifiable {
    let leader: OrgPersonDTO
    let people: [OrgPersonDTO]
    var id: String { leader.userId }
}

/// What stands in a card's row, left to right.
enum OrgRowItem: Identifiable, Hashable {
    case unit(String)
    /// The staff box of this card.
    case staff(String)
    /// The "di bawah <leader>" box of this card for this leader.
    case under(String, String)

    var id: String {
        switch self {
        case .unit(let u): return "u:\(u)"
        case .staff(let u): return "staff:\(u)"
        case .under(let u, let l): return "under:\(u):\(l)"
        }
    }
}

struct OrgTree {
    let units: [String: OrgUnitDTO]
    let children: [String: [OrgUnitDTO]]
    let roots: [OrgUnitDTO]
    let people: [OrgPersonDTO]
    /// Unit id → its people, A–Z.
    let peopleOf: [String: [OrgPersonDTO]]

    init(_ data: OrgChartData) {
        var byId: [String: OrgUnitDTO] = [:]
        for u in data.units { byId[u.id] = u }
        units = byId
        var kids: [String: [OrgUnitDTO]] = [:]
        for u in data.units {
            if let p = u.parentId, byId[p] != nil { kids[p, default: []].append(u) }
        }
        for k in Array(kids.keys) { kids[k]?.sort(by: OrgTree.byPosition) }
        children = kids
        roots = data.units.filter { u in u.parentId.map { byId[$0] == nil } ?? true }.sorted(by: OrgTree.byPosition)
        people = data.people
        var members: [String: [OrgPersonDTO]] = [:]
        for p in data.people {
            for id in p.unitIds where byId[id] != nil { members[id, default: []].append(p) }
        }
        for k in Array(members.keys) {
            members[k]?.sort { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
        }
        peopleOf = members
    }

    static func byPosition(_ a: OrgUnitDTO, _ b: OrgUnitDTO) -> Bool {
        let pa = a.position ?? 0, pb = b.position ?? 0
        if pa != pb { return pa < pb }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    /// Every group next to the first one; the other cards keep their order around them (owner,
    /// 5 Oct 2026: PATS Entertainment sat between Community and Outlet).
    static func groupsTogether(_ list: [OrgUnitDTO]) -> [OrgUnitDTO] {
        guard let first = list.firstIndex(where: { $0.isGroup }) else { return list }
        let before = list[..<first].filter { !$0.isGroup }
        let groups = list.filter { $0.isGroup }
        let after = list[first...].filter { !$0.isGroup }
        return before + groups + after
    }

    /// Parents of a unit, nearest first.
    func ancestors(_ id: String) -> [String] {
        var out: [String] = []
        var seen: Set<String> = [id]
        var cur = units[id]?.parentId
        while let p = cur, let u = units[p], !seen.contains(p) {
            out.append(p)
            seen.insert(p)
            cur = u.parentId
        }
        return out
    }
    /// The card a unit really belongs to: its parent, or — through groups — the card above them.
    func effectiveParent(_ id: String) -> String? {
        ancestors(id).first { units[$0]?.isGroup == false }
    }
    /// Cards (not groups) above a unit: 0 = the top.
    func level(_ id: String) -> Int {
        ancestors(id).filter { units[$0]?.isGroup == false }.count
    }
    func descendants(_ id: String) -> Set<String> {
        var out: Set<String> = []
        var stack = children[id] ?? []
        while let c = stack.popLast() {
            if out.insert(c.id).inserted { stack.append(contentsOf: children[c.id] ?? []) }
        }
        return out
    }
    /// The top first, the unit last.
    func path(_ id: String) -> [OrgUnitDTO] {
        (Array(ancestors(id).reversed()) + [id]).compactMap { units[$0] }
    }
    /// "The Z Networks › Framework Agency" — where a unit sits (without itself).
    func trail(_ id: String) -> String {
        Array(ancestors(id).reversed()).compactMap { units[$0]?.name }.joined(separator: " › ")
    }

    /// The cards right under the top (through any groups), in chart order: the view chips.
    var topUnits: [OrgUnitDTO] {
        var out: [OrgUnitDTO] = []
        var seen: Set<String> = []
        func walk(_ id: String) {
            for k in children[id] ?? [] where seen.insert(k.id).inserted {
                if k.isGroup { walk(k.id) } else { out.append(k) }
            }
        }
        for r in roots { walk(r.id) }
        return out
    }

    func split(_ unitId: String) -> OrgUnitPeople {
        let all = peopleOf[unitId] ?? []
        let bods = all.filter { $0.isSenior }
        let allManagers = all.filter { $0.role == "MANAGER" }
        let leaders = bods + allManagers
        var order: [String: Int] = [:]
        for (i, p) in leaders.enumerated() where order[p.userId] == nil { order[p.userId] = i }
        // BoD / One Above All never go under anyone; only a leader of THIS card counts.
        func underOf(_ p: OrgPersonDTO) -> String? {
            guard !p.isSenior, let to = p.reportsTo?[unitId], to != p.userId, order[to] != nil else { return nil }
            return to
        }
        var grouped: [String: [OrgPersonDTO]] = [:]
        for p in all {
            if let to = underOf(p) { grouped[to, default: []].append(p) }
        }
        let under = leaders
            .filter { grouped[$0.userId] != nil }
            .map { OrgUnderBox(leader: $0, people: grouped[$0.userId] ?? []) }
        return OrgUnitPeople(
            bods: bods,
            managers: allManagers.filter { underOf($0) == nil },
            staff: all.filter { !$0.isLeader && underOf($0) == nil },
            under: under,
            leaderOrder: order
        )
    }

    /// Led by one of the leaders of the card it belongs to.
    func isLed(_ k: OrgUnitDTO, by people: OrgUnitPeople) -> Bool {
        guard !k.isGroup, let l = k.leadUserId else { return false }
        return people.leaderOrder[l] != nil
    }

    func row(of unitId: String) -> [OrgRowItem] {
        guard let u = units[unitId] else { return [] }
        let kids = children[unitId] ?? []
        if u.isGroup {
            return OrgTree.groupsTogether(kids).map { OrgRowItem.unit($0.id) }
        }
        let ppl = split(unitId)
        struct Ranked { let item: OrgRowItem; let at: Int; let box: Int }
        var ranked: [Ranked] = kids.filter { isLed($0, by: ppl) }.map {
            Ranked(item: .unit($0.id), at: ppl.leaderOrder[$0.leadUserId ?? ""] ?? 0, box: 0)
        }
        ranked += ppl.under.map { Ranked(item: .under(unitId, $0.leader.userId), at: ppl.leaderOrder[$0.leader.userId] ?? 0, box: 1) }
        ranked.sort { ($0.at, $0.box) < ($1.at, $1.box) }
        let free = OrgTree.groupsTogether(kids.filter { !isLed($0, by: ppl) })
        var row: [OrgRowItem] = ranked.map { $0.item } + free.map { OrgRowItem.unit($0.id) }
        if !ppl.staff.isEmpty {
            let groupItems = Set(free.filter { $0.isGroup }.map { OrgRowItem.unit($0.id) })
            let snapshot = row
            let splitsGroups: (Int) -> Bool = { i in
                i > 0 && i < snapshot.count && groupItems.contains(snapshot[i - 1]) && groupItems.contains(snapshot[i])
            }
            let mid = row.count / 2
            let at = Array(0...row.count)
                .sorted { (abs($0 - mid), $0) < (abs($1 - mid), $1) }
                .first { !splitsGroups($0) } ?? mid
            row.insert(.staff(unitId), at: at)
        }
        return row
    }

    /// The leader a row item hangs from, as "unitId:userId" — nil when it hangs from the crossbar.
    func leaderChip(of item: OrgRowItem, in unitId: String, people: OrgUnitPeople) -> String? {
        switch item {
        case .unit(let id):
            guard let k = units[id], isLed(k, by: people), let l = k.leadUserId else { return nil }
            return "\(unitId):\(l)"
        case .under(let u, let l):
            return "\(u):\(l)"
        case .staff:
            return nil
        }
    }

    /// Ringkas: everyone in the branch (each person once) and the cards under it.
    func branchStats(_ id: String) -> (people: Int, parts: Int) {
        let below = descendants(id)
        var ids: Set<String> = []
        for u in [id] + Array(below) {
            for p in peopleOf[u] ?? [] { ids.insert(p.userId) }
        }
        return (ids.count, below.filter { units[$0]?.isGroup == false }.count)
    }
}
