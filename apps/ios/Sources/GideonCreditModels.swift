import Foundation

/// The server owns limits, resets, enforcement and the Aphrodite fallback. Native only draws its answer.
struct GideonCreditSummary: Decodable, Sendable, Equatable {
    struct Period: Decodable, Sendable, Equatable { let startKey: String; let endKey: String; let resetsAt: String }
    struct Today: Decodable, Sendable, Equatable { let used: Int; let limit: Int; let remaining: Int; let answers: Int }
    struct Pool: Decodable, Sendable, Equatable { let used: Int; let limit: Int; let bonus: Int; let remaining: Int }
    let unlimited: Bool
    let dayKey: String
    let periodKey: String
    let period: Period
    let dayResetsAt: String
    let today: Today
    let pool: Pool
    let period_used: Int
    let over: Int
    let fallbackToday: Int
    let fallbackPerDay: Int
    let enforced: Bool
    let next: String
}

struct GideonCreditNotice: Decodable, Sendable, Equatable {
    let kind: String
    let en: String
    let id: String
    var text: String { AppLanguage.shared.lang == .id ? id : en }
}

struct GideonCreditHistory: Decodable, Sendable {
    struct Item: Decodable, Sendable, Identifiable {
        let id: String
        let tier: String
        let credits: Int
        let createdAt: String
        let title: String?
        let billable: Bool
        let fallback: Bool
    }
    let summary: GideonCreditSummary
    let items: [Item]
    let nextBefore: String?
}
