import Foundation

// Owner's device test fixes, 22 Oct 2026: announcement origins (Announcements / System). Wording as
// the web's (fixes-22oct contract). Source-language keys are unique across tables.
extension AppLanguage {
    static let indonesianFixes22Oct: [String: String] = [
        // Control Room → Announcements
        "Post one above to tell everyone, or a few people, something.": "Kirim satu di atas untuk memberi tahu semua orang, atau beberapa orang.",
        "Nothing from the system": "Belum ada dari System",
        "Attendance warnings, app reminders and GIDEON posts show up here.": "Peringatan absensi, pengingat app, dan kiriman GIDEON muncul di sini.",
        "Posted from this page.": "Dikirim dari halaman ini.",
        "Attendance warnings, app reminders and GIDEON posts.": "Peringatan absensi, pengingat app, dan kiriman GIDEON.",
        "Attendance warning": "Peringatan absensi",
    ]
}
