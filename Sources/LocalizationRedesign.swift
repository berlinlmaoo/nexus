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
        "Couldn't load your submissions.": "Pengajuanmu gagal dimuat.",
        "Check your connection and try again.": "Cek koneksimu lalu coba lagi.",
        "Everything you send through a form (a payment request, a design request, a report) shows up here with where it stands, so you never have to ask.": "Semua yang kamu kirim lewat form (pengajuan dana, permintaan desain, laporan) muncul di sini beserta posisinya, jadi kamu tidak perlu bertanya.",
        "Nothing needs your action": "Tidak ada yang perlu kamu tindak lanjuti",
        "No submissions here": "Tidak ada pengajuan di sini",
        "When the team asks for a revision or replies to you, the request shows up here.": "Saat tim meminta revisi atau membalasmu, pengajuannya muncul di sini.",
        "Try another filter.": "Coba filter lain.",
        "Finance": "Finance",
        "Multimedia": "Multimedia",
        "All projects": "Semua project",
        "Filter by project": "Filter per project",
        "Needs my action": "Perlu tindakanku",
        "Read-only. The team moves the cards.": "Hanya baca. Tim yang memindahkan kartunya.",
        "Proof": "Bukti",
        "Needs your reply": "Perlu balasanmu",
        "This submission no longer exists, or the link is wrong.": "Pengajuan ini sudah tidak ada, atau tautannya salah.",
        "It may have been deleted. Your other submissions are on My Submissions.": "Mungkin sudah dihapus. Pengajuanmu yang lain ada di Pengajuan Saya.",
        "Delete this submission?": "Hapus pengajuan ini?",
        "Its task in the project is deleted too.": "Task-nya di project ikut terhapus.",
        "Couldn't do that": "Tidak bisa melakukannya",
        "Submitted %@": "Dikirim %@",
        "Category": "Kategori",
        "Handled by": "Ditangani oleh",
        "Not assigned yet": "Belum ada yang menangani",
        "Your answers": "Jawabanmu",
        "Proof of payment": "Bukti pembayaran",
        "Tap to open or save": "Ketuk untuk membuka atau menyimpan",
        "Couldn't open the file.": "File gagal dibuka.",
        "Status history": "Riwayat status",
        "Moved to %@": "Dipindah ke %@",
        "No comments yet. Ask the team here if something is unclear.": "Belum ada komentar. Tanya tim di sini kalau ada yang belum jelas.",
        "Reply to the team…": "Balas ke tim…",
        "Deleting this submission also deletes its task in the project.": "Menghapus pengajuan ini juga menghapus task-nya di project.",
        "Couldn't delete the submission.": "Pengajuan gagal dihapus.",
        "%@: enter an email address, like name@company.com.": "%@: isi alamat email, misalnya nama@perusahaan.com.",
        "%@: enter a web address, like company.com.": "%@: isi alamat web, misalnya perusahaan.com.",
        "A question": "Sebuah pertanyaan",
        // ── marker: entries are appended above this line by tooling; keep it last ──
        "__redesign_end__": "__redesign_end__",
    ]
}
