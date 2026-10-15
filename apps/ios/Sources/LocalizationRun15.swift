import Foundation

/// Indonesian strings for the UI tour run 15 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun15: [String: String] = [
        // Settings → Security → Active sessions: the web's verb and its groups per device (R15-I-02/03, Q-IB2/3)
        "Sign out": "Keluarkan",
        "Sign out all": "Keluarkan semua",
        "Sign out this device?": "Keluarkan perangkat ini?",
        "Sign out other sessions": "Keluarkan sesi lain",
        "Sign out of every other device? They will need to sign in again. This device stays signed in.": "Keluarkan semua perangkat lain? Perangkat itu harus masuk lagi. Perangkat ini tetap masuk.",
        "Sign out “{name}”? That device will need to sign in again.": "Keluarkan “{name}”? Perangkat itu harus masuk lagi.",
        "Sign out all {n} sessions of “{name}”? Those devices will need to sign in again.": "Keluarkan semua {n} sesi “{name}”? Perangkat itu harus masuk lagi.",
        "Devices signed in to your account. Sign out any you don't recognise.": "Perangkat yang sedang masuk ke akunmu. Keluarkan yang tidak kamu kenali.",
        "Couldn't sign that out. Try again.": "Gagal mengeluarkan sesi itu. Coba lagi.",
        "{n} sessions": "{n} sesi",
        "Hide sessions": "Sembunyikan sesi",
        "Show all {n}": "Lihat semua {n}",
        "NEXUS app for iPadOS": "Aplikasi NEXUS iPadOS",
        // My Submissions: an empty lane says what lands in it (Q-IA4, Q-M4)
        "Requests the team is working on move here.": "Permintaan yang sedang dikerjakan tim pindah ke sini.",
        "Finished requests end up here.": "Permintaan yang sudah selesai berakhir di sini.",
        // Settings → Security: the password fields get labels and the length rule (R15-I-05)
        "At least 8 characters": "Minimal 8 karakter",
        // Board (Q-IA21)
        "Add status": "Tambah status",
        // Project overview (decision: web wording per width)
        "Done ({month})": "Selesai ({month})",
        // Status updates: no internal "BoD" in an empty state (R15-I-25)
        "No updates yet. Post one so the team and the board can follow along without asking.": "Belum ada update. Kirim satu supaya tim dan direksi bisa mengikuti tanpa harus bertanya.",
        // List / board: at most two dates, then "+N" (Q-IA24, Q-M11)
        "%d more dates": "%d tanggal lagi",
        // Project calendar: the no-date hint folds the list away again (Q-IA28)
        "Hide them": "Sembunyikan",
        // R15-MORE
    ]
}
