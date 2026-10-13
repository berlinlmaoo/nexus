import Foundation

// Indonesian for the project page's Mac / iPad parity pass (13 Oct 2026): the web's tab row (tools, split
// Add task), the Table and the Timeline. Merged into AppLanguage.translate after the other tables. Keys must
// not appear in any other Sources/Localization*.swift (a duplicate key traps at runtime):
// scripts/check-localization.sh.

extension AppLanguage {
    static let indonesianMacProject: [String: String] = [
        "1 day": "1 hari",
        "Add a task to": "Tambah task ke",
        "Filter": "Filter",
        "More ways to add": "Cara lain menambah",
        "Nothing on the timeline": "Belum ada apa-apa di timeline",
        "Tasks show here as bars from their start date to their due date.": "Task tampil di sini sebagai batang dari tanggal mulai sampai tenggatnya.",
        "Tasks you add to this project show up here. Start with the first one.": "Task yang kamu tambahkan ke project ini muncul di sini. Mulai dari yang pertama.",
        "View settings": "Pengaturan tampilan",
    ]
}
