import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for the QA web fixes ported on 13 Oct 2026, part 1 (work, people, projects): project access
// levels, personal attendance privacy, quests by IP & Division, leaderboard ties, error states and failed
// writes, My Tasks, Reports past period, Calendar, Pipeline, Room booking, attendance Score, "Tanpa judul".
// Wording follows the web's id-qafix-perm.ts / id-qafix-work.ts / id-qafix-kbd.ts.
//
// A key may appear in only ONE of the Localization*.swift tables (scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianQAWork: [String: String] = [
        // Project access levels
        "Full access": "Akses penuh",
        "Can edit": "Bisa edit",
        "Can comment": "Bisa komentar",
        "Can view": "Bisa lihat",
        "Edit, manage members and settings, delete the project": "Edit, atur anggota dan pengaturan, hapus project",
        "Create, edit and delete tasks, docs and comments": "Buat, edit dan hapus task, dokumen dan komentar",
        "Read and comment": "Baca dan komentar",
        "Access for %@": "Akses untuk %@",
        "Access for the people you add": "Akses untuk orang yang kamu tambahkan",
        "Access for the person you invite": "Akses untuk orang yang kamu undang",
        "Project Owner": "Pemilik Project",
        "Project Owners": "Pemilik Project",
        "A project keeps at least one Project Owner. Give someone else Full access first.": "Project harus punya minimal satu Pemilik Project. Beri orang lain Akses penuh dulu.",
        "Couldn't change their access": "Akses mereka tidak bisa diubah",
        "That didn't go through. You need Full access to the project.": "Tidak berhasil. Kamu butuh Akses penuh ke project ini.",
        "Only people with Full access to the project can add members.": "Hanya yang punya Akses penuh ke project yang bisa menambah anggota.",
        "You need Full access to change this project's settings.": "Kamu butuh Akses penuh untuk mengubah pengaturan project ini.",
        "You have %@ here. Only people with Full access (the Project Owner and the BoD) can change the project's name, photo, status, auto assign and members.": "Aksesmu di sini: %@. Hanya yang punya Akses penuh (Pemilik Project dan BoD) yang bisa mengubah nama, foto, status, auto assign dan anggota project.",
        "Optional. You're the Project Owner (Full access); the people you pick get the access chosen here.": "Opsional. Kamu Pemilik Project (Akses penuh); orang yang kamu pilih mendapat akses yang dipilih di sini.",
        "Ask the Project Owner if you need more access.": "Minta Pemilik Project kalau kamu butuh akses lebih.",
        "Ask the Project Owner or a BoD to add you to the project.": "Minta Pemilik Project atau BoD menambahkanmu ke project.",
        "The Project Owner or a BoD sets it.": "Pemilik Project atau BoD yang mengaturnya.",
        "People with Full access can set up automations here.": "Yang punya Akses penuh bisa mengatur otomasi di sini.",
        "View only: people with Full access edit automations": "Hanya lihat: yang punya Akses penuh yang mengubah otomasi",
        "Couldn't save. Only people with Full access can edit automations.": "Tidak tersimpan. Hanya yang punya Akses penuh yang bisa mengubah otomasi.",
        "Delete the project “%@”? A manager or the BoD can restore it from Control Room → Audit for 90 days.": "Hapus project “%@”? Manager atau BoD bisa memulihkannya dari Control Room → Audit selama 90 hari.",
        "Invite sent to %@": "Undangan terkirim ke %@",
        "Invite failed. Check the email and your access.": "Undangan gagal. Cek email dan aksesmu.",
        "You can only view this project. Ask the Project Owner if you need more access.": "Kamu hanya bisa melihat project ini. Minta Pemilik Project kalau kamu butuh akses lebih.",
        // Project not found / no access
        "Project not found": "Project tidak ditemukan",
        "It was deleted, or the link is wrong. A deleted project can be restored from Control Room → Audit.": "Project-nya sudah dihapus, atau link-nya salah. Project yang dihapus bisa dipulihkan dari Control Room → Audit.",
        "Go to Projects": "Buka Projects",
        "You can't open this project": "Kamu tidak bisa membuka project ini",
        "You need to be signed in and be a member of this project. Ask its Project Owner to add you.": "Kamu harus masuk dan menjadi anggota project ini. Minta Pemilik Project menambahkanmu.",
        // Personal attendance privacy
        "XP gained this period": "XP yang didapat periode ini",
        "Penalties and attendance details are private: only this person and the people above them can see them.": "Potongan dan detail absensi bersifat pribadi: hanya orang ini dan atasannya yang bisa melihatnya.",
        "Their approver, work hours and attendance mode are visible only to the people above them in the Approval chart and to the BoD.": "Approver, jam kerja dan mode absensinya hanya terlihat oleh atasannya di Bagan Approval dan oleh BoD.",
        // Reports
        "Other projects": "Project lain",
        "Projects you're not a member of": "Project yang kamu bukan anggotanya",
        "Task in a project you're not in": "Task di project yang kamu bukan anggotanya",
        "At the end of the period (%@)": "Di akhir periode (%@)",
        "Nothing was overdue at the end of this period.": "Tidak ada yang terlambat di akhir periode ini.",
        // Quests by IP & Division
        "For": "Untuk",
        "(pick divisions from the IP & Division Chart · none = everyone · people in a sub-division count too)": "(pilih divisi dari Bagan IP & Divisi · kosong = semua orang · orang di sub-divisi ikut terhitung)",
        "Couldn't load the divisions. The quest goes to everyone.": "Divisi tidak bisa dimuat. Quest ini untuk semua orang.",
        "Deleted division": "Divisi sudah dihapus",
        "Everyone (was for a team that no longer exists)": "Semua orang (dulu untuk tim yang sudah tidak ada)",
        "1 team": "1 tim",
        "%d teams": "%d tim",
        // Failures
        "No connection": "Tidak ada koneksi",
        "Not found": "Tidak ditemukan",
        "You don't have access": "Kamu tidak punya akses",
        "It may have been deleted, or the link is wrong.": "Mungkin sudah dihapus, atau tautannya salah.",
        "It no longer exists. Refresh the page.": "Sudah tidak ada. Muat ulang halamannya.",
        "Check your internet, then try again. Nothing was changed.": "Cek internetmu, lalu coba lagi. Tidak ada yang berubah.",
        "Couldn't load %@": "%@ tidak bisa dimuat",
        "Something went wrong. Try again.": "Ada yang salah. Coba lagi.",
        "Something went wrong on our side. Try again in a moment.": "Ada masalah di sisi kami. Coba lagi sebentar lagi.",
        "The server didn't accept it. Check what you entered and try again.": "Server menolaknya. Cek isianmu lalu coba lagi.",
        "Your role can't do this. Ask a BoD if you need it.": "Peranmu tidak bisa melakukan ini. Minta BoD kalau perlu.",
        "Your role can't open this. Ask a BoD if you need it.": "Peranmu tidak bisa membuka ini. Minta BoD kalau perlu.",
        "Your session ended. Sign in again, then retry.": "Sesimu sudah berakhir. Masuk lagi, lalu coba ulang.",
        // Vault
        "the vault": "Vault",
        "This folder doesn't exist any more.": "Folder ini sudah tidak ada.",
        "It's locked to certain roles.": "Folder ini dikunci untuk peran tertentu.",
        // My Tasks
        "Show all %d": "Lihat semua %d",
        "%dd late": "telat %d hari",
        "Pick a project": "Pilih project",
        "Pick the project and the section it goes in. It's assigned to you.": "Pilih project dan bagiannya. Task ini ditugaskan ke kamu.",
        // Pipeline
        "e.g. Brand activation, Jakarta Fair": "mis. Aktivasi brand, Jakarta Fair",
        // Room booking
        "VIP Meeting Room": "Ruang Meeting VIP",
        "Meeting Room": "Ruang Meeting",
        "Room": "Ruangan",
        "New booking": "Booking baru",
        "Edit booking": "Ubah booking",
        "Book room": "Booking ruangan",
        "Delete booking": "Hapus booking",
        "Delete this booking?": "Hapus booking ini?",
        "e.g. Client meeting": "mis. Meeting klien",
        "Start": "Mulai",
        "End": "Selesai",
        "Notes (optional)": "Catatan (opsional)",
        "End time has to be after the start time.": "Jam selesai harus setelah jam mulai.",
        "Couldn't save the booking.": "Booking gagal disimpan.",
        "Couldn't delete the booking.": "Booking gagal dihapus.",
        "%@ is already booked at that time (%@).": "%@ sudah dibooking pada jam itu (%@).",
        "%@ is already booked at that time.": "%@ sudah dibooking pada jam itu.",
        "That time has already passed. Pick a time later today or another day.": "Jam itu sudah lewat. Pilih jam yang lebih siang hari ini atau hari lain.",
        "Only the person who booked it or a manager can change this booking.": "Hanya pembuat booking atau manager yang bisa mengubah booking ini.",
        "Check the date and times, then try again.": "Cek tanggal dan jamnya, lalu coba lagi.",
        "Add a title to book the room.": "Isi judul untuk membooking ruangan.",
        // Attendance Score
        "Days worked (present or permit) out of %d working days, from %@: %d days minus %d day-off allowance.": "Hari masuk (hadir atau izin) dari %d hari kerja, sejak %@: %d hari dikurangi %d jatah day off.",
    ]
}
