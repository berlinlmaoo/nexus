import Foundation

/// Indonesian strings for the UI tour run 19 iOS fixes and the owner's 16 Oct 2026 changes. Keys must not
/// appear in any other Localization*.swift (scripts/check-localization.sh). Wording as on the web.
extension AppLanguage {
    static let indonesianRun19: [String: String] = [
        // Control Room › Users › person: the employment start date (owner, 16 Oct 2026; web admin.tsx)
        "The basis for annual leave: eligible after 12 months of work. Not filled in = not eligible yet.": "Dasar cuti tahunan: berhak setelah 12 bulan bekerja. Belum diisi = belum berhak.",
        // XP rules card (owner, 16 Oct 2026: quests as they really are; web id-r19web.ts)
        "XP penalties": "Potongan XP",
        "XP bonuses": "Bonus XP",
        "Per quest": "Per quest",
        "Finish a quest": "Selesaikan quest",
        "Made by BoD and up, for everyone, one person, chosen divisions or a set of tasks. You get the XP the quest sets when you claim it.": "Dibuat oleh BoD ke atas, untuk semua orang, satu orang, divisi tertentu, atau sekumpulan task. Kamu dapat XP sesuai quest-nya saat mengklaim.",
        "Adjustment by BoD": "Penyesuaian oleh BoD",
        "Up to 1.000 XP up or down each time, with who made it": "Naik atau turun maksimal 1.000 XP sekali ubah, dengan nama pemberinya",
        "“Automatic” is worked out by the system from attendance. “Manual” comes from a quest or from BoD.": "“Otomatis” dihitung sistem dari absensi. “Manual” datang dari quest atau dari BoD.",
        "Your level is this period's level: everyone starts at 1.000 XP on the 28th.": "Level-mu adalah level periode ini: semua mulai dari 1.000 XP setiap tanggal 28.",
        // Audit: restore is BoD and One Above All only (owner, 16 Oct 2026)
        "Only BoD and One Above All can restore.": "Hanya BoD dan One Above All yang bisa memulihkan.",
        // Attendance: no zero over zero (decision 10)
        "No public holidays this month": "Tidak ada libur nasional bulan ini",
        "Where you can check in": "Tempat kamu bisa check-in",
        "{n} other sessions": "{n} sesi lain",
        // Profile (UI tour run 19, R19-I-39)
        "%@ XP gained · %@ XP lost": "%@ XP didapat · %@ XP hilang",
        "XP comes from quests and is lost to attendance penalties — late, no check-out, absent.": "XP datang dari quest dan hilang karena penalti absensi — telat, lupa check-out, TK.",
        // Leaderboard: the period runs from the 28th, as attendance (owner, 16 Oct 2026)
        "Everyone's XP for {range}. It resets on the 28th.": "XP semua orang untuk {range}. Direset setiap tanggal 28.",
        // Join a workspace with its code (owner, 16 Oct 2026)
        "Join your company's workspace": "Gabung ke workspace perusahaanmu",
        "Ask your company's admin for the code. Your personal workspace and everything in it is deleted when you join.": "Minta kodenya ke admin perusahaanmu. Workspace pribadimu beserta seluruh isinya dihapus saat kamu bergabung.",
        "Workspace code": "Kode workspace",
        "Join workspace": "Gabung workspace",
        "You joined {name}.": "Kamu sudah bergabung ke {name}.",
        "Delete “{name}” and join?": "Hapus “{name}” lalu bergabung?",
        "Its projects, tasks and files are deleted for good. Nothing is moved to the company's workspace.": "Project, task, dan file di dalamnya terhapus permanen. Tidak ada yang dipindahkan ke workspace perusahaan.",
        "Delete and join": "Hapus dan gabung",
        "Your account already shares a workspace with other people. Ask that workspace's admin to add you instead.": "Akunmu sudah berada di workspace bersama orang lain. Minta admin workspace itu untuk menambahkanmu.",
        "You are already in that workspace.": "Kamu sudah ada di workspace itu.",
        "That workspace code is not valid.": "Kode workspace itu tidak valid.",
        "Enter the workspace code": "Masukkan kode workspace",
        "You are in a personal workspace. Enter your company's workspace code in Settings to join it; the Calendar then shows the tasks of everyone there.": "Kamu berada di workspace pribadi. Masukkan kode workspace perusahaanmu di Pengaturan untuk bergabung; Kalender lalu menampilkan tugas semua orang di sana.",
    ]
}
