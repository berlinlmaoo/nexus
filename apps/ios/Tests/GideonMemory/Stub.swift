import Foundation
func T(_ key: String) -> String { key }
struct Session { let userId: String }
@MainActor enum Keychain { static var session: Session? = Session(userId: "owner"); static func load() -> Session? { session } }
enum APIError: Error { case unauthorized }
struct GideonMemoryFailure: Error { let code: String; var status = 0 }
enum NativeAPI { static func escape(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~")))! } }
@MainActor enum GideonMemoryAPI {
    struct Reply { let data: Data; var delay: UInt64 = 0; var notFound = false }
    static var replies: [Reply] = []
    static var requests: [(String,String,[String:Any])] = []
    static func request<T: Decodable>(_ suffix: String = "", method: String = "GET", body: [String:Any]? = nil) async throws -> T {
        requests.append((suffix,method,body ?? [:])); let reply = replies.removeFirst()
        if reply.delay > 0 { try await Task.sleep(nanoseconds: reply.delay) }
        if reply.notFound { throw GideonMemoryFailure(code: "not_found",status: 404) }
        return try JSONDecoder().decode(T.self, from: reply.data)
    }
}
@MainActor final class GideonChat {
    static let shared = GideonChat()
    var values: [GideonMemory] = []
    func updateMemory(_ memory: GideonMemory) { if let i = values.firstIndex(where: { $0.id == memory.id }) { values[i] = memory } }
    func reconcileMemories(_ memories: [GideonMemory]) { for i in values.indices { if let m = memories.first(where: { $0.id == values[i].id }) { values[i] = m } else { values[i].status = "DELETED" } } }
    func forgetAllMemories() { for i in values.indices { values[i].status = "DELETED" } }
}
struct GideonStep: Decodable, Sendable {}
struct GideonRef: Decodable, Sendable {}
struct GideonCard: Decodable, Sendable {}
struct GideonProposal: Decodable, Sendable {}
struct GideonCreditSummary: Decodable, Sendable {}
struct GideonCreditNotice: Decodable, Sendable {}
struct GideonAttachment {
    enum Kind { case image, document }
    let kind: Kind; let name: String; let bytes: Int?; let url: String?; let mime: String
}
struct GideonTurn {
    enum Role: String { case user, assistant }
    let id: String; let role: Role; let content: String; let tools: [String]; let attachments: [GideonAttachment]
    var steps: [GideonStep] = []; var sources: [GideonRef] = []; var cards: [GideonCard] = []; var proposals: [GideonProposal] = []; var memories: [GideonMemory] = []
}
