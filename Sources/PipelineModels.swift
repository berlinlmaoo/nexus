import Foundation

// MARK: - Pipeline Dashboard (Project.type "PIPELINE", owner, 9 Oct 2026)
//
// Berlin: "GM gw udh kirim contoh pipeline dashboard yg dia pengen … tinggal diubah ke design NEXUS".
// The GM's "Control Tower TZN" board lives inside a NEXUS project: one deal per client job, from first
// contact to closed and paid. Spec: agents:~/handoff/chat/PIPELINE-DASHBOARD.md. Server: src/lib/pipeline.ts
// and pipeline-server.ts; web: apps/nexus-lovable-ui/src/components/pipeline.
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

/// A document on a deal: SPK, contract, MOU, invoice or other. http(s) only (the server refuses the rest).
struct PipelineLink: Decodable, Hashable, Identifiable, Sendable {
    let id: String
    let type: String
    let label: String
    let url: String

    private enum CodingKeys: String, CodingKey { case id, type, label, url }
    init(id: String, type: String, label: String, url: String) { self.id = id; self.type = type; self.label = label; self.url = url }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = (try? c.decodeIfPresent(String.self, forKey: .url)) ?? ""
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? url
        type = (try? c.decodeIfPresent(String.self, forKey: .type)) ?? "Lainnya"
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? ""
    }
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
/// each done | active | pending | bad.
struct PipelinePhase: Decodable, Hashable, Sendable {
    let key: String
    let state: String
}

struct PipelineDeal: Decodable, Identifiable, Sendable {
    let id: String
    var code: String
    var position: Double
    var name: String
    var brand: String
    var service: String
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
    // Derived by the server.
    var stageGroup: String
    var daysOverdue: Int
    var health: PipelineHealth
    var phases: [PipelinePhase]

    private enum CodingKeys: String, CodingKey {
        case id, code, position, name, brand, service, bdUserId, bdName, bd, pmUserId, pmName, pm, stage, probability
        case contractValue, netValue, invoiceValue, contractStatus, vregStatus, readiness, deliverableStatus
        case deliverableRisk, paymentStatus, outstandingReceivable, paymentDueDate, maxDaysOverdue, netCash
        case closingStatus, mainDate, nextAction, nextActionDate, blocker, notes, links, createdAt, createdBy
        case updatedAt, updatedBy, stageGroup, daysOverdue, health, phases
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
        stageGroup = o(.stageGroup) ?? PipelineVocab.group(of: stage)
        daysOverdue = Int(n(.daysOverdue))
        health = (try? c.decodeIfPresent(PipelineHealth.self, forKey: .health)) ?? PipelineHealth(key: "NONE", reasons: [])
        phases = (try? c.decodeIfPresent([PipelinePhase].self, forKey: .phases)) ?? []
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
            case "service": if let str { service = str }
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
            case "mainDate": mainDate = str
            case "nextActionDate": nextActionDate = str
            case "bdName": bdName = str
            case "pmName": pmName = str
            case "bdUserId": bdUserId = str; if str == nil { bd = nil }
            case "pmUserId": pmUserId = str; if str == nil { pm = nil }
            default: break
            }
        }
    }
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

    init() {}

    private enum CodingKeys: String, CodingKey {
        case total, openCount, openValue, weightedValue, wonCount, wonValue, activeCount, lostCount, lostValue
        case readyCount, blockedCount, receivable, receivableOverdue, criticalCount, attentionCount
        case deliverablesOnTrack, deliverablesDone
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
        linkTypes: ["SPK", "Kontrak", "MOU", "Invoice", "Lainnya"]
    )

    init(stages: [String], services: [String], probabilities: [Double], contractStatuses: [String], vregStatuses: [String],
         readiness: [String], deliverableStatuses: [String], deliverableRisks: [String], paymentStatuses: [String],
         closingStatuses: [String], linkTypes: [String]) {
        self.stages = stages; self.services = services; self.probabilities = probabilities
        self.contractStatuses = contractStatuses; self.vregStatuses = vregStatuses; self.readiness = readiness
        self.deliverableStatuses = deliverableStatuses; self.deliverableRisks = deliverableRisks
        self.paymentStatuses = paymentStatuses; self.closingStatuses = closingStatuses; self.linkTypes = linkTypes
    }

    private enum CodingKeys: String, CodingKey {
        case stages, services, probabilities, contractStatuses, vregStatuses, readiness, deliverableStatuses
        case deliverableRisks, paymentStatuses, closingStatuses, linkTypes
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

    private enum CodingKeys: String, CodingKey { case project, deals, summary, vocab, today }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        project = try? c.decodeIfPresent(PipelineProjectRef.self, forKey: .project)
        // One deal that does not decode (no id) is dropped rather than costing the whole board.
        let raw = (try? c.decodeIfPresent([PipelineFailable<PipelineDeal>].self, forKey: .deals)) ?? []
        deals = raw.compactMap(\.value)
        summary = (try? c.decodeIfPresent(PipelineSummary.self, forKey: .summary)) ?? PipelineSummary()
        vocab = (try? c.decodeIfPresent(PipelineVocab.self, forKey: .vocab)) ?? .fallback
        today = try? c.decodeIfPresent(String.self, forKey: .today)
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

    private enum CodingKeys: String, CodingKey { case id, field, before, after, createdAt, user }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? UUID().uuidString
        field = (try? c.decodeIfPresent(String.self, forKey: .field)) ?? ""
        before = try? c.decodeIfPresent(AuditJSON.self, forKey: .before)
        after = try? c.decodeIfPresent(AuditJSON.self, forKey: .after)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        user = try? c.decodeIfPresent(PipelinePerson.self, forKey: .user)
    }
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
        case "Lainnya": return T("Other link")
        case "SPK": return T("SPK (Work Order)")
        default: return k
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

    /// English names of the fields for the History tab ("Bagas changed Stage …"), put through T().
    static func field(_ key: String) -> String {
        let en: String
        switch key {
        case "name": en = "Name"
        case "brand": en = "Brand / client"
        case "service": en = "Service"
        case "bdUserId", "bdName": en = "BD / account owner"
        case "pmUserId", "pmName": return "PM"
        case "stage": en = "Stage"
        case "probability": en = "Probability"
        case "contractValue": en = "Contract value"
        case "netValue": en = "Net project value"
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
    private static let fmtEN0 = formatter(digits: 0, id: false)
    private static let fmtEN1 = formatter(digits: 1, id: false)

    private static func number(_ v: Double, digits: Int) -> String {
        let f = isID ? (digits > 0 ? fmtID1 : fmtID0) : (digits > 0 ? fmtEN1 : fmtEN0)
        return f.string(from: NSNumber(value: v)) ?? String(Int(v))
    }

    /// Compact: Rp950Jt / Rp1,2M (Indonesian) or Rp950M / Rp1.2B (English) — the GM's fmtIDR.
    static func idr(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "–" }
        let abs = Swift.abs(n)
        let suffix = isID ? ("M", "Jt", "Rb") : ("B", "M", "K")
        var v = abs
        var s = ""
        if abs >= 1e9 { v = abs / 1e9; s = suffix.0 }
        else if abs >= 1e6 { v = abs / 1e6; s = suffix.1 }
        else if abs >= 1e3 { v = abs / 1e3; s = suffix.2 }
        let digits = (!s.isEmpty && v < 10) ? 1 : 0
        return "\(n < 0 ? "-" : "")Rp\(number(v, digits: digits))\(s)"
    }

    /// Full: Rp950.000.000.
    static func idrFull(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "–" }
        return "\(n < 0 ? "-" : "")Rp\(number(Swift.abs(n).rounded(), digits: 0))"
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
