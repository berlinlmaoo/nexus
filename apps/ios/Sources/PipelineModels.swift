import Foundation

// MARK: - Pipeline Dashboard (Project.type "PIPELINE", owner, 9 Oct 2026)
//
// owner: "GM gw udh kirim contoh pipeline dashboard yg dia pengen … tinggal diubah ke design NEXUS".
// The GM's "Control Tower TZN" board lives inside a NEXUS project: one deal per client job, from first
// contact to closed and paid. Spec: handoff/chat/PIPELINE-DASHBOARD.md. Server: src/lib/pipeline.ts
// and pipeline-server.ts; web: apps/web/src/components/pipeline.
//
// Health, phases, days overdue and the KPI summary are computed by the SERVER on every read, so this app
// does not port the GM's formulas: a phone that drifted from them would quote different numbers from the
// web. Everything here decodes leniently (every field optional, a default for each), because the server
// will grow fields and options and an unknown value must be shown as-is, never cost the whole pipeline.
//
// Stored values are the GM's English keys (the dash in "Won – …" is an EN DASH, U+2013); only what is
// shown is translated, with the same Indonesian as the web's id-pipeline.ts.

/// A NEXUS user on a deal (BD, PM, last editor).
struct PipelinePerson: Decodable, Hashable, Sendable {
    let id: String
    let name: String?
    let avatar: String?

    private enum CodingKeys: String, CodingKey { case id, name, avatar }
    init(id: String, name: String?, avatar: String?) { self.id = id; self.name = name; self.avatar = avatar }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ""
        name = try? c.decodeIfPresent(String.self, forKey: .name)
        avatar = try? c.decodeIfPresent(String.self, forKey: .avatar)
    }
    var initial: String { String((name ?? "?").first ?? "?").uppercased() }
}

/// A document on a deal: SPK, contract, MOU, invoice or other. A pasted http(s) link, or (owner, 9 Oct
/// 2026) an attached file — then `url` is its members-only download path ("/api/projects/…/documents/…")
/// and fileName / mimeType / size describe it. Older servers send links only.
struct PipelineLink: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let type: String
    let label: String
    let url: String
    /// "file" or "link" (nil from a server before files).
    let kind: String?
    let fileName: String?
    let mimeType: String?
    let size: Int?

    private enum CodingKeys: String, CodingKey { case id, type, label, url, kind, fileName, mimeType, size }
    init(id: String, type: String, label: String, url: String) {
        self.id = id; self.type = type; self.label = label; self.url = url
        kind = "link"; fileName = nil; mimeType = nil; size = nil
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = (try? c.decodeIfPresent(String.self, forKey: .url)) ?? ""
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? url
        type = (try? c.decodeIfPresent(String.self, forKey: .type)) ?? "Lainnya"
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? ""
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? nil
        fileName = (try? c.decodeIfPresent(String.self, forKey: .fileName)) ?? nil
        mimeType = (try? c.decodeIfPresent(String.self, forKey: .mimeType)) ?? nil
        size = (try? c.decodeIfPresent(Int.self, forKey: .size)) ?? nil
    }
    var isFile: Bool { kind == "file" }
    /// The shape PATCH takes back: the whole list is sent each time, like the web.
    var json: [String: Any] { ["id": id, "type": type, "label": label, "url": url] }
}

/// One reason a deal is Critical or needs Attention, as a code the client words (RECEIVABLE_OVERDUE …).
struct PipelineReason: Decodable, Hashable, Sendable {
    let code: String
    let days: Int?
    let text: String?

    private enum CodingKeys: String, CodingKey { case code, days, text }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = (try? c.decodeIfPresent(String.self, forKey: .code)) ?? ""
        days = (try? c.decodeIfPresent(Double.self, forKey: .days)).map { Int($0) }
        text = try? c.decodeIfPresent(String.self, forKey: .text)
    }
}

/// CRITICAL | ATTENTION | HEALTHY | NOT_STARTED | NONE (Lost). An unknown key reads as NONE.
struct PipelineHealth: Decodable, Hashable, Sendable {
    let key: String
    let reasons: [PipelineReason]

    private enum CodingKeys: String, CodingKey { case key, reasons }
    init(key: String, reasons: [PipelineReason]) { self.key = key; self.reasons = reasons }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = (try? c.decodeIfPresent(String.self, forKey: .key)) ?? "NONE"
        reasons = (try? c.decodeIfPresent([PipelineReason].self, forKey: .reasons)) ?? []
    }
}

/// One of the six segments on a card: commercial, contract, readiness, deliverable, payment, closing,
/// each done | active | pending | bad. `blocked`: the deal's blocker holds this phase up (server
/// blockerPhaseOf, owner, 9 Oct 2026) — absent from a server older than that, hence optional.
struct PipelinePhase: Decodable, Hashable, Sendable {
    let key: String
    let state: String
    var blocked: Bool?
}

struct PipelineDeal: Decodable, Identifiable, Sendable {
    let id: String
    var code: String
    var position: Double
    var name: String
    var brand: String
    var service: String
    /// Every service, presets and typed ones (owner, 9 Oct 2026); `service` is the first. A server from
    /// before the list sends only `service`, which becomes the one item.
    var services: [String]
    var bdUserId: String?
    var bdName: String?
    var bd: PipelinePerson?
    var pmUserId: String?
    var pmName: String?
    var pm: PipelinePerson?
    var stage: String
    var probability: Double
    var contractValue: Double
    var netValue: Double
    var invoiceValue: Double
    var contractStatus: String
    var vregStatus: String
    var readiness: String
    var deliverableStatus: String
    var deliverableRisk: String
    var paymentStatus: String
    var outstandingReceivable: Double
    var paymentDueDate: String?
    var maxDaysOverdue: Int
    var netCash: Double
    var closingStatus: String
    var mainDate: String?
    var nextAction: String
    var nextActionDate: String?
    var blocker: String
    var notes: String
    var links: [PipelineLink]
    var createdAt: String?
    var createdBy: PipelinePerson?
    var updatedAt: String?
    var updatedBy: PipelinePerson?
    /// "Create execution project" on a won deal (owner, 10 Oct 2026: "jangan dibuat otomatis tpi siapin
    /// aja tombol … 1 folder di project yg isinya Master Calendar sama Master Task"). executionProject is
    /// the folder's Master Task (or, on a deal from 9 Oct, its single execution project); the folder and
    /// its Master Calendar are nil on older deals and on a server from before them.
    var executionProjectId: String?
    var executionProject: PipelineExecutionRef?
    var executionCalendarProjectId: String?
    var executionCalendarProject: PipelineExecutionRef?
    var executionFolderId: String?
    var executionFolder: PipelineExecutionRef?
    // Derived by the server.
    var stageGroup: String
    var daysOverdue: Int
    var health: PipelineHealth
    var phases: [PipelinePhase]
    /// Payments per term (owner, 9 Oct 2026: "perlu per termin"), in order. Empty on a deal without
    /// terms and on a server from before them.
    var terms: [PipelineTerm]
    /// The deal's payment from its terms; nil when it has none — then the manual fields count.
    var termSummary: PipelineTermSummary?
    /// Real cost lines (Control Tower v4, 14 Oct 2026). Empty on a deal without cost data and on a server
    /// from before them. The margin is worked out below on the net value, as the server does.
    var costs: [PipelineCost]
    /// Pipeline v8 additions are optional on the wire; an older board starts with empty lists.
    var barterValue: Double
    var barterCompensation: String
    var cashback: [PipelineCashback]
    var cashbackTotal: Double
    var contacts: [PipelineContact]
    var budgets: [PipelineBudget]
    var budgetTotal: Double
    var eventYear: Int?
    /// Present only when the deal came from All Pipelines. Opening it uses this projectId.
    var source: PipelineDealSource?

    private enum CodingKeys: String, CodingKey {
        case id, code, position, name, brand, service, services, bdUserId, bdName, bd, pmUserId, pmName, pm, stage, probability
        case contractValue, netValue, invoiceValue, contractStatus, vregStatus, readiness, deliverableStatus
        case deliverableRisk, paymentStatus, outstandingReceivable, paymentDueDate, maxDaysOverdue, netCash
        case closingStatus, mainDate, nextAction, nextActionDate, blocker, notes, links, createdAt, createdBy
        case updatedAt, updatedBy, stageGroup, daysOverdue, health, phases
        case executionProjectId, executionProject
        case executionCalendarProjectId, executionCalendarProject, executionFolderId, executionFolder
        case terms, termSummary, costs
        case barterValue, barterCompensation, cashback, cashbackTotal, contacts, budgets, budgetTotal, eventYear, source
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // The id is the one field without which a deal cannot be addressed at all.
        id = try c.decode(String.self, forKey: .id)
        func s(_ k: CodingKeys, _ d: String = "") -> String { (try? c.decodeIfPresent(String.self, forKey: k)) ?? d }
        func o(_ k: CodingKeys) -> String? {
            guard let v = try? c.decodeIfPresent(String.self, forKey: k), !v.isEmpty else { return nil }
            return v
        }
        func n(_ k: CodingKeys) -> Double { (try? c.decodeIfPresent(Double.self, forKey: k)) ?? 0 }
        func p(_ k: CodingKeys) -> PipelinePerson? {
            guard let v = try? c.decodeIfPresent(PipelinePerson.self, forKey: k), !v.id.isEmpty else { return nil }
            return v
        }
        code = s(.code); position = n(.position); name = s(.name); brand = s(.brand); service = s(.service)
        services = ((try? c.decodeIfPresent([String].self, forKey: .services)) ?? nil) ?? (service.isEmpty ? [] : [service])
        bdUserId = o(.bdUserId); bdName = o(.bdName); bd = p(.bd)
        pmUserId = o(.pmUserId); pmName = o(.pmName); pm = p(.pm)
        stage = s(.stage, "Incoming"); probability = n(.probability)
        contractValue = n(.contractValue); netValue = n(.netValue); invoiceValue = n(.invoiceValue)
        contractStatus = s(.contractStatus); vregStatus = s(.vregStatus); readiness = s(.readiness)
        deliverableStatus = s(.deliverableStatus); deliverableRisk = s(.deliverableRisk); paymentStatus = s(.paymentStatus)
        outstandingReceivable = n(.outstandingReceivable); paymentDueDate = o(.paymentDueDate)
        maxDaysOverdue = Int(n(.maxDaysOverdue)); netCash = n(.netCash); closingStatus = s(.closingStatus)
        mainDate = o(.mainDate); nextAction = s(.nextAction); nextActionDate = o(.nextActionDate)
        blocker = s(.blocker); notes = s(.notes)
        links = (try? c.decodeIfPresent([PipelineLink].self, forKey: .links)) ?? []
        createdAt = o(.createdAt); createdBy = p(.createdBy); updatedAt = o(.updatedAt); updatedBy = p(.updatedBy)
        executionProjectId = o(.executionProjectId)
        executionProject = (try? c.decodeIfPresent(PipelineExecutionRef.self, forKey: .executionProject)) ?? nil
        executionCalendarProjectId = o(.executionCalendarProjectId)
        executionCalendarProject = (try? c.decodeIfPresent(PipelineExecutionRef.self, forKey: .executionCalendarProject)) ?? nil
        executionFolderId = o(.executionFolderId)
        executionFolder = (try? c.decodeIfPresent(PipelineExecutionRef.self, forKey: .executionFolder)) ?? nil
        stageGroup = o(.stageGroup) ?? PipelineVocab.group(of: stage)
        daysOverdue = Int(n(.daysOverdue))
        health = (try? c.decodeIfPresent(PipelineHealth.self, forKey: .health)) ?? PipelineHealth(key: "NONE", reasons: [])
        phases = (try? c.decodeIfPresent([PipelinePhase].self, forKey: .phases)) ?? []
        let rawTerms = (try? c.decodeIfPresent([PipelineFailable<PipelineTerm>].self, forKey: .terms)) ?? []
        terms = rawTerms.compactMap(\.value)
        termSummary = (try? c.decodeIfPresent(PipelineTermSummary.self, forKey: .termSummary)) ?? nil
        let rawCosts = (try? c.decodeIfPresent([PipelineFailable<PipelineCost>].self, forKey: .costs)) ?? []
        costs = rawCosts.compactMap(\.value)
        barterValue = n(.barterValue); barterCompensation = s(.barterCompensation)
        let rawCashback = (try? c.decodeIfPresent([PipelineFailable<PipelineCashback>].self, forKey: .cashback)) ?? []
        cashback = rawCashback.compactMap(\.value)
        cashbackTotal = n(.cashbackTotal)
        let rawContacts = (try? c.decodeIfPresent([PipelineFailable<PipelineContact>].self, forKey: .contacts)) ?? []
        contacts = rawContacts.compactMap(\.value)
        let rawBudgets = (try? c.decodeIfPresent([PipelineFailable<PipelineBudget>].self, forKey: .budgets)) ?? []
        budgets = rawBudgets.compactMap(\.value)
        budgetTotal = n(.budgetTotal)
        eventYear = try? c.decodeIfPresent(Int.self, forKey: .eventYear)
        source = try? c.decodeIfPresent(PipelineDealSource.self, forKey: .source)
    }

    /// Σ of the cost lines (server: costTotalOf).
    var costTotal: Double { costs.reduce(0) { $0 + $1.amount } }
    /// Net value − real cost; nil while the deal has no net value (no misleading 100% or 0). Server: marginOf.
    var margin: Double? { netValue > 0 ? netValue - costTotal : nil }
    /// margin ÷ net value (0.25 = 25%); nil with margin.
    var marginPct: Double? { margin.map { $0 / netValue } }

    /// With terms, the receivable, payment status and next due date are the terms' (owner, 9 Oct 2026);
    /// the manual fields stay for deals without terms. Every place that shows them reads these.
    var receivable: Double { termSummary?.outstanding ?? outstandingReceivable }
    var paymentStatusShown: String { termSummary?.paymentStatus ?? paymentStatus }
    var paymentDueShown: String? { termSummary != nil ? termSummary?.nextDueDate : paymentDueDate }

    /// What the terms are checked against: the invoice value, else the contract value (web: the same).
    var termsReference: Double { invoiceValue > 0 ? invoiceValue : contractValue }

    /// A won deal (Pre-Execution, Execution or Closed) may have its execution folder made — by hand only
    /// since 10 Oct 2026; the server answers NOT_WON for any other.
    var canHaveExecutionProject: Bool {
        stageGroup == "Pre-Execution" || stageGroup == "Execution" || stageGroup == "Closed"
    }

    /// The BD's / PM's name: the NEXUS user, else the free text (someone outside NEXUS), else nil.
    var bdDisplay: String? { Self.person(bd, bdName) }
    var pmDisplay: String? { Self.person(pm, pmName) }
    private static func person(_ user: PipelinePerson?, _ text: String?) -> String? {
        if let n = user?.name?.trimmingCharacters(in: .whitespaces), !n.isEmpty { return n }
        if let t = text?.trimmingCharacters(in: .whitespaces), !t.isEmpty { return t }
        return nil
    }

    /// What a card shows before the server's answer to an edit arrives (the stage moves at once).
    /// Health and phases stay the server's until the reload that follows every write.
    mutating func apply(_ patch: [String: Any]) {
        for (key, value) in patch {
            let str = value as? String
            let num = (value as? NSNumber)?.doubleValue
            switch key {
            case "name": if let str { name = str }
            case "brand": if let str { brand = str }
            case "service":
                if let str { service = str; services = [str] + services.filter { $0.caseInsensitiveCompare(str) != .orderedSame } }
            case "services":
                if let list = value as? [String] { services = list; service = list.first ?? "" }
            case "stage":
                if let str {
                    stage = str
                    stageGroup = PipelineVocab.group(of: str)
                    // The server's rule: Lost → 0 %, a won stage → 100 %, unless the same PATCH sets it.
                    if patch["probability"] == nil {
                        if str == PipelineVocab.lostStage { probability = 0 }
                        else if ["Pre-Execution", "Execution", "Closed"].contains(stageGroup) { probability = 1 }
                    }
                }
            case "probability": if let num { probability = num }
            case "contractValue": if let num { contractValue = num }
            case "netValue": if let num { netValue = num }
            case "invoiceValue": if let num { invoiceValue = num }
            case "outstandingReceivable": if let num { outstandingReceivable = num }
            case "netCash": if let num { netCash = num }
            case "barterValue": if let num { barterValue = num }
            case "barterCompensation": if let str { barterCompensation = str }
            case "maxDaysOverdue": if let num { maxDaysOverdue = Int(num) }
            case "contractStatus": if let str { contractStatus = str }
            case "vregStatus": if let str { vregStatus = str }
            case "readiness": if let str { readiness = str }
            case "deliverableStatus": if let str { deliverableStatus = str }
            case "deliverableRisk": if let str { deliverableRisk = str }
            case "paymentStatus": if let str { paymentStatus = str }
            case "closingStatus": if let str { closingStatus = str }
            case "nextAction": if let str { nextAction = str }
            case "blocker": if let str { blocker = str }
            case "notes": if let str { notes = str }
            case "paymentDueDate": paymentDueDate = str
            case "mainDate":
                mainDate = str
                eventYear = str.flatMap { Int($0.prefix(4)) }
            case "nextActionDate": nextActionDate = str
            case "bdName": bdName = str
            case "pmName": pmName = str
            case "costs":
                if let list = value as? [[String: Any]] {
                    costs = list.compactMap { item in
                        guard let id = item["id"] as? String else { return nil }
                        // Omission keeps an older client's category; explicit null clears it.
                        let budgetId = item.keys.contains("budgetId")
                            ? (item["budgetId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                            : costs.first(where: { $0.id == id })?.budgetId
                        return PipelineCost(id: id, label: item["label"] as? String ?? "",
                                            amount: (item["amount"] as? NSNumber)?.doubleValue ?? 0,
                                            budgetId: budgetId)
                    }
                }
            case "bdUserId": bdUserId = str; if str == nil { bd = nil }
            case "pmUserId": pmUserId = str; if str == nil { pm = nil }
            default: break
            }
        }
    }
}

/// One payment term of a deal: "DP", "Termin 1", … (owner, 9 Oct 2026). Status, outstanding and days
/// overdue are the server's (lib/pipeline.ts termStatusOf), never worked out here.
struct PipelineTerm: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    var position: Double
    var label: String
    var amount: Double
    var dueDate: String?
    var invoiceNo: String
    var invoiceDate: String?
    var paidAmount: Double
    var paidAt: String?
    var note: String
    /// Not Invoiced | Invoiced | Partial | Paid | Overdue (an unknown one is shown as-is).
    var status: String
    var outstanding: Double
    var daysOverdue: Int
    var overpaid: Double = 0

    private enum CodingKeys: String, CodingKey {
        case id, position, label, amount, dueDate, invoiceNo, invoiceDate, paidAmount, paidAt, note, status, outstanding, daysOverdue, overpaid
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        func s(_ k: CodingKeys) -> String { (try? c.decodeIfPresent(String.self, forKey: k)) ?? "" }
        func o(_ k: CodingKeys) -> String? {
            guard let v = try? c.decodeIfPresent(String.self, forKey: k), !v.isEmpty else { return nil }
            return v
        }
        func n(_ k: CodingKeys) -> Double { (try? c.decodeIfPresent(Double.self, forKey: k)) ?? 0 }
        position = n(.position); label = s(.label); amount = n(.amount); dueDate = o(.dueDate)
        invoiceNo = s(.invoiceNo); invoiceDate = o(.invoiceDate); paidAmount = n(.paidAmount); paidAt = o(.paidAt)
        note = s(.note); status = o(.status) ?? "Not Invoiced"
        outstanding = (try? c.decodeIfPresent(Double.self, forKey: .outstanding)) ?? max(0, amount - paidAmount)
        daysOverdue = Int(n(.daysOverdue))
        overpaid = n(.overpaid)
    }

    var isPaid: Bool { status == "Paid" }
}

/// The deal's payment worked out from its terms (server: termSummaryOf).
struct PipelineTermSummary: Decodable, Hashable, Sendable {
    var count = 0
    var paidCount = 0
    var totalAmount: Double = 0
    var totalPaid: Double = 0
    var outstanding: Double = 0
    var overdueOutstanding: Double = 0
    var maxDaysOverdue = 0
    var paymentStatus = "Not Yet"
    var nextDueDate: String?

    private enum CodingKeys: String, CodingKey {
        case count, paidCount, totalAmount, totalPaid, outstanding, overdueOutstanding, maxDaysOverdue, paymentStatus, nextDueDate
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func n(_ k: CodingKeys) -> Double { (try? c.decodeIfPresent(Double.self, forKey: k)) ?? 0 }
        count = Int(n(.count)); paidCount = Int(n(.paidCount)); totalAmount = n(.totalAmount); totalPaid = n(.totalPaid)
        outstanding = n(.outstanding); overdueOutstanding = n(.overdueOutstanding); maxDaysOverdue = Int(n(.maxDaysOverdue))
        paymentStatus = (try? c.decodeIfPresent(String.self, forKey: .paymentStatus)) ?? "Not Yet"
        nextDueDate = (try? c.decodeIfPresent(String.self, forKey: .nextDueDate)) ?? nil
    }
}

/// POST/PATCH …/terms answer { deal, term }; DELETE answers { deal }.
/// DELETE …/documents/:docId → { deal } (owner, 9 Oct 2026).
struct PipelineDocumentResponse: Decodable, Sendable {
    let deal: PipelineDeal?

    private enum CodingKeys: String, CodingKey { case deal }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deal = try? c.decodeIfPresent(PipelineDeal.self, forKey: .deal)
    }
}

struct PipelineTermResponse: Decodable, Sendable {
    let deal: PipelineDeal?
    let term: PipelineTerm?

    private enum CodingKeys: String, CodingKey { case deal, term }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deal = try? c.decodeIfPresent(PipelineDeal.self, forKey: .deal)
        term = try? c.decodeIfPresent(PipelineTerm.self, forKey: .term)
    }
}

/// One real-cost line of a deal (Control Tower v4, 14 Oct 2026): "Vendor sound", Rp12.000.000. The id is
/// made by the client that adds it and kept by the server, so a row stays the same row while it saves.
struct PipelineCost: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    var label: String
    var amount: Double
    var budgetId: String?

    init(id: String, label: String, amount: Double, budgetId: String? = nil) {
        self.id = id
        self.label = label
        self.amount = amount
        self.budgetId = budgetId
    }

    private enum CodingKeys: String, CodingKey { case id, label, amount, budgetId }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? ""
        amount = (try? c.decodeIfPresent(Double.self, forKey: .amount)) ?? 0
        budgetId = (try? c.decodeIfPresent(String.self, forKey: .budgetId)).flatMap { $0.isEmpty ? nil : $0 }
    }

    /// What a PATCH of `costs` sends back for this line.
    var json: [String: Any] { ["id": id, "label": label, "amount": amount, "budgetId": budgetId as Any? ?? NSNull()] }

    /// A new line's id, in the shape the server keeps ("c_" + 16 hex).
    static func newId() -> String {
        "c_" + String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
    }
}

/// The company is the deal's own pipeline board, never a manually editable source field.
struct PipelineDealSource: Decodable, Hashable, Sendable {
    let projectId: String
    let name: String

    private enum CodingKeys: String, CodingKey { case projectId, name }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projectId = try c.decode(String.self, forKey: .projectId)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
    }

    var companyName: String { name.hasPrefix("Pipeline ") ? String(name.dropFirst(9)) : name }
}

/// An ordered cashback recipient. Server-created ids also survive deletion/restoration from Audit.
struct PipelineCashback: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let dealId: String
    var position: Double
    var name: String
    var amount: Double
    let createdAt: String?
    let updatedAt: String?

    private enum CodingKeys: String, CodingKey { case id, dealId, position, name, amount, createdAt, updatedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        dealId = (try? c.decodeIfPresent(String.self, forKey: .dealId)) ?? ""
        position = (try? c.decodeIfPresent(Double.self, forKey: .position)) ?? 0
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        amount = (try? c.decodeIfPresent(Double.self, forKey: .amount)) ?? 0
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

struct PipelineContact: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let dealId: String
    var position: Double
    var role: String
    var name: String
    var phone: String
    let createdAt: String?
    let updatedAt: String?

    private enum CodingKeys: String, CodingKey { case id, dealId, position, role, name, phone, createdAt, updatedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        dealId = (try? c.decodeIfPresent(String.self, forKey: .dealId)) ?? ""
        position = (try? c.decodeIfPresent(Double.self, forKey: .position)) ?? 0
        role = (try? c.decodeIfPresent(String.self, forKey: .role)) ?? "Client"
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        phone = (try? c.decodeIfPresent(String.self, forKey: .phone)) ?? ""
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

/// Spent and remaining are server-derived; the budget does not enter margin or real-profit KPIs.
struct PipelineBudget: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let dealId: String
    var position: Double
    var name: String
    var amount: Double
    var spent: Double
    var remaining: Double
    let createdAt: String?
    let updatedAt: String?

    private enum CodingKeys: String, CodingKey { case id, dealId, position, name, amount, spent, remaining, createdAt, updatedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        dealId = (try? c.decodeIfPresent(String.self, forKey: .dealId)) ?? ""
        position = (try? c.decodeIfPresent(Double.self, forKey: .position)) ?? 0
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        amount = (try? c.decodeIfPresent(Double.self, forKey: .amount)) ?? 0
        spent = (try? c.decodeIfPresent(Double.self, forKey: .spent)) ?? 0
        remaining = (try? c.decodeIfPresent(Double.self, forKey: .remaining)) ?? 0
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
    }
}

/// Item answers carry the whole deal, which callers replace in the cache after every write.
struct PipelineItemResponse: Decodable, Sendable {
    let deal: PipelineDeal?
    let item: PipelineItem?
    let duplicate: Bool

    private enum CodingKeys: String, CodingKey { case deal, item, duplicate }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deal = try? c.decodeIfPresent(PipelineDeal.self, forKey: .deal)
        item = try? c.decodeIfPresent(PipelineItem.self, forKey: .item)
        duplicate = (try? c.decodeIfPresent(Bool.self, forKey: .duplicate)) ?? false
    }
}

/// A kind-tagged item returned by POST/PATCH; budget spent/remaining live in deal.budgets instead.
struct PipelineItem: Decodable, Sendable {
    let id: String
    let kind: String
    let name: String?
    let amount: Double?
    let role: String?
    let phone: String?
}

/// The KPI strip, over EVERY deal of the project (never the filtered view), as the server sums it.
struct PipelineSummary: Decodable, Sendable {
    var total = 0
    var openCount = 0
    var openValue: Double = 0
    var weightedValue: Double = 0
    var wonCount = 0
    var wonValue: Double = 0
    var activeCount = 0
    var lostCount = 0
    var lostValue: Double = 0
    var readyCount = 0
    var blockedCount = 0
    var receivable: Double = 0
    var receivableOverdue: Double = 0
    var criticalCount = 0
    var attentionCount = 0
    var deliverablesOnTrack = 0
    var deliverablesDone = 0
    /// Real cost & margin (Control Tower v6, 14 Oct 2026): over the deals that are not Lost, have cost lines
    /// and a net value — Σ real cost and Σ (net value − real cost) ("Real profit"). costDealCount = deals not
    /// Lost with cost lines (net value or not). 0 from an older server.
    var realCost: Double = 0
    var realProfit: Double = 0
    var costDealCount = 0
    /// Every deal that is not Lost / Cancelled: the M of "N of M deals have costs" (Control Tower v6).
    var costEligibleCount = 0
    /// Of the N deals with costs, those without a net value: left out of Real profit, shown as a warning.
    var costNoNetCount = 0

    init() {}

    private enum CodingKeys: String, CodingKey {
        case total, openCount, openValue, weightedValue, wonCount, wonValue, activeCount, lostCount, lostValue
        case readyCount, blockedCount, receivable, receivableOverdue, criticalCount, attentionCount
        case deliverablesOnTrack, deliverablesDone, realCost, realProfit, costDealCount, costEligibleCount
        case costNoNetCount
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func n(_ k: CodingKeys) -> Double { (try? c.decodeIfPresent(Double.self, forKey: k)) ?? 0 }
        func i(_ k: CodingKeys) -> Int { Int(n(k)) }
        total = i(.total); openCount = i(.openCount); openValue = n(.openValue); weightedValue = n(.weightedValue)
        wonCount = i(.wonCount); wonValue = n(.wonValue); activeCount = i(.activeCount); lostCount = i(.lostCount)
        lostValue = n(.lostValue); readyCount = i(.readyCount); blockedCount = i(.blockedCount)
        receivable = n(.receivable); receivableOverdue = n(.receivableOverdue); criticalCount = i(.criticalCount)
        attentionCount = i(.attentionCount); deliverablesOnTrack = i(.deliverablesOnTrack); deliverablesDone = i(.deliverablesDone)
        realCost = n(.realCost); realProfit = n(.realProfit); costDealCount = i(.costDealCount); costEligibleCount = i(.costEligibleCount)
        costNoNetCount = i(.costNoNetCount)
    }
}

/// Every option list, as GET …/pipeline sends it. The fallbacks are the GM's lists of 9 Oct 2026, for a
/// response that somehow lacks one; the server's own list always wins, so a new option shows up here
/// without a release.
struct PipelineVocab: Decodable, Sendable {
    var stages: [String]
    var services: [String]
    var probabilities: [Double]
    var contractStatuses: [String]
    var vregStatuses: [String]
    var readiness: [String]
    var deliverableStatuses: [String]
    var deliverableRisks: [String]
    var paymentStatuses: [String]
    var closingStatuses: [String]
    var linkTypes: [String]
    var contactRoles: [String]

    static let lostStage = "Lost / Cancelled"

    static let fallback = PipelineVocab(
        stages: ["Incoming", "Proposal / Quotation", "Negotiation", "Won – Contract Pending", "Won – In Execution",
                 "Closing", "Closed", "Lost / Cancelled"],
        services: ["Event", "Creative", "Multimedia", "Digital Campaign", "Production", "Activation", "Exhibition", "Other"],
        probabilities: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1],
        contractStatuses: ["Not Started", "Request to Legal", "Legal Drafting", "Internal Review", "Sent to Client",
                           "Client Review", "Revision", "Final Review", "Client Signed", "TZN Signed", "Fully Executed", "Cancelled"],
        vregStatuses: ["Not Required", "Not Started", "Documents Gathering", "Ready to Submit", "Submitted", "Client Review",
                       "Revision Required", "Approved", "Rejected"],
        readiness: ["N/A", "Blocked", "Partial", "Ready"],
        deliverableStatuses: ["Not Started", "Briefing", "In Progress", "Internal Review", "Client Review", "Revision",
                              "Approved", "Completed", "Cancelled"],
        deliverableRisks: ["Aman", "At Risk", "Overdue"],
        paymentStatuses: ["Not Yet", "Upcoming", "Due", "Overdue", "Partial", "Paid"],
        closingStatuses: ["Not Ready", "In Progress", "Waiting BAST", "Waiting Client Payment", "Waiting Vendor Settlement",
                          "Waiting Deliverables", "Ready to Close", "Closed"],
        linkTypes: ["Deck", "Quotation", "Kontrak", "SPK", "MOU", "Invoice", "Report", "Lainnya"],
        contactRoles: ["Client", "Vendor", "Broker", "PM (client side)", "Finance", "Admin", "Other"]
    )

    init(stages: [String], services: [String], probabilities: [Double], contractStatuses: [String], vregStatuses: [String],
         readiness: [String], deliverableStatuses: [String], deliverableRisks: [String], paymentStatuses: [String],
         closingStatuses: [String], linkTypes: [String],
         contactRoles: [String] = ["Client", "Vendor", "Broker", "PM (client side)", "Finance", "Admin", "Other"]) {
        self.stages = stages; self.services = services; self.probabilities = probabilities
        self.contractStatuses = contractStatuses; self.vregStatuses = vregStatuses; self.readiness = readiness
        self.deliverableStatuses = deliverableStatuses; self.deliverableRisks = deliverableRisks
        self.paymentStatuses = paymentStatuses; self.closingStatuses = closingStatuses; self.linkTypes = linkTypes
        self.contactRoles = contactRoles
    }

    private enum CodingKeys: String, CodingKey {
        case stages, services, probabilities, contractStatuses, vregStatuses, readiness, deliverableStatuses
        case deliverableRisks, paymentStatuses, closingStatuses, linkTypes, contactRoles
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let f = Self.fallback
        func l(_ k: CodingKeys, _ d: [String]) -> [String] {
            guard let v = try? c.decodeIfPresent([String].self, forKey: k), !v.isEmpty else { return d }
            return v
        }
        stages = l(.stages, f.stages); services = l(.services, f.services)
        let probs = (try? c.decodeIfPresent([Double].self, forKey: .probabilities)) ?? []
        probabilities = probs.isEmpty ? f.probabilities : probs
        contractStatuses = l(.contractStatuses, f.contractStatuses); vregStatuses = l(.vregStatuses, f.vregStatuses)
        readiness = l(.readiness, f.readiness); deliverableStatuses = l(.deliverableStatuses, f.deliverableStatuses)
        deliverableRisks = l(.deliverableRisks, f.deliverableRisks); paymentStatuses = l(.paymentStatuses, f.paymentStatuses)
        closingStatuses = l(.closingStatuses, f.closingStatuses); linkTypes = l(.linkTypes, f.linkTypes)
        contactRoles = l(.contactRoles, f.contactRoles)
    }

    /// The server's stageGroupOf: Pipeline · Pre-Execution · Execution · Closed · Lost.
    static func group(of stage: String) -> String {
        switch stage {
        case "Incoming", "Proposal / Quotation", "Negotiation": return "Pipeline"
        case lostStage: return "Lost"
        case "Closed": return "Closed"
        case "Won – Contract Pending": return "Pre-Execution"
        default: return "Execution"
        }
    }
}

/// A deal's execution folder or project as the deal carries it.
struct PipelineExecutionRef: Decodable, Hashable, Sendable {
    let id: String
    let name: String?
}

/// POST /api/projects/:id/pipeline/:dealId/execution
/// What "Create execution project" opens: the deal's folder, or — from a server before 10 Oct 2026,
/// which made one project and no folder — that project.
enum PipelineExecutionTarget {
    case folder(String)
    case project(ProjectRef)
}

/// projectId is the Master Task; calendarProjectId and folderId are nil from a server before 10 Oct 2026.
struct PipelineExecutionResponse: Decodable, Sendable {
    let projectId: String
    let calendarProjectId: String?
    let folderId: String?
    let created: Bool?
    let deal: PipelineDeal?
}

struct PipelineProjectRef: Decodable, Sendable {
    let id: String?
    let name: String?
    let type: String?
    let workspaceId: String?
}

/// GET /api/projects/:id/pipeline
struct PipelineResponse: Decodable, Sendable {
    let project: PipelineProjectRef?
    let deals: [PipelineDeal]
    let summary: PipelineSummary
    let vocab: PipelineVocab
    let today: String?
    /// May the viewer change deals (14 Oct 2026)? Full / Can edit yes, Can comment / Can view no. A server
    /// from before it says nothing: true, as before.
    let canEdit: Bool
    /// All available years, even while the server has filtered the deals/summary to `year`.
    let years: [Int]
    let year: Int?

    private enum CodingKeys: String, CodingKey { case project, deals, summary, vocab, today, canEdit, years, year }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        project = try? c.decodeIfPresent(PipelineProjectRef.self, forKey: .project)
        // One deal that does not decode (no id) is dropped rather than costing the whole board.
        let raw = (try? c.decodeIfPresent([PipelineFailable<PipelineDeal>].self, forKey: .deals)) ?? []
        deals = raw.compactMap(\.value)
        summary = (try? c.decodeIfPresent(PipelineSummary.self, forKey: .summary)) ?? PipelineSummary()
        vocab = (try? c.decodeIfPresent(PipelineVocab.self, forKey: .vocab)) ?? .fallback
        today = try? c.decodeIfPresent(String.self, forKey: .today)
        canEdit = ((try? c.decodeIfPresent(Bool.self, forKey: .canEdit)) ?? nil) ?? true
        years = (try? c.decodeIfPresent([Int].self, forKey: .years)) ?? []
        year = try? c.decodeIfPresent(Int.self, forKey: .year)
    }
}

/// A pipeline board available to the BoD/OAA combined view and board switcher.
struct PipelineBoardRef: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let icon: String?
    let color: String?
    let status: String
    let dealCount: Int

    private enum CodingKeys: String, CodingKey { case id, name, icon, color, status, dealCount }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        icon = try? c.decodeIfPresent(String.self, forKey: .icon)
        color = try? c.decodeIfPresent(String.self, forKey: .color)
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? "ACTIVE"
        dealCount = (try? c.decodeIfPresent(Int.self, forKey: .dealCount)) ?? 0
    }
}

struct PipelineBoardsResponse: Decodable, Sendable {
    let workspaceId: String?
    let boards: [PipelineBoardRef]

    private enum CodingKeys: String, CodingKey { case workspaceId, boards }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workspaceId = try? c.decodeIfPresent(String.self, forKey: .workspaceId)
        let raw = (try? c.decodeIfPresent([PipelineFailable<PipelineBoardRef>].self, forKey: .boards)) ?? []
        boards = raw.compactMap(\.value)
    }
}

/// GET /api/pipelines/all. Read-only even if a malformed/older answer claims edit permission.
struct PipelineAllResponse: Decodable, Sendable {
    let workspaceId: String?
    let boards: [PipelineBoardRef]
    let deals: [PipelineDeal]
    let summary: PipelineSummary
    let vocab: PipelineVocab
    let today: String?
    let years: [Int]
    let year: Int?
    let source: String?
    var canEdit: Bool { false }

    private enum CodingKeys: String, CodingKey { case workspaceId, boards, deals, summary, vocab, today, years, year, source }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        workspaceId = try? c.decodeIfPresent(String.self, forKey: .workspaceId)
        let rawBoards = (try? c.decodeIfPresent([PipelineFailable<PipelineBoardRef>].self, forKey: .boards)) ?? []
        boards = rawBoards.compactMap(\.value)
        let rawDeals = (try? c.decodeIfPresent([PipelineFailable<PipelineDeal>].self, forKey: .deals)) ?? []
        deals = rawDeals.compactMap(\.value)
        summary = (try? c.decodeIfPresent(PipelineSummary.self, forKey: .summary)) ?? PipelineSummary()
        vocab = (try? c.decodeIfPresent(PipelineVocab.self, forKey: .vocab)) ?? .fallback
        today = try? c.decodeIfPresent(String.self, forKey: .today)
        years = (try? c.decodeIfPresent([Int].self, forKey: .years)) ?? []
        year = try? c.decodeIfPresent(Int.self, forKey: .year)
        source = try? c.decodeIfPresent(String.self, forKey: .source)
    }
}

/// Decodes one element of a list, or nothing, so a single odd element does not fail the list.
struct PipelineFailable<Wrapped: Decodable>: Decodable {
    let value: Wrapped?
    init(from decoder: Decoder) throws { value = try? Wrapped(from: decoder) }
}

/// One field changed by one person: the deal's History tab.
struct PipelineChange: Decodable, Identifiable, Sendable {
    let id: String
    let field: String
    let before: AuditJSON?
    let after: AuditJSON?
    let createdAt: String?
    let user: PipelinePerson?
    /// A payment-term change ("term.<field>", "term.created" …): which term, named as it was then.
    let termId: String?
    let termLabel: String?

    private enum CodingKeys: String, CodingKey { case id, field, before, after, createdAt, user, termId, termLabel }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? UUID().uuidString
        field = (try? c.decodeIfPresent(String.self, forKey: .field)) ?? ""
        before = try? c.decodeIfPresent(AuditJSON.self, forKey: .before)
        after = try? c.decodeIfPresent(AuditJSON.self, forKey: .after)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        user = try? c.decodeIfPresent(PipelinePerson.self, forKey: .user)
        termId = (try? c.decodeIfPresent(String.self, forKey: .termId)) ?? nil
        termLabel = (try? c.decodeIfPresent(String.self, forKey: .termLabel)) ?? nil
    }

    /// "term.amount" → "amount"; nil for a change to the deal itself.
    var termField: String? { field.hasPrefix("term.") ? String(field.dropFirst(5)) : nil }
}

/// GET /api/projects/:id/pipeline/:dealId
struct PipelineDealDetail: Decodable, Sendable {
    let deal: PipelineDeal?
    let history: [PipelineChange]

    private enum CodingKeys: String, CodingKey { case deal, history }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        deal = try? c.decodeIfPresent(PipelineDeal.self, forKey: .deal)
        let raw = (try? c.decodeIfPresent([PipelineFailable<PipelineChange>].self, forKey: .history)) ?? []
        history = raw.compactMap(\.value)
    }
}

// MARK: - Words

/// What a stored value reads as. Only what is shown is translated; the stored key never changes.
enum PipelineText {
    /// The three stages the GM named in Indonesian; every other key reads the same in both languages.
    static func stage(_ k: String) -> String { T(k) }

    static func risk(_ k: String) -> String { k == "Aman" ? T("On track") : k }

    static func link(_ k: String) -> String {
        switch k {
        case "Kontrak": return T("Contract")
        case "Lainnya": return T("Other")
        case "SPK": return T("SPK (Work Order)")
        case "Quotation": return T("Quotation")
        case "Report": return T("Report")
        default: return k
        }
    }

    static func contactRole(_ key: String) -> String {
        key == "Other" ? T("Other contact") : T(key)
    }

    static func itemKind(_ key: String) -> String {
        switch key {
        case "cashback": return T("Cashback")
        case "contact": return T("Project contact")
        case "budget": return T("Budget expenses")
        default: return key
        }
    }

    static func itemField(_ key: String) -> String {
        switch key {
        case "name": return T("Name")
        case "amount": return T("Amount")
        case "role": return T("Role")
        case "phone": return T("Phone")
        default: return key
        }
    }

    static func health(_ key: String) -> String {
        switch key {
        case "CRITICAL": return T("Critical")
        case "ATTENTION": return T("Attention")
        case "HEALTHY": return T("Healthy")
        case "NOT_STARTED": return T("Not started")
        default: return T("Lost")
        }
    }

    static func healthTone(_ key: String) -> ChipTone {
        switch key {
        case "CRITICAL": return .danger
        case "ATTENTION": return .warning
        case "HEALTHY": return .success
        default: return .neutral
        }
    }

    /// The GM's words for each reason code (web: useReasonText). An unknown code is shown raw.
    static func reason(_ r: PipelineReason) -> String {
        switch r.code {
        case "READINESS_BLOCKED": return T("Readiness blocked")
        case "EXECUTION_WITHOUT_CONTRACT": return T("Running without a fully executed contract")
        // Same words for both: the pill's colour already says whether it is critical yet (> 7 days).
        case "RECEIVABLE_OVERDUE", "MINOR_OVERDUE":
            let d = r.days ?? 0
            return String(format: T(d == 1 ? "Receivable %d day overdue" : "Receivable %d days overdue"), d)
        case "DELIVERABLE_OVERDUE": return T("Deliverable overdue")
        case "NEGATIVE_CASH": return T("Cash position materially negative")
        case "READINESS_PARTIAL": return T("Partly ready")
        case "DELIVERABLE_AT_RISK": return T("Deliverable at risk")
        case "PAYMENT_PARTIAL": return T("Partly paid")
        case "PAYMENT_DUE": return T("Payment due")
        case "BLOCKER": return String(format: T("Blocker: %@"), r.text ?? "")
        case "VREG_PENDING": return T("Vendor registration not approved yet")
        default: return r.code
        }
    }

    /// A payment term's status (server: TERM_STATUSES). An unknown one is shown as-is.
    static func termStatus(_ k: String) -> String {
        switch k {
        case "Not Invoiced": return T("Not invoiced")
        case "Invoiced": return T("Invoiced")
        case "Partial": return T("Partly paid")
        case "Paid": return T("Paid")
        case "Overdue": return T("Overdue")
        default: return k
        }
    }

    static func termTone(_ k: String) -> ChipTone {
        switch k {
        case "Paid": return .success
        case "Overdue": return .danger
        case "Partial": return .warning
        case "Invoiced": return .info
        default: return .neutral
        }
    }

    /// A payment term's fields in the History tab.
    static func termField(_ key: String) -> String {
        switch key {
        case "label": return T("Name")
        case "amount": return T("Amount")
        case "dueDate": return T("Due date")
        case "invoiceNo": return T("Invoice number")
        case "invoiceDate": return T("Invoice date")
        case "paidAmount": return T("Amount paid")
        case "paidAt": return T("Paid on")
        case "note": return T("Notes")
        default: return key
        }
    }

    static func phase(_ key: String) -> String {
        switch key {
        case "commercial": return T("Commercial")
        case "contract": return T("Contract")
        case "readiness": return T("Readiness")
        case "deliverable": return T("Deliverable")
        case "payment": return T("Payment")
        case "closing": return T("Closing")
        default: return key
        }
    }

    static func phaseState(_ state: String) -> String {
        switch state {
        case "done": return T("done")
        case "active": return T("in progress")
        case "bad": return T("needs attention")
        default: return T("not started")
        }
    }

    /// English names of the fields for the History tab ("Budi changed Stage …"), put through T().
    static func field(_ key: String) -> String {
        let en: String
        switch key {
        case "name": en = "Name"
        case "brand": en = "Brand / client"
        case "service": en = "Service"
        case "services": en = "Services"
        case "bdUserId", "bdName": en = "BD / account owner"
        case "pmUserId", "pmName": return "PM"
        case "stage": en = "Stage"
        case "probability": en = "Probability"
        case "contractValue": en = "Contract value"
        case "netValue": en = "Net project value"
        case "barterValue": en = "Barter value"
        case "barterCompensation": en = "Barter compensation form"
        case "invoiceValue": en = "Invoice value"
        case "contractStatus": en = "Contract status"
        case "vregStatus": en = "Vendor registration"
        case "readiness": en = "Execution readiness"
        case "deliverableStatus": en = "Deliverable status"
        case "deliverableRisk": en = "Deliverable risk"
        case "paymentStatus": en = "Payment status"
        case "outstandingReceivable": en = "Outstanding receivable"
        case "paymentDueDate": en = "Payment due date"
        case "maxDaysOverdue": en = "Days overdue (typed)"
        case "netCash": en = "Net cash position"
        case "closingStatus": en = "Closing status"
        case "mainDate": en = "Event / main date"
        case "nextAction": en = "Next action"
        case "nextActionDate": en = "Next action date"
        case "blocker": en = "Blocker / issue"
        case "notes": en = "Notes"
        case "links": en = "Documents & links"
        case "costs": en = "Real cost"
        default: return key
        }
        return T(en)
    }
}

// MARK: - Numbers and dates

/// Rupiah and dates the way the web's pipeline-ui.ts writes them, in the app's language.
enum PipelineFormat {
    private static var isID: Bool { AppLanguage.shared.lang == .id }

    private static func formatter(digits: Int, id: Bool) -> NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: id ? "id_ID" : "en_GB")
        f.maximumFractionDigits = digits
        f.minimumFractionDigits = 0
        return f
    }
    private static let fmtID0 = formatter(digits: 0, id: true)
    private static let fmtID1 = formatter(digits: 1, id: true)
    // Whole numbers use dot grouping in English too (owner rule, UI tour run 13).
    private static let fmtEN0 = formatter(digits: 0, id: true)
    private static let fmtEN1 = formatter(digits: 1, id: false)

    private static func number(_ v: Double, digits: Int) -> String {
        let f = isID ? (digits > 0 ? fmtID1 : fmtID0) : (digits > 0 ? fmtEN1 : fmtEN0)
        return f.string(from: NSNumber(value: v)) ?? String(Int(v))
    }

    /// Compact, for narrow cards, tiles and columns: "Rp 963 jt" / "Rp 1,3 M" / "Rp 250 rb" (Indonesian) or
    /// "Rp 963 M" / "Rp 1.3 B" / "Rp 250 K" (English), a space before the unit (owner decision, 25 Oct 2026).
    /// Everywhere with room the full amount stays: `idrFull`, "Rp 6.000.000".
    static func idr(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "–" }
        let abs = Swift.abs(n)
        let suffix = isID ? ("M", "jt", "rb") : ("B", "M", "K")
        var v = abs
        var s = ""
        if abs >= 1e9 { v = abs / 1e9; s = suffix.0 }
        else if abs >= 1e6 { v = abs / 1e6; s = suffix.1 }
        else if abs >= 1e3 { v = abs / 1e3; s = suffix.2 }
        let digits = (!s.isEmpty && v < 10) ? 1 : 0
        return "\(n < 0 ? "\u{2212}" : "")Rp \(number(v, digits: digits))\(s.isEmpty ? "" : " " + s)"
    }

    /// Full: Rp 950.000.000.
    static func idrFull(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "–" }
        return AppNumber.rupiah(Int64(n.rounded()))
    }

    /// A plain number as typed into a money field: digits with the language's grouping.
    static func plain(_ n: Double) -> String { number(n.rounded(), digits: 0) }

    /// Reads what someone typed into a money field: "950.000.000", "950,000,000", "Rp 950000000", "-5000".
    /// Separators of either language are dropped, as rupiah have no cents here (the server rounds).
    static func parseMoney(_ text: String) -> Double? {
        let negative = text.trimmingCharacters(in: .whitespaces).hasPrefix("-")
        let digits = text.filter(\.isNumber)
        guard !digits.isEmpty, let v = Double(digits) else { return text.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : nil }
        return negative ? -v : v
    }

    static func pct(_ p: Double) -> String { "\(Int((p * 100).rounded()))%" }

    private static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Jakarta")!
        return c
    }()
    private static let isoDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let shownID: DateFormatter = makeShown("id_ID")
    private static let shownEN: DateFormatter = makeShown("en_GB")
    private static func makeShown(_ locale: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: locale)
        f.dateFormat = "d MMM yyyy"
        return f
    }
    private static let stampID: DateFormatter = makeStamp("id_ID")
    private static let stampEN: DateFormatter = makeStamp("en_GB")
    private static func makeStamp(_ locale: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: locale)
        f.dateFormat = "d MMM yyyy, HH:mm"
        return f
    }

    static func parseDay(_ iso: String?) -> Date? {
        guard let iso, iso.count >= 10 else { return nil }
        return isoDayFormatter.date(from: String(iso.prefix(10)))
    }
    static func isoDay(_ d: Date) -> String { isoDayFormatter.string(from: d) }

    /// "4 Okt 2026" / "4 Oct 2026"; "–" for none.
    static func day(_ iso: String?) -> String {
        guard let d = parseDay(iso) else { return iso ?? "–" }
        return (isID ? shownID : shownEN).string(from: d)
    }

    /// A server timestamp ("2026-10-09T08:35:26.000Z") as "9 Okt 2026, 15:35" in Jakarta time.
    static func stamp(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        return (isID ? stampID : stampEN).string(from: d)
    }

    private static let shortID: DateFormatter = makeShort("id_ID")
    private static let shortEN: DateFormatter = makeShort("en_GB")
    private static func makeShort(_ locale: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: locale)
        f.dateFormat = "d MMM"
        return f
    }

    /// "4 Okt" / "4 Oct": a date on a board card, where the year goes without saying; "" for none.
    static func shortDay(_ iso: String?) -> String {
        guard let d = parseDay(iso) else { return iso ?? "" }
        return (isID ? shortID : shortEN).string(from: d)
    }

    /// Whole days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier.
    static func daysBetween(_ from: String, _ to: String) -> Int? {
        guard let a = parseDay(from), let b = parseDay(to) else { return nil }
        return calendar.dateComponents([.day], from: a, to: b).day
    }

    /// Today in Jakarta, for when the server's `today` is missing.
    static var today: String { isoDayFormatter.string(from: Date()) }
}

extension PipelineDeal {
    /// Inside a column: the most urgent first, then the biggest — the GM's order (web: bySeverity).
    static func bySeverity(_ a: PipelineDeal, _ b: PipelineDeal) -> Bool {
        let order = ["CRITICAL": 0, "ATTENTION": 1, "HEALTHY": 2, "NOT_STARTED": 3, "NONE": 4]
        let sa = order[a.health.key] ?? 9, sb = order[b.health.key] ?? 9
        if sa != sb { return sa < sb }
        return a.netValue > b.netValue
    }
}

// MARK: - Phase progress (owner, 9 Oct 2026)
//
// owner: "progress fase pas gw pencet board per dealnya jg gaada dan kalo gw isi blocker didalemnya …
// harusnya masuk ke tampilan 1 sama progress fasenya supaya tau problemnya". The ONE place this app words
// the six phases (card track, deal stepper); the states are the server's (src/lib/pipeline.ts phasesOf),
// the words are the GM's node details, as the web's usePhaseDetail (pipeline-ui.tsx).
extension PipelineDeal {
    /// The blocker as written, or nil when there is none.
    var blockerText: String? {
        let t = blocker.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    /// The server's phases, with the blocker's phase marked. A server from before 9 Oct evening does not
    /// mark it, so then the blocker goes on the phase the deal is at now: the one already in trouble, else
    /// the one in progress, else the first not done (the server's fallback when the words name none).
    var progressPhases: [PipelinePhase] {
        guard blockerText != nil, !phases.isEmpty, !phases.contains(where: { $0.blocked == true }) else { return phases }
        let held = phases.first(where: { $0.state == "bad" })
            ?? phases.first(where: { $0.state == "active" })
            ?? phases.first(where: { $0.state != "done" })
            ?? phases[phases.count - 1]
        return phases.map { $0.key == held.key ? PipelinePhase(key: $0.key, state: "bad", blocked: true) : $0 }
    }

    /// The line under a phase: "Deal won", "Fully executed", "Overdue 12 hari", "Belum dimulai" … Never
    /// "Overdue 0 days": without a day count it says "Payment overdue". Unknown statuses are shown as-is.
    func phaseDetail(_ key: String) -> String {
        switch key {
        case "commercial":
            let g = PipelineVocab.group(of: stage)
            return g == "Pipeline" || g == "Lost" ? PipelineText.stage(stage) : T("Deal won")
        case "contract":
            if contractStatus == "Fully Executed" { return T("Fully executed") }
            if contractStatus == "Cancelled" { return T("Contract cancelled") }
            if contractStatus.isEmpty || contractStatus == "Not Started" { return T("Not started") }
            return contractStatus
        case "readiness":
            if readiness == "Ready" { return T("Ready to execute") }
            if readiness == "Blocked" { return T("Readiness blocked") }
            if readiness == "Partial" { return T("Partly ready") }
            return T("Not yet relevant")
        case "deliverable":
            if deliverableStatus == "Completed" || deliverableStatus == "Approved" { return T("Deliverable done") }
            if deliverableRisk == "Overdue" { return T("Deliverable overdue") }
            if deliverableRisk == "At Risk" { return T("Deliverable at risk") }
            if deliverableStatus.isEmpty || deliverableStatus == "Not Started" { return T("Not started") }
            return deliverableStatus
        case "payment":
            switch paymentStatusShown {
            case "Paid": return T("Fully paid")
            case "Overdue":
                return daysOverdue > 0
                    ? String(format: T(daysOverdue == 1 ? "Overdue %d day" : "Overdue %d days"), daysOverdue)
                    : T("Payment overdue")
            case "Partial": return T("Partly paid")
            case "Due": return T("Payment due")
            case "Upcoming": return T("Upcoming due")
            default: return T("Not yet billed")
            }
        case "closing":
            if closingStatus == "Closed" { return "Closed" }
            if closingStatus.isEmpty || closingStatus == "Not Ready" { return T("Not started") }
            return closingStatus
        default:
            return ""
        }
    }
}
