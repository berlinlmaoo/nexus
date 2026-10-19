import Foundation
struct Session { let userId: String }
@MainActor enum Keychain { static var session: Session? = Session(userId: "me"); static func load() -> Session? { session } }
@MainActor final class RemoteConfig { static let shared = RemoteConfig(); var presenceStatus = true }
enum APIError: Error { case unauthorized }
@MainActor enum NativeAPI {
    struct Reply { let data: Data; var delay: UInt64 = 0 }
    static var replies: [Reply] = []
    static var requests: [(String,String,[String:Any])] = []
    static func escape(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~")))! }
    static func request<T: Decodable>(_ path: String, method: String = "GET", body: [String:Any]? = nil) async throws -> T {
        requests.append((path,method,body ?? [:])); let reply = replies.removeFirst()
        if reply.delay > 0 { try await Task.sleep(nanoseconds: reply.delay) }
        return try JSONDecoder().decode(T.self, from: reply.data)
    }
}
