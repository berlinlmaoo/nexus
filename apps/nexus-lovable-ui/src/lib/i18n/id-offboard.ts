/** English → Indonesian for offboarding in Control Room → Users and task people tags. Keys must be unique across all id-*.ts files. */
export const ID_OFFBOARD: Record<string, string> = {
  "Created by": "Dibuat oleh",
  // Control Room → Users: rows and the person's detail card
  "Left": "Keluar",
  // "Left · {date}" (the row badge) is in id-former.ts, shared with the attendance screens.
  "Offboard": "Offboard",
  "Offboard {name}": "Offboard {name}",
  "Offboard {name}…": "Offboard {name}…",
  "Offboarding…": "Memproses…",
  "Reinstate": "Aktifkan ulang",
  "For someone who resigned, whose contract ended, or who was let go. Their history stays.": "Untuk orang yang resign, habis kontrak, atau diberhentikan. Riwayatnya tetap ada.",
  // The offboard dialog
  "Last working day": "Hari kerja terakhir",
  "Reason": "Alasan",
  "Resigned": "Resign",
  "Contract ended": "Kontrak habis",
  "Dismissed": "Diberhentikan",
  "Note (optional)": "Catatan (opsional)",
  "What happens": "Yang terjadi",
  "Can't sign in anymore, on any device.": "Tidak bisa masuk lagi, di perangkat mana pun.",
  "Removed from projects, teams and chats.": "Dikeluarkan dari project, tim, dan chat.",
  "Their attendance, requests, projects, tasks and messages stay.": "Absensi, pengajuan, project, task, dan pesannya tetap ada.",
  "Their open tasks stay assigned to them.": "Task yang belum selesai tetap atas namanya.",
  "Anyone who had them as approver goes back to the BoD safety net.": "Yang approver-nya dia kembali ke BoD sebagai jaring pengaman.",
  // After offboarding
  "{name} is offboarded.": "{name} sudah di-offboard.",
  "Last working day: {date}": "Hari kerja terakhir: {date}",
  "Pending requests": "Pengajuan menunggu",
  "Still waiting for a decision in Attendance.": "Masih menunggu keputusan di Attendance.",
  "Nothing waiting.": "Tidak ada yang menunggu.",
  "Open tasks": "Task belum selesai",
  "Still assigned to them. Reassign them if someone should take over.": "Masih atas namanya. Pindahkan kalau perlu ada yang melanjutkan.",
  "Nothing open.": "Tidak ada yang terbuka.",
  "{n} person lost their approver": "{n} orang kehilangan approver",
  "{n} people lost their approver": "{n} orang kehilangan approver",
  "Their requests go to the BoD until you set a new approver in the Approval chart.": "Pengajuan mereka masuk ke BoD sampai kamu atur approver baru di Bagan Approval.",
  "Open Approval chart": "Buka Bagan Approval",
  "{n} automatic deduction dated after their last day was canceled.": "{n} potongan otomatis setelah hari terakhirnya dibatalkan.",
  "{n} automatic deductions dated after their last day were canceled.": "{n} potongan otomatis setelah hari terakhirnya dibatalkan.",
  // Refusals (the server's `code`)
  "You can't do this to your own account.": "Tidak bisa dilakukan ke akun kamu sendiri.",
  "You can't do this to someone at or above your level.": "Tidak bisa dilakukan ke orang yang setara atau di atas level kamu.",
  "Only BoD and above can do this.": "Hanya BoD ke atas yang bisa melakukan ini.",
  "Check the last working day: not after today, and not before they joined.": "Cek hari kerja terakhir: tidak boleh setelah hari ini, dan tidak sebelum tanggal bergabung.",
  "They aren't a member of the company workspace.": "Dia bukan anggota workspace perusahaan.",
  "This account is offboarded already.": "Akun ini sudah di-offboard.",
  "This account isn't offboarded.": "Akun ini tidak sedang di-offboard.",
  "Something went wrong. Nothing was changed.": "Ada yang salah. Tidak ada yang diubah.",
  // Reinstate
  "Reinstate {name}?": "Aktifkan ulang {name}?",
  "They can sign in again and are back in {workspaces} with the role and settings they had.": "Dia bisa masuk lagi dan kembali ke {workspaces} dengan peran dan pengaturan yang sama.",
  "They can sign in again.": "Dia bisa masuk lagi.",
  "Not restored: projects, teams, passkeys, devices, and anyone who had them as approver. Set those again by hand.": "Tidak dikembalikan: project, tim, passkey, perangkat, dan orang yang approver-nya dia. Atur ulang secara manual.",
  "{name} is back.": "{name} aktif lagi.",
  // Delete account refused: attendance history is never deleted
  "This account has attendance records or requests. Use Offboard instead, so they stay.": "Akun ini punya data absensi/pengajuan. Pakai Offboard supaya datanya tetap ada.",
  "This account has attendance records or requests, so it can't be deleted. It's offboarded already: it can't sign in, and its history stays.": "Akun ini punya data absensi/pengajuan, jadi tidak bisa dihapus. Akunnya sudah di-offboard: tidak bisa masuk, dan riwayatnya tetap ada.",
  // Sign-in refused for an offboarded account (routes/login.tsx)
  "This account has been deactivated. Ask your BoD if you think this is a mistake.": "Akun ini sudah dinonaktifkan. Hubungi BoD kalau menurutmu ini keliru.",
  // Task detail: an assignee or creator who left
  "Left the company. Their tasks stay assigned to them.": "Sudah keluar dari perusahaan. Task-nya tetap atas namanya.",
}
