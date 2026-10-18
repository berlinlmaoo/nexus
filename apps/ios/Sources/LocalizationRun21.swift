import Foundation

/// Indonesian strings for the fix 21a owner reverts. Keys must not appear in any other Localization*.swift
/// (scripts/check-localization.sh). Wording as on the web.
extension AppLanguage {
    static let indonesianRun21: [String: String] = [
        // Mac Home Attendance card: no check-in on the Mac (M-07)
        "Use the NEXUS app on your phone to check in": "Pakai app NEXUS di HP-mu untuk check-in",
        // Leaderboard podium, a step several people share (web "{n} tied")
        "%d tied": "%d orang seri",
        "The assignees changed. Check the latest list and try again.": "Penanggung jawab berubah. Periksa daftar terbaru lalu coba lagi.",
        "A task can have at most 20 tags.": "Satu task bisa memiliki maksimal 20 tag.",
        "That task moved to another section. The board has been refreshed; try the move again.": "Task itu pindah ke bagian lain. Board sudah diperbarui; coba pindahkan lagi.",
        "The description changed while you were editing. Review the latest version before saving again.": "Deskripsi berubah saat kamu mengedit. Periksa versi terbaru sebelum menyimpan lagi.",
        "The document changed while you were editing. Review the latest version before saving again.": "Dokumen berubah saat kamu mengedit. Periksa versi terbaru sebelum menyimpan lagi.",
        "The form changed while you were editing. Review the latest version before saving again.": "Form berubah saat kamu mengedit. Periksa versi terbaru sebelum menyimpan lagi.",
        "Your Vault is full. Remove a file before uploading another.": "Vault kamu penuh. Hapus file sebelum mengunggah yang lain.",
        "This folder no longer exists. Choose another folder.": "Folder ini sudah tidak ada. Pilih folder lain.",
        "A folder can't be moved inside itself or one of its subfolders.": "Folder tidak bisa dipindahkan ke dalam dirinya sendiri atau subfoldernya.",
        "This item no longer exists. Refresh the list.": "Item ini sudah tidak ada. Muat ulang daftar.",
        "The sheet columns changed. The latest version is shown; try your change again.": "Kolom sheet berubah. Versi terbaru ditampilkan; coba ubah lagi.",
        "Reload the sheet before changing its columns.": "Muat ulang sheet sebelum mengubah kolomnya.",
    ]
}
