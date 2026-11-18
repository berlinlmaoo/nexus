import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for printing to the office printer (owner, 18 Nov 2026; PrintSheet.swift, PrintLogView.swift,
// PrintAPI.swift, PrintModels.swift). Wording follows the web's apps/web/src/lib/i18n/id-print.ts ("Print" →
// "Cetak" as on the web; "Print log" → "Riwayat print"). Words that already have an entry elsewhere (Everyone,
// Person, From, To, Queued, Done, Close, Status…) are not repeated. Keys must not appear in any other
// Localization*.swift (scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianPrint: [String: String] = [
        "%d pages × %d": "%d halaman × %d",
        "At most %d pages per print.": "Maksimal %d halaman per print.",
        "Black & white": "Hitam-putih",
        "Color": "Warna",
        "Copies": "Salinan",
        "Copies must be between 1 and %d.": "Jumlah salinan harus antara 1 dan %d.",
        "Couldn't count the pages of this file, so it wasn't printed.": "Jumlah halaman file ini tidak terbaca, jadi tidak dicetak.",
        "Couldn't load the print log": "Riwayat print tidak bisa dimuat",
        "Last 30 days": "30 hari terakhir",
        "Last 7 days": "7 hari terakhir",
        "Legal document": "Dokumen legal",
        "No prints yet": "Belum ada print",
        "Nothing was printed in this period. Try another date or person.": "Tidak ada yang dicetak di periode ini. Coba tanggal atau orang lain.",
        "Page": "Halaman",
        "Print": "Cetak",
        "Print a Legal document or a page from its ••• menu.": "Cetak dokumen Legal atau halaman dari menu •••-nya.",
        "Print failed": "Print gagal",
        "Print log": "Riwayat print",
        "Printed": "Sudah dicetak",
        "Printer": "Printer",
        "Printer isn't set up on this server": "Printer belum diatur di server ini",
        "Printing…": "Sedang mencetak…",
        "Sending to the printer…": "Mengirim ke printer…",
        "Still printing. Check the Print log in Settings later.": "Masih mencetak. Cek Riwayat print di Pengaturan nanti.",
        "This file has %d pages. One print can have at most %d pages.": "File ini punya %d halaman. Satu print maksimal %d halaman.",
        "This server can't turn files into PDF yet, so it can't print them.": "Server ini belum bisa mengubah file jadi PDF, jadi belum bisa mencetaknya.",
        "This version has no file that can be printed.": "Versi ini tidak punya file yang bisa dicetak.",
        "Too many pages: at most %d per print.": "Terlalu banyak halaman: maksimal %d per print.",
        "You've printed 20 times this hour. Try again later.": "Kamu sudah print 20 kali dalam sejam. Coba lagi nanti.",
    ]
}
