import Foundation
import Observation

struct GideonTierAvailability: Codable, Sendable, Equatable {
    var available: Bool
    var reason: String?
    var since: String?
    var reasonText: String {
        switch reason {
        case "transcribing": return T("The office GPU is transcribing a meeting.")
        case "loading": return T("It's starting up again.")
        case "down": return T("The local model isn't responding.")
        default: return ""
        }
    }
}
@MainActor @Observable
final class GideonTierStatus {
    static let shared = GideonTierStatus()
    private(set) var tiers: [String: GideonTierAvailability] = [:]
    private var loadedAt: Date?
    func state(_ tier: GideonTier) -> GideonTierAvailability { tiers[tier.rawValue] ?? GideonTierAvailability(available: true) }
    func accept(_ value: [String: GideonTierAvailability]) { tiers = value; loadedAt = Date() }
    func unavailable(_ tier: String, reason: String?) { tiers[tier] = GideonTierAvailability(available: false, reason: reason, since: nil) }
    func refresh(force: Bool = false) async {
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 15 { return }
        struct Envelope: Decodable { let tiers: [String: GideonTierAvailability] }
        if let response: Envelope = try? await NativeAPI.request("/api/gideon/tiers") { accept(response.tiers) }
    }
}
