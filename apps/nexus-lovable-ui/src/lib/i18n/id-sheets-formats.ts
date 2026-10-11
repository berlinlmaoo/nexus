/**
 * English → Indonesian for the spreadsheet's number formats (12 Oct 2026, Google Sheets parity):
 * Format › Number / the toolbar's "123" menu, and the custom number, date-time and currency dialogs.
 * Labels follow Sheets' Indonesian UI. Keys must be unique across all id-*.ts files (i18n.test.mjs);
 * "Automatic", "Plain text", "Number", "Percent", "Date", "Apply", "Month", "Day", "Remove" and
 * "Search" already live elsewhere and are reused.
 */
export const ID_SHEETS_FORMATS: Record<string, string> = {
  "Scientific": "Ilmiah",
  "Accounting": "Akuntansi",
  "Financial": "Keuangan",
  "Currency": "Mata Uang",
  "Currency rounded": "Mata uang dibulatkan",
  "Time": "Waktu",
  "Date time": "Tanggal waktu",
  "Duration": "Durasi",
  "Custom currency": "Mata uang khusus",
  "Custom date and time": "Tanggal dan waktu kustom",
  "Custom number format": "Format angka kustom",
  "Custom number formats": "Format angka khusus",
  "Custom date and time formats": "Format tanggal dan waktu khusus",
  "Custom currencies": "Mata uang khusus",
  "Example:": "Contoh:",
  "Recently used": "Baru saja digunakan",
  "Number format presets": "Format angka bawaan",
  "Year": "Tahun",
  "Day of week": "Hari dalam seminggu",
  "Hour": "Jam",
  "Minute": "Menit",
  "Second": "Detik",
  "AM/PM": "AM/PM",
  "Elapsed hours": "Jam berlalu",
  "Elapsed minutes": "Menit berlalu",
  "Elapsed seconds": "Detik berlalu",
  "Add date or time format": "Tambahkan format tanggal atau waktu",
  "Change {field} format": "Ubah format {field}",
  "Separator text": "Teks pemisah",
  "Date and time format presets": "Format tanggal dan waktu bawaan",
  "Search currencies": "Telusuri mata uang",
  "Currency format": "Format mata uang",
  "No currencies match": "Tidak ada mata uang yang cocok",
  "Symbol first": "Simbol di depan",
  "Symbol first, rounded": "Simbol di depan, dibulatkan",
  "Negative in brackets": "Negatif dalam kurung",
  "Negative in red": "Negatif berwarna merah",
  "Symbol after": "Simbol di belakang",
  "Currency code": "Kode mata uang",
};
