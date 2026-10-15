import Foundation

/// Indonesian strings for the UI tour run 16 iOS fixes (15 Oct 2026). Keys must not appear in any other
/// Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianRun16: [String: String] = [
        // Login: the web's wording (R16-I-09, decision 2)
        "Request access": "Minta akses",
        // Days off / public holidays usage, the web's form (R16-I-11, R16-B-24, decision 4)
        "%@/%@ used": "%@/%@ terpakai",
        "%@/%@ used · %@ left": "%@/%@ terpakai · sisa %@",
        // Prorated allowance footnote, the web's words (R16-I-14)
        "From {date}: {days} days, {working} working days ({days} − {quota} days off, the {full}-day allowance prorated).": "Sejak {date}: {days} hari, {working} hari kerja ({days} − {quota} day off, jatah {full} hari dihitung proporsional).",
        // Projects summary: the web's hint (R16-B-15)
        "Select a project to open it.": "Pilih proyek untuk membukanya.",
        // Project calendar day panel: the web's sentences (R16-B-09)
        "Nothing on this day, nor anywhere else this month.": "Tidak ada apa-apa di tanggal ini, begitu juga sepanjang bulan ini.",
        "Nothing on this day. Days with a dot have tasks.": "Tidak ada apa-apa di hari ini. Hari yang bertitik ada tugasnya.",
        "Nothing on this day. Tap another day to see its tasks.": "Tidak ada apa pun di hari ini. Ketuk hari lain untuk melihat tugasnya.",
        "Nothing on this day. Click another day to see its tasks.": "Tidak ada apa pun di hari ini. Klik hari lain untuk melihat tugasnya.",
        // Attendance board: the web's labelled export (R16-B-24)
        "Export": "Ekspor",
        // Home leaderboard widget (R16-B-14)
        "Rank %d": "Peringkat %d",
        // Settings → Passkeys: the web's form and list (R16-B-23)
        "Device name (e.g. MacBook Pro)": "Nama perangkat (mis. MacBook Pro)",
        "Add passkey": "Tambah passkey",
        "Your passkeys": "Passkey kamu",
        // Outlet report settings: the web drawer's buttons (R16-M-15)
        "Save settings": "Simpan setelan",
        // Social media day sheet: the web's button (R16-B-19)
        "Save day": "Simpan hari",
    ]
}
