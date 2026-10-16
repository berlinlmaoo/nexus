import Foundation

/// Indonesian strings for the UI tour run 19 iOS fixes and the owner's 16 Oct 2026 changes. Keys must not
/// appear in any other Localization*.swift (scripts/check-localization.sh). Wording as on the web.
extension AppLanguage {
    static let indonesianRun19: [String: String] = [
        // Control Room › Users › person: the employment start date (owner, 16 Oct 2026; web admin.tsx)
        "The basis for annual leave: eligible after 12 months of work. Not filled in = not eligible yet.": "Dasar cuti tahunan: berhak setelah 12 bulan bekerja. Belum diisi = belum berhak.",
    ]
}
