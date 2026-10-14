import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Legal requests (owner, 14 Oct 2026): the request form behind a link (/f/legal-<token>), the requester's own
// requests in My Submissions, and Legal's board. Contract: docs/legal-api.md "Requests"; the web client is
// apps/web/src/lib/legal-requests-api.ts. Tolerant decoding like LegalModels.swift. Foundation only.
// ─────────────────────────────────────────────────────────────────────────────

extension KeyedDecodingContainer {
    fileprivate func rv<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }
    fileprivate func ro<T: Decodable>(_ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }
}

enum LegalRequestLinks {
    /// "/f/legal-<24 letters/digits>" is a Legal request link; any other id under /f/ is a form.
    static func isLinkId(_ id: String) -> Bool {
        guard id.hasPrefix("legal-") else { return false }
        let token = id.dropFirst(6)
        return token.count == 24 && token.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }
}

/// Any JSON value: a request's field values come back as whatever the requester typed (text, numbers, a
/// switch, table rows), and become `LegalValue`s for the New document form.
indirect enum LegalJSON: Decodable, Equatable {
    case string(String), number(Double), bool(Bool), array([LegalJSON]), object([String: LegalJSON]), null

    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([LegalJSON].self) { self = .array(a) }
        else if let o = try? c.decode([String: LegalJSON].self) { self = .object(o) }
        else { self = .null }
    }

    /// As text: "25000000" for a number (no ".0"), the string as is.
    var text: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
        case .bool(let b): return b ? "true" : "false"
        default: return nil
        }
    }

    var legalValue: LegalValue? {
        switch self {
        case .bool(let b): return .bool(b)
        case .array(let rows):
            return .rows(rows.compactMap { row in
                guard case .object(let o) = row else { return nil }
                return o.compactMapValues { $0.legalValue }
            })
        case .null, .object: return nil
        default: return text.map { .text($0) }
        }
    }

    static func values(_ dict: [String: LegalJSON]) -> [String: LegalValue] { dict.compactMapValues { $0.legalValue } }
}

// MARK: - The form

struct LegalRequestFormTemplate: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String
    let docType: String
    let companyId: String?
    let isAddendum: Bool
    /// All optional for the requester.
    let fields: [LegalField]
    private enum K: String, CodingKey { case id, name, description, docType, companyId, isAddendum, fields }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.rv(.id, ""); name = c.rv(.name, ""); description = c.rv(.description, ""); docType = c.rv(.docType, "OTHER")
        companyId = c.ro(.companyId); isAddendum = c.rv(.isAddendum, false); fields = c.rv(.fields, [])
    }
}

struct LegalRequestCompany: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    private enum K: String, CodingKey { case id, name }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.rv(.id, ""); name = c.rv(.name, "")
    }
}

struct LegalRequestFormInfo: Decodable {
    /// The company the link fixes, or nil (the general link: picked in the form).
    let lockedCompany: LegalRequestCompany?
    let accepting: Bool
    let signedIn: Bool
    let companies: [LegalRequestCompany]
    let templates: [LegalRequestFormTemplate]
    private enum K: String, CodingKey { case link, signedIn, companies, templates }
    private enum L: String, CodingKey { case company, accepting }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        let l = try? c.nestedContainer(keyedBy: L.self, forKey: .link)
        lockedCompany = l?.ro(.company); accepting = l?.rv(.accepting, false) ?? false
        signedIn = c.rv(.signedIn, false); companies = c.rv(.companies, []); templates = c.rv(.templates, [])
    }
}

struct LegalRequestSent: Decodable {
    let id: String
    private enum K: String, CodingKey { case id }
    init(from d: Decoder) throws { id = try d.container(keyedBy: K.self).decode(String.self, forKey: .id) }
}

// MARK: - The requester's own requests

struct LegalRequestAttachment: Decodable, Identifiable, Hashable {
    let id: String
    let fileName: String
    let mimeType: String
    let size: Int
    private enum K: String, CodingKey { case id, fileName, mimeType, size }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.rv(.id, ""); fileName = c.rv(.fileName, ""); mimeType = c.rv(.mimeType, ""); size = c.rv(.size, 0)
    }
}

struct LegalRequestAnswer: Decodable, Identifiable {
    let name: String
    let label: String
    let type: String
    let value: LegalJSON
    let columns: [LegalField]
    var id: String { name }
    private enum K: String, CodingKey { case name, label, type, value, columns }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        name = c.rv(.name, ""); label = c.rv(.label, ""); type = c.rv(.type, "text"); value = c.rv(.value, .null); columns = c.rv(.columns, [])
    }
}

/// One of my requests (GET /api/legal-requests/mine[/id]).
struct MyLegalRequest: Decodable, Identifiable {
    struct Doc: Decodable { let number: String; let title: String; let status: String }
    let id: String
    let createdAt: String?
    let company: LegalRequestCompany?
    let templateName: String
    let docType: String
    let isAddendum: Bool
    let parentNumberText: String
    /// YYYY-MM-DD
    let deadline: String?
    /// RECEIVED | IN_PROGRESS | REVISION | FINAL | SIGNED | DONE | REJECTED
    let stage: String
    let rejectReason: String?
    let pic: LegalPerson?
    /// The document this request produced (only that one).
    let document: Doc?
    let canDownload: Bool
    let purpose: String
    let attachments: [LegalRequestAttachment]
    let project: LegalProjectRef?
    let deal: LegalDealRef?
    let answers: [LegalRequestAnswer]
    private enum K: String, CodingKey {
        case id, createdAt, company, templateName, docType, isAddendum, parentNumberText, deadline, stage, rejectReason, pic
        case document, canDownload, purpose, attachments, project, deal, answers
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.rv(.id, ""); createdAt = c.ro(.createdAt); company = c.ro(.company); templateName = c.rv(.templateName, "")
        docType = c.rv(.docType, "OTHER"); isAddendum = c.rv(.isAddendum, false); parentNumberText = c.rv(.parentNumberText, "")
        deadline = c.ro(.deadline); stage = c.rv(.stage, "RECEIVED"); rejectReason = c.ro(.rejectReason); pic = c.ro(.pic)
        document = c.ro(.document); canDownload = c.rv(.canDownload, false); purpose = c.rv(.purpose, "")
        attachments = c.rv(.attachments, []); project = c.ro(.project); deal = c.ro(.deal); answers = c.rv(.answers, [])
    }
}

struct MyLegalRequestsResponse: Decodable {
    let requests: [MyLegalRequest]
    private enum K: String, CodingKey { case requests }
    init(from d: Decoder) throws { requests = try d.container(keyedBy: K.self).rv(.requests, []) }
}

struct MyLegalRequestResponse: Decodable {
    let request: MyLegalRequest
    private enum K: String, CodingKey { case request }
    init(from d: Decoder) throws { request = try d.container(keyedBy: K.self).decode(MyLegalRequest.self, forKey: .request) }
}

// MARK: - The board (Legal)

struct LegalBoardRequest: Decodable, Identifiable {
    struct Doc: Decodable { let id: String; let number: String; let title: String; let status: String }
    struct Parent: Decodable { let id: String; let number: String?; let title: String? }
    let id: String
    let createdAt: String?
    let requester: LegalPerson?
    let company: LegalCompanyRef?
    let templateId: String?
    let templateName: String
    let docType: String
    let isAddendum: Bool
    let parentNumberText: String
    let parent: Parent?
    let deadline: String?
    /// TODO | IN_PROGRESS | DONE
    let column: String
    let stage: String
    let rejected: Bool
    let rejectReason: String
    let pic: LegalPerson?
    let document: Doc?
    let purpose: String
    let attachments: [LegalRequestAttachment]
    let project: LegalProjectRef?
    let deal: LegalDealRef?
    let linkHidden: Bool
    let fieldValues: [String: LegalJSON]
    let fields: [LegalField]
    private enum K: String, CodingKey {
        case id, createdAt, requester, company, templateId, templateName, docType, isAddendum, parentNumberText, parent, deadline
        case column, stage, rejected, rejectReason, pic, document, purpose, attachments, project, deal, linkHidden, fieldValues, fields
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.rv(.id, ""); createdAt = c.ro(.createdAt); requester = c.ro(.requester); company = c.ro(.company)
        templateId = c.ro(.templateId); templateName = c.rv(.templateName, ""); docType = c.rv(.docType, "OTHER")
        isAddendum = c.rv(.isAddendum, false); parentNumberText = c.rv(.parentNumberText, ""); parent = c.ro(.parent)
        deadline = c.ro(.deadline); column = c.rv(.column, "TODO"); stage = c.rv(.stage, "RECEIVED"); rejected = c.rv(.rejected, false)
        rejectReason = c.rv(.rejectReason, ""); pic = c.ro(.pic); document = c.ro(.document); purpose = c.rv(.purpose, "")
        attachments = c.rv(.attachments, []); project = c.ro(.project); deal = c.ro(.deal); linkHidden = c.rv(.linkHidden, false)
        fieldValues = c.rv(.fieldValues, [:]); fields = c.rv(.fields, [])
    }

    /// The deadline has passed and the card isn't done.
    var overdue: Bool {
        guard let deadline, column != "DONE" else { return false }
        return deadline < LegalRequestDay.today()
    }
}

struct LegalBoardResponse: Decodable {
    let requests: [LegalBoardRequest]
    private enum K: String, CodingKey { case requests }
    init(from d: Decoder) throws { requests = try d.container(keyedBy: K.self).rv(.requests, []) }
}

struct LegalRequestPrefill: Decodable {
    let requestId: String
    let templateId: String?
    let companyId: String
    let isAddendum: Bool
    let parentDocumentId: String?
    let values: [String: LegalJSON]
    let projectId: String?
    let dealId: String?
    private enum K: String, CodingKey { case requestId, templateId, companyId, isAddendum, parentDocumentId, values, projectId, dealId }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        requestId = c.rv(.requestId, ""); templateId = c.ro(.templateId); companyId = c.rv(.companyId, ""); isAddendum = c.rv(.isAddendum, false)
        parentDocumentId = c.ro(.parentDocumentId); values = c.rv(.values, [:]); projectId = c.ro(.projectId); dealId = c.ro(.dealId)
    }
}

struct LegalBoardDetail: Decodable {
    let request: LegalBoardRequest
    let prefill: LegalRequestPrefill?
    private enum K: String, CodingKey { case request, prefill }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        request = try c.decode(LegalBoardRequest.self, forKey: .request); prefill = c.ro(.prefill)
    }
}

struct LegalBoardOne: Decodable {
    let request: LegalBoardRequest
    private enum K: String, CodingKey { case request }
    init(from d: Decoder) throws { request = try d.container(keyedBy: K.self).decode(LegalBoardRequest.self, forKey: .request) }
}

struct LegalRequestLink: Decodable, Identifiable {
    let scope: String
    let company: LegalCompanyRef?
    /// "/f/legal-<token>"
    let path: String
    let accepting: Bool
    let rotatedAt: String?
    var id: String { scope }
    private enum K: String, CodingKey { case scope, company, path, accepting, rotatedAt }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        scope = c.rv(.scope, ""); company = c.ro(.company); path = c.rv(.path, ""); accepting = c.rv(.accepting, false); rotatedAt = c.ro(.rotatedAt)
    }
}

struct LegalRequestLinksResponse: Decodable {
    let links: [LegalRequestLink]
    private enum K: String, CodingKey { case links }
    init(from d: Decoder) throws { links = try d.container(keyedBy: K.self).rv(.links, []) }
}

struct LegalRequestLinkResponse: Decodable {
    let link: LegalRequestLink
    private enum K: String, CodingKey { case link }
    init(from d: Decoder) throws { link = try d.container(keyedBy: K.self).decode(LegalRequestLink.self, forKey: .link) }
}

/// Board filters (GET /api/legal/requests).
struct LegalBoardQuery: Equatable {
    var q = ""
    var docType: String?
    var companyId: String?
    /// A Legal member's id, or "none" (unassigned).
    var picId: String?
    /// overdue | week | none
    var deadline: String?
    var filtered: Bool { [docType, companyId, picId, deadline].contains { !($0 ?? "").isEmpty } }
}

enum LegalRequestDay {
    /// Today in Jakarta, YYYY-MM-DD.
    static func today() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}
