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

/// Numbers in the language the app is set to, not the device's region: English "1,000" and "18.5 MB",
/// Indonesian "1.000" and "18,5 MB" (UI tour run 5: an English app showed "1.000 XP" on an Indonesian
/// iPhone, and ByteCountFormatter followed the region too). Same locales as AppDateLocale.
enum AppNumber {
    static func int(_ n: Int) -> String {
        n.formatted(.number.locale(AppDateLocale.current))
    }

    static func decimal(_ x: Double, digits: Int = 1) -> String {
        x.formatted(.number.precision(.fractionLength(digits)).locale(AppDateLocale.current))
    }

    /// File sizes as the web writes them (1024-based): "320 KB", "18.5 MB", "1.2 GB".
    static func bytes(_ count: Double) -> String {
        let b = max(0, count)
        if b >= 1_073_741_824 { return decimal(b / 1_073_741_824) + " GB" }
        if b >= 1_048_576 { return decimal(b / 1_048_576) + " MB" }
        if b >= 1024 { return int(Int((b / 1024).rounded())) + " KB" }
        return int(Int(b)) + " B"
    }

    static func bytes(_ count: Int) -> String { bytes(Double(count)) }
}
