import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for project access levels, QA round 2 (13 Oct 2026; web 5e416d9 + e74a735): Can view / Can
// comment see a project read-only, the project chat's "View only" line, the readable access refusals
// (NEEDS_EDIT_ACCESS / NEEDS_COMMENT_ACCESS / NEEDS_FULL_ACCESS) and the "can't open this task / page"
// states. Wording follows the web's id-qafix-perm.ts / id tables. Keys must not appear in any other
// Localization*.swift table (a duplicate key traps at runtime): scripts/check-localization.sh.
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianAccessR2: [String: String] = [
        "View only: you can read this project's chat but not post in it. Ask its Project Owner for Can comment access.": "Hanya lihat: kamu bisa membaca chat project ini tapi tidak bisa mengirim pesan. Minta Pemilik Project akses Bisa komentar.",
        "You can view this project but not change it. Ask its Project Owner for Can edit access.": "Kamu bisa melihat project ini tapi tidak bisa mengubahnya. Minta Pemilik Project akses Bisa edit.",
        "You can view this project but not comment. Ask its Project Owner for Can comment access.": "Kamu bisa melihat project ini tapi tidak bisa berkomentar. Minta Pemilik Project akses Bisa komentar.",
        "Only people with Full access to the project can do this.": "Hanya yang punya Akses penuh ke project yang bisa melakukan ini.",
        "You can comment on this task, but not change it.": "Kamu bisa berkomentar di task ini, tapi tidak bisa mengubahnya.",
        "View only: you can read this task, but not change it.": "Hanya lihat: kamu bisa membaca task ini, tapi tidak bisa mengubahnya.",
        "this task": "Task ini",
        "This task doesn't exist any more": "Task ini sudah tidak ada",
        "It was deleted, or the link is wrong. A BoD or manager can restore a deleted task from Control Room → Audit for 90 days.": "Task ini sudah dihapus, atau tautannya salah. BoD atau manager bisa memulihkan task yang dihapus dari Control Room → Audit selama 90 hari.",
        "You can't open this task": "Kamu tidak bisa membuka task ini",
        "It's in a project you're not a member of. Ask its Project Owner to add you.": "Ini ada di project yang kamu bukan anggotanya. Minta Pemilik Project menambahkanmu.",
        "this page": "Halaman ini",
        "This page doesn't exist any more": "Halaman ini sudah tidak ada",
        "You can't open this page": "Kamu tidak bisa membuka halaman ini",
        "No files yet.": "Belum ada file.",
        "No updates yet.": "Belum ada update.",
        "Pick a date to see its tasks.": "Pilih tanggal untuk melihat tugasnya.",
        "Only on this screen. Saving a filter to the view needs Can edit access.": "Hanya di layar ini. Menyimpan filter ke tampilan butuh akses Bisa edit.",
    ]
}
