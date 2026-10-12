import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for the dev redesign (owner, 12 Oct 2026: the app ships together with the redesigned web).
//
// A second table rather than more lines in Localization.swift: that literal is 3 300 lines long and every
// string added there is one more chance of a duplicate key, which traps at runtime the moment somebody
// picks Bahasa Indonesia (0.1.5). AppLanguage.translate reads Localization.swift first, then this.
//
// The pre-build script in project.yml and scripts/check-localization.sh fail on a key that appears twice
// in either table OR in both. Add new strings here; change an existing translation where it lives.
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianRedesign: [String: String] = [
        "“%@” wasn't saved. Check your connection and try again.": "“%@” belum tersimpan. Cek koneksimu lalu coba lagi.",
        "To-do": "Belum dikerjakan",
        "Complete": "Selesai",
        "Gray": "Abu-abu",
        "Brown": "Cokelat",
        "Orange": "Oranye",
        "Yellow": "Kuning",
        "Green": "Hijau",
        "Blue": "Biru",
        "Purple": "Ungu",
        "Pink": "Merah muda",
        "Red": "Merah",
        "Starts %@": "Mulai %@",
        "Add subtask": "Tambah subtask",
        "Couldn't save the change.": "Perubahan gagal disimpan.",
        "Attachments": "Lampiran",
        "Add files": "Tambah file",
        "Payout proof": "Bukti pencairan",
        "No files yet. Tap + to add receipts, proofs or documents.": "Belum ada file. Ketuk + untuk menambah nota, bukti, atau dokumen.",
        "Activity": "Aktivitas",
        "Changed the status from %@ to %@": "Mengubah status dari %@ ke %@",
        "Created this task from the form “%@”": "Membuat task ini dari form “%@”",
        "Created this task": "Membuat task ini",
        "Added a comment": "Menambahkan komentar",
        "Added an assignee": "Menambahkan assignee",
        "Removed an assignee": "Menghapus assignee",
        "The quest completes when this task is done. XP goes to the assignee, and the quest is visible to every project member. Max 50 XP.": "Quest selesai saat task ini selesai. XP masuk ke assignee, dan quest terlihat oleh semua anggota project. Maks 50 XP.",
        "XP reward": "Hadiah XP",
        "Reward": "Hadiah",
        // ── marker: entries are appended above this line by tooling; keep it last ──
        "__redesign_end__": "__redesign_end__",
    ]
}
