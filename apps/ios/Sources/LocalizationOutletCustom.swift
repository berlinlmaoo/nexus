import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for the Outlet Sales Dashboard revisions of 14 Oct 2026 (report settings, guest overview,
// daily targets; Views/OutletSalesCustom.swift and the outlet views). Wording follows the web's
// apps/web/src/lib/i18n/id-outlet.ts; the iOS keys use %@ / %d where the web writes {month} / {n}.
// Sales, Pax, RSVP and Hosting stay as Ryan wrote them. Keys must not appear in any other
// Localization*.swift (scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianOutletCustom: [String: String] = [
        "Report settings": "Pengaturan laporan",
        "Guests · %@": "Tamu · %@",
        "No guest numbers for %@ yet": "Belum ada angka tamu untuk %@",
        "They come from each night's report. Fill one in and RSVP, hosting and community totals add up here.": "Angkanya datang dari laporan tiap malam. Isi satu, lalu total RSVP, hosting, dan komunitas terkumpul di sini.",
        "Fill a report": "Isi laporan",
        "From 1 report": "Dari 1 laporan",
        "From %d reports": "Dari %d laporan",
        "RSVP total": "Total RSVP",
        "Hosting total": "Total hosting",
        "Communities": "Komunitas",
        "No RSVP items. Add them in Report settings.": "Belum ada item RSVP. Tambahkan di Pengaturan laporan.",
        "No hosting items. Add them in Report settings.": "Belum ada item hosting. Tambahkan di Pengaturan laporan.",
        "No communities yet. Add the ones that come in Report settings.": "Belum ada komunitas. Tambahkan yang datang di Pengaturan laporan.",
        "archived": "diarsipkan",
        "Communities – TOTAL": "Komunitas – TOTAL",
        "Total only": "Total saja",
        "Breakdown": "Rincian",
        "Report settings saved. The form uses them from now on.": "Pengaturan laporan disimpan. Form memakainya mulai sekarang.",
        "The settings weren't saved. Try again.": "Pengaturan tidak tersimpan. Coba lagi.",
        "What this outlet's team reports after each night. Renaming keeps every figure; past reports never change.": "Apa yang dilaporkan tim outlet ini setelah tiap malam. Ganti nama tidak menghapus angka; laporan lama tidak berubah.",
        "The settings didn't load. Check your connection, then try again.": "Pengaturan gagal dimuat. Cek koneksi, lalu coba lagi.",
        "RSVP items": "Item RSVP",
        "RSVP total is the sum of these.": "Total RSVP adalah jumlah item ini.",
        "Add RSVP item": "Tambah item RSVP",
        "Hosting items": "Item hosting",
        "Hosting total is the sum of these.": "Total hosting adalah jumlah item ini.",
        "Add hosting item": "Tambah item hosting",
        "The communities that came. Each counts one number, or its own items.": "Komunitas yang datang. Masing-masing dihitung satu angka, atau dengan itemnya sendiri.",
        "Archive %@?": "Arsipkan %@?",
        "1 report has figures for it. It leaves the form, and that report keeps its numbers and totals. You can restore it later.": "1 laporan punya angka untuk item ini. Item hilang dari form, dan laporan itu tetap menyimpan angka dan totalnya. Bisa dipulihkan nanti.",
        "%d reports have figures for it. It leaves the form, and those reports keep their numbers and totals. You can restore it later.": "%d laporan punya angka untuk item ini. Item hilang dari form, dan laporan-laporan itu tetap menyimpan angka dan totalnya. Bisa dipulihkan nanti.",
        "The report settings stay as they were.": "Pengaturan laporan tetap seperti semula.",
        "Item name": "Nama item",
        "Community name": "Nama komunitas",
        "How it is counted": "Cara menghitung",
        "Add item to %@": "Tambah item ke %@",
        "this community": "komunitas ini",
        "Add community": "Tambah komunitas",
        "Own daily target": "Target harian sendiri",
        "Day target": "Target harian",
        "Change day target": "Ubah target harian",
        "Set day target": "Atur target harian",
        "Sales target": "Target sales",
        "Pax target": "Target pax",
        "No target": "Tanpa target",
        "Fill sales, pax or both. An empty box uses the month's target split over its days.": "Isi sales, pax, atau keduanya. Kotak kosong memakai target bulanan dibagi jumlah harinya.",
        "Own target": "Target sendiri",
        "Month's target ÷ days": "Target bulanan ÷ hari",
        "No items yet. Report settings sets them up.": "Belum ada item. Atur di Pengaturan laporan.",
    ]
}
