import Foundation

/// The phone's language, on the watch.
///
/// The phone sends its choice ("en" or "id") in the application context next to the session, and
/// `WatchConnectivityBridge` keeps it here under the same key the phone stores it under. English
/// until the phone says otherwise, the same default as the phone — never the watch's own locale.
enum WatchLang {
    static let key = "nexus.language"

    static var isIndonesian: Bool { UserDefaults.standard.string(forKey: key) == "id" }

    /// For date formatting: weekday and month names in the phone's language.
    static var locale: Locale { Locale(identifier: isIndonesian ? "id_ID" : "en_US") }
}

/// The English or the Indonesian copy of a string, by the phone's language.
///
/// Both are written out at the call site because the watch does not carry the phone's translation
/// table (Sources/Localization.swift). Only the Calendar tab uses this so far.
func wt(_ en: String, _ id: String) -> String {
    WatchLang.isIndonesian ? id : en
}
