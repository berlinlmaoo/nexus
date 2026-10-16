import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for GIDEON reading the Calendar and Room Booking, and the book_room card (16 Oct 2026). Wording
// follows the web's lib/i18n/id-gideon-calendar.ts. Keys must not appear in any other Localization*.swift
// (scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianGideonRooms: [String: String] = [
        // Step lines and the suggestion
        "Reading the calendar": "Membaca kalender",
        "Reading the calendar, %@": "Membaca kalender, %@",
        "Checking room bookings": "Mengecek booking ruangan",
        "Checking room bookings, %@": "Mengecek booking ruangan, %@",
        "Booking %@": "Membooking %@",
        "Booking a room": "Membooking ruangan",
        "What's on my calendar this week?": "Ada apa di kalenderku minggu ini?",

        // The book_room card (room picker)
        "Book a room": "Booking ruangan",
        "Checking the rooms…": "Mengecek ruangan…",
        "Couldn't check the rooms.": "Gagal mengecek ruangan.",
        "%@ is booked then. Pick a free room below.": "%@ sudah dibooking di jam itu. Pilih ruangan yang kosong di bawah.",
        "%d seats": "%d kursi",
        "Booked by %@ until %@": "Dibooking %@ sampai %@",
        "No room is free then. Nearest free times:": "Tidak ada ruangan kosong di jam itu. Jam kosong terdekat:",
        "Room booked": "Ruangan dibooking",
    ]
}
