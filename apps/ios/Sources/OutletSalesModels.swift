import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Outlet Sales Dashboard (owner, 10 Oct 2026, for Ryan): one project = one outlet. Each night is an
// event with its report (sales, pax, RSVP, hosting, what worked, what didn't), the month has its own
// targets, and the server decides every total, percent and status — this app only shows them.
// Contract: handoff/chat/OUTLET-SALES.md, server src/lib/outlet-sales.ts (commit 0cedc3a).
//
// Read leniently on purpose: an odd value in one field must never cost the whole month. Money is whole
// rupiah and may exceed 2^31, so every number is Int64.
// ─────────────────────────────────────────────────────────────────────────────

/// Someone who set a target or wrote a report.
struct OutletPerson: Decodable, Hashable, Sendable {
    let id: String
    let name: String?
    let avatar: String?
}

/// Board column, derived by the server (never dragged): UPCOMING · WAITING_REPORT · REPORTED.
enum OutletStatus: String, CaseIterable, Identifiable, Sendable {
    case upcoming = "UPCOMING", waiting = "WAITING_REPORT", reported = "REPORTED"
    var id: String { rawValue }

    var label: String {
        switch self {
        case .upcoming: return T("Upcoming")
        case .waiting: return T("Waiting report")
        case .reported: return T("Reported")
        }
    }

    /// Quiet for what is ahead, amber for what is owed, green for done (same as web's STATUS_DOT).
    var tone: ChipTone {
        switch self {
        case .upcoming: return .info
        case .waiting: return .warning
        case .reported: return .success
        }
    }
}

/// A coding key made from any string: the event's numbers and answers are read by the form's own keys.
struct OutletAnyKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

extension KeyedDecodingContainer where K == OutletAnyKey {
    /// A whole number as JSON sends it (8000000, 8000000.0 or 1e12). nil = not filled (or unreadable).
    func outletNumber(_ key: String) -> Int64? {
        let k = OutletAnyKey(key)
        if let v = try? decodeIfPresent(Int64.self, forKey: k) { return v }
        if let d = try? decodeIfPresent(Double.self, forKey: k), d.isFinite, abs(d) < 9.0e18 { return Int64(d.rounded()) }
        return nil
    }
    func outletString(_ key: String) -> String? { try? decodeIfPresent(String.self, forKey: OutletAnyKey(key)) }
    /// { "id": number } leniently: a value that is not a number is skipped, not the whole map.
    func outletNumberMap(_ key: String) -> [String: Int64] {
        guard let nested = try? nestedContainer(keyedBy: OutletAnyKey.self, forKey: OutletAnyKey(key)) else { return [:] }
        var out: [String: Int64] = [:]
        for k in nested.allKeys { if let v = nested.outletNumber(k.stringValue) { out[k.stringValue] = v } }
        return out
    }
    func outletPerson(_ key: String) -> OutletPerson? { try? decodeIfPresent(OutletPerson.self, forKey: OutletAnyKey(key)) }
}

/// One night of the outlet with its report.
struct OutletEvent: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let projectId: String
    /// "YYYY-MM-DD", the day of the event in WIB.
    let date: String
    let name: String
    /// The filled numbers by key (`numberKeys`). Absent = not filled; 0 is a real zero.
    let numbers: [String: Int64]
    /// The six answers by key (`textKeys`). "" = not filled.
    let texts: [String: String]
    let rsvpTotal: Int64?
    let hostingTotal: Int64?
    /// Every breakdown figure by item id (owner, 14 Oct 2026), the seven original items included.
    /// Absent = not filled. An older server sends none: the original items are read from `numbers`.
    let values: [String: Int64]
    /// All communities together, and per community id.
    let communityTotal: Int64?
    let communityTotals: [String: Int64]
    let salesPct: Int64?
    let paxPct: Int64?
    let status: OutletStatus
    /// A subset of ["sales", "pax"]: what still keeps the night from REPORTED.
    let missing: [String]
    let reportedAt: String?
    let reportedBy: OutletPerson?
    let updatedAt: String?
    let updatedBy: OutletPerson?
    let createdBy: OutletPerson?

    static let numberKeys = ["salesTarget", "paxTarget", "sales", "pax", "rsvpWalkIn", "rsvpTeam", "rsvpPr", "rsvpEo",
                             "hostingTeam", "hostingPr", "hostingEo"]
    static let textKeys = ["successWhat", "successWhy", "successRepeat", "failWhat", "failWhy", "failPrevent"]

    var sales: Int64? { numbers["sales"] }
    var pax: Int64? { numbers["pax"] }
    var salesTarget: Int64? { numbers["salesTarget"] }
    var paxTarget: Int64? { numbers["paxTarget"] }
    /// "2026-10" — the month the event counts in.
    var month: String { String(date.prefix(7)) }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        id = try c.decode(String.self, forKey: OutletAnyKey("id"))
        projectId = c.outletString("projectId") ?? ""
        date = c.outletString("date") ?? ""
        name = c.outletString("name") ?? ""
        var nums: [String: Int64] = [:]
        for k in Self.numberKeys { if let v = c.outletNumber(k) { nums[k] = v } }
        numbers = nums
        var txt: [String: String] = [:]
        for k in Self.textKeys { txt[k] = c.outletString(k) ?? "" }
        texts = txt
        rsvpTotal = c.outletNumber("rsvpTotal")
        hostingTotal = c.outletNumber("hostingTotal")
        var vals = c.outletNumberMap("values")
        for k in OutletReportConfig.legacyIds where vals[k] == nil { if let v = nums[k] { vals[k] = v } }
        values = vals
        communityTotal = c.outletNumber("communityTotal")
        communityTotals = c.outletNumberMap("communityTotals")
        salesPct = c.outletNumber("salesPct")
        paxPct = c.outletNumber("paxPct")
        status = OutletStatus(rawValue: c.outletString("status") ?? "") ?? .upcoming
        missing = (try? c.decodeIfPresent([String].self, forKey: OutletAnyKey("missing"))) ?? []
        reportedAt = c.outletString("reportedAt")
        reportedBy = c.outletPerson("reportedBy")
        updatedAt = c.outletString("updatedAt")
        updatedBy = c.outletPerson("updatedBy")
        createdBy = c.outletPerson("createdBy")
    }

    /// "Sales and pax missing" / "Sales missing" / "Pax missing", or nil when both are filled.
    var missingLabel: String? {
        let s = missing.contains("sales"), p = missing.contains("pax")
        if s && p { return T("Sales and pax missing") }
        if s { return T("Sales missing") }
        if p { return T("Pax missing") }
        return nil
    }
}

/// The month's own target row (NOT the sum of the events' targets).
struct OutletTarget: Decodable, Sendable {
    let month: String
    let salesTarget: Int64?
    let paxTarget: Int64?
    let updatedAt: String?
    let updatedBy: OutletPerson?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        month = c.outletString("month") ?? ""
        salesTarget = c.outletNumber("salesTarget")
        paxTarget = c.outletNumber("paxTarget")
        updatedAt = c.outletString("updatedAt")
        updatedBy = c.outletPerson("updatedBy")
    }
}

/// The month's totals, worked out by the server.
struct OutletSummary: Decodable, Sendable {
    var sales: Int64? = nil
    var pax: Int64? = nil
    var salesTarget: Int64? = nil
    var paxTarget: Int64? = nil
    var salesPct: Int64? = nil
    var paxPct: Int64? = nil
    var eventCount: Int64 = 0
    var reportedCount: Int64 = 0
    var waitingCount: Int64 = 0
    var upcomingCount: Int64 = 0
    var rsvpTotal: Int64? = nil
    var hostingTotal: Int64? = nil

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        sales = c.outletNumber("sales")
        pax = c.outletNumber("pax")
        salesTarget = c.outletNumber("salesTarget")
        paxTarget = c.outletNumber("paxTarget")
        salesPct = c.outletNumber("salesPct")
        paxPct = c.outletNumber("paxPct")
        eventCount = c.outletNumber("eventCount") ?? 0
        reportedCount = c.outletNumber("reportedCount") ?? 0
        waitingCount = c.outletNumber("waitingCount") ?? 0
        upcomingCount = c.outletNumber("upcomingCount") ?? 0
        rsvpTotal = c.outletNumber("rsvpTotal")
        hostingTotal = c.outletNumber("hostingTotal")
    }
}

// MARK: - The server's form (§5): sections and fields in Ryan's order and words, in both languages

struct OutletBilingual: Decodable, Hashable, Sendable {
    let en: String
    let id: String
    init(_ en: String, _ id: String) { self.en = en; self.id = id }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        en = c.outletString("en") ?? ""
        id = c.outletString("id") ?? en
    }
    /// The interface language's text, the other one when it is empty.
    var text: String {
        let pick = AppLanguage.shared.lang == .id ? id : en
        return pick.isEmpty ? en : pick
    }
}

struct OutletFormField: Decodable, Hashable, Sendable {
    let key: String
    /// text · date · money · count · longtext. Anything else is skipped.
    let type: String
    let label: OutletBilingual
    let required: Bool
    let max: Double?
    let hint: OutletBilingual?

    init(_ key: String, _ type: String, _ en: String, _ id: String, required: Bool = false, max: Double? = nil, hint: OutletBilingual? = nil) {
        self.key = key; self.type = type; self.label = OutletBilingual(en, id)
        self.required = required; self.max = max; self.hint = hint
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        key = try c.decode(String.self, forKey: OutletAnyKey("key"))
        type = c.outletString("type") ?? "text"
        label = (try? c.decodeIfPresent(OutletBilingual.self, forKey: OutletAnyKey("label"))) ?? OutletBilingual(key, key)
        required = (try? c.decodeIfPresent(Bool.self, forKey: OutletAnyKey("required"))) ?? false
        max = (try? c.decodeIfPresent(Double.self, forKey: OutletAnyKey("max"))) ?? nil
        hint = try? c.decodeIfPresent(OutletBilingual.self, forKey: OutletAnyKey("hint"))
    }

    static let knownTypes: Set<String> = ["text", "date", "money", "count", "longtext"]
    var isNumber: Bool { type == "money" || type == "count" }
}

struct OutletFormSection: Decodable, Hashable, Sendable, Identifiable {
    let key: String
    let title: OutletBilingual
    /// "rsvpTotal" / "hostingTotal": the section's title shows the live sum of its fields.
    let total: String?
    let fields: [OutletFormField]
    var id: String { key }

    init(_ key: String, _ en: String, _ id: String, total: String? = nil, _ fields: [OutletFormField]) {
        self.key = key; self.title = OutletBilingual(en, id); self.total = total; self.fields = fields
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        key = try c.decode(String.self, forKey: OutletAnyKey("key"))
        title = (try? c.decodeIfPresent(OutletBilingual.self, forKey: OutletAnyKey("title"))) ?? OutletBilingual(key, key)
        total = c.outletString("total")
        // One unreadable field drops that field, not the section.
        let raw = (try? c.decodeIfPresent([OutletLossy<OutletFormField>].self, forKey: OutletAnyKey("fields"))) ?? []
        fields = raw.compactMap(\.value).filter { OutletFormField.knownTypes.contains($0.type) }
    }
}

struct OutletForm: Decodable, Hashable, Sendable {
    let version: Int
    let sections: [OutletFormSection]

    init(version: Int, sections: [OutletFormSection]) { self.version = version; self.sections = sections }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        version = (try? c.decodeIfPresent(Int.self, forKey: OutletAnyKey("version"))) ?? 1
        let raw = (try? c.decodeIfPresent([OutletLossy<OutletFormSection>].self, forKey: OutletAnyKey("sections"))) ?? []
        sections = raw.compactMap(\.value)
    }

    func field(_ key: String) -> OutletFormField? { sections.lazy.flatMap(\.fields).first { $0.key == key } }
    func section(_ key: String) -> OutletFormSection? { sections.first { $0.key == key } }
    /// The field's label in the interface language, or `fallback` when the form does not have it.
    func label(_ key: String, _ fallback: String) -> String { field(key)?.label.text ?? fallback }

    /// The same form as the server's OUTLET_FORM, for the moment before (or without) its answer.
    static let standard = OutletForm(version: 1, sections: [
        OutletFormSection("event", "Event", "Event", [
            OutletFormField("name", "text", "Event name", "Nama event", required: true, max: 120),
            OutletFormField("date", "date", "Day/Date", "Hari/Tanggal", required: true),
        ]),
        OutletFormSection("sales", "Sales", "Sales", [
            OutletFormField("sales", "money", "Sales", "Sales", max: 1e12,
                            hint: OutletBilingual("Total revenue, after tax, service charge and discounts",
                                                  "Total revenue, setelah pajak, service charge & diskon")),
            OutletFormField("salesTarget", "money", "Sales target", "Target sales", max: 1e12),
        ]),
        OutletFormSection("pax", "Pax", "Pax", [
            OutletFormField("pax", "count", "Pax", "Pax", max: 1_000_000,
                            hint: OutletBilingual("People who actually came", "Jumlah orang yang datang")),
            OutletFormField("paxTarget", "count", "Pax target", "Target pax", max: 1_000_000),
        ]),
        OutletFormSection("rsvp", "RSVP – TOTAL", "RSVP – TOTAL", total: "rsvpTotal", [
            OutletFormField("rsvpWalkIn", "count", "Walk-in RSVP", "Walk-in RSVP"),
            OutletFormField("rsvpTeam", "count", "RSVP Team", "RSVP Team"),
            OutletFormField("rsvpPr", "count", "RSVP PR", "RSVP PR"),
            OutletFormField("rsvpEo", "count", "RSVP EO", "RSVP EO"),
        ]),
        OutletFormSection("hosting", "HOSTING – TOTAL", "HOSTING – TOTAL", total: "hostingTotal", [
            OutletFormField("hostingTeam", "count", "Hosting Team", "Hosting Team"),
            OutletFormField("hostingPr", "count", "Hosting PR", "Hosting PR"),
            OutletFormField("hostingEo", "count", "Hosting EO", "Hosting EO"),
        ]),
        OutletFormSection("success", "What worked", "Hal yang berhasil", [
            OutletFormField("successWhat", "longtext", "What", "Apa", max: 2000),
            OutletFormField("successWhy", "longtext", "Why it worked", "Kenapa berhasil", max: 2000),
            OutletFormField("successRepeat", "longtext", "How to make it happen again", "Gimana biar bisa terulang lagi", max: 2000),
        ]),
        OutletFormSection("fail", "What didn't work", "Hal yang gagal", [
            OutletFormField("failWhat", "longtext", "What", "Apa", max: 2000),
            OutletFormField("failWhy", "longtext", "Why it didn't work", "Kenapa gagal", max: 2000),
            OutletFormField("failPrevent", "longtext", "How to keep it from happening again", "Gimana biar tidak kejadian lagi", max: 2000),
        ]),
    ])
}

/// Decodes an element or swallows its failure, so one bad element leaves the rest of the list.
struct OutletLossy<V: Decodable & Sendable>: Decodable, Sendable {
    let value: V?
    init(from decoder: Decoder) throws { value = try? V(from: decoder) }
}

// MARK: - Responses

struct OutletProjectInfo: Decodable, Sendable {
    let id: String
    let name: String?
    let type: String?
    let workspaceId: String?
}

/// GET /api/projects/:id/outlet-sales?month=YYYY-MM
struct OutletMonthResponse: Decodable, Sendable {
    let project: OutletProjectInfo?
    let canManageTargets: Bool
    let month: String
    let today: String?
    let target: OutletTarget?
    let summary: OutletSummary
    let events: [OutletEvent]
    let waitingEarlier: [OutletEvent]
    let form: OutletForm?
    /// Owner, 14 Oct 2026: the outlet's own breakdown, the month's guest overview, every day's target in
    /// force, and the dates that set their own. An older server sends none of them.
    let config: OutletReportConfig?
    let guests: OutletGuests?
    let days: [OutletDay]
    let dayTargets: [OutletDayTarget]
    let canManageSettings: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        config = try? c.decodeIfPresent(OutletReportConfig.self, forKey: OutletAnyKey("config"))
        guests = try? c.decodeIfPresent(OutletGuests.self, forKey: OutletAnyKey("guests"))
        days = ((try? c.decodeIfPresent([OutletLossy<OutletDay>].self, forKey: OutletAnyKey("days"))) ?? []).compactMap(\.value)
        dayTargets = ((try? c.decodeIfPresent([OutletLossy<OutletDayTarget>].self, forKey: OutletAnyKey("dayTargets"))) ?? []).compactMap(\.value)
        project = try? c.decodeIfPresent(OutletProjectInfo.self, forKey: OutletAnyKey("project"))
        canManageTargets = (try? c.decodeIfPresent(Bool.self, forKey: OutletAnyKey("canManageTargets"))) ?? false
        canManageSettings = (try? c.decodeIfPresent(Bool.self, forKey: OutletAnyKey("canManageSettings"))) ?? canManageTargets
        month = c.outletString("month") ?? ""
        today = c.outletString("today")
        target = try? c.decodeIfPresent(OutletTarget.self, forKey: OutletAnyKey("target"))
        summary = (try? c.decodeIfPresent(OutletSummary.self, forKey: OutletAnyKey("summary"))) ?? OutletSummary()
        events = ((try? c.decodeIfPresent([OutletLossy<OutletEvent>].self, forKey: OutletAnyKey("events"))) ?? []).compactMap(\.value)
        waitingEarlier = ((try? c.decodeIfPresent([OutletLossy<OutletEvent>].self, forKey: OutletAnyKey("waitingEarlier"))) ?? []).compactMap(\.value)
        form = try? c.decodeIfPresent(OutletForm.self, forKey: OutletAnyKey("form"))
    }
}

/// GET /api/projects/:id/outlet-sales/events/:eventId
struct OutletEventDetail: Decodable, Sendable {
    let event: OutletEvent
    let form: OutletForm?
    let config: OutletReportConfig?
}

// MARK: - The outlet's own report breakdown (owner, 14 Oct 2026, after a meeting with Ryan)
//
// RSVP items, Hosting items and Communities, set up per outlet (Report settings). Every item has a stable
// id: renaming changes the label only, and an item removed while reports hold figures for it stays,
// archived, so those reports keep their numbers. The seven original items keep the old keys as ids.

struct OutletItem: Codable, Hashable, Sendable, Identifiable {
    /// "" for an item added in Report settings and not saved yet (the server gives it an id).
    var id: String
    var label: String
    var archived: Bool = false
    /// Only to tell unsaved new rows apart in a list; never sent.
    var localKey: String = UUID().uuidString

    var rowId: String { id.isEmpty ? localKey : id }

    init(id: String, label: String, archived: Bool = false) { self.id = id; self.label = label; self.archived = archived }

    enum CodingKeys: String, CodingKey { case id, label, archived }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        label = (try? c.decode(String.self, forKey: .label)) ?? ""
        archived = (try? c.decodeIfPresent(Bool.self, forKey: .archived)) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if !id.isEmpty { try c.encode(id, forKey: .id) }
        try c.encode(label, forKey: .label)
        if archived { try c.encode(true, forKey: .archived) }
    }

    static func == (a: OutletItem, b: OutletItem) -> Bool { a.id == b.id && a.label == b.label && a.archived == b.archived }
    func hash(into h: inout Hasher) { h.combine(id); h.combine(label); h.combine(archived) }
}

struct OutletCommunity: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    /// "total" (one number) or "breakdown" (its own items).
    var mode: String
    var items: [OutletItem]
    var archived: Bool = false
    var localKey: String = UUID().uuidString

    var rowId: String { id.isEmpty ? localKey : id }
    var isBreakdown: Bool { mode == "breakdown" }

    init(id: String, name: String, mode: String, items: [OutletItem], archived: Bool = false) {
        self.id = id; self.name = name; self.mode = mode; self.items = items; self.archived = archived
    }

    enum CodingKeys: String, CodingKey { case id, name, mode, items, archived }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        mode = (try? c.decode(String.self, forKey: .mode)) == "breakdown" ? "breakdown" : "total"
        items = ((try? c.decodeIfPresent([OutletLossy<OutletItem>].self, forKey: .items)) ?? []).compactMap(\.value)
        archived = (try? c.decodeIfPresent(Bool.self, forKey: .archived)) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if !id.isEmpty { try c.encode(id, forKey: .id) }
        try c.encode(name, forKey: .name)
        try c.encode(mode, forKey: .mode)
        try c.encode(items, forKey: .items)
        if archived { try c.encode(true, forKey: .archived) }
    }

    static func == (a: OutletCommunity, b: OutletCommunity) -> Bool {
        a.id == b.id && a.name == b.name && a.mode == b.mode && a.items == b.items && a.archived == b.archived
    }
    func hash(into h: inout Hasher) { h.combine(id); h.combine(name); h.combine(mode); h.combine(archived) }
}

struct OutletReportConfig: Codable, Hashable, Sendable {
    var version: Int = 1
    var rsvp: [OutletItem]
    var hosting: [OutletItem]
    var communities: [OutletCommunity]

    static let legacyIds = ["rsvpWalkIn", "rsvpTeam", "rsvpPr", "rsvpEo", "hostingTeam", "hostingPr", "hostingEo"]

    init(rsvp: [OutletItem], hosting: [OutletItem], communities: [OutletCommunity]) {
        self.rsvp = rsvp; self.hosting = hosting; self.communities = communities
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        version = 1
        rsvp = ((try? c.decodeIfPresent([OutletLossy<OutletItem>].self, forKey: OutletAnyKey("rsvp"))) ?? []).compactMap(\.value)
        hosting = ((try? c.decodeIfPresent([OutletLossy<OutletItem>].self, forKey: OutletAnyKey("hosting"))) ?? []).compactMap(\.value)
        communities = ((try? c.decodeIfPresent([OutletLossy<OutletCommunity>].self, forKey: OutletAnyKey("communities"))) ?? []).compactMap(\.value)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: OutletAnyKey.self)
        try c.encode(1, forKey: OutletAnyKey("version"))
        try c.encode(rsvp, forKey: OutletAnyKey("rsvp"))
        try c.encode(hosting, forKey: OutletAnyKey("hosting"))
        try c.encode(communities, forKey: OutletAnyKey("communities"))
    }

    /// The seven items every outlet starts with (Ryan's words, the same in both languages).
    static let standard = OutletReportConfig(
        rsvp: [OutletItem(id: "rsvpWalkIn", label: "Walk-in RSVP"), OutletItem(id: "rsvpTeam", label: "RSVP Team"),
               OutletItem(id: "rsvpPr", label: "RSVP PR"), OutletItem(id: "rsvpEo", label: "RSVP EO")],
        hosting: [OutletItem(id: "hostingTeam", label: "Hosting Team"), OutletItem(id: "hostingPr", label: "Hosting PR"),
                  OutletItem(id: "hostingEo", label: "Hosting EO")],
        communities: [])

    /// Every id a report can hold a figure for (items, communities and their items).
    var allIds: [String] {
        rsvp.map(\.id) + hosting.map(\.id) + communities.flatMap { [$0.id] + $0.items.map(\.id) }
    }
}

/// GET/PUT /api/projects/:id/outlet-sales/config
struct OutletConfigResponse: Decodable, Sendable {
    let config: OutletReportConfig
    /// Per item id: how many reports hold a figure for it (ask before removing it).
    let usage: [String: Int64]
    let canManage: Bool

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        config = (try? c.decodeIfPresent(OutletReportConfig.self, forKey: OutletAnyKey("config"))) ?? .standard
        usage = c.outletNumberMap("usage")
        canManage = (try? c.decodeIfPresent(Bool.self, forKey: OutletAnyKey("canManage"))) ?? false
    }
}

struct OutletGuestLine: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
    let archived: Bool
    let total: Int64

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        id = (try? c.decode(String.self, forKey: OutletAnyKey("id"))) ?? UUID().uuidString
        label = c.outletString("label") ?? c.outletString("name") ?? ""
        archived = (try? c.decodeIfPresent(Bool.self, forKey: OutletAnyKey("archived"))) ?? false
        total = c.outletNumber("total") ?? 0
    }
}

struct OutletGuestCommunity: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let mode: String
    let archived: Bool
    let total: Int64
    let items: [OutletGuestLine]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        id = (try? c.decode(String.self, forKey: OutletAnyKey("id"))) ?? UUID().uuidString
        name = c.outletString("name") ?? ""
        mode = c.outletString("mode") ?? "total"
        archived = (try? c.decodeIfPresent(Bool.self, forKey: OutletAnyKey("archived"))) ?? false
        total = c.outletNumber("total") ?? 0
        items = ((try? c.decodeIfPresent([OutletLossy<OutletGuestLine>].self, forKey: OutletAnyKey("items"))) ?? []).compactMap(\.value)
    }
}

/// The Overview's Guest overview for the month: worked out by the server (summarizeGuests).
struct OutletGuests: Decodable, Sendable {
    struct Bucket: Sendable { var total: Int64 = 0; var items: [OutletGuestLine] = [] }
    struct Communities: Sendable { var total: Int64 = 0; var items: [OutletGuestCommunity] = [] }
    let reportCount: Int64
    let rsvp: Bucket
    let hosting: Bucket
    let communities: Communities

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        reportCount = c.outletNumber("reportCount") ?? 0
        func group(_ key: String) -> Bucket {
            guard let g = try? c.nestedContainer(keyedBy: OutletAnyKey.self, forKey: OutletAnyKey(key)) else { return Bucket() }
            let items = ((try? g.decodeIfPresent([OutletLossy<OutletGuestLine>].self, forKey: OutletAnyKey("items"))) ?? []).compactMap(\.value)
            return Bucket(total: g.outletNumber("total") ?? 0, items: items)
        }
        rsvp = group("rsvp")
        hosting = group("hosting")
        if let g = try? c.nestedContainer(keyedBy: OutletAnyKey.self, forKey: OutletAnyKey("communities")) {
            let items = ((try? g.decodeIfPresent([OutletLossy<OutletGuestCommunity>].self, forKey: OutletAnyKey("items"))) ?? []).compactMap(\.value)
            communities = Communities(total: g.outletNumber("total") ?? 0, items: items)
        } else {
            communities = Communities()
        }
    }
}

/// One day of the month with the target in force (its own, else the month's share) and its actuals.
struct OutletDay: Decodable, Hashable, Sendable {
    let date: String
    let sales: Int64?
    let pax: Int64?
    let salesTarget: Int64?
    let paxTarget: Int64?
    /// "day" = set on this date, "month" = the month's share, nil = no target.
    let salesTargetSource: String?
    let paxTargetSource: String?
    let salesPct: Int64?
    let paxPct: Int64?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        date = c.outletString("date") ?? ""
        sales = c.outletNumber("sales")
        pax = c.outletNumber("pax")
        salesTarget = c.outletNumber("salesTarget")
        paxTarget = c.outletNumber("paxTarget")
        salesTargetSource = c.outletString("salesTargetSource")
        paxTargetSource = c.outletString("paxTargetSource")
        salesPct = c.outletNumber("salesPct")
        paxPct = c.outletNumber("paxPct")
    }
}

/// A date's own target (either part may be nil = the month's share for that part).
struct OutletDayTarget: Decodable, Hashable, Sendable {
    let date: String
    let salesTarget: Int64?
    let paxTarget: Int64?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: OutletAnyKey.self)
        date = c.outletString("date") ?? ""
        salesTarget = c.outletNumber("salesTarget")
        paxTarget = c.outletNumber("paxTarget")
    }
}

/// What POST /api/projects answers that this app reads: the new project's id.
struct OutletCreatedProject: Decodable, Sendable {
    let id: String
    let name: String?
}

// MARK: - Formats (§6): "Rp 8.000.000 / Rp 20.000.000 (40%)", "Minggu, 4 Oktober"

enum OutletFormat {
    static var isID: Bool { AppLanguage.shared.lang == .id }

    /// "3.000": Indonesian dot grouping in both languages (owner rule, UI tour run 13: the app wrote
    /// "Rp6,000,000" in English while the web writes dots).
    static func grouped(_ n: Int64) -> String { AppNumber.int64(n) }

    /// "Rp 6.000.000"; "—" for nothing filled.
    static func rupiah(_ n: Int64?) -> String {
        guard let n else { return "—" }
        return AppNumber.rupiah(n)
    }

    /// "3.000"; "—" for nothing filled.
    static func count(_ n: Int64?) -> String {
        guard let n else { return "—" }
        return grouped(n)
    }

    /// Ryan's "actual / target (pct%)". No target → the actual alone; a target but nothing filled →
    /// "— / Rp20.000.000" (no percent).
    static func vsTarget(_ actual: Int64?, _ target: Int64?, _ pct: Int64?, money: Bool) -> String {
        let fmt: (Int64?) -> String = money ? rupiah : count
        guard let target else { return fmt(actual) }
        let tail = (pct != nil && actual != nil) ? " (\(pct!)%)" : ""
        return "\(fmt(actual)) / \(fmt(target))\(tail)"
    }

    /// floor(actual × 100 / target), as the server rounds it: Rp1 short never shows 100%. nil when the
    /// target is missing or 0, or nothing is filled.
    static func pct(_ actual: Int64?, _ target: Int64?) -> Int64? {
        guard let actual, let target, target > 0 else { return nil }
        let (product, overflow) = actual.multipliedReportingOverflow(by: 100)
        if overflow { return Int64((Double(actual) * 100 / Double(target)).rounded(.down)) }
        return product / target
    }

    /// Digits a person typed ("8.000.000", "Rp 8,000,000") as a whole number; nil for an empty box.
    static func parse(_ text: String) -> Int64? {
        let digits = text.filter(\.isASCII).filter(\.isNumber)
        guard !digits.isEmpty else { return nil }
        return Int64(digits.prefix(15))
    }

    /// What a number box shows while typing: its digits regrouped ("8000000" → "8.000.000").
    static func regroup(_ text: String) -> String {
        guard let n = parse(text) else { return "" }
        return grouped(n)
    }

    // Names written out rather than asked of DateFormatter: en_GB has started to say "Sept", and the
    // web and this app must print the same "Min 4 Okt" / "Sun 4 Oct".
    private static let weekdaysID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
    private static let weekdaysEN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    private static let weekdaysShortID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]
    private static let weekdaysShortEN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    private static let monthsID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus",
                                   "September", "Oktober", "November", "Desember"]
    private static let monthsEN = ["January", "February", "March", "April", "May", "June", "July", "August",
                                   "September", "October", "November", "December"]
    private static let monthsShortID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
    private static let monthsShortEN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    /// Mon–Sun, short, for the calendar's head row (Monday first).
    static var weekHeader: [String] {
        let s = isID ? weekdaysShortID : weekdaysShortEN
        return Array(s[1...]) + [s[0]]
    }

    /// A calendar that does arithmetic on plain days: Gregorian, UTC, so no time zone can shift a day.
    static let dayCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        c.firstWeekday = 2
        return c
    }()

    /// "2026-10-04" → (2026, 10, 4), or nil when it is not a day.
    static func parts(_ iso: String) -> (y: Int, m: Int, d: Int)? {
        let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, (1...12).contains(p[1]), (1...31).contains(p[2]) else { return nil }
        return (p[0], p[1], p[2])
    }

    static func date(_ iso: String) -> Date? {
        guard let p = parts(iso) else { return nil }
        return dayCalendar.date(from: DateComponents(year: p.y, month: p.m, day: p.d))
    }

    static func iso(_ date: Date) -> String {
        let c = dayCalendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
    }

    /// 0 = Sunday … 6 = Saturday.
    private static func weekdayIndex(_ iso: String) -> Int? {
        guard let d = date(iso) else { return nil }
        return dayCalendar.component(.weekday, from: d) - 1
    }

    /// "Minggu 4 Okt" / "Sunday 4 Oct": the app's day header (UI tour run 13, F-34: this said
    /// "Wednesday, 14 October" while the Calendar writes "Wednesday 14 Oct"). The year only when it is not
    /// `thisYear` ("2026").
    static func dayLong(_ iso: String, thisYear: String? = nil) -> String {
        guard let p = parts(iso), let w = weekdayIndex(iso) else { return iso }
        let wd = (isID ? weekdaysID : weekdaysEN)[w]
        let mn = (isID ? monthsShortID : monthsShortEN)[p.m - 1]
        let year = (thisYear != nil && String(iso.prefix(4)) != thisYear) ? " \(p.y)" : ""
        return "\(wd) \(p.d) \(mn)\(year)"
    }

    /// "1–14 Oct" from the first of `month` to `cutoff`; "1 Oct" when the cutoff is the first.
    static func monthSpan(_ month: String, to cutoff: String) -> String {
        guard let end = parts(cutoff) else { return "" }
        let mn = (isID ? monthsShortID : monthsShortEN)[end.m - 1]
        return end.d <= 1 ? "1 \(mn)" : "1–\(end.d) \(mn)"
    }

    /// "Min 4 Okt" / "Sun 4 Oct" (no comma: UI tour run 14, N-35) — on a card; the year too when it is not `thisYear`.
    static func dayShort(_ iso: String, thisYear: String? = nil) -> String {
        guard let p = parts(iso), let w = weekdayIndex(iso) else { return iso }
        let wd = (isID ? weekdaysShortID : weekdaysShortEN)[w]
        let mn = (isID ? monthsShortID : monthsShortEN)[p.m - 1]
        let year = (thisYear != nil && String(iso.prefix(4)) != thisYear) ? " \(p.y)" : ""
        return "\(wd) \(p.d) \(mn)\(year)"
    }

    /// "Oktober 2026" / "October 2026" for "2026-10".
    static func monthLabel(_ month: String) -> String {
        guard let p = parts(month + "-01") else { return month }
        return "\((isID ? monthsID : monthsEN)[p.m - 1]) \(p.y)"
    }

    /// "2026-10" moved by `by` months.
    static func shiftMonth(_ month: String, by: Int) -> String {
        guard let p = parts(month + "-01") else { return month }
        let total = p.y * 12 + (p.m - 1) + by
        return String(format: "%04d-%02d", total / 12, total % 12 + 1)
    }

    /// The company's day (WIB) on this device's clock, until the server's `today` arrives.
    static func wibToday() -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Jakarta")!
        let d = c.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", d.year ?? 2026, d.month ?? 1, d.day ?? 1)
    }

    /// The days the month grid draws: Monday first, six weeks, the neighbouring months' days included.
    static func gridDays(_ month: String) -> [String] {
        guard let first = date(month + "-01") else { return [] }
        let weekday = dayCalendar.component(.weekday, from: first)   // 1 = Sunday
        let back = (weekday + 5) % 7                                   // days since Monday
        guard let start = dayCalendar.date(byAdding: .day, value: -back, to: first) else { return [] }
        return (0..<42).compactMap { dayCalendar.date(byAdding: .day, value: $0, to: start).map(iso) }
    }

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    /// "5 Okt, 16.30" / "5 Oct, 16:30" in WIB, for "Reported by … ·".
    static func stamp(_ iso: String?) -> String? {
        guard let iso, let d = isoFractional.date(from: iso) ?? isoPlain.date(from: iso) else { return nil }
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Jakarta")!
        let p = c.dateComponents([.month, .day, .hour, .minute], from: d)
        let mn = (isID ? monthsShortID : monthsShortEN)[max(0, min(11, (p.month ?? 1) - 1))]
        let sep = isID ? "." : ":"
        // "14 Oct 18:50": no comma between date and time, like every other date in the app (UI tour run 15, R15-I-19).
        return String(format: "%d %@ %02d%@%02d", p.day ?? 1, mn, p.hour ?? 0, sep, p.minute ?? 0)
    }
}
