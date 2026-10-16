import Foundation

/// Indonesian strings for the UI tour run 20 iOS fixes. Keys must not appear in any other Localization*.swift
/// (scripts/check-localization.sh). Wording as on the web (fix20 API copy).
extension AppLanguage {
    static let indonesianRun20: [String: String] = [
        // Profile XP figure (fix20 API copy 1, R20-B-06 / R20-I-24)
        "%@ XP this period": "%@ XP periode ini",
        "Starts at %@ on the 28th · +%@ gained · %@ lost": "Mulai dari %@ tiap tanggal 28 · +%@ didapat · %@ hilang",
        "Starts at %@ on the 28th": "Mulai dari %@ tiap tanggal 28",
        // Attendance cards and the day-off / public holiday log (fix20 API copy 3 and 4, decision 11)
        "Days off · %@/%@ used": "Day off · %@/%@ terpakai",
        "Public holidays · %@/%@ used": "Tanggal merah · %@/%@ terpakai",
        "See public holidays used": "Lihat tanggal merah yang terpakai",
        "See how your days off were used": "Lihat pemakaian day off-mu",
        "Includes {n} extra ({reasons}) — expires on the 27th": "Termasuk {n} tambahan ({reasons}) — hangus tanggal 27",
        "Day-off log": "Log day off",
        "Public holiday log": "Log tanggal merah",
        "Days off and deductions (late >120 min) this period": "Day off dan potongan (telat >120 menit) periode ini",
        "Public holidays used this period": "Tanggal merah yang terpakai periode ini",
        "Current period:": "Periode berjalan:",
        "Auto · late >120m": "Otomatis · telat >120m",
        "No days off used yet": "Belum ada day off terpakai",
        "No public holidays used yet": "Belum ada tanggal merah terpakai",
        "Days off you take from %@ show up here.": "Day off yang kamu ambil sejak %@ muncul di sini.",
        "Public holidays you use from %@ show up here.": "Tanggal merah yang kamu pakai sejak %@ muncul di sini.",
        "Automatic: more than 120 min late": "Otomatis: telat lebih dari 120 menit",
        "Automatic: more than 120 min late on %@ (taken from the day-off allowance)": "Otomatis: telat lebih dari 120 menit pada %@ (memotong jatah day off)",
        "Automatic: no check-in or check-out on %@ (taken from the day-off allowance)": "Otomatis: tidak check-in atau check-out pada %@ (memotong jatah day off)",
        // Board chips in words (fix20 API copy 3 and 4)
        "{n} days off left": "Sisa {n} day off",
        "1 day off left": "Sisa 1 day off",
        "No days off left": "Day off habis",
        "{n} holidays left": "Sisa {n} tanggal merah",
        "1 holiday left": "Sisa 1 tanggal merah",
        "No holidays left": "Tanggal merah habis",
        "Day off left this period: {left} of {quota} (used {used})": "Sisa day off periode ini: {left} dari {quota} (terpakai {used})",
    ]
}
