import Foundation

/// Indonesian strings for the UI tour run 14 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun14PP: [String: String] = [
        // Attendance: where "Finding you…" ends up (P-I23 / I-24), the Mac chip (P-M3), the board scope (N-04)
        "Location not found": "Lokasi tidak ditemukan",
        "No office set up": "Belum ada kantor",
        "Couldn't get your position. Pull down to try again.": "Posisimu tidak terbaca. Tarik ke bawah untuk mencoba lagi.",
        "Your workspace has no office to check in at yet.": "Workspace-mu belum punya kantor untuk check-in.",
        "Usually takes a few seconds.": "Biasanya hanya beberapa detik.",
        "Check in on your phone": "Check-in dari HP-mu",
        "Everyone in the workspace": "Semua orang di workspace",
        // Home (N-37 / P-I16 / P-M10)
        "Open My Tasks": "Buka Task Saya",
        // Leaderboard subtitle with the period (P-I34 / P-M29) and the member profile (N-32)
        "Everyone's XP for {range}. It resets on the 1st.": "XP semua orang untuk {range}. Direset setiap tanggal 1.",
        "No XP was taken for these absences. An absence costs XP once the nightly check has run; a day excused by a permit, or lost to an outage, costs nothing.": "Belum ada XP yang dipotong untuk absen ini. Absen memotong XP setelah pengecekan malam berjalan; hari yang tertutup izin, atau hilang karena gangguan sistem, tidak memotong apa pun.",
        // Settings → Security: one verb, "Log out" (N-41), and the card title (P-I9)
        "Passkeys": "Passkey",
        "Devices signed in to your account. Log out any you don't recognise.": "Perangkat yang sedang masuk ke akunmu. Keluarkan yang tidak kamu kenali.",
        "Log out other sessions": "Keluarkan sesi lain",
        "Log out of every other device? They will need to sign in again. This device stays signed in.": "Keluarkan semua perangkat lain? Perangkat itu harus masuk lagi. Perangkat ini tetap masuk.",
        "Log out “{name}”? That device will need to sign in again.": "Keluarkan “{name}”? Perangkat itu harus masuk lagi.",
        "Log out this device?": "Keluarkan perangkat ini?",
        "Couldn't log that out. Try again.": "Gagal mengeluarkan sesi itu. Coba lagi.",
    ]
}
