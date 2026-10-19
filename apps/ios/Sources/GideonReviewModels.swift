import Foundation

struct GideonPersonReviewData: Decodable {
    struct Person: Decodable { let id: String; let name: String?; let email: String?; let avatar: String?; let role: String?; let offboarded: Bool? }
    struct Viewer: Decodable { let canReadChats: Bool }
    struct Stats: Decodable { let questions: Int; let answers: Int; let toolCalls: Int; let chats: Int; let deletedChats: Int?; let firstUsed: String?; let lastUsed: String? }
    struct Credits: Decodable {
        let periodKey: String; let period: Period; let used: Int; let answers: Int; let todayUsed: Int; let tiers: [Tier]
        struct Period: Decodable { let startKey: String; let endKey: String; let resetsAt: String }
        struct Tier: Decodable, Identifiable { let tier: String; let credits: Int; let answers: Int; var id: String { tier } }
    }
    struct TopTier: Decodable { let tier: String; let answers: Int }
    let person: Person; let viewer: Viewer; let stats: Stats; let credits: Credits; let topTier: TopTier?
}
struct GideonReviewedChats: Decodable {
    struct Chat: Decodable, Identifiable {
        let id: String; let title: String?; let createdAt: String; let updatedAt: String?
        let messages: Int; let questions: Int?; let tier: String?; let tiers: GideonReviewTiers?; let credits: Int
        let deleted: Bool; let deletedAt: String?; let match: String?
    }
    let chats: [Chat]; let nextCursor: String?; let total: Int
}
struct GideonReviewedTranscript: Decodable {
    let person: GideonPersonReviewData.Person
    struct Chat: Decodable { let id: String; let title: String?; let createdAt: String; let deleted: Bool; let deletedAt: String? }
    let chat: Chat
    let messages: [GideonHistoryResponse.Row]
    let olderBefore: String?
}
struct GideonAdminCredits: Decodable {
    struct Person: Decodable, Identifiable {
        let id: String; let name: String?; let limits: Limits; let override: Override?
        struct Limits: Decodable { let unlimited: Bool; let daily: Int; let monthly: Int; let bonus: Int; let overridden: Bool }
        struct Override: Decodable { let dailyLimit: Int?; let monthlyLimit: Int?; let unlimited: Bool?; let note: String? }
    }
    let people: [Person]
}
struct GideonBonusHistory: Decodable {
    struct Bonus: Decodable, Identifiable { let id: String; let credits: Int; let reason: String?; let grantedByName: String?; let createdAt: String }
    let bonuses: [Bonus]
}

struct GideonReviewTiers: Decodable {
    let names: [String]
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let values = try? c.decode([String].self) { names = values }
        else if let values = try? c.decode([String: Int].self) { names = Array(values.keys).sorted() }
        else { names = [] }
    }
}
