import Foundation

/// Indonesian strings for the 19 Oct 2026 device review revisions (R-items). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRev19Oct: [String: String] = [
        // R-3 GIDEON Memory: profile fields edited in place
        "What should GIDEON call you?": "GIDEON sebaiknya memanggilmu apa?",
        "e.g. Finance manager": "mis. Manajer keuangan",
        "Interests, values or preferences to keep in mind": "Minat, nilai, atau preferensi yang perlu diingat",
        // R-4 Control Room › GIDEON › Performance
        "Answers 24 h": "Jawaban 24 jam",
        "Errors 24 h": "Error 24 jam",
        "Errors (15 min)": "Error (15 mnt)",
        "No answers in 15 min": "Belum ada jawaban dalam 15 mnt",
        "Typical time (p50)": "Waktu umumnya (p50)",
        "Credits / answer": "Kredit / jawaban",
        "Offline": "Offline",
        // R-5 / R-6 meeting notes: one progress screen
        "%@ of %@ · %@": "%1$@ dari %2$@ · %3$@",
        "Processing the meeting": "Memproses meeting",
        "Minutes ready": "Notulen siap",
        "You can close this. We'll notify you when the minutes are ready.": "Kamu bisa menutup ini. Kami akan memberi tahu saat notulen sudah siap.",
        "Cancel the upload?": "Batalkan unggahan?",
        "Keep uploading": "Lanjutkan unggahan",
        "Cancel upload": "Batalkan unggahan",
        "The meeting is removed. A recording made here stays on this device.": "Meeting ini dihapus. Rekaman yang dibuat di sini tetap tersimpan di perangkat ini.",
        "Ready — open to review": "Siap — buka untuk ditinjau",
        "Writing the minutes…": "Menulis notulen…",
        "#%@ in the queue": "Urutan ke-%@ dalam antrean",
        "Next in the queue": "Berikutnya dalam antrean",
        "Transcribing… about %@ min left": "Mentranskrip… sekitar %@ mnt lagi",
        "Transcribe": "Transkripsi",
        "Minutes & tasks ready": "Notulen & task siap",
        "Transcribing…": "Mentranskrip…",
    ]
}
