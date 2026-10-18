// swiftc Sources/LegalModels.swift Tests/LegalModels/main.swift -o /tmp/legalmodels && /tmp/legalmodels
//
// Decoding of the Legal API (docs/legal-api.md) from sample JSON shaped like the server's answers, the
// tolerance for missing / mistyped fields, and the pure helpers the forms use (word diff, number-format
// fields, Rupiah grouping, Jakarta days, form values). Linux: swift:5.10-jammy in Docker. Exit 1 on any failure.
import Foundation

var failures = 0
var checks = 0

func expect<T: Equatable>(_ got: T, _ want: T, _ label: String) {
    checks += 1
    if got != want {
        failures += 1
        print("FAIL \(label)\n  got:  \(got)\n  want: \(want)")
    }
}

func decode<T: Decodable>(_ type: T.Type, _ json: String, _ label: String) -> T? {
    do { return try JSONDecoder().decode(T.self, from: Data(json.utf8)) } catch {
        checks += 1; failures += 1
        print("FAIL decode \(label): \(error)")
        return nil
    }
}

// MARK: Access & members

if let me = decode(LegalMe.self, #"{"access": true, "isRoot": false, "invitePower": "STAFF"}"#, "me") {
    expect(me.access, true, "me.access")
    expect(me.invitePower, .staff, "me.invitePower")
    expect(me.invitePower.canInvite, true, "staff can invite")
}
if let me = decode(LegalMe.self, #"{"access": true, "invitePower": "SOMETHING_NEW"}"#, "me unknown power") {
    expect(me.invitePower, .none, "unknown power reads as NONE")
    expect(me.isRoot, false, "missing isRoot")
}

let membersJSON = #"""
{"members": [
  {"userId": "u1", "name": "Budi", "email": "b@x.id", "avatar": null, "orgRole": "ONE_ABOVE_ALL", "isRoot": true,
   "active": true, "invitedAt": null, "invitedBy": null, "revokedAt": null, "revokedBy": null, "canRevoke": false, "invitePower": "ANY"},
  {"userId": "u2", "name": "Mira", "email": "m@x.id", "avatar": "/a.png", "orgRole": "BOD", "isRoot": false, "active": false,
   "invitedAt": "2026-10-14T03:00:00.000Z", "invitedBy": {"id": "u1", "name": "Budi", "avatar": null},
   "revokedAt": "2026-10-14T05:00:00.000Z", "revokedBy": {"id": "u1", "name": "Budi", "avatar": null}, "canRevoke": true, "invitePower": "NONE"}
], "invitePower": "ANY"}
"""#
if let r = decode(LegalMembersResponse.self, membersJSON, "members") {
    expect(r.members.count, 2, "members count")
    expect(r.invitePower, .any, "members invitePower")
    expect(r.members[1].revokedBy?.name ?? "", "Budi", "revokedBy")
    expect(r.members[1].active, false, "removed member inactive")
    expect(r.members[0].isRoot, true, "root")
}
if let c = decode(LegalCandidatesResponse.self, #"{"candidates": [{"userId": "u3", "name": "Yuda", "email": "y@x.id", "avatar": null, "orgRole": "STAFF"}]}"#, "candidates") {
    expect(c.candidates.first?.id ?? "", "u3", "candidate id")
}

// MARK: Companies & numbering

let companiesJSON = #"""
{"companies": [{"id": "c1", "code": "PATS", "name": "PATS", "legalName": "PT Contoh", "address": "Jakarta", "hasKop": true,
  "kopFileName": "kop.docx", "kopUpdatedAt": "2026-10-14T03:00:00Z", "active": true, "documentCount": 3,
  "series": [{"id": "s1", "key": "PATS-SPK", "docType": "SPK", "label": "SPK", "format": "{SEQ:3}/SPK/{CO}/{ROMAWI}/{YYYY}",
              "resetPeriod": "YEAR", "active": true},
             {"id": "s2", "key": "PATS-INV", "docType": "INVOICE", "label": "Invoice", "format": "INV/{YYYY}{MM}/{SEQ:4}",
              "resetPeriod": "MONTH", "active": false}]}]}
"""#
if let r = decode(LegalCompaniesResponse.self, companiesJSON, "companies") {
    expect(r.companies.first?.series.count ?? 0, 2, "series count")
    expect(r.companies.first?.series.last?.resetPeriod ?? "", "MONTH", "series reset")
    expect(r.companies.first?.hasKop ?? false, true, "hasKop")
}
if let c = decode(LegalCompany.self, #"{"id": "c2", "name": "Intoo", "legalName": null, "documentCount": "x"}"#, "company tolerant") {
    expect(c.legalName, "", "null legalName → empty")
    expect(c.documentCount, 0, "mistyped documentCount → 0")
    expect(c.series.isEmpty, true, "missing series → empty")
    expect(c.active, true, "missing active → true")
}
if let info = decode(LegalSeriesInfo.self, #"{"series": {"id": "s1", "key": "k", "docType": "SPK", "label": "SPK", "format": "{SEQ:3}", "resetPeriod": "YEAR", "active": true}, "issued": 12, "next": "013/SPK/PATS/X/2026"}"#, "series info") {
    expect(info.issued, 12, "issued")
    expect(info.next, "013/SPK/PATS/X/2026", "next")
}

// MARK: Templates (recursive fields)

let templateJSON = #"""
{"template": {"id": "t1", "name": "SPK Talent", "description": "", "docType": "SPK",
  "company": {"id": "c1", "code": "PATS", "name": "PATS"}, "series": null, "currentVersion": 2, "archived": false,
  "fields": [
    {"name": "TANGGAL_DOKUMEN", "label": "Tanggal dokumen", "type": "date", "required": true},
    {"name": "HONOR", "label": "Honor", "type": "money", "required": true, "help": "Tanpa titik"},
    {"name": "JENIS", "label": "Jenis", "type": "select", "required": false, "options": ["A", "B"]},
    {"name": "PAKAI_MATERAI", "label": "Pakai materai", "type": "boolean", "required": false},
    {"name": "BARANG", "label": "Barang", "type": "list", "required": true,
     "columns": [{"name": "NAMA_BARANG", "label": "Nama", "type": "text", "required": true},
                 {"name": "JUMLAH", "label": "", "type": "number", "required": false}]}
  ],
  "createdBy": {"id": "u1", "name": "Budi", "avatar": null}, "createdAt": "2026-10-14T03:00:00Z", "updatedAt": "2026-10-14T04:00:00Z",
  "versions": [{"version": 2, "fileName": "spk.docx", "size": 20480, "note": "fix", "fieldCount": 5, "createdBy": null, "createdAt": "2026-10-14T04:00:00Z"},
               {"version": 1, "fileName": "spk.docx", "size": 20000, "note": "", "fieldCount": 4, "createdBy": null, "createdAt": "2026-10-14T03:00:00Z"}]}}
"""#
if let t = decode(LegalTemplateResponse.self, templateJSON, "template")?.template {
    expect(t.fields.count, 5, "fields count")
    expect(t.series == nil, true, "null series")
    expect(t.fields[4].columns?.count ?? 0, 2, "list columns")
    expect(t.fields[4].columns?[1].label ?? "", "JUMLAH", "empty label falls back to the name")
    expect(t.fields[2].options ?? [], ["A", "B"], "select options")
    expect(t.versions.first?.fieldCount ?? 0, 5, "version fieldCount")
    // Round trip: the PATCH sends the fields back as JSON.
    let data = try! JSONEncoder().encode(t.fields)
    let again = try! JSONDecoder().decode([LegalField].self, from: data)
    expect(again, t.fields, "fields encode → decode round trip")
    let any = LegalField.jsonArray(t.fields) as? [[String: Any]]
    expect(any?.count ?? 0, 5, "jsonArray")
    expect((any?[4]["columns"] as? [[String: Any]])?.count ?? 0, 2, "jsonArray nested columns")
}

// MARK: Documents

let pageJSON = #"""
{"documents": [{"id": "d1", "number": "001/SPK/PATS/X/2026", "docType": "SPK", "title": "SPK Mira", "counterparty": "Mira",
  "docDate": "2026-10-14", "status": "DRAFT", "source": "GENERATED", "company": {"id": "c1", "code": "PATS", "name": "PATS"},
  "project": null, "deal": {"id": "dl1", "code": "PL-001", "name": "Campaign", "projectId": "p1"}, "currentVersion": 1,
  "createdBy": {"id": "u1", "name": "Budi", "avatar": null}, "createdAt": "2026-10-14T03:00:00Z", "updatedAt": "2026-10-14T03:00:00Z"}],
 "total": 120, "page": 2, "pageSize": 50}
"""#
if let p = decode(LegalDocumentsPage.self, pageJSON, "documents page") {
    expect(p.total, 120, "total")
    expect(p.page, 2, "page")
    expect(p.documents.first?.deal?.code ?? "", "PL-001", "deal code")
}

let documentJSON = #"""
{"document": {"id": "d1", "number": "001/SPK/PATS/X/2026", "docType": "SPK", "title": "SPK Mira", "counterparty": "Mira",
  "docDate": "2026-10-14", "status": "FINAL", "source": "GENERATED", "company": {"id": "c1", "code": "PATS", "name": "PATS"},
  "project": {"id": "p1", "name": "Campaign"}, "deal": null, "currentVersion": 3, "createdBy": null, "createdAt": "2026-10-14T03:00:00Z",
  "updatedAt": "2026-10-14T05:00:00Z", "notes": "", "series": {"id": "s1", "key": "PATS-SPK", "label": "SPK"},
  "template": {"id": "t1", "name": "SPK Talent", "version": 2}, "fieldValues": {"HONOR": "25000000", "BARANG": [{"NAMA_BARANG": "Kamera"}]},
  "finalVersion": 2, "hasNumber": true, "updatedBy": null,
  "versions": [
    {"version": 3, "kind": "UPLOAD", "fileName": "signed.pdf", "mimeType": "application/pdf", "size": 300000, "hasDocx": false, "hasPdf": true, "hasFile": true, "note": "", "changes": null, "author": null, "createdAt": "2026-10-14T05:00:00Z"},
    {"version": 2, "kind": "MANUAL", "fileName": "spk.docx", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "size": 21000, "hasDocx": true, "hasPdf": true, "hasFile": false, "note": "fee", "changes": [{"index": 4}], "author": {"id": "u1", "name": "Budi", "avatar": null}, "createdAt": "2026-10-14T04:00:00Z"},
    {"version": 1, "kind": "GENERATED", "fileName": "spk.docx", "mimeType": "", "size": 20000, "hasDocx": true, "hasPdf": false, "hasFile": false, "note": "", "changes": null, "author": null, "createdAt": "2026-10-14T03:00:00Z"}
  ]}}
"""#
if let d = decode(LegalDocumentResponse.self, documentJSON, "document")?.document {
    expect(d.shownVersion?.version ?? 0, 2, "shown = finalVersion")
    expect(d.current?.hasDocx ?? true, false, "current is the signed PDF")
    expect(d.wordVersions, [1, 2], "word versions, oldest first")
    expect(d.template?.version ?? 0, 2, "template version")
    expect(d.project?.name ?? "", "Campaign", "project")
}
if let d = decode(LegalDocument.self, #"{"id": "d2", "currentVersion": 1, "finalVersion": null, "versions": [{"version": 1, "kind": "UPLOAD", "hasFile": true}]}"#, "document tolerant") {
    expect(d.shownVersion?.version ?? 0, 1, "shown = current when no final")
    expect(d.status, "DRAFT", "missing status")
    expect(d.wordVersions.isEmpty, true, "no word versions")
}

let prepareJSON = #"""
{"template": {"id": "t1", "name": "SPK Talent", "docType": "SPK", "version": 2},
 "company": {"id": "c1", "code": "PATS", "name": "PATS", "hasKop": false},
 "series": {"id": "s1", "key": "PATS-SPK", "label": "SPK", "format": "{SEQ:3}/{KOTA}/{CO}/{ROMAWI}/{YYYY}", "resetPeriod": "YEAR"},
 "fields": [{"name": "TANGGAL_DOKUMEN", "label": "Tanggal", "type": "date", "required": true}, {"name": "KOTA", "label": "Kota", "type": "text", "required": true}],
 "numberPreview": "001/JKT/PATS/X/2026"}
"""#
if let p = decode(LegalPrepared.self, prepareJSON, "prepare") {
    expect(p.company?.hasKop ?? true, false, "prepare hasKop")
    expect(p.fields.count, 2, "prepare fields")
    expect(LegalText.formatFields(p.series?.format ?? ""), ["KOTA"], "format fields of the prepared series")
}
if let g = decode(LegalGenerated.self, #"{"id": "d9", "number": "002/SPK", "pdfError": "Gotenberg is not set up"}"#, "generated") {
    expect(g.pdfError ?? "", "Gotenberg is not set up", "pdfError")
}
if let u = decode(LegalUploaded.self, #"{"id": "d10", "pdfError": null}"#, "uploaded") { expect(u.pdfError == nil, true, "null pdfError") }
if let l = decode(LegalLinks.self, #"{"projects": [{"id": "p1", "name": "Campaign"}], "deals": [{"id": "dl1", "code": "PL-001", "name": "Deal", "brand": "Z", "projectId": "p1"}]}"#, "links") {
    expect(l.deals.first?.brand ?? "", "Z", "deal brand")
}

// MARK: Review, compare, GIDEON

if let p = decode(LegalParagraphsResponse.self, #"{"version": 2, "current": 3, "paragraphs": [{"index": 0, "text": "No: 001", "editable": false, "lockReason": "number", "style": "Title", "inTable": false}, {"index": 1, "text": "Pasal 1", "editable": true, "inTable": true}]}"#, "paragraphs") {
    expect(p.paragraphs[0].lockReason ?? "", "number", "lockReason")
    expect(p.paragraphs[1].style == nil, true, "missing style")
    expect(p.paragraphs[1].inTable, true, "inTable")
}

let compareJSON = #"""
{"a": 1, "b": 2, "diff": [
  {"type": "same", "a": 0, "b": 0, "text": "Judul"},
  {"type": "removed", "a": 1, "text": "Lama"},
  {"type": "added", "b": 1, "text": "Baru"},
  {"type": "changed", "a": 2, "b": 2, "before": "fee 1", "after": "fee 2", "segments": [{"type": "same", "text": "fee "}, {"type": "del", "text": "1"}, {"type": "ins", "text": "2"}]},
  {"type": "something-new", "a": 3, "b": 3, "text": "x"}
]}
"""#
if let c = decode(LegalCompareResponse.self, compareJSON, "compare") {
    expect(c.diff.count, 5, "diff count")
    expect(c.diff.filter { !$0.isSame }.count, 3, "changes (unknown type reads as same)")
    if case .changed(_, _, let before, _, let segments) = c.diff[3] {
        expect(before, "fee 1", "changed before")
        expect(segments.map(\.type), ["same", "del", "ins"], "changed segments")
    } else { checks += 1; failures += 1; print("FAIL changed case") }
    if case .removed(let a, let text) = c.diff[1] { expect(a, 1, "removed a"); expect(text, "Lama", "removed text") }
    else { checks += 1; failures += 1; print("FAIL removed case") }
    if case .added(let b, _) = c.diff[2] { expect(b, 1, "added b") } else { checks += 1; failures += 1; print("FAIL added case") }
}

let proposalsJSON = #"""
{"proposals": [
  {"id": "pr2", "status": "CLARIFY", "baseVersion": 3, "instruction": "change the term", "question": "6 or 12 months?", "summary": "",
   "changes": [], "appliedVersion": null, "createdBy": {"id": "u1", "name": "Budi", "avatar": null}, "decidedBy": null, "decidedAt": null, "createdAt": "2026-10-14T06:00:00Z"},
  {"id": "pr1", "status": "PENDING", "baseVersion": 2, "instruction": "fee", "question": null, "summary": "Fee to Rp 2.000.000",
   "changes": [{"index": 4, "before": "Rp 1.000.000", "after": "Rp 2.000.000", "segments": [{"type": "same", "text": "Rp "}, {"type": "del", "text": "1.000.000"}, {"type": "ins", "text": "2.000.000"}]}],
   "appliedVersion": null, "createdBy": null, "decidedBy": null, "decidedAt": null, "createdAt": "2026-10-14T05:00:00Z"}
]}
"""#
if let r = decode(LegalProposalsResponse.self, proposalsJSON, "proposals") {
    expect(r.proposals.first?.question ?? "", "6 or 12 months?", "clarify question")
    expect(r.proposals.last?.changes.first?.index ?? -1, 4, "change index")
}
if let d = decode(LegalDecision.self, #"{"proposal": null, "version": 4, "pdfError": null}"#, "decision") { expect(d.version ?? 0, 4, "decision version") }
if let v = decode(LegalVersionCreated.self, #"{"version": 5}"#, "version created") { expect(v.version, 5, "version created") }

// Blank lines (lockReason "empty") are not drawn; locked number paragraphs are.
if let p = decode(LegalParagraphsResponse.self, #"{"version": 1, "current": 1, "paragraphs": [{"index": 0, "text": "", "editable": false, "lockReason": "empty", "inTable": false}, {"index": 1, "text": "   ", "editable": true, "inTable": false}, {"index": 2, "text": "No: 1", "editable": false, "lockReason": "number", "inTable": false}]}"#, "blank paragraphs") {
    expect(p.paragraphs.map(\.isBlank), [true, true, false], "isBlank")
}

// PDFs come in the background: a recent Word version without one is awaited, for 3 minutes.
if let d = decode(LegalDocument.self, #"{"id": "d3", "currentVersion": 2, "versions": [{"version": 2, "kind": "MANUAL", "hasDocx": true, "hasPdf": false, "createdAt": "2026-10-14T05:00:00.000Z"}, {"version": 1, "kind": "GENERATED", "hasDocx": true, "hasPdf": false, "createdAt": "2026-10-14T04:00:00Z"}]}"#, "awaiting pdf") {
    let now = ISO8601DateFormatter().date(from: "2026-10-14T05:01:00Z")!
    expect(d.versionsAwaitingPdf(now: now).map(\.version), [2], "only the recent version is awaited")
    let later = ISO8601DateFormatter().date(from: "2026-10-14T05:04:00Z")!
    expect(d.versionsAwaitingPdf(now: later).isEmpty, true, "stop after 3 minutes")
}
if let p = decode(LegalProposal.self, #"{"id": "pr3", "status": "APPLYING", "baseVersion": 2}"#, "applying") {
    expect(p.status, "APPLYING", "applying status kept")
    expect(p.changes.isEmpty, true, "applying without changes")
}

if let d = decode(LegalDocument.self, #"{"id": "d4", "project": null, "deal": null, "linkHidden": true, "versions": []}"#, "link hidden") {
    expect(d.linkHidden, true, "linkHidden")
    expect(d.project == nil && d.deal == nil, true, "hidden link has no project / deal")
}
if let d = decode(LegalDocumentSummary.self, #"{"id": "d5"}"#, "older server") { expect(d.linkHidden, false, "missing linkHidden → false") }

// MARK: Error bodies

if let e = decode(LegalErrorBody.self, #"{"error": "Some fields need attention", "fieldErrors": {"HONOR": "Not a number", "BARANG.0.NAMA_BARANG": "Required"}}"#, "422 fields") {
    expect(e.fieldErrors["BARANG.0.NAMA_BARANG"] ?? "", "Required", "table cell error")
    expect(e.problems.isEmpty, true, "no problems")
}
if let e = decode(LegalErrorBody.self, #"{"error": "This template has problems", "problems": ["{{NAMA} is not closed", "Unknown filter: foo"]}"#, "422 problems") {
    expect(e.problems.count, 2, "problems")
    expect(e.fieldErrors.isEmpty, true, "no field errors")
}
if let e = decode(LegalErrorBody.self, #"{"error": "Legal is by invitation only", "code": "LEGAL_NOT_INVITED"}"#, "403") {
    expect(e.code ?? "", "LEGAL_NOT_INVITED", "403 code")
}

// MARK: Helpers

func segs(_ s: [LegalSegment]) -> String { s.map { "\($0.type):\($0.text)" }.joined(separator: "|") }
expect(segs(LegalText.diffWords("fee Rp 1.000.000 per month", "fee Rp 2.000.000 per month")),
       "same:fee Rp |del:1.000.000|ins:2.000.000|same: per month", "diff one word")
expect(segs(LegalText.diffWords("same text", "same text")), "same:same text", "diff no change")
expect(segs(LegalText.diffWords("", "new")), "ins:new", "diff from empty")
expect(segs(LegalText.diffWords("a b c", "x b y")), "del:a|ins:x|same: b |del:c|ins:y", "diff two changes")
// A lone matching space between two changes reads as one change.
expect(segs(LegalText.diffWords("one two", "three four")), "del:one two|ins:three four", "diff absorbs a lone space")

expect(LegalText.formatFields("{SEQ:3}/{CO}/{ROMAWI}/{YYYY}"), [], "built-in tokens only")
expect(LegalText.formatFields("{SEQ:3}/{KOTA}/{DIVISI}/{MM}/{YY}/{KOTA}"), ["KOTA", "DIVISI"], "field tokens, once each")

expect(LegalText.groupDigits("25000000"), "25.000.000", "group")
expect(LegalText.groupDigits("0012"), "12", "leading zeros")
expect(LegalText.groupDigits("1500,755"), "1.500,75", "decimals")
expect(LegalText.groupDigits("Rp 1.000"), "1.000", "regroup typed text")
expect(LegalText.ungroup("25.000.000"), "25000000", "ungroup")
expect(LegalText.ungroup("1.500,75"), "1500.75", "ungroup decimals")

let noonUTC = ISO8601DateFormatter().date(from: "2026-10-14T18:30:00Z")!
expect(LegalText.todayJakarta(noonUTC), "2026-10-15", "Jakarta day is UTC+7")
expect(LegalText.date(fromDay: "2026-10-14").map(LegalText.dayString) ?? "", "2026-10-14", "day round trip")
expect(LegalText.date(fromDay: "garbage") == nil, true, "bad day")

let values: [String: LegalValue] = ["A": .text("x"), "B": .bool(true), "ROWS": .rows([["C": .text("1")]])]
let json = LegalValue.json(values)
expect(json["A"] as? String ?? "", "x", "value text json")
expect(json["B"] as? Bool ?? false, true, "value bool json")
expect(((json["ROWS"] as? [[String: Any]])?.first?["C"] as? String) ?? "", "1", "value rows json")
expect(JSONSerialization.isValidJSONObject(json), true, "values serialise")

// MARK: Signed copies, void, addenda (owner, 14 Oct 2026)

let signedDocJSON = #"""
{"document": {"id": "d1", "number": "PKS/PATS-UNIV/YOGYAKARTA/OKT/2026/001", "docType": "PKS", "title": "PKS Venue", "status": "SIGNED",
 "source": "GENERATED", "currentVersion": 3, "finalVersion": 2, "signedVersion": 3, "hasNumber": true,
 "signedAt": "2026-10-14T09:00:00.000Z", "signedBy": {"id": "u1", "name": "Budi", "avatar": null},
 "addenda": [{"id": "a1", "number": "PKS/PATS-UNIV/YOGYAKARTA/OKT/2026/001/ADD-1", "title": "Addendum Pertama", "status": "DRAFT",
   "docDate": "2026-10-20", "signedAt": null, "addendumSeq": 1, "numberReleased": false}],
 "versions": [
  {"version": 3, "kind": "UPLOAD", "fileName": "scan.pdf", "hasPdf": true, "label": "SIGNED", "downloadName": "PKS-PATS - PKS Venue SIGNED"},
  {"version": 2, "kind": "MANUAL", "fileName": "x.docx", "hasDocx": true, "hasPdf": true, "label": "FINAL", "downloadName": "PKS-PATS - PKS Venue FINAL"}]}}
"""#
if let r = decode(LegalDocumentResponse.self, signedDocJSON, "signed document") {
    let d = r.document
    expect(d.isLocked, true, "signed is locked")
    expect(d.shownVersion?.version ?? 0, 3, "signed copy is the primary file")
    expect(d.signedBy?.name ?? "", "Budi", "signed by")
    expect(d.addenda.first?.number ?? "", "PKS/PATS-UNIV/YOGYAKARTA/OKT/2026/001/ADD-1", "addendum number")
    expect(d.statusChoices, ["SIGNED", "VOID"], "signed: only void")
    expect(d.voidReleasesNumber, false, "a signed void keeps its number retired")
    expect(d.canUploadSignedCopy, false, "no second signed copy")
    expect(d.versions[0].shareName("pdf") ?? "", "PKS-PATS - PKS Venue SIGNED.pdf", "share name")
    expect(d.versions[1].shareName("docx") ?? "", "PKS-PATS - PKS Venue FINAL.docx", "share name docx")
}
expect(LegalDocument.statusChoices(status: "VOID", source: "GENERATED"), ["VOID"], "void is one-way")
expect(LegalDocument.statusChoices(status: "FINAL", source: "GENERATED"), ["DRAFT", "FINAL", "SENT", "VOID"], "generated: signed only by upload")
expect(LegalDocument.statusChoices(status: "FINAL", source: "UPLOADED"), ["DRAFT", "FINAL", "SENT", "SIGNED", "VOID"], "uploaded may be marked signed")
if let r = decode(LegalDocumentsPage.self, #"{"documents": [{"id": "v1", "number": "SP/1", "status": "VOID", "numberReleased": true, "numberReusedBy": {"id": "n2", "number": "SP/1", "title": "New"}, "addendaCount": 0}, {"id": "a1", "number": "P/1/ADD-1", "parent": {"id": "p", "number": "P/1", "title": "PKS", "status": "SIGNED", "docType": "PKS"}, "addendumNo": 1}], "total": 2}"#, "archive v2") {
    expect(r.documents[0].numberReleased, true, "released")
    expect(r.documents[0].numberReusedBy?.id ?? "", "n2", "reused by")
    expect(r.documents[1].parent?.number ?? "", "P/1", "parent")
    expect(r.documents[1].addendumNo ?? 0, 1, "addendum no")
}
if let p = decode(LegalPrepared.self, #"{"fields": [], "numberPreview": "P/1/ADD-2", "series": null, "parent": {"id": "p", "number": "P/1", "title": "PKS", "addendumNo": 2}, "prefill": {"NAMA_PIHAK_KEDUA": "PT X", "JUMLAH": 3}}"#, "prepare addendum") {
    expect(p.parent?.addendumNo ?? 0, 2, "addendum n")
    expect(p.prefill["NAMA_PIHAK_KEDUA"] ?? "", "PT X", "prefill text")
    expect(p.prefill["JUMLAH"] ?? "", "3", "prefill number")
    expect(p.series == nil, true, "no series for an addendum")
}

// Page typography and numbered/table paragraphs are part of the native rendering contract.
if let r = decode(LegalParagraphsResponse.self, #"""
{"version":2,"current":2,"page":{"width":595.3,"marginLeft":72,"marginRight":64,"marginTop":36,"font":"Arial","size":11},
 "paragraphs":[{"index":0,"text":"Agreement","editable":true,"inTable":false,"layout":{"align":"center","size":16,"runs":[{"text":"Agreement","b":true}]}},
 {"index":1,"text":"Clause","editable":true,"inTable":false,"layout":{"indentLeft":36,"hanging":18,"firstLine":0,"marker":"(1)","spaceBefore":6,"spaceAfter":8,"lineHeight":1.5}},
 {"index":2,"text":"Cell","editable":true,"inTable":true,"layout":{"cell":{"table":0,"row":1,"col":2},"runs":[{"text":"Cell","i":true,"u":true}]}},
 {"index":3,"text":"","editable":false,"lockReason":"empty","inTable":false}]}
"""#, "page layout") {
    expect(r.page?.width ?? 0, 595.3, "page width in points")
    expect(r.page?.font ?? "", "Arial", "document font")
    expect(r.paragraphs[0].layout?.runs?.first?.b, true, "bold runs")
    expect(r.paragraphs[1].layout?.marker ?? "", "(1)", "numbered marker")
    expect(r.paragraphs[1].layout?.hanging ?? 0, 18, "hanging indent")
    expect(r.paragraphs[2].layout?.cell?.col ?? -1, 2, "table column")
    expect(r.paragraphs[2].layout?.runs?.first?.u, true, "underlined table run")
    expect(r.paragraphs[3].isBlank, true, "blank line retains spacing")
}
if let old = decode(LegalParagraphsResponse.self, #"{"version":1,"current":1,"paragraphs":[{"index":0,"text":"Old doc","editable":true}]}"#, "legacy paragraph layout") {
    expect(old.page == nil, true, "older server omits page")
    expect(old.paragraphs[0].layout == nil, true, "older server omits layout")
}

print("\(checks) checks, \(failures) failures")
exit(failures == 0 ? 0 : 1)
