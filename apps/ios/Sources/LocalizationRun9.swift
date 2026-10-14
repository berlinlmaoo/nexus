import Foundation

/// Indonesian strings for the UI tour run 9 iOS fixes (14 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun9: [String: String] = [
        // Project tab row: the "…" menu when the tabs do not fit
        "All views": "Semua tampilan",
        // Attendance → Offices
        "Offices & geofence": "Kantor & geofence",
        "Office locations and the check-in radius.": "Titik kantor + radius check-in.",
        "radius %d m": "radius %d m",
        // Project List: start → due
        "Start %@": "Mulai %@",
        // My Submissions (web id-r7web.ts)
        "None of your submissions are at this stage right now. The team moves a card here when its work reaches it.": "Belum ada pengajuanmu di tahap ini. Tim memindahkan kartu ke sini saat pekerjaannya sampai di tahap ini.",
        // GIDEON chat list
        "Ask something to start one.": "Tanyakan sesuatu untuk memulai.",
        // Notifications
        "Mark as read": "Tandai sudah dibaca",
    ]
}
