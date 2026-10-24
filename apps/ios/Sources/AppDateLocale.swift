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
        useShortMonths(f)
        cache[key] = f
        return f
    }

    /// en_GB abbreviates September "Sept"; the app (and the web) write "Sep" (owner rule). Applied to every
    /// English formatter this file hands out, and to the Calendar's template formatters.
    static let englishShortMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static func useShortMonths(_ f: DateFormatter) {
        guard f.locale?.identifier.hasPrefix("en") == true else { return }
        f.shortMonthSymbols = englishShortMonths
        f.shortStandaloneMonthSymbols = englishShortMonths
    }

    /// A short date that leaves the year out when it is the current year: "14 Oct", "3 Mar 2025" (UI tour
    /// run 11: Legal lists and project Table cells, as the web writes them).
    static func shortDate(_ d: Date, timeZone: TimeZone? = TimeZone(identifier: "Asia/Jakarta")) -> String {
        var cal = Calendar(identifier: .gregorian)
        if let timeZone { cal.timeZone = timeZone }
        let thisYear = cal.component(.year, from: d) == cal.component(.year, from: Date())
        return formatter(thisYear ? "d MMM" : "d MMM yyyy", timeZone: timeZone).string(from: d)
    }

    /// A month title: "October" in the current year, "January 2027" in any other (decision 2 of run 19,
    /// R19-I-40: month titles hide the current year too, as every other date does).
    static func monthTitle(_ d: Date, timeZone: TimeZone? = TimeZone(identifier: "Asia/Jakarta")) -> String {
        var cal = Calendar(identifier: .gregorian)
        if let timeZone { cal.timeZone = timeZone }
        let thisYear = cal.component(.year, from: d) == cal.component(.year, from: Date())
        return formatter(thisYear ? "LLLL" : "LLLL yyyy", timeZone: timeZone).string(from: d).capitalized(with: current)
    }

    /// `monthTitle` of a "yyyy-MM" (or "yyyy-MM-dd") key; the key itself when it does not parse.
    static func monthTitle(key: String) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.dateFormat = "yyyy-MM"
        guard let d = f.date(from: String(key.prefix(7))) else { return key }
        return monthTitle(d)
    }

    /// The weekday before the short date, the year again only outside the current one: "Wednesday 14 Oct",
    /// "Rabu 14 Okt", "Friday 5 Jan 2027" (UI tour run 12, IP1: the phone's Calendar day said
    /// "Wednesday, 14 Oct 2026"; the web writes "Wednesday 14 Oct").
    static func weekdayDate(_ d: Date, timeZone: TimeZone? = TimeZone(identifier: "Asia/Jakarta")) -> String {
        var cal = Calendar(identifier: .gregorian)
        if let timeZone { cal.timeZone = timeZone }
        let thisYear = cal.component(.year, from: d) == cal.component(.year, from: Date())
        return formatter(thisYear ? "EEEE d MMM" : "EEEE d MMM yyyy", timeZone: timeZone).string(from: d)
    }
}

/// Numbers as the app shows them. Whole numbers always use Indonesian dot grouping, in English too
/// ("2.597", "3.800 / 18.000"; owner rule, UI tour run 13), and never follow the device's region.
/// Fractions keep the app language's decimal mark ("18.5 MB" / "18,5 MB").
enum AppNumber {
    private static let groupedFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "id_ID")
        f.maximumFractionDigits = 0
        f.usesGroupingSeparator = true
        return f
    }()

    /// "2.597", "−32" (a true minus, as the web prints negatives).
    static func int(_ n: Int) -> String { int64(Int64(n)) }

    static func int64(_ n: Int64) -> String {
        let digits = groupedFormatter.string(from: NSNumber(value: n.magnitude)) ?? String(n.magnitude)
        return n < 0 ? "\u{2212}" + digits : digits
    }

    /// Grouped in the UI language, "4,000" in English and "4.000" in Indonesian. Only where the owner asked for it:
    /// the chat length counter, as the web's (QA final #2, I-11). Everything else stays Indonesian (int).
    static func localInt(_ n: Int) -> String { n.formatted(.number.locale(AppDateLocale.current)) }

    /// "Rp 6.000.000", a space after "Rp", in both languages; "−Rp 5.000" below zero.
    static func rupiah(_ n: Int64) -> String {
        let digits = groupedFormatter.string(from: NSNumber(value: n.magnitude)) ?? String(n.magnitude)
        return (n < 0 ? "\u{2212}" : "") + "Rp " + digits
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
