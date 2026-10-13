import Foundation

/// Dates in the language the app is set to.
///
/// Several screens built their formatters with a fixed `id_ID` locale from the days the app was only in
/// Indonesian, so an English app showed "Sel, 13 Okt" on Attendance, "SELASA, 13 OKT" on Room Booking and
/// "13 Okt, 00:15" in Notifications (UI tour 13 Oct 2026). English uses en_GB: day before month
/// ("Tue, 13 Oct"), as the web writes it.
enum AppDateLocale {
    static var current: Locale { Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB") }

    private static let lock = NSLock()
    private static var cache: [String: DateFormatter] = [:]

    /// A shared formatter for `pattern` in the current UI language. Keyed by language too, so switching the
    /// language in Settings changes the next label drawn instead of keeping the first one made.
    static func formatter(_ pattern: String, timeZone: TimeZone? = nil) -> DateFormatter {
        let locale = current
        let key = "\(locale.identifier)|\(timeZone?.identifier ?? "-")|\(pattern)"
        lock.lock(); defer { lock.unlock() }
        if let cached = cache[key] { return cached }
        let f = DateFormatter()
        f.dateFormat = pattern
        f.locale = locale
        if let timeZone { f.timeZone = timeZone }
        cache[key] = f
        return f
    }
}
