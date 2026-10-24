import Foundation

// Visual QA re-review, 24 Oct 2026 (set D: projects, pages, tickets, room booking). Source-language keys are
// unique across tables.
extension AppLanguage {
    static let indonesianVQA25D: [String: String] = [
        // Project → Pages, empty
        "A brief, an SOP or meeting notes for this project. Pages are written on the web and show up here to read.":
            "Brief, SOP, atau notulen rapat untuk project ini. Halaman ditulis di web dan muncul di sini untuk dibaca.",
        // Tickets board, an empty lane
        "New tickets land here.": "Tiket baru masuk ke sini.",
        "Attendance corrections waiting for the board's decision.": "Koreksi absen yang menunggu keputusan direksi.",
        "Tickets the board is looking into.": "Tiket yang sedang ditinjau direksi.",
        "Resolved and closed tickets.": "Tiket yang sudah selesai dan ditutup.",
        // Room booking, notes field
        "e.g. Guests, equipment or setup needed": "mis. tamu, peralatan, atau setup yang dibutuhkan",
    ]
}
