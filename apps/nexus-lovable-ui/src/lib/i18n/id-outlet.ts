/**
 * English → Indonesian for the Outlet Sales Dashboard (owner, 10 Oct 2026, for Ryan; components/outlet-sales).
 * Keys must be unique across all id-*.ts files (i18n.test.mjs). The form's questions are not here: they come
 * from the server in both languages (lib/outlet-sales.ts OUTLET_FORM), in Ryan's words. Sales, Pax, RSVP and
 * Hosting stay as Ryan wrote them.
 */
export const ID_OUTLET: Record<string, string> = {
  // Picking the type
  "Outlet Sales Dashboard": "Outlet Sales Dashboard",
  "One outlet: sales and pax against the month's target, a calendar of events, and a report form for every night.":
    "Satu outlet: sales dan pax dibanding target bulanan, kalender event, dan form laporan untuk tiap malam.",
  "Create project + open dashboard": "Buat proyek + buka dashboard",
  "Report form": "Form laporan",

  // Status
  "Upcoming": "Akan datang",
  "Waiting report": "Menunggu laporan",
  "Reported": "Sudah dilaporkan",
  "Nothing planned ahead in this month.": "Belum ada event yang akan datang di bulan ini.",
  "Every night that's over has its report.": "Semua malam yang sudah lewat sudah ada laporannya.",
  "No reports in this month yet.": "Belum ada laporan di bulan ini.",
  "Sales and pax missing": "Sales & pax belum diisi",
  "Sales missing": "Sales belum diisi",
  "Pax missing": "Pax belum diisi",

  // Month and toolbar
  "This month": "Bulan ini",
  "Copy form link": "Salin link form",
  "Form link copied. Anyone in this project can open it in NEXUS.": "Link form disalin. Semua anggota project ini bisa membukanya di NEXUS.",
  "The link wasn't copied. Copy it from the address bar instead.": "Link tidak tersalin. Salin dari address bar saja.",
  "Add event": "Tambah event",
  "Loading the outlet": "Memuat outlet",
  "This outlet is for its project members": "Outlet ini khusus anggota project-nya",
  "The outlet didn't load": "Outlet gagal dimuat",

  // Overview
  "This month against target": "Bulan ini dibanding target",
  "Sales · {month}": "Sales · {month}",
  "Pax · {month}": "Pax · {month}",
  "No target for this month": "Belum ada target untuk bulan ini",
  "Target set by {name}": "Target diatur oleh {name}",
  "No target for {month} yet.": "Belum ada target untuk {month}.",
  "The project lead or a manager sets it.": "Lead project atau manager yang mengaturnya.",
  "Set target": "Atur target",
  "Change target": "Ubah target",
  "Sales target for {month}": "Target sales {month}",
  "Pax target for {month}": "Target pax {month}",
  "Save target": "Simpan target",
  "Target for {month} saved.": "Target {month} tersimpan.",
  "The target wasn't saved. Try again.": "Target tidak tersimpan. Coba lagi.",
  "Leave a box empty for no target. The month's total is the sum of its events' actual figures.":
    "Kosongkan kalau tidak ada target. Total bulan ini = jumlah angka aktual semua event-nya.",
  "Events": "Event",
  "1 night is waiting for its report": "1 malam menunggu laporannya",
  "{n} nights are waiting for their report": "{n} malam menunggu laporannya",
  "Events in {month}": "Event di {month}",
  "No events this month yet": "Belum ada event bulan ini",
  "Add the nights you have planned. After each one, the team fills its report and the totals above update.":
    "Tambahkan malam-malam yang sudah direncanakan. Setelah tiap malam, tim mengisi laporannya dan total di atas ikut terbarui.",
  "{n} pax": "{n} pax",

  // Calendar and detail
  "1 event": "1 event",
  "{n} events": "{n} event",
  "No events": "Tidak ada event",
  "Add event on this day": "Tambah event di hari ini",
  "No event on this day. Add one to fill its report after the night.": "Tidak ada event di hari ini. Tambahkan supaya laporannya bisa diisi setelah malamnya.",
  "Fill report": "Isi laporan",
  "Edit report": "Ubah laporan",
  "Not filled": "Belum diisi",
  "Reported by {name}": "Dilaporkan oleh {name}",
  "Last changed by {name}": "Terakhir diubah oleh {name}",
  "The night's report, as the team filled it.": "Laporan malam itu, seperti yang diisi tim.",

  // Form
  "Event report": "Laporan event",
  "Fill it after every night. It goes straight into Overview, Calendar and Board.": "Isi setiap selesai event. Datanya langsung masuk ke Overview, Calendar, dan Board.",
  "Which event?": "Event yang mana?",
  "New event": "Event baru",
  "Waiting for a report": "Menunggu laporan",
  "Discard the changes you haven't saved?": "Buang perubahan yang belum disimpan?",
  "This event no longer exists. It may have been deleted; Control Room → Audit can restore it.":
    "Event ini sudah tidak ada. Mungkin sudah dihapus; Control Room → Audit bisa memulihkannya.",
  "Give the event a name.": "Isi nama event-nya.",
  "Pick the day of the event.": "Pilih tanggal event-nya.",
  "Report for {name} saved.": "Laporan {name} tersimpan.",
  "{name} added. Fill its report after the night.": "{name} ditambahkan. Isi laporannya setelah malamnya.",
  "{name} saved.": "{name} tersimpan.",
  "That wasn't saved. Try again.": "Tidak tersimpan. Coba lagi.",
  "Save report": "Simpan laporan",
  "Delete event": "Hapus event",
  "The event and its report leave the calendar, the board and the month's totals. Control Room → Audit can restore it.":
    "Event dan laporannya hilang dari kalender, board, dan total bulan ini. Control Room → Audit bisa memulihkannya.",
  "The event wasn't deleted. Try again.": "Event tidak terhapus. Coba lagi.",

  // Audit
  "It goes back to its outlet with its whole report, and counts in its month's totals again.":
    "Kembali ke outlet-nya dengan laporan lengkap, dan dihitung lagi di total bulannya.",
}
