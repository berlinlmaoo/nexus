import Foundation

struct GideonPerformanceData: Decodable {
    let now: String
    let thresholds: [String: Double]
    var telemetry: Telemetry
    let tiers: [Tier]
    var live: Live?
    let model0: Model0
    let hours: [Hour]
    let quality: Quality
    let alerts: [Alert]
    struct Telemetry: Decodable { var lastAt: String?; var stale: Bool; let cadenceSec: Int }
    struct Tier: Decodable, Identifiable {
        let id: String; let status: String; let reason: String?
        let inFlight: Int; let answers15m: Int; let failures15m: Int; let answers24h: Int
        let errorRate: Double?; let p50Ms: Double?; let p95Ms: Double?
        let avgCredits15m: Double?; let avgCredits24h: Double?
    }
    struct Live: Decodable {
        let at: String
        let gpu: GPU?
        let engine: Engine?
        let whisper: Whisper?
        struct GPU: Decodable {
            let name: String?; let util: Double?; let memUsedMiB: Double?; let memTotalMiB: Double?
            let tempC: Double?; let powerW: Double?; let powerLimitW: Double?
        }
        struct Engine: Decodable {
            let up: Bool; let model: Model?
            struct Model: Decodable {
                let name: String; let sizeBytes: Double?; let sizeVramBytes: Double?
                let gpuShare: Double?; let contextLength: Int?; let expiresAt: String?
            }
        }
        struct Whisper: Decodable { let up: Bool; let busy: Bool; let queued: Int }
    }
    struct Model0: Decodable {
        let recent: [Generation]; let loads: [Load]; let avgEvalTps24h: Double?; let gens24h: Int
        struct Generation: Decodable { let at: String; let evalTps: Double?; let promptTps: Double?; let outTokens: Int?; let totalMs: Double? }
        struct Load: Decodable { let at: String; let loadSec: Double }
    }
    struct Hour: Decodable {
        let t: String; let questions: [String: Int]; let p50Ms: [String: Double?]
        let credits: Int; let inputTokens: Int; let cachedTokens: Int; let cacheHit: Double?
    }
    struct Quality: Decodable {
        let routerMisses24h: Int; let answers24h: Int
        let topTools: [Tool]; let failingTools: [Tool]
        let thumbsDown: Int?
        struct Tool: Decodable { let tool: String; let calls: Int; let failures: Int }
    }
    struct Alert: Decodable, Identifiable {
        let key: String; let active: Bool; let since: String?; let value: Value?
        struct Value: Decodable {
            let text: String?
            init(from decoder: Decoder) throws {
                let c = try decoder.singleValueContainer()
                if let value = try? c.decode(String.self) { text = value }
                else if let value = try? c.decode(Double.self) { text = String(value) }
                else { text = nil }
            }
        }
        var id: String { key }
    }
    func telemetryStale(at date: Date) -> Bool {
        guard let last = NativeDate.parse(telemetry.lastAt) else { return true }
        return telemetry.stale || date.timeIntervalSince(last) > 180
    }
    mutating func accept(live: Live) {
        self.live = live; telemetry.lastAt = live.at; telemetry.stale = false
    }
}
enum NativeDate {
    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
