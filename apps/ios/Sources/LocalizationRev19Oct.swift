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
    ]
}
