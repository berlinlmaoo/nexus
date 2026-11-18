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
        // Print screen: an uploaded file (18 Nov 2026). "Choose a file" and "Pages" already have entries.
        "%d pages": "%d halaman",
        "All pages": "Semua halaman",
        "Choose another file": "Pilih file lain",
        "e.g. 1-3,5": "mis. 1-3,5",
        "HEIC photos can't be printed. Save the photo as JPG or PNG first.": "Foto HEIC tidak bisa dicetak. Simpan dulu sebagai JPG atau PNG.",
        "PDF, Word, Excel, PowerPoint, JPG or PNG, up to 25 MB. The file is deleted from the server once it's printed.": "PDF, Word, Excel, PowerPoint, JPG, atau PNG, maksimal 25 MB. File dihapus dari server setelah dicetak.",
        "Preparing the file…": "Menyiapkan file…",
        "Print another file": "Print file lain",
        "Print any file on the office printer": "Cetak file apa saja di printer kantor",
        "Print shows up here once the office printer is set up on the server.": "Menu Cetak muncul di sini setelah printer kantor diatur di server.",
        "Printing is for members of the company workspace.": "Print hanya untuk anggota workspace perusahaan.",
        "The file doesn't match its name (it may be damaged or renamed).": "Isi file tidak cocok dengan namanya (mungkin rusak atau diganti namanya).",
        "The file is larger than 25 MB": "File lebih dari 25 MB",
        "These pages add up to %d. One print can have at most %d pages.": "Halaman yang dipilih berjumlah %d. Satu print maksimal %d halaman.",
        "This file couldn't be converted for printing. Try saving it as PDF first.": "File ini tidak bisa dikonversi untuk dicetak. Coba simpan dulu sebagai PDF.",
        "This file has %d pages.": "File ini punya %d halaman.",
        "This kind of file can't be printed. Use PDF, Word, Excel, PowerPoint, JPG or PNG.": "Jenis file ini tidak bisa dicetak. Gunakan PDF, Word, Excel, PowerPoint, JPG, atau PNG.",
        "This upload has expired. Upload the file again.": "File ini sudah kedaluwarsa. Unggah ulang filenya.",
        "Uploaded file": "File unggahan",
        "Write pages like 1-3,5": "Tulis halaman seperti 1-3,5",
    ]
}
