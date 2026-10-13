import Foundation

// Indonesian for the iPad / Mac shell (sidebar header, footer, My Tasks page header and empty state),
// Mac parity 13 Oct 2026. Copy taken from the dev web's lib/i18n tables. Chained into
// AppLanguage.translate. Keys must not appear in any other Sources/Localization*.swift
// (scripts/check-localization.sh): a duplicate key in a dictionary literal crashes on first use.
extension AppLanguage {
    static let indonesianMacShell: [String: String] = [
        "Dashboard": "Dasbor",
        "Search…": "Cari…",
        "Collapse sidebar": "Ciutkan sidebar",
        "Light mode": "Mode terang",
        "Dark mode": "Mode gelap",
        "Language": "Bahasa",
        "Log out": "Keluar",
        "Pin a project to keep it here.": "Sematkan project supaya tetap ada di sini.",
        "Tasks assigned to you, the most urgent first.": "Task yang ditugaskan ke kamu, yang paling mendesak duluan.",
        "Tasks assigned to you show up here, from a project or a form. Nothing is waiting on you right now — pick something up from a project.": "Task yang ditugaskan ke kamu muncul di sini, dari project atau form. Belum ada yang menunggumu — ambil pekerjaan dari salah satu project.",
    ]
}
