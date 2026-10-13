import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for GIDEON's Mac / iPad parity pass (13 Oct 2026): the web's full page (chat list, header,
// empty state, composer card, approval modes) and the step lines worded from the tool. Wording follows the
// web's lib/i18n/id-gideon.ts and id-gideon-ai.ts. Keys must not appear in any other Localization*.swift
// (scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianMacGideon: [String: String] = [
        // Approval modes (composer "Review before writing ▾")
        "Always ask": "Selalu tanya",
        "Review before writing": "Tinjau sebelum menulis",
        "Don't ask": "Jangan tanya",
        "Every change GIDEON wants to make waits for you.": "Setiap perubahan dari GIDEON menunggu persetujuanmu.",
        "Edits, comments and tasks for other people wait for you. Your own new tasks and docs are made directly.": "Ubahan, komentar, dan task untuk orang lain menunggu persetujuanmu. Task dan dokumen baru untukmu sendiri langsung dibuat.",
        "GIDEON makes changes right away, as you.": "GIDEON langsung membuat perubahan, sebagai kamu.",
        "Before GIDEON changes something": "Sebelum GIDEON mengubah sesuatu",

        // Header, ⋯ menu, deleting
        "Acts in NEXUS as you": "Bertindak di NEXUS sebagai kamu",
        "New chat (⌘O)": "Chat baru (⌘O)",
        "GIDEON tier": "Tingkatan GIDEON",
        "Delete this chat": "Hapus chat ini",
        "Clear all chat history": "Hapus semua riwayat chat",
        "Clear every GIDEON chat?": "Hapus semua chat GIDEON?",
        "Clear history": "Hapus riwayat",
        "The conversation and its attached files are deleted for good. Tasks and docs GIDEON made stay.": "Percakapan dan file lampirannya dihapus permanen. Task dan doc yang dibuat GIDEON tetap ada.",
        "Every conversation, message and attached file is deleted for good. Tasks and docs GIDEON made stay.": "Semua percakapan, pesan, dan file lampiran dihapus permanen. Task dan dokumen buatan GIDEON tetap ada.",

        // Composer
        "The page you're on": "Halaman yang sedang kamu buka",
        "Remove this context": "Hapus konteks ini",
        "Ask anything. Type @ to add a page": "Tanya apa saja. Ketik @ untuk menambah halaman",
        "Add a photo": "Tambah foto",
        "Add a file (PDF, Word, Excel, text…)": "Tambah file (PDF, Word, Excel, teks…)",
        "Add a page, task or project": "Tambah halaman, task, atau project",
        "Add photos, files or pages": "Tambah foto, file, atau halaman",

        // Steps (worded from the tool, never the raw tool name)
        "Listing projects": "Melihat daftar project",
        "Looking up people": "Mencari orang",
        "Listing tasks in %@": "Melihat task di %@",
        "Listing tasks": "Melihat daftar task",
        "Searching tasks for “%@”": "Mencari task “%@”",
        "Searching tasks": "Mencari task",
        "Searching your workspace for “%@”": "Mencari di workspace-mu: “%@”",
        "Searching your workspace": "Mencari di workspace-mu",
        "Reading project %@": "Membaca project %@",
        "Reading a project": "Membaca project",
        "Reading %@": "Membaca %@",
        "Reading the project's fields": "Membaca kolom project",
        "Reading task %@": "Membaca task %@",
        "Reading a task": "Membaca task",
        "Searching docs for “%@”": "Mencari dokumen “%@”",
        "Searching docs": "Mencari dokumen",
        "Reading doc %@": "Membaca dokumen %@",
        "Reading a doc": "Membaca dokumen",
        "Creating task %@": "Membuat task %@",
        "Creating a task": "Membuat task",
        "Updating task %@": "Mengubah task %@",
        "Updating a task": "Mengubah task",
        "Commenting on %@": "Berkomentar di %@",
        "Commenting on a task": "Berkomentar di task",
        "Writing doc %@": "Menulis dokumen %@",
        "Writing a doc": "Menulis dokumen",
        "Looking at the image": "Melihat gambar",
        "Working on it": "Sedang dikerjakan",
        "1 failed": "1 gagal",
        "1 step": "1 langkah",
        "%d steps": "%d langkah",

        // Empty state and suggestions (the web's chips; GideonChatTitle has the same pairs)
        "It searches and reads your projects, tasks, docs and chats with your access only, and shows what it read.": "GIDEON mencari dan membaca project, task, dokumen, dan chat hanya dengan aksesmu, lalu menunjukkan apa saja yang dibacanya.",
        "Ask %@ about %@": "Tanya %@ soal %@",
        "What can %@ do for you?": "%@ bisa bantu apa?",
        "What's overdue for me?": "Apa saja task-ku yang terlambat?",
        "Summarize my week across projects": "Ringkas mingguku di semua project",
        "What did my team decide recently? Cite the sources.": "Apa yang baru diputuskan timku? Sebutkan sumbernya.",
        "Find the action items in this page": "Temukan action item di halaman ini",
        "What questions does this page leave open?": "Pertanyaan apa yang belum terjawab di halaman ini?",
        "What's the latest on this task?": "Apa kabar terbaru task ini?",
        "Break this task into subtasks": "Pecah task ini jadi subtask",
        "Draft a status comment for this task": "Buatkan draf komentar status untuk task ini",
        "this project": "project ini",
        "Summarize where %@ stands this week": "Ringkas posisi %@ minggu ini",
        "What's overdue in %@, and who owns it?": "Apa yang terlambat di %@, dan siapa PIC-nya?",
        "Turn the next steps of %@ into tasks": "Jadikan langkah berikutnya %@ sebagai task",

        // Chat list column
        "Chat title": "Judul chat",
        "No chats yet. Ask something to start one.": "Belum ada chat. Tanyakan sesuatu untuk memulai.",
        "No chat mentions “%@”.": "Tidak ada chat yang menyebut “%@”.",
        "Previous 7 days": "7 hari terakhir",
        "Older": "Lebih lama",
        "Couldn't rename this chat.": "Chat ini gagal diganti namanya.",
        "Couldn't delete this chat.": "Chat ini gagal dihapus.",
    ]
}
