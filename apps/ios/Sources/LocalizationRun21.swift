import Foundation

/// Indonesian strings for the fix 21a owner reverts. Keys must not appear in any other Localization*.swift
/// (scripts/check-localization.sh). Wording as on the web.
extension AppLanguage {
    static let indonesianRun21: [String: String] = [
        // Mac Home Attendance card: no check-in on the Mac (M-07)
        "Use the NEXUS app on your phone to check in": "Pakai app NEXUS di HP-mu untuk check-in",
        // Leaderboard podium, a step several people share (web "{n} tied")
        "%d tied": "%d orang seri",
    ]
}
