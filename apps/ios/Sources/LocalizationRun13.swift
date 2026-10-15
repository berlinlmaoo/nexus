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
        // New project picker (I-11, M-8)
        "Create a new project": "Buat project baru",
        "The project starts with default sections and opens when it's ready.": "Project dimulai dengan bagian bawaan dan langsung terbuka begitu siap.",
        // Member profile (F-11, F-12, F-13)
        "Days off allowance": "Jatah day off",
        "Tap a day for its detail. The colour is the day's status; a small red dot means XP was deducted for that day.": "Ketuk tanggal untuk detailnya. Warna menunjukkan status hari itu; titik merah kecil berarti ada potongan XP untuk hari itu.",
        "Click a day for its detail. The colour is the day's status; a small red dot means XP was deducted for that day.": "Klik tanggal untuk detailnya. Warna menunjukkan status hari itu; titik merah kecil berarti ada potongan XP untuk hari itu.",
        "XP comes from quests and goes on attendance penalties — late, no check-out, absent.": "XP datang dari quest dan berkurang karena penalti absensi — telat, lupa check-out, TK.",
        // Attendance board scope (F-15)
        "You and your direct reports": "Kamu dan bawahan langsungmu",
        // Attendance tiles (F-17)
        "None this month": "Tidak ada bulan ini",
        // Home and Settings wording (F-26, F-37)
        "Edit profile": "Ubah profil",
        // Legal (F-28)
        "1 addendum": "1 addendum",
        // Legal request form (F-30, W-B23)
        "Fill in the required fields (*) to send": "Isi kolom wajib (*) untuk mengirim",
        // Legal requests board (F-31, M-21)
        "Previous number voided": "Nomor sebelumnya dibatalkan",
        // Threads relative time (F-36)
        "%dm ago": "%d mnt lalu",
        "%dh ago": "%d jam lalu",
        "%dd ago": "%d hr lalu",
        // Form builder (I-12)
        "Tap a question to change its type, make it required, add logic or choose where its answer goes.": "Ketuk pertanyaan untuk mengganti jenisnya, menjadikannya wajib, menambah logika, atau memilih ke mana jawabannya masuk.",
        // Leaderboard: the viewer left out of the ranking (W-B4)
        "You're not on this ranking: the board is left out, so management doesn't compete with staff.": "Kamu tidak masuk peringkat ini: direksi tidak diikutkan agar manajemen tidak bersaing dengan staf.",
    ]
}
