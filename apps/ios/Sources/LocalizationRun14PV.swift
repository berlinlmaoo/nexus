import Foundation

/// Indonesian strings for the UI tour run 14 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun14PV: [String: String] = [
        // Project Timeline: what the bar colours mean (P-I15 / P-M13)
        "Bar colour by priority:": "Warna bar menurut prioritas:",
        // Project Overview, "Who's working on what" header (N-17 / P-I22 / P-M23)
        "Done (month)": "Selesai bulan ini",
        // Project Calendar hint (P-M12)
        "Pick a date to see its tasks and add one there.": "Pilih tanggal untuk melihat tugasnya dan menambah tugas di sana.",
        // Projects summary on iPad / Mac (P-I19)
        "Open a project to see its board, pages, calendar and timeline.": "Buka project untuk melihat board, halaman, kalender, dan timeline-nya.",
    ]
}
