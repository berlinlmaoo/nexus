import Foundation

/// JSON calls for the newer native surfaces. Keeps refusal codes and conflict bodies intact.
enum NativeAPI {
    static func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        // makeRequest takes a decoded path and an already encoded query. Decode the path
        // component once here, so escaped IDs cannot become literal %2D / %20 in the route.
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let decodedPath = String(parts[0]).removingPercentEncoding ?? String(parts[0])
        let requestPath = decodedPath + (parts.count == 2 ? "?" + parts[1] : "")
        var request = APIClient.shared.makeRequest(requestPath, method: method)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await APIClient.shared.perform(request)
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw NativeAPIError(status: http.statusCode, data: data, path: path) }
        return try JSONDecoder().decode(T.self, from: data)
    }
    static func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
    static func escape(_ text: String) -> String { text.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? "" }
    struct Empty: Decodable {}
}
struct NativeAPIError: LocalizedError {
    let status: Int
    let data: Data
    var path: String = ""
    var fields: [String: Any] { (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }
    var code: String { fields["code"] as? String ?? "" }
    var errorDescription: String? {
        if path.hasPrefix("/api/meetings") { return MeetingIssue.message(code.isEmpty ? fields["error"] as? String ?? "" : code, metadata: fields) ?? T("Couldn't update meeting notes. Try again.") }
        switch code.uppercased() {
        case "NEEDS_EDIT_ACCESS": return T("You can't add tasks to that project. Pick another.")
        case "BAD_SECTION": return T("That column is no longer available. Choose another column.")
        case "BAD_ASSIGNEE": return T("An assignee is no longer in the project. Check the PIC list.")
        case "NEEDS_LATEST_APP": return T("Open on the latest app or the web to confirm this change.")
        case "OAA_ONLY": return T("Only the One Above All can read GIDEON chats")
        case "BOD_ONLY": return T("This is only available to the Board of Directors.")
        default: return APIError.http(status, fields["error"] as? String).localizedDescription
        }
    }
}
