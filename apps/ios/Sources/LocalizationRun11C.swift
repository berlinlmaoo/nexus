import Foundation

/// Indonesian strings for the UI tour run 11 iOS fixes, part C (14 Oct 2026): tickets, attendance, calendar,
/// settings, leaderboard, and the Mac's Click / Touch ID wording (PlatformWording). Keys must not appear in
/// any other Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun11C: [String: String] = [
        // Tickets: a Closed ticket whose attendance correction still waits (IP-1)
        "Correction awaiting decision": "Koreksi menunggu keputusan",
        // Attendance on a Mac (MC-12)
        "On your phone": "Di HP-mu",
        "Check-in location": "Lokasi absen",
        "Check-in location is taken by the NEXUS app on your phone.": "Lokasi absen dibaca oleh aplikasi NEXUS di HP-mu.",
        // Leaderboard (PD-17)
        "%d-way tie for 1st": "%d orang seri di peringkat 1",
        // Settings › Password (PD-5 / MC-5) and passkeys on a Mac (MC-6)
        "Sign in with Touch ID": "Masuk pakai Touch ID",
        "Sign in with Touch ID instead of typing your password. Your password keeps working.":
            "Masuk pakai Touch ID, nggak usah ngetik password. Password kamu tetap jalan.",
        "Sign in with a passkey instead of typing your password. Your password keeps working.":
            "Masuk pakai passkey, nggak usah ngetik password. Password kamu tetap jalan.",
        "No passkeys yet — add one and this device can sign you in with Touch ID.":
            "Belum ada passkey — tambah satu biar perangkat ini bisa masukin kamu pakai Touch ID.",
        "No passkeys yet — add one and this device can sign you in without your password.":
            "Belum ada passkey — tambah satu biar perangkat ini bisa masukin kamu tanpa password.",
        // Click on a Mac (MC-13)
        "Photo couldn't load. Click to try again.": "Foto gagal dimuat. Klik untuk coba lagi.",
        "Click to try again": "Klik untuk coba lagi",
        "No files yet. Click + to add receipts, proofs or documents.": "Belum ada file. Klik + untuk menambah nota, bukti, atau dokumen.",
        "Click a day for its detail. A red dot means XP was deducted for that day.": "Klik tanggal untuk detailnya. Titik merah berarti ada potongan XP untuk hari itu.",
        "Click to enlarge": "Klik untuk memperbesar",
        "Click to open": "Klik untuk membuka",
        "Click the first day, then the last": "Klik hari pertama, lalu hari terakhir",
        "Only the last 3 days are shown, so the list opens on what just happened. The rest of this period is one click away.":
            "Yang tampil hanya 3 hari terakhir, agar daftarnya langsung menunjukkan yang baru terjadi. Sisa periode ini tinggal satu klik.",
        "Click a form to edit it. Right-click it to fill it in, copy or share its link, or publish it.":
            "Klik form untuk mengeditnya. Klik kanan untuk mengisi, menyalin atau membagikan link-nya, atau memublikasikannya.",
        "Click for info": "Klik untuk info",
        "Click to type": "Klik untuk mengetik",
        "The slicer filters this column of the range for everyone. Click it on the sheet to pick values.":
            "Pemotong memfilter kolom ini pada rentang untuk semua orang. Klik pemotong di sheet untuk memilih nilai.",
    ]
}
