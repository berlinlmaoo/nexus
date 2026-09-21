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
        "XP Penalties": "Potongan XP",
        "XP Bonuses": "Bonus XP",
        "Tier rewards (end of period)": "Reward tier (akhir periode)",
        "Automatic": "Otomatis",
        "Manual": "Manual",
        "Expanded": "Terbuka",
        "Collapsed": "Tertutup",
        "Late check-in": "Telat check-in",
        "Max 120 min. >120 → docks a day off": "Maks 120 menit. >120 → potong jatah day off",
        "No check-out (forgot to log out)": "Tidak check-out (lupa absen pulang)",
        "Per incident": "Per kejadian",
        "Left the office without manager approval": "Keluar kantor tanpa izin manager",
        "No-show, no heads-up (absent)": "Tidak masuk tanpa kabar (alpha)",
        "Per day": "Per hari",
        "Zero absences for a full month": "Nol alpha sebulan penuh",
        "Showing up consistently": "Konsisten hadir",
        "Finish a side quest from your Head": "Selesaikan side quest dari Head",
        "Head's call": "Keputusan Head",
        "Performance beyond target": "Performa melampaui target",
        "Management's call": "Keputusan manajemen",
        "Feedback the company adopts": "Masukan yang dipakai perusahaan",
        "HR's call": "Keputusan HR",
        "\"Automatic\" is calculated by the system from attendance & end of period. \"Manual\" is awarded by Head/HR/management based on their judgment.":
            "\"Otomatis\" dihitung sistem dari absensi & akhir periode. \"Manual\" diberikan Head/HR/manajemen berdasarkan penilaian mereka.",
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
        "Sign in with Face ID": "Masuk pakai Face ID",
        "Add a passkey and you can skip typing your password. It stays on this device, and your password keeps working.": "Tambahkan passkey supaya nggak perlu ngetik password lagi. Kuncinya tetap di perangkat ini, dan password lo tetap jalan.",
        "Couldn't add that passkey.": "Passkey-nya nggak bisa ditambahkan.",
        "Showing saved data": "Menampilkan data tersimpan",
        "Search missions and tasks…": "Cari mission dan task…",
        "Nothing matches that.": "Nggak ada yang cocok.",
        "MISSIONS": "MISSION",
        "TASKS": "TASK",
        "No connection to the server.": "Tidak ada koneksi ke server.",
        "No connection, and no location fix to save with.": "Tidak ada koneksi, dan lokasi belum didapat.",
        "Saved offline — will be sent when the server is back.": "Tersimpan offline — dikirim begitu server hidup.",
        "1 attendance saved offline — not sent yet.": "1 absen tersimpan offline — belum terkirim.",
        "attendance records saved offline — not sent yet.": "absen tersimpan offline — belum terkirim.",
        "Reply": "Balas",
        "Replying to": "Membalas",
        "📎 Attachment": "📎 Lampiran",
        "Message": "Pesan",
        "Cancel it": "Batalin",
        "Leave": "Cuti",
        "Permit": "Izin",
        "Approved": "Disetujui",
        "Rejected": "Ditolak",
        "Canceled": "Dibatalkan",
        "Pending": "Menunggu",
        "Submissions": "Pengajuan",
        "Review the crew's requests and file your own.": "Review request crew + ajuin punyamu.",
        "File leave, permit, sick or day-off.": "Ajuin cuti / izin / sakit / day-off.",
        "START": "MULAI",
        "UNTIL": "SAMPAI",
        "REASON": "ALASAN",
        "Reason / context…": "Alasan / konteks…",
        "New request": "Pengajuan baru",
        "Submit request": "Kirim pengajuan",
        "Choose from library": "Pilih dari galeri",
        "Choose a file": "Pilih file",
        "File is over the 10MB limit.": "File maks 10MB.",
        "My Work Schedule": "Jadwal Kerja Saya",
        "📍 Location-free — clock in from anywhere": "📍 Bebas lokasi — absen dari mana aja",
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
        "Local model in the office. Slow, and can be wrong.": "Model lokal di kantor. Lambat dan bisa keliru.",
        "Using the app": "Pakai app",
        "Devices": "Perangkat",
        "Nobody has installed the app yet.": "Belum ada yang pasang app.",
        "Not reported": "Belum dilaporkan",
        "Image attached": "Gambar terlampir",
        "People": "Pemakai",
        "Questions": "Pertanyaan",
        "Tools used": "Tool dipakai",
        "Nobody has used GIDEON yet.": "Belum ada yang pakai GIDEON.",
        "questions": "pertanyaan",
        "Never": "Belum pernah",
        "Model": "Model",
        "Deepest. For analysis and decisions.": "Paling dalam. Untuk analisis dan keputusan.",
        "Everyday.": "Sehari-hari.",
        "Light. Short questions.": "Ringan. Pertanyaan pendek.",
        "Clear chat": "Hapus obrolan",
        "Ask GIDEON about NEXUS": "Tanya GIDEON soal NEXUS",
        "Projects, tasks, who is busy, what is overdue.": "Proyek, task, siapa yang sibuk, apa yang telat.",
        "Ask anything about NEXUS…": "Tanya apa saja soal NEXUS…",
        "GIDEON didn't answer. Try again.": "GIDEON tidak menjawab. Coba lagi.",
        "GIDEON failed.": "GIDEON gagal.",
        "GIDEON is typing…": "GIDEON sedang mengetik…",
        // ── gideon composer · what can be attached to a question ──────────────
        // The wording of the refusal matches the sentence /api/gideon sends back for a 415, so the
        // same file gets the same answer whether it was caught here or there.
        "Photo": "Foto",
        "Camera": "Kamera",
        "File": "File",
        "GIDEON can't read that kind of file yet.": "Tipe file itu belum bisa dibaca GIDEON.",
        "Couldn't read that file.": "Gagal membaca file itu.",
        // "File is over the 10MB limit." is already carried above, near the attendance strings.
        "Got it": "Oke, paham",
        "Next": "Berikutnya",
        "Link project": "Hubungkan proyek",
        "Members": "Member",
        "Lead": "Lead",
        "Make lead": "Jadikan lead",
        "Make member": "Jadikan member",
        "Remove from team": "Keluarkan dari tim",
        "Nobody on this team yet.": "Belum ada member di tim ini.",
        "No projects linked yet.": "Belum ada proyek yang dihubungkan.",
        "Everyone in the workspace is already on this team.": "Semua orang di workspace sudah ada di tim ini.",
        "Every project is already linked.": "Semua proyek sudah dihubungkan.",
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
        // ── task attachments · opening one, and watching it move ──────────────
        "Uploading": "Lagi ngirim",
        "Downloading": "Lagi ngambil",
        "Open file": "Buka file",
        "Save or share": "Simpan atau bagikan",
        "Couldn't open this file.": "Gagal buka file ini.",
        // ── the upload wall, for the destinations with no chunk route ─────────
        // Task attachments split themselves across /api/attachments/chunk and never reach these.
        // Project files, form submits and the icons have no such route, so this is where they stop.
        // The sizes are appended outside the sentence — see APIClient.tooBigToSend.
        "This file is too big to upload here.": "File ini kegedean buat diupload di sini.",
        "These files are too big to send together.": "Total filenya kegedean buat dikirim sekaligus.",
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
        "REPEAT":
            "ULANGI",
        "Once":
            "Sekali aja",
        "Time (WIB)":
            "Jam (WIB)",
        "Goes out now, then again each day at that hour — pop-up and push. It reappears for everyone, including people who already dismissed it.":
            "Dikirim sekarang, terus diulang tiap hari di jam itu — popup dan push. Muncul lagi buat semua orang, termasuk yang udah nutup sebelumnya.",
        "Delete this post?":
            "Hapus postingan ini?",
        "It disappears from the feed for everyone.":
            "Postingannya hilang dari feed buat semua orang.",
        "Couldn't delete that post.":
            "Nggak bisa hapus postingannya.",
        "What's new":
            "Apa yang baru",
        "Threads is open to everyone":
            "Threads sekarang dibuka buat semua",
        "The company feed used to be BoD-only. Everyone can read, post, comment and like it now — and posts can carry up to four photos.":
            "Feed perusahaan dulu cuma buat BoD. Sekarang semua orang bisa baca, posting, komentar, dan like — dan tiap postingan bisa bawa sampai empat foto.",
        "Take a post down":
            "Hapus postingan",
        "BoD only. The dots sit at the top right of a post — your own, or anyone's.":
            "Khusus BoD. Titik tiganya ada di pojok kanan atas postingan — punya sendiri maupun punya orang.",
        "Move a ticket from the app":
            "Pindahin status tiket dari app",
        "Tap the status chip at the top of a ticket to move it between Open, In review, Resolved and Closed.":
            "Pencet label status di atas tiket buat mindahin antara Open, In review, Resolved, dan Closed.",
        "Cancel an attendance penalty":
            "Batalin potongan absen",
        "A second kind of proposal on attendance tickets: give back the XP and the day-off token without touching the recorded times.":
            "Jenis usulan kedua di tiket absen: balikin XP dan jatah day off-nya tanpa ngutak-ngatik jam yang tercatat.",
        "Announcements can repeat":
            "Pengumuman bisa diulang",
        "Post one and have it come back every day until a date you set, at an hour you set — pop-up and push both.":
            "Bikin sekali, terus muncul lagi tiap hari sampai tanggal yang lo tentuin, di jam yang lo tentuin — popup dan push dua-duanya.",
        "Control Room tabs scroll":
            "Tab Control Room bisa digeser",
        "Seven tabs no longer share one row's width, so nothing is squeezed to five letters.":
            "Tujuh tab nggak lagi berebut satu baris, jadi nggak ada yang kepotong jadi lima huruf.",
        "GIDEON answers attendance tickets properly":
            "GIDEON jawab tiket absen dengan bener",
        "File a ticket about your attendance and GIDEON now reads the record itself — your shift, whether a permit covers the day, whether NEXUS was down, and what the day actually cost you. It proposes the fix for a BoD to approve, and it can propose giving your XP back without changing your recorded hours.":
            "Kirim tiket soal absen lo, dan sekarang GIDEON baca catatannya sendiri — shift lo, ada izin yang nutupin hari itu atau nggak, NEXUS lagi mati atau nggak, dan berapa sebenernya yang kepotong hari itu. Dia bikin usulan buat di-approve BoD, dan bisa ngusulin XP lo dibalikin tanpa ngubah jam yang tercatat.",
        "Nothing new to show":
            "Belum ada yang baru",
        "No release notes were written for this version.":
            "Belum ada catatan rilis buat versi ini.",
        "Uploads take the office network":
            "Upload lewat jaringan kantor",
        "On the office WiFi, photos and files go straight to the server instead of out to the internet and back. Nothing to switch on — the app checks and picks the faster route itself.":
            "Di WiFi kantor, foto dan file langsung ke server, nggak muter dulu ke internet. Nggak ada yang perlu dinyalain — app-nya ngecek sendiri dan milih jalur yang lebih cepet.",
        "Apple Watch, widgets and Siri":
            "Apple Watch, widget, dan Siri",
        "Check in from your wrist, keep attendance on the Home and Lock Screen, and ask Siri. The work session shows in the Dynamic Island while it runs.":
            "Absen dari jam tangan, taruh absensi di Home dan Lock Screen, dan tanya Siri. Sesi kerjanya kelihatan di Dynamic Island selama jalan.",
        "Chat with GIDEON from the app, and show it a picture":
            "Ngobrol sama GIDEON dari app, dan bisa kirim gambar",
        "Fill in a form in the app, and open a form link straight into it":
            "Isi form di dalam app, dan link form langsung kebuka di situ",
        "File a ticket from your phone and follow the conversation on it":
            "Kirim tiket dari HP dan ikutin percakapannya",
        "Notifications filter, clear, and land on the thing they point at":
            "Notifikasi bisa disaring, dibersihin, dan mendarat di hal yang ditunjuknya",
        "Open a colleague's profile from any list of people":
            "Buka profil rekan kerja dari daftar orang mana pun",
        "One attendance approval queue, with the reason a request was rejected":
            "Satu antrean approval absen, lengkap sama alasan penolakannya",
        "Open a submission and read what was actually filed":
            "Buka pengajuan dan baca isi yang beneran dikirim",
        "Uploads show how far they have got":
            "Upload nunjukin udah sampai mana",
        "Manage team members and project access from the team":
            "Atur anggota tim dan akses project dari tim-nya",
        "Control Room tabs scroll instead of being squeezed into one row":
            "Tab Control Room bisa digeser, nggak lagi berdesakan satu baris",
        "Control Room shows who has the app, on which build, and who uses GIDEON":
            "Control Room nunjukin siapa yang punya app, build berapa, dan siapa yang pakai GIDEON",
        "XP and day-off tokens taken on 2–3 September have been given back — NEXUS was unreachable for 19 hours and the nightly job charged people for it":
            "XP dan jatah day off yang kepotong 2–3 September udah dibalikin — NEXUS nggak bisa diakses 19 jam dan cron malam tetap motong",
        "Large files could never be uploaded, and a failed upload said nothing at all":
            "File besar dulu nggak pernah bisa diupload, dan upload yang gagal diem aja",
        "Ten rows across the app looked tappable and did nothing":
            "Sepuluh baris di app kelihatan bisa dipencet padahal nggak ngapa-ngapain",
        "Photos on a post did not appear when you opened its thread":
            "Foto di postingan nggak muncul waktu thread-nya dibuka",
        "Closing the GIDEON panel erased the question you had just asked":
            "Nutup panel GIDEON ngehapus pertanyaan yang barusan dikirim",
        "An attachment sent to GIDEON showed on the wrong message":
            "Lampiran ke GIDEON nempel di pesan yang salah",
        "An approved request was hard to find again, and requests could not be swiped away":
            "Pengajuan yang udah di-approve susah dicari lagi, dan nggak bisa digeser buat dihapus",
        "A colleague's XP penalties were visible to everyone":
            "Potongan XP rekan kerja kelihatan sama semua orang",
        "Menu entries that only ever answered \"forbidden\" are gone":
            "Menu yang cuma bisa jawab \"forbidden\" udah dihilangkan",
        "Pictures load quicker and stay cached after the app restarts; the Dashboard no longer redraws itself as you scroll":
            "Gambar kebuka lebih cepet dan tetap tersimpan setelah app dibuka ulang; Dashboard nggak lagi gambar ulang tiap di-scroll",
        "The post menu was too small to hit reliably":
            "Tombol menu postingan kekecilan buat dipencet",
        "Files in a project and the Knowledge Library are gone — Z Vault replaces both in 0.1.4":
            "Files di dalam project dan Knowledge Library dihapus — dua-duanya diganti Z Vault di 0.1.4",
        "Office network":
            "Jaringan kantor",
        "direct":
            "langsung",
        "Also new":
            "Baru juga",
        "Fixed":
            "Diperbaiki",
        "Files upload faster on the office WiFi":
            "Upload file lebih cepat pakai WiFi kantor",
        "Photos and files go straight to the server instead of out to the internet and back, so they finish sooner. Nothing to switch on — the app checks whether you are on the office WiFi and picks the faster route itself.":
            "Foto dan file langsung ke server, nggak muter dulu ke internet, jadi lebih cepat kelar. Nggak ada yang perlu dinyalain — app-nya ngecek sendiri lagi di WiFi kantor atau nggak, terus milih jalur yang lebih cepat.",
        "Delete a post in Threads":
            "Hapus postingan di Threads",
        "BoD only. In Threads, the dots at the top right of a post remove it — your own, or anyone's. It disappears from the feed for everyone.":
            "Khusus BoD. Di Threads, titik tiga di pojok kanan atas postingan buat menghapusnya — punya sendiri maupun punya orang. Postingannya hilang dari feed buat semua orang.",
        "See today's attendance on your wrist, and approve requests there if that is your job. Keep attendance on the Home and Lock Screen, ask Siri, and watch the work session run in the Dynamic Island.":
            "Lihat absensi hari ini dari jam tangan, dan approve pengajuan di situ kalau itu tugasmu. Taruh absensi di Home dan Lock Screen, tanya Siri, dan lihat sesi kerja jalan di Dynamic Island.",
        "Couldn't post that.":
            "Nggak bisa ngirim postingannya.",
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

        // ── approval checkout luar area (satu antrian sama Pengajuan) ─────────
        "Offsite check-out": "Checkout luar area",
        "Review requests and offsite check-outs, and file your own.":
            "Tinjau pengajuan & checkout luar area, sekalian ajuin punya kamu.",
        "You can't approve your own.": "Punya sendiri nggak bisa di-approve.",
        "View map": "Lihat peta",
        "Approve": "Setujui",
        "No record": "Tidak ada catatan",
        "shift": "shift",
        "Worked": "Kerja",
        "Corrected by BoD": "Dikoreksi BoD",
        "No check-in was recorded that day and no request covered it.": "Tidak ada check-in hari itu dan tidak ada pengajuan yang menutupinya.",
        "approved by": "disetujui oleh",
        "open it on the web": "buka di web",
        "Attendance detail": "Detail absensi",
        "from the office": "dari kantor",
        "Not recorded.": "Tidak tercatat.",
        "Selfie": "Selfie",
        "today": "hari ini",
        "Open the full board": "Buka papan penuh",
        "It disappears from the list and nobody can check in there anymore. Days already recorded there keep the office's name.": "Hilang dari daftar dan tidak ada yang bisa check-in di sana lagi. Hari yang sudah tercatat tetap memakai nama office ini.",
        "is on the App Store": "sudah ada di App Store",
        "You're on": "Kamu masih di",
        "Update to get the latest fixes and features — it takes a minute.": "Perbarui untuk perbaikan dan fitur terbaru — cuma semenit.",
        "Update in App Store": "Perbarui di App Store",
        "A mission is a project board: its tasks, people and deadlines in one place. You'll see every mission you're part of here — create the first one to get going.": "Mission itu papan proyek: task, orang, dan tenggatnya di satu tempat. Semua mission yang kamu ikuti tampil di sini — buat yang pertama untuk mulai.",
        "Tasks assigned to you land here, from a mission board or a form. Nothing is waiting on you right now — pick something up from a mission.": "Task yang ditugaskan ke kamu muncul di sini, dari papan mission atau form. Belum ada yang menunggu kamu — ambil dari salah satu mission.",
        "Browse missions": "Lihat mission",
        "Requests to approve, replies to your tickets, mentions and announcements land here the moment they happen. Nothing needs you right now.": "Pengajuan yang perlu disetujui, balasan tiket, mention, dan pengumuman masuk ke sini begitu terjadi. Belum ada yang perlu kamu tangani.",
        "Nothing of this kind": "Tidak ada yang jenis ini",
        "This filter only shows one type of signal. Everything else is still in All.": "Filter ini hanya menampilkan satu jenis notifikasi. Sisanya ada di Semua.",
        "Show all": "Tampilkan semua",
        "Nothing on the feed yet": "Feed masih kosong",
        "Threads is the company feed: wins, photos, questions for everyone. Write the first post in the box above and it appears here for the whole office.": "Threads itu feed perusahaan: pencapaian, foto, pertanyaan untuk semua. Tulis post pertama di kotak atas dan langsung tampil untuk satu kantor.",
        "A form is an intake page — a request, a reimbursement, a report — that turns into a task the moment it's submitted. BoD builds them on the web; once one is published it appears here for you to fill in.": "Form itu halaman pengajuan — permintaan, reimbursement, laporan — yang otomatis jadi task begitu dikirim. BoD membuatnya di web; begitu terbit, form tampil di sini untuk diisi.",
        "A team groups people and hands them access to the projects linked to it. Managers create teams from Control Room; once you're in one, it shows up here.": "Tim mengelompokkan orang dan memberi akses ke proyek yang ditautkan. Manager membuat tim dari Control Room; begitu kamu masuk tim, tim itu tampil di sini.",
        "Everything you file through a form — a request, a reimbursement, a report — lands on this board with its status, so you never have to ask where it got to. Start with a form.": "Semua yang kamu ajukan lewat form — permintaan, reimbursement, laporan — tampil di papan ini beserta statusnya, jadi tidak perlu tanya sudah sampai mana. Mulai dari sebuah form.",
        "Open forms": "Buka form",
        "No tickets yet": "Belum ada tiket",
        "A ticket is how you raise something with BoD — a complaint, a question, or an attendance record that looks wrong. GIDEON checks the data first, BoD decides, and it stays between you and them.": "Tiket adalah cara menyampaikan sesuatu ke BoD — keluhan, pertanyaan, atau catatan absen yang terlihat salah. GIDEON mengecek datanya dulu, BoD memutuskan, dan isinya hanya antara kamu dan mereka.",
        "Only tickets with this status are shown here. The rest are still under All.": "Hanya tiket dengan status ini yang tampil. Sisanya ada di Semua.",
        "Nothing to review yet": "Belum ada yang perlu ditinjau",
        "Leave, sick days, permits and offsite check-outs from your people appear here the moment they're filed, with Approve and Reject right on the row.": "Cuti, sakit, izin, dan check-out luar kantor dari anak buahmu tampil di sini begitu diajukan, dengan tombol Approve dan Reject di barisnya.",
        "Leave, sick days, permits and day-offs you file show up here with their status, and your approver is told the moment you send one.": "Cuti, sakit, izin, dan day off yang kamu ajukan tampil di sini beserta statusnya, dan approver-mu langsung diberi tahu begitu kamu kirim.",
        "File a request": "Ajukan",
        "Nothing in this filter": "Tidak ada di filter ini",
        "Only requests with this status are shown. The rest are under All.": "Hanya pengajuan dengan status ini yang tampil. Sisanya ada di Semua.",
        "No attendance this month yet": "Belum ada absensi bulan ini",
        "Nobody has checked in this month yet. The first check-in fills the first cell; use the arrows to look at earlier months.": "Belum ada yang check-in bulan ini. Check-in pertama mengisi sel pertama; pakai panah untuk melihat bulan sebelumnya.",
        "Your check-ins fill this board day by day — green for present, purple for a day off, red for a missed day. Check in from the card above.": "Check-in kamu mengisi papan ini hari demi hari — hijau hadir, ungu day off, merah bolos. Check-in dari kartu di atas.",
        "No offices yet": "Belum ada office",
        "An office is a point on the map with a radius around it. Staff can only check in inside that radius, so nothing can be recorded until the first office exists.": "Office itu titik di peta dengan radius di sekelilingnya. Staff hanya bisa check-in di dalam radius itu, jadi belum ada yang bisa tercatat sebelum office pertama dibuat.",
        "Add office": "Tambah office",
        "Direct messages and group chats with colleagues live here, and every project has a room of its own. Start one and it appears at the top.": "Pesan langsung dan grup dengan rekan kerja ada di sini, dan tiap proyek punya ruang sendiri. Mulai satu dan langsung muncul di atas.",
        "Nothing needs you yet. Requests, replies and mentions land here the moment they happen.": "Belum ada yang perlu kamu tangani. Pengajuan, balasan, dan mention masuk ke sini begitu terjadi.",
        "Delete office": "Hapus office",
        "Delete this office?": "Hapus office ini?",
        "Only possible while no attendance has been recorded at it.": "Hanya bisa selama belum ada absen yang tercatat di sini.",
        "Export this month as a spreadsheet": "Ekspor bulan ini sebagai spreadsheet",
        "Couldn't delete the office.": "Office tidak bisa dihapus.",
        "Rest days": "Hari libur tetap",
        "Sunday off": "Libur Minggu",
        "Sat + Sun off": "Libur Sabtu + Minggu",
        "Works every day": "Kerja tiap hari",
        "Works every office day; a day off must be requested.": "Kerja tiap hari kantor; day off harus diajukan.",
        "No reminder, lateness or absence on these days. No day-off request needed.": "Tidak ada pengingat, telat, atau alpa di hari ini. Tidak perlu ajukan day off.",
        "Tue": "Sel",
        "Wed": "Rab",
        "Thu": "Kam",
        "Sat": "Sab",
        "Sun": "Min",
        // 0.1.5: screens that used to pass Indonesian literals as keys (they showed Indonesian in English mode).
        "Activate": "Aktifkan",
        "Active": "Aktif",
        "Already in every team you can manage.": "Sudah masuk semua tim yang bisa kamu atur.",
        "Change approver…": "Ganti atasan…",
        "Change photo": "Ganti foto",
        "Create a company mailbox": "Bikin email kantor baru",
        "Create team": "Bikin tim",
        "Deactivate": "Nonaktifkan",
        "Delete (the team stays)": "Hapus (timnya tetap ada)",
        "Delete team": "Hapus tim",
        "Delete this team?": "Hapus tim ini?",
        "Division name": "Nama divisi",
        "First name": "Nama depan",
        "Inactive": "Nonaktif",
        "Joining a team grants access to the projects linked to it.": "Masuk tim = otomatis dapat akses ke project yang ditautkan tim itu.",
        "Last name": "Nama belakang",
        "Manage this team": "Atur tim ini",
        "Members keep their own hours from Control Room.": "Anggota memakai jam masing-masing dari Control Room.",
        "Name & email saved.": "Nama & email disimpan.",
        "Name in Google": "Nama di Google",
        "No divisions yet.": "Belum ada divisi.",
        "Not in any project yet.": "Belum masuk project mana pun.",
        "Not in any team yet.": "Belum masuk tim mana pun.",
        "Not in the workspace yet": "Belum masuk workspace",
        "Not placed": "Belum ditaruh",
        "Not placed on the Approval Chart": "Belum ditaruh di Bagan Approval",
        "Place under an approver…": "Taruh di bawah atasan…",
        "Rename": "Ganti nama",
        "Rename division": "Ganti nama divisi",
        "Rename team": "Ganti nama tim",
        "Save name & email": "Simpan nama & email",
        "Save shift hours": "Simpan jam shift",
        "Saving…": "Menyimpan…",
        "Search accounts…": "Cari akun…",
        "Search name or email…": "Cari nama atau email…",
        "Search names…": "Cari nama…",
        "Search projects…": "Cari project…",
        "Search teams…": "Cari tim…",
        "Set as main attendance team": "Jadikan tim absensi utama",
        "Team name": "Nama tim",
        "Team shift hours": "Jam shift tim",
        "Teams & projects": "Tim & project",
        "Unset as main attendance team": "Lepas tim absensi utama",
        "Use custom hours for this team": "Pakai jam khusus untuk tim ini",
        "people": "orang",
        "people lose access to": "orang kehilangan akses ke",
        "projects linked to this team.": "project yang ditautkan tim ini.",
        "read by": "dibaca",
        "team": "tim",
        "team / office default": "ikut tim / kantor",
        "their requests go to every BoD": "request-nya masuk ke semua BoD",
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
        // ── passkey ───────────────────────────────────────────────────────────
        "or": "atau",
        "Sign in with passkey": "Masuk pakai passkey",
        "Passkey sign-in failed. Use your password instead.":
            "Gagal masuk pakai passkey. Pakai password aja dulu.",
        "Passkey sign-in cancelled.": "Masuk pakai passkey dibatalin.",
        "No passkey was returned. Try again.": "Passkey-nya nggak kebaca. Coba lagi.",
        "The server sent passkey options this app couldn't read.":
            "Server ngirim opsi passkey yang nggak kebaca sama app ini.",
        "PASSKEYS": "PASSKEY",
        "Sign in with Face ID or Touch ID instead of typing your password. Your password keeps working.":
            "Masuk pakai Face ID atau Touch ID, nggak usah ngetik password. Password kamu tetap jalan.",
        "Add a passkey": "Tambah passkey",
        "Unnamed passkey": "Passkey tanpa nama",
        "Added": "Ditambahkan",
        "Last used": "Terakhir dipakai",
        "Never used": "Belum pernah dipakai",
        "No passkeys yet — add one and this device can sign you in with Face ID.":
            "Belum ada passkey — tambah satu biar HP ini bisa masukin kamu pakai Face ID.",
        "Couldn't load your passkeys.": "Gagal memuat daftar passkey kamu.",
        "Revoke": "Cabut",
        "That passkey stops working everywhere it was saved. This cannot be undone.":
            "Passkey itu bakal berhenti jalan di semua tempat dia kesimpan. Nggak bisa dibatalin.",
        "Passkey revoked ✓": "Passkey dicabut ✓",
        "Couldn't revoke the passkey. Try again.": "Gagal nyabut passkey. Coba lagi.",
        "Passkey added ✓": "Passkey ditambahkan ✓",
        "Couldn't add the passkey. Try again.": "Gagal nambah passkey. Coba lagi.",
        // ── ticket · statuses and row markers ────────────────────────────────
        // AWAITING_DECISION: GIDEON has answered, or a correction is sitting undecided. Not
        // IN_REVIEW — that one means a director took the ticket on. ("Open" is carried above, with
        // the generic states.)
        "Awaiting decision": "Menunggu keputusan",
        "In review": "Sedang ditinjau",
        "Resolved": "Selesai",
        "Closed": "Ditutup",
        // The row markers. Shorter than the status chip they sit under, and deliberately worded
        // apart from it: the chip says what the ticket IS, these say what is waiting inside it.
        "Decision waiting": "Nunggu diputusin",
        "GIDEON replied": "GIDEON udah jawab",
        // ── ticket composer ─────────────────────────────────────────────────
        "New ticket": "Tiket baru",
        "CATEGORY": "KATEGORI",
        "SUBJECT": "JUDUL",
        "WHAT HAPPENED": "CERITAKAN KEJADIANNYA",
        "EVIDENCE PHOTOS (REQUIRED)": "FOTO BUKTI (WAJIB)",
        "Short title for the issue": "Judul singkat masalahnya",
        "Tell the BoD what happened…": "Ceritain ke BoD apa yang terjadi…",
        "At least one photo is required.": "Minimal satu foto bukti.",
        "File ticket": "Kirim tiket",
        "Couldn't file the ticket.": "Gagal ngirim tiket.",
        "EXP / Gamification": "EXP / Gamifikasi",
        "Leave / Day-off": "Cuti / Day-Off",
        "Other": "Lainnya",
        // ── ticket · attendance correction ───────────────────────────────────
        "Attendance correction": "Koreksi absen",
        "A proposal only — the attendance record moves when a BoD approves it, not before.":
            "Baru usulan — absen berubah kalau BoD nyetujuin, belum sebelum itu.",
        "No correction has been proposed for this ticket yet.":
            "Belum ada usulan koreksi absen buat tiket ini.",
        "Propose an attendance correction": "Ajukan koreksi absen",
        "Proposed by": "Diajukan oleh",
        "Attendance of": "Absen milik",
        "No attendance was recorded that day — this would create it.":
            "Hari itu nggak ada absen tercatat — usulan ini yang bakal bikin.",
        "unchanged": "tetap",
        "Waiting on a BoD decision. The attendance record has not changed.":
            "Nunggu keputusan BoD. Absennya belum berubah.",
        "Approving rewrites that day's attendance record straight away.":
            "Begitu disetujui, absen hari itu langsung ditulis ulang.",
        "XP cut that day":
            "XP kepotong hari itu",
        "Day off taken":
            "Jatah day off kepotong",
        "Proposal: cancel that penalty — the XP and the day off both come back. The recorded times are not touched.":
            "Usulannya: batalkan potongan itu — XP dan jatah day off-nya sama-sama balik. Jam yang tercatat nggak disentuh.",
        "Proposal: cancel that penalty. The recorded times are not touched.":
            "Usulannya: batalkan potongan itu. Jam yang tercatat nggak disentuh.",
        "That day has no attendance record, and it still will not have one.":
            "Hari itu memang nggak punya catatan absen, dan tetap nggak akan punya.",
        "Approving gives back what that day cost and writes NOTHING to the attendance record. If no leave covers the day, it is also marked penalty-free so the nightly job cannot cut it again.":
            "Begitu disetujui, yang kepotong hari itu dibalikin dan NGGAK ada apa pun yang ditulis ke catatan absennya. Kalau nggak ada izin yang nutupin hari itu, hari itu sekalian ditandai bebas potongan supaya cron malam nggak motong lagi.",
        "Given back":
            "Yang balik",
        "day off":
            "jatah day off",
        "That day is now marked penalty-free, so it cannot be cut again.":
            "Hari itu sekarang ditandai bebas potongan, jadi nggak bisa kepotong lagi.",
        "Couldn't move the ticket.":
            "Nggak bisa mindahin status tiketnya.",
        "Note for the decision (optional)": "Catatan keputusan (opsional)",
        "Decided by": "Diputus oleh",
        "Couldn't send the attendance correction.": "Gagal ngirim koreksi absen.",
        "That day's attendance moved after this proposal was written. Check the day again and ask for a fresh proposal.":
            "Absen hari itu udah berubah setelah usulan ini dibuat. Cek lagi harinya, terus minta usulan baru.",
        "This asks the BoD to rewrite one day's attendance. Nothing changes until they approve it.":
            "Ini minta BoD nulis ulang absen satu hari. Nggak ada yang berubah sampai mereka nyetujuin.",
        "DATE": "TANGGAL",
        "Set at least one of check-in or check-out.": "Minimal isi salah satu: check-in atau check-out.",
        "Leave the recorded time as it is": "Biarin jam yang udah tercatat",
        "Why the record is wrong…": "Kenapa catatannya salah…",
        "Send the proposal": "Kirim usulan",
        // ── ticket · thread ──────────────────────────────────────────────────
        "Conversation": "Percakapan",
        "No replies yet. Answers land right here.": "Belum ada balasan. Jawabannya bakal muncul di sini.",
        "Couldn't load the conversation.": "Gagal muat percakapan.",
        "Write a reply…": "Tulis balasan…",
        "Couldn't send the reply.": "Gagal ngirim balasan.",
        "This ticket is closed. No more replies.": "Tiket ini udah ditutup. Nggak bisa balas lagi.",
        "Marked resolved": "Ditandai selesai",
        "Ticket closed": "Tiket ditutup",
        // "Someone" — the fallback author label — is already carried above, near the chat strings.
        // ── notification tap-through · request attachment ─────────────────────
        // "Close" is already carried above, near the ticket strings.
        "tap to open": "ketuk buat buka",
        "Tap to enlarge": "Ketuk buat perbesar",
        "View attachment": "Lihat lampiran",
        "PDF · open it on the web": "PDF · buka di web",
        // ── attendance request · the decision and its reason ────────────
        "Nothing in this filter.": "Nggak ada yang cocok sama filter ini.",
        "Why it was rejected": "Alasan ditolak",
        "Note from the approver": "Catatan dari approver",
        "Recorded automatically": "Dicatat otomatis sistem",
        "REJECTION REASON": "ALASAN PENOLAKAN",
        "Say why, so they can fix it and file again…": "Tulis alasannya, biar dia bisa benerin terus ngajuin lagi…",
        "The person who filed it reads this next to the decision.": "Yang ngajuin bakal baca ini di sebelah keputusannya.",
        "Reject request": "Tolak pengajuan",
        "Could not send the decision.": "Gagal ngirim keputusannya.",
        // ── my submissions · the detail behind a card ─────────────────
        "Submission": "Pengajuan",
        "Submission details": "Isi pengajuan",
        "No answers were recorded.": "Nggak ada jawaban yang tercatat.",
        "Couldn't load the details.": "Gagal muat detailnya.",
        "Open it on the web": "Buka di web",
        "Yes": "Ya",
        "No": "Tidak",
        // ── notifications · filter buckets ────────────────────────────
        "Tickets": "Tiket",
        "Announcements": "Pengumuman",
        "Nothing here": "Kosong di sini",
        "No notifications of this kind.": "Nggak ada notifikasi jenis ini.",
        // ── forms · filling one in ------------------------------------------
        "Field": "Isian",
        "Form not open yet": "Form belum dibuka",
        "Form unavailable": "Form nggak bisa dibuka",
        "This form is private or no longer exists.": "Form ini privat atau udah nggak ada.",
        "This form is closed right now.": "Form ini lagi ditutup.",
        "Couldn't load this form.": "Gagal muat form ini.",
        "This form has no fields yet.": "Form ini belum punya isian.",
        "Submitting as": "Ngirim sebagai",
        "Auto-filled from your account": "Diisi otomatis dari akun kamu",
        "Choose…": "Pilih…",
        "Not set yet": "Belum diisi",
        "Choose files (more than one is fine)": "Pilih file (boleh lebih dari satu)",
        "files selected": "file dipilih",
        "Attach a file (optional)": "Lampirkan file (opsional)",
        "Remove file": "Hapus file",
        "That file is over the 50MB limit.": "File itu lebih dari 50MB.",
        "Submit": "Kirim",
        "Fill in the required ones first": "Isi dulu yang wajib",
        "Submission failed. Try again.": "Gagal ngirim. Coba lagi.",
        "Couldn't submit the form.": "Gagal ngirim formnya.",
        "Log in again to submit this form.": "Login lagi buat ngirim form ini.",
        "Submitted — thank you!": "Terkirim — makasih!",
        "Your response was received.": "Jawaban kamu udah masuk.",
        // ── profile · one person's page --------------------------------
        "Profile unavailable": "Profil nggak bisa dibuka",
        "That person isn't in a workspace you share.": "Orang itu nggak ada di workspace yang sama sama kamu.",
        "Couldn't load this profile.": "Gagal muat profil ini.",
        "Joined": "Gabung",
        "Level": "Level",
        "BoD and One Above All sit outside the ranking.": "BoD & One Above All di luar peringkat.",
        "No points this period yet.": "Belum ada poin periode ini.",
        "Day streak": "Streak harian",
        "Not on a team yet.": "Belum masuk tim mana pun.",
        "No team you can both see.": "Nggak ada tim yang bisa kalian berdua lihat.",
        "No project you can both see.": "Nggak ada project yang bisa kalian berdua lihat.",
        "THIS PERIOD": "PERIODE INI",
        "No points moved this period.": "Nggak ada poin yang gerak periode ini.",
        "Late": "Telat",
        "min": "mnt",
        "Absent": "Alpha",
        "No check-out": "Nggak check-out",
        "Peer report · reward": "Laporan rekan · bonus",
        "Peer report · penalty": "Laporan rekan · penalti",
        "Adjusted by a BoD": "Disesuaikan BoD",
        "Quest claimed": "Quest diklaim",
    ]
}

/// Translate a UI string. The argument IS the English copy, so English is a pass-through.
func T(_ english: String) -> String { AppLanguage.shared.translate(english) }
