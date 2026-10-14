import Foundation

/// Indonesian strings for the UI tour run 14 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun14NF: [String: String] = [
        // Number formats, Notion style (CustomFieldNumberViews.swift). Format names are in
        // CustomFieldNumber.formats in both languages.
        "Ring": "Cincin",
        "Divide by": "Bagi dengan",
        "Show number": "Tampilkan angka",
        "Changes apply to all views showing this property.": "Perubahan berlaku untuk semua tampilan yang menampilkan properti ini.",
        "Filter formats…": "Filter format…",
        "No formats match": "Tidak ada format yang cocok",
        "Try a currency name or its code, like IDR.": "Coba nama mata uang atau kodenya, misalnya IDR.",
        "Couldn't save the format. Check your connection and try again.": "Format tidak tersimpan. Periksa koneksimu lalu coba lagi.",
    ]
}
