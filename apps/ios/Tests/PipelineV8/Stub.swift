import Foundation

// UI and transport dependencies only. Pipeline models, request methods, number formatting,
// request URL construction and AuditJSON are compiled from the production sources.
func T(_ text: String) -> String { text }
enum AppLang { case en, id }
final class AppLanguage { static let shared = AppLanguage(); var lang: AppLang = .en }
enum ChipTone { case neutral, danger, warning, success, info }
enum ProjDate { static func parse(_ value: String?) -> Date? { value.flatMap { ISO8601DateFormatter().date(from: $0) } } }
struct ProjectRef { let id: String; let name: String; let icon: String? }
struct SuccessResponse: Decodable {}
struct OutletCreatedProject: Decodable { let id: String; let name: String? }
enum ProjectAccessLevel: String { case edit = "EDIT" }
struct ProjectDetail: Decodable {
    struct ProjectMember: Decodable {}
    let members: [ProjectMember]?
}
struct WorkspaceInfo { let workspaceId: String; let role: String? }
final class UploadProgress {}
enum APIError: Error {
    case http(Int, String?), unauthorized, decoding, transport(String), offline
    static func nothingAnswered(_ error: Error) -> APIError { .offline }
}
struct APIClient {
    static let shared = APIClient()
    static var last: URLRequest?
    static var payload = Data("{}".utf8)
    static var status = 200
    static var transportFails = false
    static var requestProbe: ((URLRequest) async throws -> (Data, URLResponse))?
    static var workspaceProbe: (() async throws -> WorkspaceInfo)?
    func makeRequest(_ path: String, method: String = "GET") -> URLRequest {
        let base = URL(string: "https://native.invalid")!
        // BUILD_REQUEST_URL
        var request = URLRequest(url: url)
        request.httpMethod = method
        return request
    }
    func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        Self.last = request
        if let probe = Self.requestProbe { return try await probe(request) }
        if Self.transportFails { throw URLError(.notConnectedToInternet) }
        return (Self.payload, response(request))
    }
    func download(_ request: URLRequest, to destination: URL) async throws -> URLResponse {
        Self.last = request
        if Self.transportFails { throw URLError(.notConnectedToInternet) }
        try Self.payload.write(to: destination)
        return response(request)
    }
    private func response(_ request: URLRequest) -> HTTPURLResponse {
        HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil,
                        headerFields: ["Content-Disposition": "attachment; filename=Pipeline.xlsx"])!
    }
    static func serverMessage(_ data: Data) -> String? {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
    }
    static func fileSize(of file: URL) -> Int { 1 }
    func workspaceInfo() async throws -> WorkspaceInfo {
        if let probe = Self.workspaceProbe { return try await probe() }
        return WorkspaceInfo(workspaceId: "workspace", role: nil)
    }
    func encValue(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value }
    func uploadInChunks(file: URL, fileName: String, size: Int, extraQuery: String, progress: UploadProgress?) async throws {}
}
