import Foundation

/// Indonesian strings for the UI tour run 12 iOS fixes (14 Oct 2026): the project Calendar and Timeline
/// hints, Attendance's day-off card and the Mac's session label. Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun12: [String: String] = [
        // Project Calendar: an empty month while tasks wait for a date (IP5); web id-r11web.ts
        "1 task has no date": "1 task belum punya tanggal",
        "%d tasks have no date": "%d task belum punya tanggal",
        // Project Timeline: no bar in the days in view (IP7 / PD4)
        "1 task outside this range": "1 task di luar rentang ini",
        "%d tasks outside this range": "%d task di luar rentang ini",
        "Jump to first": "Lompat ke yang pertama",
        // Attendance: the card over "0/4 used" (IP9); web id-i18n-attendance.ts
        "Days off": "Day off",
        // Settings › Active sessions on a Mac (MC3)
        "NEXUS app for macOS": "Aplikasi NEXUS macOS",
    ]
}
