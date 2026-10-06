/** English → Indonesian for the Calendar page's header, month grid and shortcut list (components/calendar/CalendarPage, MonthGrid). Keys must be unique across all id-*.ts files. */
export const ID_CALENDAR_EXTRA: Record<string, string> = {
  "View": "Tampilan",
  "{unit}, {n} task": "{unit}, {n} tugas",
  "{unit}, {n} tasks": "{unit}, {n} tugas",
  // Narrowing the calendar to one division is "focus" on every platform, never zoom / perbesar (in the
  // Bagan, "Perbesar" magnifies the canvas). "Focus on {unit}", "All divisions" and "Close, then leave
  // the focus" are in id-calendar-page.ts.
  "Focus on {unit}, {n} task": "Fokus ke {unit}, {n} tugas",
  "Focus on {unit}, {n} tasks": "Fokus ke {unit}, {n} tugas",
  "Dots follow the IP & Division Chart. A name with the focus icon focuses the calendar on that division; any other name filters it.": "Titik mengikuti Bagan IP & Divisi. Nama berikon fokus memfokuskan kalender ke divisi itu; nama lain memfilternya.",
  "public holiday": "tanggal merah",
  "You have nothing due in {month}.": "Kamu tidak punya tugas bertenggat di {month}.",
  "Your division has nothing due in {month}.": "Divisimu tidak punya tugas bertenggat di {month}.",
  "First / last day of the week": "Hari pertama / terakhir dalam minggu",
  "Previous / next month (with Shift: year)": "Bulan sebelum / berikutnya (dengan Shift: tahun)",
  "Arrow keys, [ ], Home / End and PgUp / PgDn work while a date in the month has keyboard focus.": "Tombol panah, [ ], Home / End, dan PgUp / PgDn berfungsi selama fokus keyboard ada di salah satu tanggal kalender.",
  "Single-key shortcuts": "Pintasan satu tombol",
  "Turn them off if they clash with a screen reader or voice control.": "Matikan jika bentrok dengan pembaca layar atau kontrol suara.",
}
