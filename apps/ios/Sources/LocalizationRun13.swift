import Foundation

/// Indonesian strings for the UI tour run 13 iOS fixes (14 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun13: [String: String] = [
        // Project cards: "1 card" (F-27)
        "Card": "Kartu",
        // Outlet day report: totals, future nights, calendar legend (F-22, W-B5, W-B11)
        "Reports open on the night itself": "Laporan dibuka pada malam itu",
        "Note": "Catatan",
        // Social Media (F-18, F-20, I-13, M-4, W-B15, W-B16)
        "Month to date · %@": "Bulan ini sampai sekarang · %@",
        "Target to date · month target %@ (incl. day targets)": "Target sampai hari ini · target bulan %@ (termasuk target harian)",
        "Set a target": "Atur target",
        "Add platform, e.g. LinkedIn": "Tambah platform, mis. LinkedIn",
        "Each day shows its engagement (likes + comments + shares) across platforms, and the posts published. Click a day to record it.": "Tiap hari menampilkan engagement (likes + komentar + share) semua platform dan jumlah postingan. Klik tanggal untuk mengisinya.",
    ]
}
