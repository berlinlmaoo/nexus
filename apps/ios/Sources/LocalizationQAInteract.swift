import Foundation

// Indonesian for the strings added by "QA web fixes ported (13 Oct 2026) — part 2" (interaction, chat,
// GIDEON, editors). Merged into AppLanguage.translate after `indonesianRedesign`. Keys must not appear in
// any other Sources/Localization*.swift (a duplicate key traps): ./scripts/check-localization.sh.
extension AppLanguage {
    static let indonesianQAInteract: [String: String] = [
        // GIDEON failures (GideonProblem)
        "GIDEON can't be reached right now. Try again in a moment.": "GIDEON belum bisa dihubungi. Coba lagi sebentar lagi.",
        "GIDEON is busy right now. Wait a minute, then try again.": "GIDEON sedang sibuk. Tunggu sebentar, lalu coba lagi.",
        "GIDEON isn't connected on this server.": "GIDEON belum tersambung di server ini.",
        "GIDEON couldn't answer that. Try again.": "GIDEON tidak bisa menjawab itu. Coba lagi.",
        "GIDEON can't read documents on this server yet.": "GIDEON belum bisa membaca dokumen di server ini.",
        "That's a lot of AI requests in an hour. Try again a little later.": "Permintaan AI sudah banyak dalam satu jam ini. Coba lagi nanti.",
        "Couldn't open this conversation. %@": "Percakapan ini tidak bisa dibuka. %@",
        "This conversation doesn't exist any more. Start a new chat below.": "Percakapan ini sudah tidak ada. Mulai chat baru di bawah.",
        "Couldn't load your chats.": "Daftar chat tidak bisa dimuat.",
        "Couldn't delete the chat": "Chat tidak bisa dihapus",
        // Board: a new task kept after a failed add
        "Couldn't add the task": "Task tidak bisa ditambahkan",
        // Search: a person opens the chat
        "Couldn't start the chat.": "Chat tidak bisa dimulai.",
        // ⌘K link form
        "Add a link": "Tambah tautan",
        "Edit link": "Ubah tautan",
        "Link": "Tautan",
        "New link": "Tautan baru",
        "Links in this block": "Tautan di blok ini",
        "Paste or type a link…": "Tempel atau ketik tautan…",
        "Text to show (optional)": "Teks yang ditampilkan (opsional)",
        "Has a link": "Ada tautan",
        "Links can't go in this block": "Tautan tidak bisa di blok ini",
        "Put the link in a text, heading, list or toggle line.": "Taruh tautan di baris teks, judul, daftar, atau toggle.",
        // Page / description edits brought back from the device
        "Changes you made earlier on this device were brought back and are being saved.": "Perubahan yang kamu buat sebelumnya di perangkat ini dikembalikan dan sedang disimpan.",
    ]
}
