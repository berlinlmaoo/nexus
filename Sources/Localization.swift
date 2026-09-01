import Foundation
import Observation

// ─────────────────────────────────────────────────────────────────────────────
// Localisation.
//
// The app ships ENGLISH as the source language: every UI literal in the code is
// already the English copy, so the default path is a pass-through with nothing to
// look up and nothing that can silently fall back to the wrong language.
//
// Indonesian is an opt-in overlay: `"Save"` returns "Simpan" only when the user
// picked Indonesian AND a translation exists. A missing entry falls back to the
// English source — degraded, never blank, never a raw key.
//
// Why not .strings / String Catalogs? Those resolve against the SYSTEM language and
// need an app relaunch to switch. The requirement here is an in-app switch that
// applies immediately, so the lookup goes through an @Observable store: reading
// `lang` inside a SwiftUI body registers the dependency, and flipping it re-renders
// every screen at once.
// ─────────────────────────────────────────────────────────────────────────────

enum AppLang: String, CaseIterable, Identifiable, Sendable {
    case en, id
    var id: String { rawValue }
    /// Shown in the picker — each in its own language, the usual convention.
    var label: String {
        switch self {
        case .en: return "English"
        case .id: return "Bahasa Indonesia"
        }
    }
    var flag: String {
        switch self {
        case .en: return "🇬🇧"
        case .id: return "🇮🇩"
        }
    }
}

@Observable
final class AppLanguage {
    static let shared = AppLanguage()

    private static let key = "nexus.language"

    var lang: AppLang {
        didSet { UserDefaults.standard.set(lang.rawValue, forKey: Self.key) }
    }

    private init() {
        // English by default. Only a value the user explicitly chose changes that —
        // deliberately NOT derived from the device locale.
        let saved = UserDefaults.standard.string(forKey: Self.key) ?? ""
        lang = AppLang(rawValue: saved) ?? .en
    }

    func translate(_ english: String) -> String {
        guard lang == .id else { return english }
        return Self.indonesian[english] ?? english
    }

    /// English → Indonesian. Keys must match the source literal EXACTLY.
    /// Anything missing simply stays English.
    /// WARNING: a Swift dictionary LITERAL traps at runtime on a duplicate key — "Fatal error:
    /// Dictionary literal contains duplicate keys". Because `static let` is lazy and `translate()`
    /// returns early while the language is English, this dictionary is only ever built the moment
    /// somebody picks Bahasa Indonesia — so a duplicate key here is an invisible crash that waits
    /// for the language switch. Two of them were sitting in this file. Check before adding:
    ///
    ///     grep -o '^ *"[^"]*":' Sources/Localization.swift | sort | uniq -d
    static let indonesian: [String: String] = [
        // ── shell / navigation ────────────────────────────────────────────────
        "Home": "Beranda",
        "Tasks": "Tugas",
        "Inbox": "Kotak Masuk",
        "Projects": "Proyek",
        "More": "Lainnya",
        "Search..": "Cari..",
        "Search": "Cari",
        "Home Base": "Markas",
        "Missions": "Misi",
        "Knowledge": "Pengetahuan",
        "Pulse Check": "Cek Denyut",
        "System": "Sistem",
        "Messages": "Pesan",
        "My Submissions": "Pengajuan Saya",
        "Send a photo": "Kirim foto",
        "Show sidebar": "Tampilkan bilah sisi",
        "Pick a conversation": "Pilih percakapan",
        "Hide sidebar": "Sembunyikan bilah sisi",
        "Pinned": "Disematkan",
        "Recent": "Baru dibuka",
        "Pin": "Sematkan",
        "Unpin": "Lepas sematan",
        "Remove from sidebar": "Hapus dari bilah sisi",
        "Take a photo": "Ambil foto",
        "Rename group": "Ganti nama grup",
        "Group name": "Nama grup",
        "Couldn't rename that group.": "Nama grup itu tidak bisa diganti.",
        "Add people": "Tambah orang",
        "Added to the group.": "Ditambahkan ke grup.",
        "Every workspace member is already in this chat.": "Semua anggota workspace sudah ada di obrolan ini.",
        "Everyone's already here": "Semua orang sudah di sini",
        "Every workspace member is already in this project.": "Semua anggota workspace sudah ada di project ini.",
        "Anyone you add joins the project itself, not just this chat.": "Orang yang lo tambahkan ikut masuk ke project-nya, bukan cuma ke chat ini.",
        "Couldn't add everyone. Some people were left out.": "Tidak semua orang berhasil ditambahkan.",
        "Added. They'll show up here once they open the app.": "Sudah ditambahkan. Mereka muncul di sini setelah membuka aplikasi.",
        "New chat": "Chat baru",
        "New group": "Grup baru",
        "Start a chat": "Mulai chat",
        "Search people": "Cari orang",
        "Group name (optional)": "Nama grup (opsional)",
        "Nobody to chat with yet": "Belum ada orang untuk diajak chat",
        "Workspace members show up here once they've joined.": "Anggota workspace muncul di sini begitu mereka bergabung.",
        "Couldn't start that chat. Try again.": "Chat itu tidak bisa dimulai. Coba lagi.",
        "Remove photo": "Hapus foto",
        "Couldn't read that photo.": "Foto itu tidak terbaca.",
        "Upload failed. Try again.": "Unggahan gagal. Coba lagi.",
        "New": "Baru masuk",
        "Submitted": "diajukan",
        "Read-only — status is set by the Finance team": "Read-only — status diatur tim Finance",
        "Team Calendar": "Kalender Tim",
        "Room Booking": "Booking Ruangan",
        "Leaderboard": "Papan Peringkat",
        "Reports": "Laporan",
        "Knowledge Library": "Pustaka Pengetahuan",
        "Forms": "Formulir",
        "Attendance": "Absensi",
        "Ticket": "Tiket",
        "Teams": "Tim",
        "Tuning Room": "Ruang Setelan",
        "Control Room": "Ruang Kendali",
        "Logout": "Keluar",

        // ── generic actions / states ──────────────────────────────────────────
        "Cancel": "Batal",
        "Save": "Simpan",
        "Delete": "Hapus",
        "Close": "Tutup",
        "Add": "Tambah",
        "Create": "Buat",
        "Edit": "Ubah",
        "Send": "Kirim",
        "Try again": "Coba lagi",
        "Loading…": "Memuat…",
        "Saved ✓": "Tersimpan ✓",
        "Something went wrong.": "Terjadi kesalahan.",
        "Empty": "Kosong",
        "Untitled": "Tanpa judul",
        "Nothing here yet.": "Belum ada apa-apa.",
        "Required": "Wajib",
        "Optional": "Opsional",
        "Open": "Terbuka",
        "Your name": "Nama kamu",
        "Couldn't load.": "Gagal memuat.",

        // ── my tasks / inbox ──────────────────────────────────────────────────
        "My Quest Log": "Catatan Quest Saya",
        "Hot today": "Panas hari ini",
        "In motion": "Sedang jalan",
        "Recently slayed": "Baru ditaklukkan",
        "Signal Inbox": "Kotak Sinyal",
        "Mark all": "Tandai semua",
        "Inbox clean": "Kotak masuk bersih",
        "No pings. Enjoy the rare silence.": "Nggak ada notif. Nikmatin sunyinya.",
        "New NEXUS signal arrived.": "Ada sinyal NEXUS baru.",
        "Login required to open the inbox.": "Login/session diperlukan untuk buka inbox.",
        "Your Mission": "Misi Kamu",
        "Monthly Quests": "Quest Bulanan",
        "Commander": "Komandan",

        // ── login ─────────────────────────────────────────────────────────────
        "ACCESS ID (EMAIL)": "ACCESS ID (EMAIL)",
        "ENCRYPTION KEY": "KUNCI ENKRIPSI",
        "Enter Mission Control": "Masuk Mission Control",
        "Opening uplink…": "Membuka uplink…",
        "Fill in your Access ID and Encryption Key first.": "Isi Access ID dan Encryption Key dulu ya.",
        "Login failed. Check your email/password.": "Login gagal. Cek email/password.",
        "Forgot your password or don't have access yet?\nContact your workspace admin.":
            "Lupa password atau belum punya akses?\nHubungi admin workspace kamu.",

        // ── errors ────────────────────────────────────────────────────────────
        "Session expired — please log in again.": "Sesi habis — login lagi ya.",
        "Couldn't read data from the server.": "Gagal baca data dari server.",
        "Location permission denied. Turn it on in Settings › NEXUS › Location.":
            "Izin lokasi ditolak. Aktifin di Settings › NEXUS › Location.",
        "Couldn't read your location. Make sure GPS is on and the signal is good.":
            "Lokasi gak kebaca. Pastiin GPS nyala & sinyalnya cukup.",

        // ── dashboard ─────────────────────────────────────────────────────────
        "Good Morning,": "Selamat Pagi,",
        "Good Afternoon,": "Selamat Siang,",
        "Good Evening,": "Selamat Malam,",
        "Your Quests": "Quest Kamu",
        "See All": "Lihat Semua",
        "No active quests yet. Your XP comes from tasks, streaks & attendance — see \"XP Rules\" below.":
            "Belum ada quest aktif. XP kamu jalan dari task, streak, & absen — cek \"Aturan XP\" di bawah.",
        "XP / Points Rules": "Aturan XP / Poin",
        "Deductions, bonuses & monthly reward tiers": "Potongan, bonus, & reward tier bulanan",
        "Edit Profile": "Ubah Profil",
        "LEVEL": "LEVEL",
        "POINTS THIS PERIOD": "POIN PERIODE",
        "Daily agenda": "Agenda harian",
        "Nothing due on this date.": "Nggak ada task jatuh tempo di tanggal ini.",
        "Chat": "Chat",
        "Notifications": "Notifikasi",
        "unread": "belum dibaca",
        "All read": "Semua kebaca",
        "No notifications yet.": "Belum ada notifikasi.",
        "No projects yet.": "Belum ada project.",
        "No open tasks.": "Belum ada task aktif.",
        "No quests yet.": "Belum ada quest.",
        "Streak": "Streak",
        "Quests claimed": "Quest klaim",
        "Total XP": "Total XP",

        // ── attendance ────────────────────────────────────────────────────────
        "Daily reflection": "Refleksi harian",
        "Required before check-out. Tell us what you worked on today.":
            "Wajib diisi sebelum check-out. Ceritain apa yang kamu kerjain hari ini.",
        "Today I worked on…": "Hari ini aku ngerjain…",
        "Loading attendance status…": "Memuat status absen…",
        "Failed.": "Gagal.",
        "Check-in successful ✓": "Check-in berhasil ✓",
        "Check-out successful ✓": "Check-out berhasil ✓",
        "Checkout sent — waiting for BoD approval ⏳": "Checkout terkirim — nunggu approval BoD ⏳",
        "⚠️ You still have an earlier shift that was never checked out. Tap PRESENCE OUT to close it first — then you can clock in again.":
            "⚠️ Masih ada absen sebelumnya yang belum di-check-out. Pencet PRESENCE OUT dulu buat nutup — baru bisa absen lagi.",
        "⏳ Checkout outside the office area — waiting for BoD approval":
            "⏳ Checkout di luar area — nunggu approval BoD",
        "Your out-of-area checkout was rejected by the BoD.": "Checkout di luar area kamu ditolak BoD.",
        "You're outside the office area": "Kamu di luar area kantor",
        "Reason (e.g. content shoot / client meeting)": "Alasan (mis. shoot konten / meeting client)",
        "Checkout & request approval": "Checkout & minta approval",
        "Sending…": "Mengirim…",
        "Finish yesterday's attendance": "Selesaikan absen kemarin",
        "Done for today 🎉": "Selesai hari ini 🎉",
        "Currently clocked-in": "Lagi clocked-in",
        "Ready to check in": "Siap check-in",
        "Today's status": "Status hari ini",
        "Office checkpoint": "Checkpoint kantor",
        "Day-off tokens": "Jatah day-off",
        "This month's day-off allowance": "Jatah day-off bulan ini",
        "Public holidays": "Tanggal merah",
        "This month's public-holiday allowance": "Jatah tanggal merah bulan ini",
        "Live from the NEXUS attendance API": "Live dari NEXUS attendance API",
        "Crew streak board": "Papan streak kru",
        "Your attendance history": "Riwayat absen kamu",
        "No attendance recorded this month.": "Belum ada absen tercatat bulan ini.",
        "Present": "Hadir",
        "Leave/Permit": "Cuti/Izin",
        "Sick": "Sakit",
        "Day off": "Day off",
        "Manage attendance": "Atur absen",
        "You": "Kamu",
        "Want to check out from here? **A reason is required** — the checkout will wait for BoD approval.":
            "Mau checkout dari sini? **Wajib isi alasan** — checkout-nya nunggu approval BoD dulu.",
        "That day's check-in & check-out are deleted permanently, and the day is shielded from attendance deductions.":
            "Data check-in & check-out hari itu kehapus permanen + hari itu diamankan dari potongan.",
        "Direct": "Langsung",
        "Groups": "Grup",
        "TASK": "TASK",
        "Create folder": "Buat folder",
        "Check-in": "Check-in",
        "Check-out": "Check-out",
        "Delete this attendance record": "Hapus absen ini",
        "Delete check-out (reopen)": "Hapus check-out (buka lagi)",
        "Delete attendance data": "Hapus data absen",
        "Couldn't delete.": "Gagal menghapus.",

        // ── projects ──────────────────────────────────────────────────────────
        "Mission Control": "Mission Control",
        "No missions yet": "Belum ada mission",
        "New mission": "Mission baru",
        "New folder": "Folder baru",
        "Edit folder": "Edit folder",
        "Delete folder": "Hapus folder",
        "Move to folder": "Pindah ke folder",
        "No folder": "Tanpa folder",
        "Empty folder.": "Folder kosong.",
        "FOLDER NAME": "NAMA FOLDER",
        "MISSION NAME": "NAMA MISSION",
        "ICON": "IKON",
        "COLOR": "WARNA",
        "Launch mission": "Luncurkan mission",
        "Couldn't save folder.": "Gagal simpan folder.",
        "Couldn't create project.": "Gagal bikin project.",
        "Calculating…": "Menghitung…",
        "Solo quest": "Solo quest",
        "No deadline": "Tanpa deadline",
        "Cards": "Kartu",
        "Done": "Selesai",
        "Lanes": "Lajur",
        "left": "sisa",

        // ── tasks ─────────────────────────────────────────────────────────────
        "No quests yet": "Belum ada quest",
        "Tasks assigned to you show up here.": "Task yang di-assign ke kamu muncul di sini.",
        "New task": "Task baru",
        "Create task": "Buat task",
        "Couldn't create task.": "Gagal bikin task.",
        "TASK TITLE": "JUDUL TASK",
        "SECTION": "SECTION",
        "PRIORITY": "PRIORITAS",
        "DEADLINE": "DEADLINE",
        "Use a deadline": "Pakai deadline",
        "Pick a section": "Pilih section",
        "Add task": "Tambah task",
        "Task title…": "Judul task…",
        "Delete task": "Hapus task",
        "Delete this task?": "Hapus task ini?",
        "The task, its subtasks and comments will be deleted.":
            "Task beserta subtask & komentarnya akan dihapus.",
        "Subtasks": "Subtask",
        "No subtasks yet.": "Belum ada subtask.",
        "+ Add subtask (Enter)": "+ Tambah subtask (Enter)",
        "No comments yet.": "Belum ada komentar.",
        "Write a comment…": "Tulis komentar…",
        "Add a description…": "Tambah deskripsi…",
        "Unassigned": "Belum ditugaskan",
        "Subtask of": "Subtask dari",
        "Make it a quest": "Jadiin quest",
        "Create another quest": "Bikin quest lain",
        "Finish this task to earn XP": "Selesaiin task ini buat dapet XP",
        "tasks done": "task selesai",
        "Pick a date to see its tasks, or tap + to create one.":
            "Pilih tanggal buat lihat task-nya, atau tap + buat bikin task baru.",
        "No tasks on this date.": "Gak ada task di tanggal ini.",

        // ── project tabs ──────────────────────────────────────────────────────
        "Spreadsheet": "Spreadsheet",
        "No tasks to show in the spreadsheet yet.": "Belum ada task buat ditampilin di spreadsheet.",
        "No tasks to put on the timeline yet.": "Belum ada task buat di-timeline.",
        "No pages in this project yet.": "Belum ada page di project ini.",
        "No forms in this project yet.": "Belum ada form di project ini.",
        "This folder is empty. Upload a file or create a folder with the + button.":
            "Folder ini kosong. Upload file atau bikin folder lewat tombol +.",
        "Upload file": "Upload file",
        "Download": "Unduh",
        "Folder": "Folder",
        "Folder name": "Nama folder",
        "Project chat room isn't active yet (needs the Messages backend).":
            "Project chat room belum aktif (perlu backend Messages).",
        "Project locked — you're not a member of this project.":
            "Project terkunci — kamu belum jadi member project ini.",
        "Couldn't load the project.": "Gagal memuat project.",
        "This project has no lanes yet.": "Project ini belum punya lane.",

        // ── chat ──────────────────────────────────────────────────────────────
        "No messages yet. Say hi 👋": "Belum ada pesan. Say hi 👋",
        "Write a message…": "Tulis pesan…",
        "No chats yet": "Belum ada chat",
        "Couldn't load chats.": "Gagal memuat chat.",
        "Send location": "Kirim lokasi",
        "Link to a task": "Link ke task",
        "Couldn't send your location.": "Gagal kirim lokasi.",
        "Shared location": "Lokasi dibagikan",
        "No message yet": "Belum ada pesan",
        "Search a task": "Cari task",
        "No tasks available to link from here.": "Nggak ada task yang bisa di-link dari sini.",
        "My location:": "Lokasi saya:",
        "Open task": "Buka task",

        // ── ticket ────────────────────────────────────────────────────────────
        "All": "Semua",
        "No tickets in this filter": "Nggak ada ticket di filter ini",
        "Switch the filter above to see other statuses.":
            "Ganti filter di atas buat lihat status lain.",
        "Couldn't load tickets.": "Gagal memuat ticket.",
        "Report body": "Isi laporan",
        "Photo evidence": "Foto bukti",
        "(no subject)": "(tanpa judul)",

        // ── settings ──────────────────────────────────────────────────────────
        "NAME": "NAMA",
        "EMAIL": "EMAIL",
        "Save profile": "Simpan profil",
        "LANGUAGE": "BAHASA",
        "App language": "Bahasa aplikasi",
        "Applies immediately across the whole app.": "Langsung berlaku di seluruh aplikasi.",
        "MEMBERS": "MEMBER",
        "Invite": "Undang",
        "New member's email": "Email member baru",
        "Couldn't invite member.": "Gagal undang member.",
        "Remove": "Keluarkan",
        "SECURITY": "KEAMANAN",
        "Current password": "Password sekarang",
        "New password (min 6)": "Password baru (min 6)",
        "Repeat new password": "Ulangi password baru",
        "Change password": "Ganti password",
        "Password changed ✓": "Password diganti ✓",
        "Failed — check your current password.": "Gagal — cek password sekarang.",

        // ── task detail ───────────────────────────────────────────────────────
        "Task": "Task",
        "task": "task",
        "Task title": "Judul task",
        "Couldn't load the task.": "Gagal memuat task.",
        "No members in this project yet.": "Belum ada member di project ini.",
        "Quest": "Quest",
        "Quest title": "Judul quest",
        "Create quest": "Bikin quest",
        "Creating…": "Bikin…",
        "Couldn't create the quest.": "Gagal bikin quest.",
        "The quest completes when this task is DONE. XP goes to the assignee, and the quest is visible to every project member. Max 50 XP.":
            "Quest selesai kalau task ini DONE. XP masuk ke yang ngerjain (assignee), dan quest-nya keliatan buat semua member project. Maksimal 50 XP.",

        // ── project tabs / composer ───────────────────────────────────────────
        "Section": "Section",
        "Status": "Status",
        "Priority": "Prioritas",
        "Due": "Tenggat",
        "Assignee": "Penerima",
        "Name": "Nama",
        "CUSTOM FIELDS": "CUSTOM FIELD",
        "Place / location name": "Lokasi / nama tempat",
        "Google Maps link": "Link Google Maps",

        // ── project settings ──────────────────────────────────────────────────
        "Project name": "Nama project",
        "Use an emoji instead": "Pakai emoji lagi",
        "Save identity": "Simpan identitas",
        "Task duplicate mode": "Mode duplicate task",
        "Multi-select duplicate + a due-date popup for recurring tasks.":
            "Multi-select duplicate + popup due date buat task berulang.",
        "Standalone finance view: daily spend, incoming-cash pipeline.":
            "View keuangan standalone: pengeluaran harian, pipeline uang masuk.",
        "Auto-assign the selected members to new tasks in this project.":
            "Otomatis assign member kepilih ke task baru di project ini.",
        "Pick at least one member first.": "Pilih minimal satu member dulu.",
        "No custom fields in this project yet.": "Belum ada custom field di project ini.",
        "Project members": "Member Project",
        "Add member": "Tambah member",
        "Invite by email": "Undang lewat email",
        "Delete project": "Hapus project",
        "Delete permanently": "Hapus permanen",
        "Couldn't save — try again.": "Gagal nyimpen — coba lagi.",
        "Couldn't duplicate.": "Gagal duplikat.",

        // ── admin (control room) ──────────────────────────────────────────────
        "Delete account": "Hapus akun",
        "Their tasks/files/quests are reassigned to you. This cannot be undone.":
            "Task/file/quest yang dia bikin dialihkan ke kamu. Gak bisa di-undo.",
        "No audit entries yet.": "Belum ada entri audit.",
        "No quests yet. Create one above.": "Belum ada quest. Bikin di atas.",
        "Has ≥N overdue (penalty)": "Punya ≥N overdue (penalti)",
        "TITLE": "JUDUL",
        "BODY": "ISI",
        "e.g. Finish 5 tasks this week": "mis. Selesaikan 5 task minggu ini",
        "No announcements yet.": "Belum ada pengumuman.",
        "Announcement title": "Judul pengumuman",
        "Announcement body…": "Isi pengumuman…",

        // ── sprints / automations / finance ───────────────────────────────────
        "No sprints yet. Create a cycle to focus execution.":
            "Belum ada sprint. Bikin cycle buat fokusin eksekusi.",
        "No cards in this sprint yet.": "Belum ada card di sprint ini.",
        "SPRINT NAME": "NAMA SPRINT",
        "END": "SELESAI",
        "IF": "KALAU",
        "Create sprint": "Bikin sprint",
        "Couldn't create the sprint.": "Gagal bikin sprint.",
        "No automations yet. Set up rules from the web app (desktop).":
            "Belum ada automation. Atur rule otomatis lewat web (desktop).",
        "Finance isn't available for this project yet.": "Finance belum tersedia buat project ini.",
        "P&L isn't enabled / BoD access required.": "P&L belum diaktifin / akses BoD diperlukan.",

        // ── attendance admin / offices / requests ─────────────────────────────
        "Shift, day-off and public-holiday settings can only be managed by BoD / One Above All.":
            "Pengaturan shift, jatah libur & tanggal merah cuma bisa diatur BoD / One Above All.",
        "SHIFT & DAY-OFF ALLOWANCE": "SHIFT & JATAH LIBUR",
        "Allowance / staff this month": "Jatah / staff bulan ini",
        "Save allowance": "Simpan jatah",
        "Allowance is still 0 — staff can't request public holidays this month until it's set.":
            "Jatah masih 0 — staff belum bisa ajuin tanggal merah bulan ini sampai diisi.",
        "Holidays / public holidays": "Hari libur / tanggal merah",
        "No public holidays this month.": "Belum ada tanggal merah di bulan ini.",
        "Date": "Tanggal",
        "Name (e.g. Eid al-Adha)": "Nama (mis. Hari Raya Idul Adha)",
        "Save public holiday": "Simpan tanggal merah",
        "Public Holiday": "Tanggal Merah",
        "No offices yet. Add an office point + geofence radius.":
            "Belum ada office. Tambah titik kantor + radius geofence.",
        "OFFICE NAME": "NAMA OFFICE",
        "Create office": "Bikin office",
        "Couldn't save the office.": "Gagal simpan office.",
        "No requests yet.": "Belum ada pengajuan.",
        "Pick a photo / file (max 10MB)": "Pilih foto / file (maks 10MB)",
        "Couldn't send the request.": "Gagal kirim pengajuan.",
        "Different from the team/office shift": "Beda dari shift tim/kantor",
        "Save shift": "Simpan shift",
        "Workspace not loaded yet — try reopening.": "Workspace belum kebaca — coba buka ulang.",
        "Per-day override (optional)": "Override per hari (opsional)",
        "Used this month": "Kepakai bulan ini",
        "Allowance / month": "Jatah / bulan",

        // ── docs / forms / teams / reports / search / submissions ─────────────
        "Search docs…": "Cari docs…",
        "The shelf is still empty": "Shelf masih kosong",
        "No matches": "Gak ada yang cocok",
        "No docs in this workspace yet.": "Belum ada docs di workspace ini.",
        "Try another keyword.": "Coba kata kunci lain.",
        "This doc is still empty.": "Doc ini masih kosong.",
        "Couldn't load the doc.": "Gagal memuat doc.",
        "No forms yet": "Belum ada form",
        "Intake forms that auto-spawn tasks appear here.":
            "Intake form yang spawn task otomatis muncul di sini.",
        "An intake form that spawns a task automatically on submit.":
            "Form intake yang spawn task otomatis pas di-submit.",
        "Couldn't load forms.": "Gagal memuat forms.",
        "No teams yet": "Belum ada team",
        "Team members automatically get access to the linked projects.":
            "Anggota team otomatis dapat akses ke project yang di-link.",
        "Couldn't load teams.": "Gagal memuat teams.",
        "Couldn't load the leaderboard.": "Gagal memuat leaderboard.",
        "No data yet.": "Belum ada data.",
        "Search tasks, projects, docs, members…": "Cari task, project, doc, member…",
        "Type at least 2 characters to search.": "Ketik minimal 2 huruf buat nyari.",
        "Start typing to search.": "Mulai ngetik buat nyari.",
        "Couldn't load": "Gagal memuat",
        "Try again later.": "Coba lagi nanti.",
        "No submissions yet": "Belum ada pengajuan",
        "Forms you submit show up on this board together with their status.":
            "Form yang kamu ajukan bakal muncul di board ini lengkap sama statusnya.",
        "No bookings in the next 14 days.": "Belum ada booking dalam 14 hari ke depan.",
        "Couldn't load bookings.": "Gagal memuat booking.",
        "No events in the next 14 days.": "Belum ada event dalam 14 hari ke depan.",

        // ── folder aggregate / task detail extras / project settings extras ───
        "Loading tasks…": "Memuat task…",
        "This folder has no projects yet.": "Folder ini belum punya project.",
        "This folder has no projects yet. Move a project here, or pick some via 'Pick projects'.":
            "Folder ini belum punya project. Pindahin project ke sini, atau pilih lewat 'Pilih project'.",
        "Select all": "Pilih semua",
        "Pick projects": "Pilih project",
        "No files yet. Tap + to upload.": "Belum ada file. Tap + buat upload.",
        "No dependencies yet.": "Belum ada dependency.",
        "No other tasks.": "Gak ada task lain.",
        "Search tasks…": "Cari task…",
        "Add dependency": "Tambah dependency",
        "Field name": "Nama field",
        "Create field": "Buat field",
        "Add an option…": "Tambah pilihan…",
        "name@company.com": "nama@perusahaan.com",
        "Send invite": "Kirim undangan",
        "Invite member": "Undang member",
        "Complete N tasks": "Selesaikan N task",

        // ── interpolated strings (assembled at runtime) ───────────────────────
        "SICK NOTE PHOTO": "FOTO SURAT SAKIT",
        "SUPPORTING PHOTO (OPTIONAL)": "FOTO PENDUKUNG (OPSIONAL)",
        " (REQUIRED)": " (WAJIB)",
        " (OPTIONAL)": " (OPSIONAL)",
        "For cleaning up an accidental check-in. \"Delete this attendance record\" removes the record and shields that day from attendance deductions. It is written to the audit log.":
            "Buat ngebersihin check-in yang kepencet gak sengaja. \"Hapus absen ini\" = record-nya ilang + hari itu diamankan dari potongan absen. Tercatat di audit log.",
        "Pick which projects go into this folder's calendar.":
            "Pilih project mana yang masuk calendar folder ini.",
        " Right now it's showing EVERY project in the folder.":
            " Sekarang lagi nampilin SEMUA project di folder.",
        "Every task, field and project data goes with it. This cannot be undone.":
            "Semua task, field & data project ikut kehapus. Gabisa di-undo.",

        // ── threads (feed) ────────────────────────────────────────────────────
        "Threads": "Utas",
        "Thread": "Utas",
        "What's new?": "Lagi ada apa?",
        "Post": "Kirim",
        "Comments": "Komentar",
        "Reply… (@ to mention)": "Balas… (@ buat sebut orang)",
        "Nothing on the feed yet. Be the first to post.": "Feed masih kosong. Jadi yang pertama posting.",
        "Couldn't load the feed.": "Gagal memuat feed.",
        "Couldn't post.": "Gagal mengirim.",

        // ── team calendar ─────────────────────────────────────────────────────
        "All teams": "Semua tim",
        "All day": "Seharian",
        "No events on this date.": "Nggak ada event di tanggal ini.",
        "Pick a date to see its events.": "Pilih tanggal buat lihat event-nya.",
        "Couldn't load the calendar.": "Gagal memuat kalender.",
        // Passed as a variable (T(d)) so the extractor can't see these — keep them here.
        "Mon": "Sen", "Tue": "Sel", "Wed": "Rab", "Thu": "Kam",
        "Fri": "Jum", "Sat": "Sab", "Sun": "Min",
        "Room bookings — VIP, Meeting, Studio.": "Booking ruangan — VIP, Meeting, Studio.",
        "Auto-assign to:": "Assign otomatis ke:",

        // ── diagnostik push notification (Tuning Room) ────────────────────────
        "PUSH NOTIFICATIONS": "NOTIFIKASI PUSH",
        "Permission": "Izin",
        "Allowed": "Diizinkan",
        "Quiet delivery": "Tanpa suara",
        "Blocked in iOS Settings": "Diblokir di Setelan iOS",
        "Not asked yet": "Belum ditanya",
        "Unknown": "Nggak diketahui",
        "APNs environment": "Environment APNs",
        "Apple": "Apple",
        "NEXUS server": "Server NEXUS",
        "Waiting for token…": "Nunggu token…",
        "Reminders": "Pengingat",
        "Local (server can't deliver yet)": "Lokal (server belum bisa kirim)",
        "From server": "Dari server",
        "Device token": "Token perangkat",
        "Copy token": "Salin token",
        "Copied ✓": "Tersalin ✓",
        "No token yet. Allow notifications, then reopen this screen.":
            "Belum ada token. Izinin notifikasi dulu, terus buka lagi layar ini.",

        // ── approval checkout luar area (antrian BoD) ─────────────────────────
        "Offsite checkouts": "Checkout luar area",
        "Check-outs from outside the office area, waiting on you.": "Checkout dari luar area kantor, nunggu kamu.",
        "Nothing waiting for approval.": "Nggak ada yang nunggu approval.",
        "You can't approve your own.": "Punya sendiri nggak bisa di-approve.",
        "View map": "Lihat peta",
        "Approve": "Setujui",
        "Reject": "Tolak",
        "Someone": "Seseorang",
        "office": "kantor",

        // ── tampilan & room booking ───────────────────────────────────────────
        "APPEARANCE": "TAMPILAN",
        "Follow system": "Ikut sistem",
        "Light": "Terang",
        "Dark": "Gelap",
        "Upcoming": "Mendatang",
        "History": "Riwayat",
        "No bookings in the last 30 days.": "Nggak ada booking dalam 30 hari terakhir.",

        // ── fragmen kalimat berinterpolasi (dirakit runtime) ──────────────────
        "days": "hari",
        "tasks": "task",
        "projects": "project",
        "members": "member",
        "custom days": "hari custom",
        "Failed": "Gagal",
        "Custom": "Custom",
        "No results for": "Gak ada hasil buat",
        "Delete the whole attendance record for": "Hapus seluruh absen",
        "Using the workspace default": "Pakai default workspace",
        "PUBLIC HOLIDAYS": "TANGGAL MERAH",
        "DAY-OFF ALLOWANCE": "JATAH LIBUR",
        "more characters needed before you can check out.":
            "karakter lagi biar bisa check-out.",
        "PRESENCE OUT unlocks once the daily reflection above reaches 200 characters.":
            "PRESENCE OUT kebuka begitu refleksi harian di atas nyampe 200 karakter.",
        "⚠️ You still have an earlier shift that was never checked out. Fill in the daily reflection above first — PRESENCE OUT unlocks after 200 characters.":
            "⚠️ Masih ada absen sebelumnya yang belum di-check-out. Isi dulu refleksi harian di atas — PRESENCE OUT kebuka setelah 200 karakter.",
    ]
}

/// Translate a UI string. The argument IS the English copy, so English is a pass-through.
func T(_ english: String) -> String { AppLanguage.shared.translate(english) }
