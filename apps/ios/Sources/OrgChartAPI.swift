import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Bagan IP & Divisi endpoints (/api/admin/org-chart/**).
//
// In their own file for the same reason VaultAPI.swift is: APIClient.swift is long enough that
// touching it re-typechecks a great deal of the app. Reading is for anyone who may open Control
// Room's user management; changing is BoD / One Above All only, and the server says so in a sentence
// that is shown as it is.
//
// Positions (layoutX/Y, boxLayout) are never written from here: arranging cards by hand is a web
// feature, and a phone that sent them back would undo it.
// ─────────────────────────────────────────────────────────────────────────────

extension APIClient {

    func orgChart() async throws -> OrgChartData {
        try await orgRun(makeRequest("/api/admin/org-chart"), decode: OrgChartData.self)
    }

    @discardableResult
    func createOrgUnit(name: String, parentId: String?, kind: String) async throws -> OrgUnitDTO {
        var req = makeRequest("/api/admin/org-chart", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": name, "parentId": jsonOrNull(parentId), "kind": kind,
        ])
        return try await orgRun(req, decode: OrgUnitEnvelope.self).unit
    }

    /// Only the keys present are changed; `NSNull()` clears parentId, leadUserId or logoUrl.
    @discardableResult
    func updateOrgUnit(_ id: String, fields: [String: Any]) async throws -> OrgUnitDTO {
        var req = makeRequest("/api/admin/org-chart/units/\(orgEnc(id))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await orgRun(req, decode: OrgUnitEnvelope.self).unit
    }

    /// Its people are released from it (they stay in their other cards) and its sub-units move up.
    func deleteOrgUnit(_ id: String) async throws {
        _ = try await orgRun(makeRequest("/api/admin/org-chart/units/\(orgEnc(id))", method: "DELETE"), decode: SuccessResponse.self)
    }

    func addOrgUnitMember(userId: String, unitId: String) async throws {
        var req = makeRequest("/api/admin/org-chart/members", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["userId": userId, "unitId": unitId])
        _ = try await orgRun(req, decode: SuccessResponse.self)
    }

    func removeOrgUnitMember(userId: String, unitId: String) async throws {
        let path = "/api/admin/org-chart/members?userId=\(orgEnc(userId))&unitId=\(orgEnc(unitId))"
        _ = try await orgRun(makeRequest(path, method: "DELETE"), decode: SuccessResponse.self)
    }

    /// Job title on one card; nil or empty = none.
    func setOrgUnitMemberTitle(userId: String, unitId: String, title: String?) async throws {
        var req = makeRequest("/api/admin/org-chart/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "userId": userId, "unitId": unitId, "title": jsonOrNull(title),
        ])
        _ = try await orgRun(req, decode: SuccessResponse.self)
    }

    /// Under which BoD/Manager of that card; nil = under nobody.
    func setOrgUnitMemberReportsTo(userId: String, unitId: String, leaderId: String?) async throws {
        var req = makeRequest("/api/admin/org-chart/members", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "userId": userId, "unitId": unitId, "reportsToUserId": jsonOrNull(leaderId),
        ])
        _ = try await orgRun(req, decode: SuccessResponse.self)
    }

    /// PNG, JPG or WebP, at most 2 MB. Multipart fields "unitId" and "file".
    @discardableResult
    func uploadOrgUnitLogo(unitId: String, data: Data, mime: String, fileName: String) async throws -> OrgUnitDTO {
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = makeRequest("/api/admin/org-chart/logo", method: "POST")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"unitId\"\r\n\r\n\(unitId)\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(mime)\r\n\r\n")
        body.append(data)
        add("\r\n--\(boundary)--\r\n")
        req.httpBody = body
        return try await orgRun(req, decode: OrgUnitEnvelope.self).unit
    }

    private func orgRun<T: Decodable>(_ req: URLRequest, decode: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, APIClient.serverMessage(data))
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding }
    }

    private func orgEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s
    }
}


/// GET /api/admin/approval-chart — every person with their approver edge, in one call. Read by the Approval
/// chart for its edges only: the members list leaves approverId out for people outside a Manager's own chain
/// since 13 Oct 2026 (personal attendance data), the chart endpoint does not. Shift / Flexi / Mobile come
/// back neutral there with `personalHidden` for the same people.
struct ApprovalChartPayload: Decodable, Sendable {
    let people: [Person]?
    struct Person: Decodable, Sendable {
        let userId: String?
        let approverId: String?
        let personalHidden: Bool?
    }
}

extension APIClient {
    func approvalChartEdges() async throws -> ApprovalChartPayload {
        try await orgRun(makeRequest("/api/admin/approval-chart"), decode: ApprovalChartPayload.self)
    }
}
