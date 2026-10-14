/**
 * English → Indonesian for the Social Media Report (owner, 14 Oct 2026; components/social-media).
 * Keys must be unique across all id-*.ts files (i18n.test.mjs). "Views" is not here: the shared dictionary
 * already uses it for a project's saved views, so the report prints "Tayangan" itself (viewsLabel).
 */
export const ID_SOCIAL: Record<string, string> = {
  // Picking the type
  "Social Media Report": "Laporan Media Sosial",
  "Daily views, likes, comments, shares and posts per platform, against monthly and daily targets.":
    "Tayangan, likes, komentar, share, dan postingan harian per platform, dibanding target bulanan dan harian.",

  // Toolbar and states
  "Platforms & targets": "Platform & target",
  "Record today": "Isi hari ini",
  "Loading the report": "Memuat laporan",
  "This report is for its project members": "Laporan ini khusus anggota project",
  "The report didn't load": "Laporan gagal dimuat",
  "{month} hasn't started yet": "{month} belum dimulai",
  "You can set its targets now. The overview fills in from its first day.": "Kamu bisa atur targetnya sekarang. Ringkasan terisi mulai hari pertamanya.",
  "The overview fills in from its first day.": "Ringkasan terisi mulai hari pertamanya.",
  "Set targets": "Atur target",
  "Nothing recorded for {month} yet": "Belum ada laporan untuk {month}",
  "Record each day's views, likes, comments, shares and posts per platform. The totals and targets show up here.":
    "Isi tayangan, likes, komentar, share, dan postingan tiap hari per platform. Total dan targetnya muncul di sini.",
  "The team records each day's figures per platform. They show up here once someone has.":
    "Tim mengisi angka harian per platform. Angkanya muncul di sini setelah ada yang mengisi.",

  // Overview
  "What counts as engagement": "Apa yang dihitung sebagai engagement",
  "Engagement = Likes + Comments + Shares": "Engagement = Likes + Komentar + Share",
  "Views are counted on their own and are not part of engagement.": "Tayangan dihitung terpisah dan tidak termasuk engagement.",
  "Month to date · {span}": "Bulan ini sampai sekarang · {span}",
  "Set this month's targets": "Atur target bulan ini",
  "No targets for this month. The Project Owner or a BoD sets them.": "Belum ada target bulan ini. Pemilik Project atau BoD yang mengaturnya.",
  "Engagement by platform": "Engagement per platform",
  "Engagement": "Engagement",
  "Contents posted": "Konten yang diposting",
  "{n} posts": "{n} postingan",
  "1 post": "1 postingan",
  "{n} / {target} posts": "{n} / {target} postingan",
  "{name} posts against target": "Postingan {name} dibanding target",
  "{name} engagement against target": "Engagement {name} dibanding target",
  "{name} engagement per day": "Engagement {name} per hari",
  "Target to date = each day's target up to today. A day without its own target takes the month's target split evenly.":
    "Target sampai hari ini = jumlah target tiap hari sampai hari ini. Hari tanpa target sendiri memakai target bulanan dibagi rata.",
  "No engagement target": "Belum ada target engagement",
  "Target to date · month target {target}": "Target sampai hari ini · target sebulan {target}",
  "Likes": "Likes",
  "Comments + Shares": "Komentar + Share",

  // Calendar
  "{n} engagement": "{n} engagement",
  "Has notes": "Ada catatan",
  "Not recorded": "Belum diisi",
  "Each day shows its engagement (likes + comments + shares) across platforms, and the posts published. Tap a day to record it.":
    "Tiap hari menampilkan engagement (likes + komentar + share) semua platform dan jumlah postingan. Ketuk tanggal untuk mengisinya.",

  // Day sheet
  "Shares": "Share",
  "Posts published": "Postingan terbit",
  "{day} saved.": "{day} tersimpan.",
  "The day wasn't saved. Try again.": "Laporan hari ini tidak tersimpan. Coba lagi.",
  "This day hasn't come yet. Record it once it's over.": "Hari ini belum tiba. Isi setelah harinya lewat.",
  "You can view this report. Recording needs Can edit access.": "Kamu bisa melihat laporan ini. Untuk mengisi, butuh akses Bisa edit.",
  "Fill what you have. An empty box stays empty, 0 is a real zero.": "Isi yang ada saja. Kotak kosong tetap kosong, 0 berarti nol.",
  "What worked": "Yang berhasil",
  "What didn't work": "Yang tidak berhasil",
  "e.g. the 7 pm reel, a trending sound": "mis. reel jam 7 malam, sound yang lagi tren",
  "e.g. carousel posted too late": "mis. carousel diposting terlalu malam",
  "Set this day's targets": "Atur target hari ini",
  "This day's targets": "Target hari ini",
  "Engagement target": "Target engagement",
  "Posts target": "Target postingan",
  "Fill either, both or none. An empty box uses the month's target split over its days.":
    "Isi salah satu, keduanya, atau kosongkan. Kotak kosong memakai target bulanan dibagi jumlah harinya.",
  "Save targets": "Simpan target",
  "Day targets saved.": "Target harian tersimpan.",
  "Save day": "Simpan hari",
  "This day stays as it was.": "Laporan hari ini tetap seperti sebelumnya.",

  // Settings
  "What this report tracks, and the month's goals per platform.": "Apa yang dilacak laporan ini, dan target bulanannya per platform.",
  "Targets for {month}": "Target {month}",
  "Each day's target is the month's split evenly, unless a day sets its own in the calendar. Leave a box empty for no target.":
    "Target tiap hari = target bulanan dibagi rata, kecuali harinya punya target sendiri di kalender. Kosongkan kotak kalau tidak ada target.",
  "Platforms": "Platform",
  "Renaming keeps every figure. Archiving hides a platform from the form; its past days keep their numbers.":
    "Ganti nama tidak menghapus angka apa pun. Arsipkan menyembunyikan platform dari form; angka hari-hari sebelumnya tetap ada.",
  "Platform name": "Nama platform",
  "Archive {name}": "Arsipkan {name}",
  "Add platform": "Tambah platform",
  "Add platform, e.g. YouTube": "Tambah platform, mis. YouTube",
  "A new platform gets its targets after you save.": "Platform baru bisa diberi target setelah disimpan.",
  "It leaves the day form and the overview. Its past figures and targets stay, and you can restore it later.":
    "Platform ini hilang dari form harian dan ringkasan. Angka dan target sebelumnya tetap ada, dan bisa dipulihkan nanti.",
  "Platforms and targets saved.": "Platform dan target tersimpan.",
  "The platforms and targets stay as they were.": "Platform dan target tetap seperti sebelumnya.",
}
