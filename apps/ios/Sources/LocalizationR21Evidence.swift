import Foundation

/// Indonesian strings for R-21, evidence on a board status change (owner 20 Oct 2026; same words as the web's
/// id-att-evidence.ts). Keys must not appear in any other Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianR21Evidence: [String: String] = [
        "Attach the sick note": "Lampirkan surat sakit",
        "Attach a supporting photo or file": "Lampirkan foto atau file pendukung",
        "Optional. Photo or PDF, up to 10 MB. Saved without it, the day is marked “no evidence attached”.": "Opsional. Foto atau PDF, maksimal 10 MB. Kalau disimpan tanpa bukti, hari ini ditandai “tanpa bukti”.",
        "Take photo": "Ambil foto",
        "Choose file": "Pilih file",
        "Change %@ (%@) to %@": "Ubah %@ (%@) jadi %@",
        "Save without evidence": "Simpan tanpa bukti",
        "No evidence attached": "Tanpa bukti",
        "Correction evidence": "Bukti koreksi",
    ]
}
