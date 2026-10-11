import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Outlet Sales Dashboard endpoints (owner, 10 Oct 2026, for Ryan): /api/projects/:id/outlet-sales/**.
//
// In their own file like PipelineAPI.swift. Access is the project's: members read and fill reports,
// the lead / Manager / BoD / OAA set the month's targets (403 TARGETS_FORBIDDEN for anyone else; the
// month answer says `canManageTargets`). Writes go straight through, no offline queue: a report
// replayed minutes later could overwrite what a colleague filled meanwhile. PATCH carries only the keys
// that changed for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

extension APIClient {

    private func outletBase(_ projectId: String) -> String {
        "/api/projects/\(Self.outletEnc(projectId))/outlet-sales"
    }

    private static func outletEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }

    /// One month: its events, its target, the server's totals and statuses, the forgotten reports of
    /// older months (`waitingEarlier`) and the form. `month` "YYYY-MM"; nil = this month in WIB.
    func outletMonth(projectId: String, month: String?) async throws -> OutletMonthResponse {
        var path = outletBase(projectId)
        if let month, !month.isEmpty { path += "?month=\(Self.outletEnc(month))" }
        return try await outletRun(makeRequest(path), as: OutletMonthResponse.self)
    }

    /// One event, for a link or an event of another month. 404 EVENT_NOT_FOUND when it is gone.
    func outletEvent(projectId: String, eventId: String) async throws -> OutletEventDetail {
        try await outletRun(makeRequest("\(outletBase(projectId))/events/\(Self.outletEnc(eventId))"), as: OutletEventDetail.self)
    }

    /// POST: `name` and `date` are required, anything else of the form may come along.
    func outletCreateEvent(projectId: String, fields: [String: Any]) async throws -> OutletEvent {
        var req = makeRequest("\(outletBase(projectId))/events", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await outletRun(req, as: OutletEvent.self)
    }

    /// PATCH: only the keys that changed. NSNull clears a number, "" clears an answer.
    func outletUpdateEvent(projectId: String, eventId: String, fields: [String: Any]) async throws -> OutletEvent {
        var req = makeRequest("\(outletBase(projectId))/events/\(Self.outletEnc(eventId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: fields)
        return try await outletRun(req, as: OutletEvent.self)
    }

    /// DELETE: restorable from Control Room → Audit ("outlet_sales_event"), with its whole report.
    func outletDeleteEvent(projectId: String, eventId: String) async throws {
        let req = makeRequest("\(outletBase(projectId))/events/\(Self.outletEnc(eventId))", method: "DELETE")
        _ = try await outletRun(req, as: SuccessResponse.self)
    }

    /// PUT the month's targets. nil sends null, which clears that target (an empty box = no target).
    func outletSetTarget(projectId: String, month: String, salesTarget: Int64?, paxTarget: Int64?) async throws -> OutletTarget {
        var req = makeRequest("\(outletBase(projectId))/targets", method: "PUT")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "month": month,
            "salesTarget": salesTarget.map { NSNumber(value: $0) } ?? NSNull(),
            "paxTarget": paxTarget.map { NSNumber(value: $0) } ?? NSNull(),
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await outletRun(req, as: OutletTarget.self)
    }

    /// New project → Outlet Sales Dashboard: an ordinary project of type OUTLET_SALES (any number of
    /// them, one per outlet; the creator is its lead). Answers the new project, so the sheet can open it
    /// ("Create project + open dashboard").
    func outletProjectCreate(workspaceId: String, name: String, color: String, folderId: String?) async throws -> ProjectRef {
        var req = makeRequest("/api/projects", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["name": name, "workspaceId": workspaceId, "color": color, "type": "OUTLET_SALES"]
        if let folderId { body["folderId"] = folderId }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let made = try await outletRun(req, as: OutletCreatedProject.self)
        return ProjectRef(id: made.id, name: made.name ?? name, icon: nil, color: color)
    }

    /// `pipelineRun`'s twin: nothing answered → `nothingAnswered`, 401 → `unauthorized`, any other
    /// refusal → the server's own sentence (an INVALID_FIELD answer names what was wrong).
    private func outletRun<Payload: Decodable>(_ req: URLRequest, as type: Payload.Type) async throws -> Payload {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, Self.serverMessage(data))
        }
        do {
            return try JSONDecoder().decode(Payload.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
