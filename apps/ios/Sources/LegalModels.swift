import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Legal (owner, 14 Oct 2026): invitation-only document assembly + archive. The contract is
// docs/legal-api.md; the web client is apps/web/src/lib/legal-api.ts. Every model decodes tolerantly
// (a missing or mistyped field falls back to a neutral value) so an older or newer server never blanks a
// screen. Foundation only, on purpose: Tests/LegalModels compiles this file alone with swiftc.
// ─────────────────────────────────────────────────────────────────────────────

extension KeyedDecodingContainer {
    /// The field when it is there and of the right type, otherwise `fallback`.
    fileprivate func lv<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }
    /// The field when it is there and of the right type, otherwise nil.
    fileprivate func lo<T: Decodable>(_ key: Key) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }
}

/// Someone named on a row: who invited, who authored a version.
struct LegalPerson: Decodable, Hashable {
    let id: String
    let name: String
    let avatar: String?
    private enum K: String, CodingKey { case id, name, avatar }
    init(id: String, name: String, avatar: String? = nil) { self.id = id; self.name = name; self.avatar = avatar }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); name = c.lv(.name, ""); avatar = c.lo(.avatar)
    }
}

/// Who may invite whom: the owner anyone, an invited BoD member staff, everyone else nobody.
enum LegalInvitePower: String {
    case any = "ANY", staff = "STAFF", none = "NONE"
    init(raw: String?) { self = LegalInvitePower(rawValue: raw ?? "") ?? .none }
    var canInvite: Bool { self != .none }
}

// MARK: - Access & members

struct LegalMe: Decodable {
    let access: Bool
    let isRoot: Bool
    let invitePower: LegalInvitePower
    private enum K: String, CodingKey { case access, isRoot, invitePower }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        access = c.lv(.access, false); isRoot = c.lv(.isRoot, false)
        invitePower = LegalInvitePower(raw: c.lo(.invitePower))
    }
}

struct LegalMember: Decodable, Identifiable {
    let userId: String
    let name: String
    let email: String
    let avatar: String?
    let orgRole: String?
    let isRoot: Bool
    let active: Bool
    let invitedAt: String?
    let invitedBy: LegalPerson?
    let revokedAt: String?
    let revokedBy: LegalPerson?
    let canRevoke: Bool
    let invitePower: LegalInvitePower
    var id: String { userId }
    private enum K: String, CodingKey {
        case userId, name, email, avatar, orgRole, isRoot, active, invitedAt, invitedBy, revokedAt, revokedBy, canRevoke, invitePower
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        userId = c.lv(.userId, ""); name = c.lv(.name, ""); email = c.lv(.email, ""); avatar = c.lo(.avatar)
        orgRole = c.lo(.orgRole); isRoot = c.lv(.isRoot, false); active = c.lv(.active, false)
        invitedAt = c.lo(.invitedAt); invitedBy = c.lo(.invitedBy); revokedAt = c.lo(.revokedAt); revokedBy = c.lo(.revokedBy)
        canRevoke = c.lv(.canRevoke, false); invitePower = LegalInvitePower(raw: c.lo(.invitePower))
    }
}

struct LegalMembersResponse: Decodable {
    let members: [LegalMember]
    let invitePower: LegalInvitePower
    private enum K: String, CodingKey { case members, invitePower }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        members = c.lv(.members, []); invitePower = LegalInvitePower(raw: c.lo(.invitePower))
    }
}

struct LegalCandidate: Decodable, Identifiable {
    let userId: String
    let name: String
    let email: String
    let avatar: String?
    let orgRole: String?
    var id: String { userId }
    private enum K: String, CodingKey { case userId, name, email, avatar, orgRole }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        userId = c.lv(.userId, ""); name = c.lv(.name, ""); email = c.lv(.email, ""); avatar = c.lo(.avatar); orgRole = c.lo(.orgRole)
    }
}

struct LegalCandidatesResponse: Decodable {
    let candidates: [LegalCandidate]
    private enum K: String, CodingKey { case candidates }
    init(from d: Decoder) throws { candidates = try d.container(keyedBy: K.self).lv(.candidates, []) }
}

// MARK: - Companies & numbering

struct LegalSeries: Decodable, Identifiable, Hashable {
    let id: String
    let key: String
    let docType: String
    let label: String
    let format: String
    /// "YEAR" or "MONTH".
    let resetPeriod: String
    let active: Bool
    private enum K: String, CodingKey { case id, key, docType, label, format, resetPeriod, active }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); key = c.lv(.key, ""); docType = c.lv(.docType, "OTHER"); label = c.lv(.label, "")
        format = c.lv(.format, ""); resetPeriod = c.lv(.resetPeriod, "YEAR"); active = c.lv(.active, true)
    }
}

struct LegalCompany: Decodable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let legalName: String
    let address: String
    let hasKop: Bool
    let kopFileName: String?
    let kopUpdatedAt: String?
    let active: Bool
    let documentCount: Int
    let series: [LegalSeries]
    private enum K: String, CodingKey { case id, code, name, legalName, address, hasKop, kopFileName, kopUpdatedAt, active, documentCount, series }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); code = c.lv(.code, ""); name = c.lv(.name, ""); legalName = c.lv(.legalName, "")
        address = c.lv(.address, ""); hasKop = c.lv(.hasKop, false); kopFileName = c.lo(.kopFileName)
        kopUpdatedAt = c.lo(.kopUpdatedAt); active = c.lv(.active, true); documentCount = c.lv(.documentCount, 0)
        series = c.lv(.series, [])
    }
}

struct LegalCompaniesResponse: Decodable {
    let companies: [LegalCompany]
    private enum K: String, CodingKey { case companies }
    init(from d: Decoder) throws { companies = try d.container(keyedBy: K.self).lv(.companies, []) }
}

struct LegalCompanyResponse: Decodable { let company: LegalCompany }
struct LegalSeriesResponse: Decodable { let series: LegalSeries }

/// GET /api/legal/series/:id — how many numbers the series has issued, and today's next one.
struct LegalSeriesInfo: Decodable {
    let series: LegalSeries
    let issued: Int
    let next: String
    private enum K: String, CodingKey { case series, issued, next }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        series = try c.decode(LegalSeries.self, forKey: .series); issued = c.lv(.issued, 0); next = c.lv(.next, "")
    }
}

// MARK: - Templates

/// One form field of a template. A `list` field's value is an array of rows keyed by its `columns`.
struct LegalField: Codable, Hashable, Identifiable {
    var name: String
    var label: String
    /// text | longtext | date | number | money | select | boolean | list
    var type: String
    var required: Bool
    var help: String?
    var options: [String]?
    var columns: [LegalField]?
    var id: String { name }

    static let scalarTypes = ["text", "longtext", "date", "number", "money", "select"]
    /// The document date: asked in every form, it decides the number's month and year. Its type and
    /// required flag are fixed.
    static let documentDate = "TANGGAL_DOKUMEN"

    init(name: String, label: String, type: String, required: Bool, help: String? = nil, options: [String]? = nil, columns: [LegalField]? = nil) {
        self.name = name; self.label = label; self.type = type; self.required = required
        self.help = help; self.options = options; self.columns = columns
    }
    private enum K: String, CodingKey { case name, label, type, required, help, options, columns }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        name = c.lv(.name, ""); label = c.lv(.label, ""); type = c.lv(.type, "text"); required = c.lv(.required, false)
        help = c.lo(.help); options = c.lo(.options); columns = c.lo(.columns)
        if label.isEmpty { label = name }
    }
    func encode(to e: Encoder) throws {
        var c = e.container(keyedBy: K.self)
        try c.encode(name, forKey: .name); try c.encode(label, forKey: .label); try c.encode(type, forKey: .type)
        try c.encode(required, forKey: .required)
        try c.encodeIfPresent(help, forKey: .help); try c.encodeIfPresent(options, forKey: .options)
        try c.encodeIfPresent(columns, forKey: .columns)
    }

    /// The fields as a JSON array for JSONSerialization (the PATCH body is built as a dictionary).
    static func jsonArray(_ fields: [LegalField]) -> Any {
        guard let data = try? JSONEncoder().encode(fields),
              let any = try? JSONSerialization.jsonObject(with: data) else { return [Any]() }
        return any
    }
}

struct LegalCompanyRef: Decodable, Hashable {
    let id: String
    let code: String
    let name: String
    private enum K: String, CodingKey { case id, code, name }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); code = c.lv(.code, ""); name = c.lv(.name, "")
    }
}

struct LegalSeriesRef: Decodable, Hashable {
    let id: String
    let key: String
    let label: String
    let format: String
    private enum K: String, CodingKey { case id, key, label, format }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); key = c.lv(.key, ""); label = c.lv(.label, ""); format = c.lv(.format, "")
    }
}

struct LegalTemplateVersion: Decodable, Identifiable {
    let version: Int
    let fileName: String
    let size: Int
    let note: String
    let fieldCount: Int
    let createdBy: LegalPerson?
    let createdAt: String?
    var id: Int { version }
    private enum K: String, CodingKey { case version, fileName, size, note, fieldCount, createdBy, createdAt }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        version = c.lv(.version, 0); fileName = c.lv(.fileName, ""); size = c.lv(.size, 0); note = c.lv(.note, "")
        fieldCount = c.lv(.fieldCount, 0); createdBy = c.lo(.createdBy); createdAt = c.lo(.createdAt)
    }
}

struct LegalTemplate: Decodable, Identifiable {
    let id: String
    let name: String
    let description: String
    let docType: String
    let company: LegalCompanyRef?
    let series: LegalSeriesRef?
    let currentVersion: Int
    let archived: Bool
    let fields: [LegalField]
    let createdBy: LegalPerson?
    let createdAt: String?
    let updatedAt: String?
    let versions: [LegalTemplateVersion]
    private enum K: String, CodingKey { case id, name, description, docType, company, series, currentVersion, archived, fields, createdBy, createdAt, updatedAt, versions }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); name = c.lv(.name, ""); description = c.lv(.description, ""); docType = c.lv(.docType, "OTHER")
        company = c.lo(.company); series = c.lo(.series); currentVersion = c.lv(.currentVersion, 1)
        archived = c.lv(.archived, false); fields = c.lv(.fields, []); createdBy = c.lo(.createdBy)
        createdAt = c.lo(.createdAt); updatedAt = c.lo(.updatedAt); versions = c.lv(.versions, [])
    }
}

struct LegalTemplatesResponse: Decodable {
    let templates: [LegalTemplate]
    private enum K: String, CodingKey { case templates }
    init(from d: Decoder) throws { templates = try d.container(keyedBy: K.self).lv(.templates, []) }
}

struct LegalTemplateResponse: Decodable { let template: LegalTemplate }

// MARK: - Documents

struct LegalProjectRef: Decodable, Hashable {
    let id: String
    let name: String
    private enum K: String, CodingKey { case id, name }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); name = c.lv(.name, "")
    }
}

struct LegalDealRef: Decodable, Hashable {
    let id: String
    let code: String
    let name: String
    let projectId: String?
    let brand: String?
    private enum K: String, CodingKey { case id, code, name, projectId, brand }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); code = c.lv(.code, ""); name = c.lv(.name, ""); projectId = c.lo(.projectId); brand = c.lo(.brand)
    }
}

/// Another document a document points at: its parent, an addendum, the one that took its number.
struct LegalDocRef: Decodable, Hashable, Identifiable {
    let id: String
    let number: String
    let title: String
    let status: String?
    let docType: String?
    let docDate: String?
    let signedAt: String?
    let numberReleased: Bool
    private enum K: String, CodingKey { case id, number, title, status, docType, docDate, signedAt, numberReleased }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); number = c.lv(.number, ""); title = c.lv(.title, ""); status = c.lo(.status); docType = c.lo(.docType)
        docDate = c.lo(.docDate); signedAt = c.lo(.signedAt); numberReleased = c.lv(.numberReleased, false)
    }
}

/// One archive row.
struct LegalDocumentSummary: Decodable, Identifiable {
    let id: String
    let number: String
    let docType: String
    let title: String
    let counterparty: String
    /// YYYY-MM-DD
    let docDate: String?
    let status: String
    /// GENERATED or UPLOADED
    let source: String
    let company: LegalCompanyRef?
    let project: LegalProjectRef?
    let deal: LegalDealRef?
    let currentVersion: Int
    let createdBy: LegalPerson?
    let createdAt: String?
    let updatedAt: String?
    /// Linked to a project or deal this viewer can't open (project / deal then come back null).
    let linkHidden: Bool
    /// The signed copy: when it was uploaded and by whom.
    let signedAt: String?
    let signedBy: LegalPerson?
    /// Voided before it was signed: the number went back to its series (and maybe to `numberReusedBy`).
    let numberReleased: Bool
    let numberReusedBy: LegalDocRef?
    /// An addendum: the signed document it amends.
    let parent: LegalDocRef?
    let addendumNo: Int?
    let addendaCount: Int
    private enum K: String, CodingKey {
        case id, number, docType, title, counterparty, docDate, status, source, company, project, deal, currentVersion, createdBy, createdAt, updatedAt, linkHidden
        case signedAt, signedBy, numberReleased, numberReusedBy, parent, addendumNo, addendaCount
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); number = c.lv(.number, ""); docType = c.lv(.docType, "OTHER"); title = c.lv(.title, "")
        counterparty = c.lv(.counterparty, ""); docDate = c.lo(.docDate); status = c.lv(.status, "DRAFT")
        source = c.lv(.source, "GENERATED"); company = c.lo(.company); project = c.lo(.project); deal = c.lo(.deal)
        currentVersion = c.lv(.currentVersion, 1); createdBy = c.lo(.createdBy); createdAt = c.lo(.createdAt); updatedAt = c.lo(.updatedAt)
        linkHidden = c.lv(.linkHidden, false)
        signedAt = c.lo(.signedAt); signedBy = c.lo(.signedBy); numberReleased = c.lv(.numberReleased, false)
        numberReusedBy = c.lo(.numberReusedBy); parent = c.lo(.parent); addendumNo = c.lo(.addendumNo); addendaCount = c.lv(.addendaCount, 0)
    }
}

struct LegalDocumentsPage: Decodable {
    let documents: [LegalDocumentSummary]
    let total: Int
    let page: Int
    let pageSize: Int
    private enum K: String, CodingKey { case documents, total, page, pageSize }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        documents = c.lv(.documents, []); total = c.lv(.total, documents.count); page = c.lv(.page, 1); pageSize = c.lv(.pageSize, 50)
    }
}

struct LegalDocVersion: Decodable, Identifiable {
    let version: Int
    /// GENERATED | MANUAL | GIDEON | UPLOAD | RESTORE
    let kind: String
    let fileName: String
    let mimeType: String
    let size: Int
    let hasDocx: Bool
    let hasPdf: Bool
    let hasFile: Bool
    let note: String
    let author: LegalPerson?
    let createdAt: String?
    /// "REV n" / "FINAL" / "SIGNED"; the download is named "<number> - <title> <label>" (owner, 14 Oct 2026).
    let label: String
    let downloadName: String
    var id: Int { version }
    private enum K: String, CodingKey { case version, kind, fileName, mimeType, size, hasDocx, hasPdf, hasFile, note, author, createdAt, label, downloadName }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        version = c.lv(.version, 0); kind = c.lv(.kind, "GENERATED"); fileName = c.lv(.fileName, ""); mimeType = c.lv(.mimeType, "")
        size = c.lv(.size, 0); hasDocx = c.lv(.hasDocx, false); hasPdf = c.lv(.hasPdf, false); hasFile = c.lv(.hasFile, false)
        note = c.lv(.note, ""); author = c.lo(.author); createdAt = c.lo(.createdAt)
        label = c.lv(.label, "REV \(version)"); downloadName = c.lv(.downloadName, "")
    }

    /// What the share sheet calls this file: the server's name for it, with the format's extension.
    func shareName(_ format: String) -> String? {
        guard !downloadName.isEmpty else { return nil }
        let ext: String
        switch format {
        case "docx": ext = "docx"
        case "pdf": ext = "pdf"
        default: ext = (fileName as NSString).pathExtension.lowercased()
        }
        return ext.isEmpty ? downloadName : "\(downloadName).\(ext)"
    }
}

struct LegalTemplateUse: Decodable, Hashable {
    let id: String
    let name: String
    let version: Int
    private enum K: String, CodingKey { case id, name, version }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); name = c.lv(.name, ""); version = c.lv(.version, 1)
    }
}

/// One document: the archive row plus its notes, numbering, template and versions.
struct LegalDocument: Decodable, Identifiable {
    let id: String
    let number: String
    let docType: String
    let title: String
    let counterparty: String
    let docDate: String?
    let status: String
    let source: String
    let company: LegalCompanyRef?
    let project: LegalProjectRef?
    let deal: LegalDealRef?
    let currentVersion: Int
    let createdBy: LegalPerson?
    let createdAt: String?
    let updatedAt: String?
    let notes: String
    let series: LegalSeriesRef?
    let template: LegalTemplateUse?
    let finalVersion: Int?
    let hasNumber: Bool
    let updatedBy: LegalPerson?
    let versions: [LegalDocVersion]
    /// Linked to a project or deal this viewer can't open (project / deal then come back null).
    let linkHidden: Bool
    let signedAt: String?
    let signedBy: LegalPerson?
    /// The signed copy's version: the primary download once signed.
    let signedVersion: Int?
    let numberReleased: Bool
    let numberReusedBy: LegalDocRef?
    let numberReusedFrom: [LegalDocRef]
    let parent: LegalDocRef?
    let addendumNo: Int?
    let addenda: [LegalDocRef]
    private enum K: String, CodingKey {
        case id, number, docType, title, counterparty, docDate, status, source, company, project, deal, currentVersion, createdBy, createdAt, updatedAt
        case notes, series, template, finalVersion, hasNumber, updatedBy, versions, linkHidden
        case signedAt, signedBy, signedVersion, numberReleased, numberReusedBy, numberReusedFrom, parent, addendumNo, addenda
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); number = c.lv(.number, ""); docType = c.lv(.docType, "OTHER"); title = c.lv(.title, "")
        counterparty = c.lv(.counterparty, ""); docDate = c.lo(.docDate); status = c.lv(.status, "DRAFT")
        source = c.lv(.source, "GENERATED"); company = c.lo(.company); project = c.lo(.project); deal = c.lo(.deal)
        currentVersion = c.lv(.currentVersion, 1); createdBy = c.lo(.createdBy); createdAt = c.lo(.createdAt); updatedAt = c.lo(.updatedAt)
        notes = c.lv(.notes, ""); series = c.lo(.series); template = c.lo(.template); finalVersion = c.lo(.finalVersion)
        hasNumber = c.lv(.hasNumber, false); updatedBy = c.lo(.updatedBy); versions = c.lv(.versions, [])
        linkHidden = c.lv(.linkHidden, false)
        signedAt = c.lo(.signedAt); signedBy = c.lo(.signedBy); signedVersion = c.lo(.signedVersion)
        numberReleased = c.lv(.numberReleased, false); numberReusedBy = c.lo(.numberReusedBy); numberReusedFrom = c.lv(.numberReusedFrom, [])
        parent = c.lo(.parent); addendumNo = c.lo(.addendumNo); addenda = c.lv(.addenda, [])
    }

    /// SIGNED: no edits, no GIDEON, no new versions (the server refuses them too).
    var isLocked: Bool { status == "SIGNED" }
    /// Voiding gives the number back to its series only when the document holds one and was never signed.
    var voidReleasesNumber: Bool { hasNumber && signedAt == nil && status != "SIGNED" }
    /// The statuses a person may pick now (owner, 14 Oct 2026): VOID is one-way, SIGNED is locked and only
    /// voided, and a generated document becomes SIGNED only by uploading its signed copy.
    var statusChoices: [String] { LegalDocument.statusChoices(status: status, source: source) }
    static func statusChoices(status: String, source: String) -> [String] {
        switch status {
        case "VOID": return ["VOID"]
        case "SIGNED": return ["SIGNED", "VOID"]
        default: return ["DRAFT", "FINAL", "SENT", "SIGNED", "VOID"].filter { $0 != "SIGNED" || source == "UPLOADED" }
        }
    }
    /// "Upload signed copy" is offered on a final or sent document.
    var canUploadSignedCopy: Bool { status == "FINAL" || status == "SENT" }

    /// The version whose files the document shows: the signed copy once there is one, else the final one
    /// once marked, else the newest.
    var shownVersion: LegalDocVersion? {
        let v = signedVersion ?? finalVersion ?? currentVersion
        return versions.first { $0.version == v } ?? versions.first
    }
    var current: LegalDocVersion? { versions.first { $0.version == currentVersion } }
    /// Word versions whose PDF the server is still making in the background (owner, 14 Oct 2026: the PDF
    /// comes after generate / save / upload / approve). Counted only for 3 minutes after the version was made,
    /// after which a missing PDF is taken as not coming.
    func versionsAwaitingPdf(now: Date = Date(), within: TimeInterval = 180) -> [LegalDocVersion] {
        versions.filter { v in
            guard v.hasDocx, !v.hasPdf, let made = v.createdAt.flatMap(LegalDocument.parseTimestamp) else { return false }
            return now.timeIntervalSince(made) < within
        }
    }

    static func parseTimestamp(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
    /// The Word versions, oldest first — what Review and Compare can read.
    var wordVersions: [Int] { versions.filter(\.hasDocx).map(\.version).sorted() }
}

struct LegalDocumentResponse: Decodable { let document: LegalDocument }

/// POST /api/legal/documents/prepare — the form, the company and series it will use, the next number.
struct LegalPrepared: Decodable {
    struct Template: Decodable {
        let id: String; let name: String; let docType: String; let version: Int
        private enum K: String, CodingKey { case id, name, docType, version }
        init(from d: Decoder) throws {
            let c = try d.container(keyedBy: K.self)
            id = c.lv(.id, ""); name = c.lv(.name, ""); docType = c.lv(.docType, "OTHER"); version = c.lv(.version, 1)
        }
    }
    struct Company: Decodable {
        let id: String; let code: String; let name: String; let hasKop: Bool
        private enum K: String, CodingKey { case id, code, name, hasKop }
        init(from d: Decoder) throws {
            let c = try d.container(keyedBy: K.self)
            id = c.lv(.id, ""); code = c.lv(.code, ""); name = c.lv(.name, ""); hasKop = c.lv(.hasKop, false)
        }
    }
    struct Series: Decodable {
        let id: String; let key: String; let label: String; let format: String; let resetPeriod: String
        private enum K: String, CodingKey { case id, key, label, format, resetPeriod }
        init(from d: Decoder) throws {
            let c = try d.container(keyedBy: K.self)
            id = c.lv(.id, ""); key = c.lv(.key, ""); label = c.lv(.label, ""); format = c.lv(.format, ""); resetPeriod = c.lv(.resetPeriod, "YEAR")
        }
    }
    /// An addendum's parent and the n it would get.
    struct Parent: Decodable {
        let id: String; let number: String; let title: String; let addendumNo: Int
        private enum K: String, CodingKey { case id, number, title, addendumNo }
        init(from d: Decoder) throws {
            let c = try d.container(keyedBy: K.self)
            id = c.lv(.id, ""); number = c.lv(.number, ""); title = c.lv(.title, ""); addendumNo = c.lv(.addendumNo, 1)
        }
    }
    /// A prefilled value: text or a number, read as the text the form edits.
    private struct Scalar: Decodable {
        let text: String?
        init(from d: Decoder) throws {
            let c = try d.singleValueContainer()
            if let s = try? c.decode(String.self) { text = s }
            else if let i = try? c.decode(Int.self) { text = String(i) }
            else if let n = try? c.decode(Double.self) { text = String(n) }
            else { text = nil }
        }
    }
    let template: Template?
    let company: Company?
    let series: Series?
    let fields: [LegalField]
    let numberPreview: String
    let parent: Parent?
    /// Starting values (an addendum's parties, from its parent).
    let prefill: [String: String]
    private enum K: String, CodingKey { case template, company, series, fields, numberPreview, parent, prefill }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        template = c.lo(.template); company = c.lo(.company); series = c.lo(.series)
        fields = c.lv(.fields, []); numberPreview = c.lv(.numberPreview, "")
        parent = c.lo(.parent)
        let raw: [String: Scalar] = c.lv(.prefill, [:])
        prefill = raw.compactMapValues(\.text)
    }
}

struct LegalGenerated: Decodable {
    let id: String
    let number: String
    let pdfError: String?
    private enum K: String, CodingKey { case id, number, pdfError }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = try c.decode(String.self, forKey: .id); number = c.lv(.number, ""); pdfError = c.lo(.pdfError)
    }
}

struct LegalUploaded: Decodable {
    let id: String
    let pdfError: String?
    private enum K: String, CodingKey { case id, pdfError }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = try c.decode(String.self, forKey: .id); pdfError = c.lo(.pdfError)
    }
}

/// A new version (edits, an upload, a restore).
struct LegalVersionCreated: Decodable {
    let version: Int
    let pdfError: String?
    private enum K: String, CodingKey { case version, pdfError }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        version = c.lv(.version, 0); pdfError = c.lo(.pdfError)
    }
}

struct LegalLinks: Decodable {
    let projects: [LegalProjectRef]
    let deals: [LegalDealRef]
    private enum K: String, CodingKey { case projects, deals }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        projects = c.lv(.projects, []); deals = c.lv(.deals, [])
    }
}

// MARK: - Review, versions, GIDEON

struct LegalParagraph: Decodable, Identifiable {
    let index: Int
    let text: String
    let editable: Bool
    /// "number" or "complex" when locked; "empty" for a blank line, which the editor does not draw.
    let lockReason: String?
    let style: String?
    let inTable: Bool
    var id: Int { index }
    /// A blank line (lockReason "empty", or an editable paragraph with no text): not drawn in Review & edit.
    var isBlank: Bool { lockReason == "empty" || (editable && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
    private enum K: String, CodingKey { case index, text, editable, lockReason, style, inTable }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        index = c.lv(.index, 0); text = c.lv(.text, ""); editable = c.lv(.editable, false)
        lockReason = c.lo(.lockReason); style = c.lo(.style); inTable = c.lv(.inTable, false)
    }
}

struct LegalParagraphsResponse: Decodable {
    let version: Int
    let current: Int
    let paragraphs: [LegalParagraph]
    private enum K: String, CodingKey { case version, current, paragraphs }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        version = c.lv(.version, 0); current = c.lv(.current, 0); paragraphs = c.lv(.paragraphs, [])
    }
}

/// A run of words: kept, removed (struck red) or added (green).
struct LegalSegment: Decodable, Equatable {
    /// "same" | "del" | "ins"
    let type: String
    let text: String
    init(type: String, text: String) { self.type = type; self.text = text }
    private enum K: String, CodingKey { case type, text }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        type = c.lv(.type, "same"); text = c.lv(.text, "")
    }
}

/// One paragraph of a compare, decoded by its `type`.
enum LegalParagraphDiff: Decodable {
    case same(a: Int, b: Int, text: String)
    case removed(a: Int, text: String)
    case added(b: Int, text: String)
    case changed(a: Int, b: Int, before: String, after: String, segments: [LegalSegment])

    private enum K: String, CodingKey { case type, a, b, text, before, after, segments }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        let type: String = c.lv(.type, "same")
        switch type {
        case "removed": self = .removed(a: c.lv(.a, 0), text: c.lv(.text, ""))
        case "added": self = .added(b: c.lv(.b, 0), text: c.lv(.text, ""))
        case "changed":
            self = .changed(a: c.lv(.a, 0), b: c.lv(.b, 0), before: c.lv(.before, ""), after: c.lv(.after, ""), segments: c.lv(.segments, []))
        default: self = .same(a: c.lv(.a, 0), b: c.lv(.b, 0), text: c.lv(.text, ""))
        }
    }
    var isSame: Bool { if case .same = self { return true } else { return false } }
}

struct LegalCompareResponse: Decodable {
    let a: Int
    let b: Int
    let diff: [LegalParagraphDiff]
    private enum K: String, CodingKey { case a, b, diff }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        a = c.lv(.a, 0); b = c.lv(.b, 0); diff = c.lv(.diff, [])
    }
}

struct LegalProposalChange: Decodable, Identifiable {
    let index: Int
    let before: String
    let after: String
    let segments: [LegalSegment]
    var id: Int { index }
    private enum K: String, CodingKey { case index, before, after, segments }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        index = c.lv(.index, 0); before = c.lv(.before, ""); after = c.lv(.after, ""); segments = c.lv(.segments, [])
    }
}

struct LegalProposal: Decodable, Identifiable {
    let id: String
    /// PENDING | CLARIFY | APPLYING | APPLIED | DISCARDED | FAILED
    let status: String
    let baseVersion: Int
    let instruction: String
    let question: String?
    let summary: String
    let changes: [LegalProposalChange]
    let appliedVersion: Int?
    let createdBy: LegalPerson?
    let decidedBy: LegalPerson?
    let decidedAt: String?
    let createdAt: String?
    private enum K: String, CodingKey { case id, status, baseVersion, instruction, question, summary, changes, appliedVersion, createdBy, decidedBy, decidedAt, createdAt }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        id = c.lv(.id, ""); status = c.lv(.status, "PENDING"); baseVersion = c.lv(.baseVersion, 0); instruction = c.lv(.instruction, "")
        question = c.lo(.question); summary = c.lv(.summary, ""); changes = c.lv(.changes, []); appliedVersion = c.lo(.appliedVersion)
        createdBy = c.lo(.createdBy); decidedBy = c.lo(.decidedBy); decidedAt = c.lo(.decidedAt); createdAt = c.lo(.createdAt)
    }
}

struct LegalProposalsResponse: Decodable {
    let proposals: [LegalProposal]
    private enum K: String, CodingKey { case proposals }
    init(from d: Decoder) throws { proposals = try d.container(keyedBy: K.self).lv(.proposals, []) }
}

struct LegalProposalResponse: Decodable { let proposal: LegalProposal }

struct LegalDecision: Decodable {
    let proposal: LegalProposal?
    let version: Int?
    let pdfError: String?
    private enum K: String, CodingKey { case proposal, version, pdfError }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        proposal = c.lo(.proposal); version = c.lo(.version); pdfError = c.lo(.pdfError)
    }
}

/// The 422 / 409 body of a Legal refusal: the sentence, plus per-field errors and a template's problems.
struct LegalErrorBody: Decodable {
    let error: String?
    let code: String?
    let fieldErrors: [String: String]
    let problems: [String]
    private enum K: String, CodingKey { case error, code, fieldErrors, problems }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        error = c.lo(.error); code = c.lo(.code); fieldErrors = c.lv(.fieldErrors, [:]); problems = c.lv(.problems, [])
    }
}

// MARK: - Form values

/// A value typed into a New document form: text (also numbers, money digits and YYYY-MM-DD dates), a
/// yes/no switch, or the rows of a table field.
enum LegalValue: Equatable {
    case text(String)
    case bool(Bool)
    case rows([[String: LegalValue]])

    var string: String {
        if case .text(let s) = self { return s }
        return ""
    }
    var rows: [[String: LegalValue]] {
        if case .rows(let r) = self { return r }
        return []
    }
    /// For JSONSerialization.
    var json: Any {
        switch self {
        case .text(let s): return s
        case .bool(let b): return b
        case .rows(let r): return r.map { row in row.mapValues { $0.json } }
        }
    }
    static func json(_ values: [String: LegalValue]) -> [String: Any] { values.mapValues { $0.json } }
}

// MARK: - Pure helpers (shared with the web: diff-words.ts, NewDocumentDialog.tsx, LegalFieldInput.tsx)

enum LegalText {
    /// Field names a number format reads ({KOTA} → KOTA), leaving out the built-in tokens.
    static func formatFields(_ format: String) -> [String] {
        guard let re = try? NSRegularExpression(pattern: "\\{([A-Z][A-Z0-9_]*)(?::\\d)?\\}") else { return [] }
        let ns = format as NSString
        let builtIn: Set<String> = ["SEQ", "ROMAWI", "MM", "BLN", "YYYY", "YY", "CO"]
        var out: [String] = []
        for m in re.matches(in: format, range: NSRange(location: 0, length: ns.length)) {
            let name = ns.substring(with: m.range(at: 1))
            if !builtIn.contains(name) && !out.contains(name) { out.append(name) }
        }
        return out
    }

    /// "25000000" → "25.000.000" while typing (Indonesian grouping, "," before up to two decimals).
    static func groupDigits(_ v: String) -> String {
        let kept = v.filter { $0.isASCII && ($0.isNumber || $0 == ",") }
        let parts = kept.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        var int = parts.first ?? ""
        while int.count > 1 && int.hasPrefix("0") { int.removeFirst() }
        var grouped = ""
        for (i, ch) in int.reversed().enumerated() {
            if i > 0 && i % 3 == 0 { grouped.append(".") }
            grouped.append(ch)
        }
        grouped = String(grouped.reversed())
        if parts.count > 1 { return grouped + "," + String(parts[1].filter { $0 != "," }.prefix(2)) }
        return grouped
    }

    /// "25.000.000,50" → "25000000.50": the value sent.
    static func ungroup(_ v: String) -> String {
        v.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".")
    }

    /// Today in Jakarta as YYYY-MM-DD (the default document date).
    static func todayJakarta(_ now: Date = Date()) -> String { dayString(now) }

    static let jakarta = TimeZone(identifier: "Asia/Jakarta") ?? TimeZone(secondsFromGMT: 7 * 3600)!

    /// A title that may be one long "word" (a file name: "03_SPK_City_Head_PATS_University.docx") gets a
    /// zero-width break opportunity after each _ . - /, so it wraps at those joins instead of mid-letter
    /// ("…University.doc / x", UI tour run 10, IP-2). For display only.
    static func wrappable(_ s: String) -> String {
        var out = ""
        out.reserveCapacity(s.count + 8)
        for ch in s {
            out.append(ch)
            if ch == "_" || ch == "." || ch == "-" || ch == "/" { out.append("\u{200B}") }
        }
        return out
    }

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = jakarta
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// A calendar day ↔ a Date at noon in Jakarta (noon, so no time zone shift moves it a day).
    static func dayString(_ date: Date) -> String { dayFormatter.string(from: date) }
    static func date(fromDay day: String) -> Date? {
        guard day.count >= 10, let d = dayFormatter.date(from: String(day.prefix(10))) else { return nil }
        return d.addingTimeInterval(12 * 3600)
    }

    /// Word-level diff of two texts: words and the spaces between them are the tokens. The same algorithm
    /// as the server's diffWords (src/lib/legal/diff.ts) and the web's diffWordsClient.
    static func diffWords(_ before: String, _ after: String) -> [LegalSegment] {
        let a = tokens(before)
        let b = tokens(after)
        let ops = lcsOps(a, b)
        let raw: [LegalSegment] = ops.map { op in LegalSegment(type: op.type, text: op.type == "ins" ? b[op.b] : a[op.a]) }
        var out: [LegalSegment] = []
        func push(_ type: String, _ text: String) {
            guard !text.isEmpty else { return }
            if let last = out.last, last.type == type {
                out[out.count - 1] = LegalSegment(type: type, text: last.text + text)
            } else {
                out.append(LegalSegment(type: type, text: text))
            }
        }
        var i = 0
        while i < raw.count {
            if raw[i].type == "same" { push("same", raw[i].text); i += 1; continue }
            var j = i
            var del = ""
            var ins = ""
            while true {
                while j < raw.count && raw[j].type != "same" {
                    if raw[j].type == "del" { del += raw[j].text } else { ins += raw[j].text }
                    j += 1
                }
                // Absorb a whitespace-only match only when another change follows it.
                if j + 1 < raw.count, isSpace(raw[j].text), raw[j + 1].type != "same" {
                    del += raw[j].text; ins += raw[j].text; j += 1
                    continue
                }
                break
            }
            push("del", del)
            push("ins", ins)
            i = j
        }
        return out
    }

    private static func isSpace(_ s: String) -> Bool { !s.isEmpty && s.allSatisfy { $0.isWhitespace } }

    private static func tokens(_ s: String) -> [String] {
        var out: [String] = []
        var cur = ""
        var curSpace: Bool?
        for ch in s {
            let sp = ch.isWhitespace
            if let c = curSpace, c != sp { out.append(cur); cur = "" }
            cur.append(ch)
            curSpace = sp
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    private struct Op { let type: String; let a: Int; let b: Int }

    /// Longest-common-subsequence walk over two token lists → same / del / ins runs.
    private static func lcsOps(_ a: [String], _ b: [String]) -> [Op] {
        let n = a.count, m = b.count
        var head = 0
        while head < n && head < m && a[head] == b[head] { head += 1 }
        var tail = 0
        while tail < n - head && tail < m - head && a[n - 1 - tail] == b[m - 1 - tail] { tail += 1 }
        let A = Array(a[head..<(n - tail)])
        let B = Array(b[head..<(m - tail)])
        let cols = B.count + 1
        var dp = [Int](repeating: 0, count: (A.count + 1) * cols)
        if !A.isEmpty && !B.isEmpty {
            for i in stride(from: A.count - 1, through: 0, by: -1) {
                for j in stride(from: B.count - 1, through: 0, by: -1) {
                    dp[i * cols + j] = A[i] == B[j] ? dp[(i + 1) * cols + j + 1] + 1 : max(dp[(i + 1) * cols + j], dp[i * cols + j + 1])
                }
            }
        }
        var out: [Op] = []
        for k in 0..<head { out.append(Op(type: "same", a: k, b: k)) }
        var i = 0, j = 0
        while i < A.count && j < B.count {
            if A[i] == B[j] { out.append(Op(type: "same", a: head + i, b: head + j)); i += 1; j += 1 }
            else if dp[(i + 1) * cols + j] >= dp[i * cols + j + 1] { out.append(Op(type: "del", a: head + i, b: 0)); i += 1 }
            else { out.append(Op(type: "ins", a: 0, b: head + j)); j += 1 }
        }
        while i < A.count { out.append(Op(type: "del", a: head + i, b: 0)); i += 1 }
        while j < B.count { out.append(Op(type: "ins", a: 0, b: head + j)); j += 1 }
        for k in 0..<tail { out.append(Op(type: "same", a: n - tail + k, b: m - tail + k)) }
        return out
    }
}
