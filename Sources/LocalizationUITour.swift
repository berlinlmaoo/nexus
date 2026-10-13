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
    ]
}
