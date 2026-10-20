/**
 * English → Indonesian for the evidence on a board status change (owner, 20 Oct 2026): → Sick asks for the sick
 * note, → Permit and Permit / TK / nothing → Present ask for a supporting photo or file — optional, a change saved
 * without it is marked "no evidence attached" (components/attendance/StatusOverridePanel.tsx, the correction drawer
 * and the day detail on the member record). Keys must be unique across all id-*.ts files (i18n.test.mjs).
 */
export const ID_ATT_EVIDENCE: Record<string, string> = {
  "The file must be smaller than 10 MB.": "Ukuran file maksimal 10 MB.",
  "Attach a photo or a PDF.": "Lampirkan foto atau PDF.",
  "Attach the sick note": "Lampirkan surat sakit",
  "Attach a supporting photo or file": "Lampirkan foto atau file pendukung",
  "Optional. Photo or PDF, up to 10 MB. Saved without it, the day is marked “no evidence attached”.": "Opsional. Foto atau PDF, maksimal 10 MB. Kalau disimpan tanpa bukti, hari ini ditandai “tanpa bukti”.",
  "Choose file": "Pilih file",
  "No evidence attached": "Tanpa bukti",
  "Change {date} ({name}) to {status}": "Ubah {date} ({name}) jadi {status}",
  "That day’s automatic XP and day-off deductions are restored too.": "Potongan XP dan day off otomatis hari itu juga dikembalikan.",
  "Save without evidence": "Simpan tanpa bukti",
  "Correction evidence": "Bukti koreksi",
};
