import Foundation
func T(_ key: String) -> String { key }
func jsonOrNull(_ text: String?) -> Any { text.map { $0 as Any } ?? NSNull() }
enum AppNumber { static func bytes(_ n: Int) -> String { String(n) }; static func int(_ n: Int) -> String { String(n) } }
enum Lang: String { case en }
struct AppLanguage { static let shared = AppLanguage(); let lang = Lang.en }
struct NativeAPIError: Error { let code: String; let data: Data }
@MainActor enum NativeAPI {
    struct Empty: Decodable {}
    struct Reply { let data: Data; var conflict = false; var delay: UInt64 = 0 }
    static var replies: [Reply] = []
    static var requests: [(String, [String: Any])] = []
    static func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        requests.append((method, body ?? [:])); let reply = replies.removeFirst()
        if reply.delay > 0 { try await Task.sleep(nanoseconds: reply.delay) }
        if reply.conflict { throw NativeAPIError(code: "VERSION_CONFLICT", data: reply.data) }
        return try JSONDecoder().decode(T.self, from: reply.data)
    }
    static func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) }
    static func escape(_ value: String) -> String { value }
}

@MainActor final class MeetingUploads { static let shared = MeetingUploads(); var removed: [String] = []; func cancelAndRemove(_ id: String) { removed.append(id) } }
