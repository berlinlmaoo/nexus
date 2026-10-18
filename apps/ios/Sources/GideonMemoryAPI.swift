import Foundation

struct GideonMemoryFailure: LocalizedError {
    let code: String
    let message: String
    var status: Int = 0
    var errorDescription: String? { GideonMemoryIssue.message(code: code, error: message, language: AppLanguage.shared.lang.rawValue) }
}

/// No URL cache, disk cache, logging, notifications or indexing for private memory data.
enum GideonMemoryAPI {
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()
    static func request<Response: Decodable>(_ suffix: String = "", method: String = "GET", body: [String: Any]? = nil) async throws -> Response {
        var request = APIClient.shared.makeRequest("/api/gideon/memory" + suffix, method: method)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let fields = (try? JSONSerialization.jsonObject(with: data)) as? [String:Any] ?? [:]
            throw GideonMemoryFailure(code: fields["code"] as? String ?? "", message: fields["error"] as? String ?? T("Couldn't update GIDEON Memory. Try again."), status: http.statusCode)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
