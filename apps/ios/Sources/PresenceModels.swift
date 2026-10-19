import Foundation

/// Presence is a server label, not a native inference from attendance or location.
struct PresenceStatus: Codable, Equatable, Sendable {
    struct Labels: Codable, Equatable, Sendable { let en: String; let id: String? }
    struct Manual: Codable, Equatable, Sendable {
        let id: String
        let text: String
        let startsAt: String
        let endsAt: String
        let availability: String?
        var selectedAvailability: String { ["online", "away", "dnd"].contains(availability ?? "") ? availability! : "away" }
    }
    let userId: String
    let state: String
    let tone: String
    let reason: String
    let text: String?
    let label: Labels
    let until: String?
    let since: String?
    let manual: Manual?
    let availability: String?
    func localizedLabel(_ language: String) -> String { language == "id" ? label.id ?? label.en : label.en }
}
struct PresenceEnvelope: Decodable {
    let enabled: Bool
    let statuses: [PresenceStatus]?
    let status: PresenceStatus?
    let serverTime: String?
}
struct PresenceMutation: Decodable { let status: PresenceStatus; let cleared: Int? }

/// All presence dates are displayed in WIB, including devices set to another time zone.
enum PresenceTime {
    static let zone = TimeZone(identifier: "Asia/Jakarta")!
    static func instant(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    static func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
    static func format(_ date: Date, _ pattern: String, language: String) -> String {
        let f = DateFormatter(); f.timeZone = zone; f.locale = Locale(identifier: language == "id" ? "id_ID" : "en_GB"); f.dateFormat = pattern
        return f.string(from: date)
    }
    static func until(_ value: String?, now: Date = Date(), language: String) -> String? {
        guard let value else { return nil }
        if value.count == 10 {
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = zone; f.dateFormat = "yyyy-MM-dd"; f.isLenient = false
            return f.date(from: value).map { format($0, "d MMM yyyy", language: language) }
        }
        guard let date = instant(value) else { return nil }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
        return format(date, cal.isDate(date, inSameDayAs: now) ? "HH:mm 'WIB'" : "d MMM yyyy HH:mm 'WIB'", language: language)
    }
    static func todayEnd(_ now: Date) -> Date {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
        return cal.date(bySettingHour: 23, minute: 59, second: 0, of: now) ?? now
    }
}
