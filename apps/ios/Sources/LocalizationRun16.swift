import Foundation

/// Indonesian strings for the UI tour run 16 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun16: [String: String] = [
        // Login: the web's wording (R16-I-09, decision 2)
        "Request access": "Minta akses",
        // Days off / public holidays usage, the web's form (R16-I-11, R16-B-24, decision 4)
        "%@/%@ used": "%@/%@ terpakai",
        "%@/%@ used · %@ left": "%@/%@ terpakai · sisa %@",
        // Prorated allowance footnote, the web's words (R16-I-14)
        "From {date}: {days} days, {working} working days ({days} − {quota} days off, the {full}-day allowance prorated).": "Sejak {date}: {days} hari, {working} hari kerja ({days} − {quota} day off, jatah {full} hari dihitung proporsional).",
    ]
}
