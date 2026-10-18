import Foundation
func T(_ text: String) -> String { text }
enum MeetingIssue { static func message(_ code: String, metadata: [String: Any]) -> String? { nil } }
enum APIError: LocalizedError { case unauthorized, offline, http(Int, String?); var errorDescription: String? { "Test error" } }
struct APIClient {
    static let shared = APIClient()
    static var last: URLRequest?
    func makeRequest(_ path: String, method: String = "GET") -> URLRequest {
        let base = URL(string: "https://native.invalid")!
        // BUILD_REQUEST_URL
        var request = URLRequest(url: url); request.httpMethod = method; return request
    }
    func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        Self.last = request
        return (Data("{}".utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
