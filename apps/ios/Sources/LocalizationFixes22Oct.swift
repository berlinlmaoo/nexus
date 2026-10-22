import Foundation

// Owner's device test fixes, 22 Oct 2026: announcement origins (Announcements / System) and group chat
// photos. Wording as the web's (fixes-22oct contract). Source-language keys are unique across tables.
extension AppLanguage {
    static let indonesianFixes22Oct: [String: String] = [
        // Control Room → Announcements
        "Post one above to tell everyone, or a few people, something.": "Kirim satu di atas untuk memberi tahu semua orang, atau beberapa orang.",
        "Nothing from the system": "Belum ada dari System",
        "Attendance warnings, app reminders and GIDEON posts show up here.": "Peringatan absensi, pengingat app, dan kiriman GIDEON muncul di sini.",
        "Posted from this page.": "Dikirim dari halaman ini.",
        "Attendance warnings, app reminders and GIDEON posts.": "Peringatan absensi, pengingat app, dan kiriman GIDEON.",
        "Attendance warning": "Peringatan absensi",
        // Group photo
        "Group photo": "Foto grup",
        "Add group photo": "Tambah foto grup",
        "Change group photo": "Ganti foto grup",
        "Remove group photo?": "Hapus foto grup?",
        "Everyone in the group will see the default icon again.": "Semua anggota akan melihat ikon bawaan lagi.",
        "Group photo updated": "Foto grup diperbarui",
        "Group photo removed": "Foto grup dihapus",
        "Couldn't upload the photo": "Gagal mengunggah foto",
        "Couldn't remove the photo": "Foto tidak bisa dihapus",
        "PNG, JPG or WEBP, up to 5 MB": "PNG, JPG, atau WEBP, maks. 5 MB",
        "That photo is over 5 MB.": "Foto itu lebih dari 5 MB.",
        "Only group chats have a photo.": "Hanya chat grup yang punya foto.",
    ]
}
