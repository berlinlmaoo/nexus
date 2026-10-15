import Foundation

/// Indonesian strings for the UI tour run 18 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun18: [String: String] = [
        // Leaderboard: the admin XP log card, as the web's (iPhone R18-I-06); the web's Indonesian
        "Every XP change, added or deducted, for everyone": "Setiap perubahan XP, ditambah atau dipotong, untuk semua orang",
        "Added (+)": "Ditambah (+)",
        "Deducted (−)": "Dipotong (−)",
        "All time": "Semua waktu",
        "Couldn't load the log. It needs board access or higher.": "Log gagal dimuat. Butuh akses direksi ke atas.",
        "No XP changes yet this period.": "Belum ada perubahan XP periode ini.",
        "No XP changes yet.": "Belum ada perubahan XP.",
        // Submissions board: an empty column that is not where new requests land (decision 3)
        "Nothing here yet. Requests move here when the team moves them.": "Belum ada isinya. Permintaan pindah ke sini saat tim memindahkannya.",
    ]

    /// Signing out of this device: "Sign out" in English, "Keluar" in Indonesian. The same English words on
    /// another session's row read "Keluarkan" (remove that session), so this one has its own lookup rather
    /// than the shared "Sign out" key (decision 1 of run 18, R18-B-03).
    static var signOutOwn: String { shared.lang == .id ? "Keluar" : "Sign out" }
}
