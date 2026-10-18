import Foundation

/// JSON calls for the newer native surfaces. Keeps refusal codes and conflict bodies intact.
enum NativeAPI {
    static func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        var request = APIClient.shared.makeRequest(path, method: method)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await APIClient.shared.perform(request)
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw NativeAPIError(status: http.statusCode, data: data) }
        return try JSONDecoder().decode(T.self, from: data)
    }
    static func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
    static func escape(_ text: String) -> String { text.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
    struct Empty: Decodable {}
}
struct NativeAPIError: LocalizedError {
    let status: Int
    let data: Data
    var fields: [String: Any] { (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }
    var code: String { fields["code"] as? String ?? "" }
    var errorDescription: String? {
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
