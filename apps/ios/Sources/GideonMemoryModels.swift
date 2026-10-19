import Foundation

/// The API has no person selector: these records always belong to the signed-in person.
struct GideonMemory: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let kind: String
    let text: String
    let monthDay: String?
    var status: String
    let source: String
    let createdAt: String
    let updatedAt: String
}
struct GideonMemories: Decodable {
    let paused: Bool
    let max: Int
    let textMax: Int
    let memories: [GideonMemory]
}
struct GideonMemoryReply: Decodable { let memory: GideonMemory; let created: Bool? }
struct GideonMemoryDeleted: Decodable { let deleted: Bool? }
struct GideonMemoriesDeleted: Decodable { let deleted: Int }

enum GideonMemoryIssue {
    static func message(code: String, error: String, language: String) -> String {
        guard language == "id" else { return error }
        switch code.lowercased() {
        case "secret": return "GIDEON tidak pernah menyimpan password, PIN, kode, atau nomor kartu/rekening/KTP."
        case "paused": return "Memori GIDEON sedang mati."
        case "full": return "Memori GIDEON penuh (40). Hapus sesuatu untuk menambah."
        default: return error
        }
    }
}
