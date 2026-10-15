import Foundation

/// Indonesian strings for the UI tour run 17 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun17: [String: String] = [
        // Settings: one verb on the Log out card (R17-B-06, decision 6)
        "Log out of NEXUS on this device.": "Keluar dari NEXUS di perangkat ini.",
        // Home attendance card before check-in (iPad R17-I-16, decision 7)
        "Ready to check in · %@": "Siap check-in · %@",
        // Project tools row: the web's label (R17-B-01, decision 1)
        "AI Autofill": "Isi Otomatis AI",
        // Form builder help: the control, then what it does (R17-B-10)
        "Move up / Move down": "Naikkan / Turunkan",
        "Pick the type of a new question.": "Pilih jenis pertanyaan baru.",
        "Reorder the questions.": "Ubah urutan pertanyaan.",
        "See the form exactly as people see it.": "Lihat formulir persis seperti yang dilihat orang.",
        // Board: a linked lane folded to a rail and opened again (R17-M-08)
        "Fold": "Lipat",
        "Show this lane": "Tampilkan lajur ini",
    ]
}
