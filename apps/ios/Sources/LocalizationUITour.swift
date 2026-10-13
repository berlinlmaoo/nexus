import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for the UI-tour parity fixes (13 Oct 2026): copy aligned with the dev web (dashboard greeting
// and XP rules card, Messages, Tickets categories, Threads Mentions). Wording follows the web's
// apps/nexus-lovable-ui/src/lib/i18n. Keys must not appear in any other Localization*.swift
// (scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianUITour: [String: String] = [
        // Dashboard
        "Good morning,": "Selamat pagi,",
        "Good afternoon,": "Selamat siang,",
        "Good evening,": "Selamat malam,",
        "XP rules": "Aturan XP",
        "What takes XP away and what adds it": "Apa yang mengurangi dan menambah XP",
        // Messages
        "No messages yet": "Belum ada pesan",
        "Direct message": "Pesan pribadi",
        // Tickets categories (web complaints.tsx CATEGORIES)
        "XP": "XP",
        "Leave / day off": "Cuti / day off",
        // Threads → Mentions
        "Mentions": "Sebutan",
        "No mentions yet": "Belum ada mention",
        "When someone tags you, it shows up here.": "Kalau ada yang menandai kamu, muncul di sini.",
        // Login (web login.tsx)
        "New here?": "Baru di sini?",
        "Sign in with a passkey": "Masuk dengan passkey",
        // Notifications
        "Delete notification": "Hapus notifikasi",
        // Projects summary card (web projects/index.tsx)
        "%d of %d projects": "%d dari %d project",
        "%d of %d project": "%d dari %d project",
        "Average progress": "Rata-rata progres",
        "Tasks done": "Task selesai",
        "On hold": "Ditunda",
        "Archived": "Diarsipkan",
        "Sort by progress": "Urutkan menurut progres",
        "Sort by number of tasks": "Urutkan menurut jumlah task",
        "Sort by name": "Urutkan menurut nama",
        // Leaderboard
        "XP ranking for everyone": "Peringkat XP semua orang",
        // UI tour run 3
        "edited": "diubah",
        // UI tour run 4
        "Any location": "Lokasi bebas",
        "Nothing booked in %@": "Belum ada booking di bulan %@",
        "Book meeting rooms here so two teams never turn up for the same room. Pick a room, a date and a time.": "Booking ruang meeting di sini supaya dua tim tidak datang ke ruangan yang sama. Pilih ruangan, tanggal, dan jam.",
        "Subject": "Judul",
        "Replies": "Balasan",
        "Last activity": "Aktivitas terakhir",
    ]
}
