import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for the Mac / iPad parity pass on Calendar, Z Vault, Settings and Room Booking (13 Oct
// 2026): the dev web's page headers, the Vault's cards and usage line, Settings' Profile / Password /
// Delete account cards and the phone number field. Merged into AppLanguage.translate after the other
// tables; a key here must not appear in any other Sources/Localization*.swift (a duplicate key traps
// at runtime — scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianMacScreens: [String: String] = [
        // Room Booking
        "All rooms": "Semua ruangan",
        "Book a meeting room and see who has it when.": "Pesan ruang meeting dan lihat siapa yang memakainya kapan.",
        // Settings
        "Your profile, security, notifications and workspace preferences.": "Profil, keamanan, notifikasi, dan preferensi workspace kamu.",
        "Visible to your teammates": "Terlihat oleh rekan setimmu",
        "PNG, JPG or WEBP. Max 5 MB.": "PNG, JPG, atau WEBP. Maks. 5 MB.",
        "No company Google account linked yet. A board member links it from Control Room.": "Belum ada akun Google perusahaan yang ditautkan. direksi menautkannya dari Control Room.",
        "Phone number": "Nomor HP",
        "08xxxxxxxxxx · outside Indonesia, start with + (e.g. +65…)": "08xxxxxxxxxx · di luar Indonesia, awali dengan + (mis. +65…)",
        "For numbers outside Indonesia, type + and the country code.": "Untuk nomor di luar Indonesia, ketik + dan kode negaranya.",
        "Profile saved.": "Profil tersimpan.",
        "Permanently delete your NEXUS account. You won't be able to sign in again, and this can't be undone.": "Hapus akun NEXUS kamu selamanya. Kamu tidak bisa masuk lagi, dan ini tidak bisa dibatalkan.",
        "Sign out of NEXUS on this device.": "Keluar dari NEXUS di perangkat ini.",
        "New password": "Kata sandi baru",
        "Password updated.": "Kata sandi diperbarui.",
        "Couldn't change it. Check your current password.": "Gagal mengubahnya. Cek kata sandi kamu saat ini.",
        "Couldn't change the role.": "Gagal mengubah peran.",
        "Couldn't remove the member.": "Gagal mengeluarkan anggota.",
        // Z Vault
        "The whole office's shared shelf — logos, decks, assets.": "Rak bersama seluruh kantor — logo, deck, aset.",
        "%@ of %@ used": "%@ dari %@ terpakai",
        "Folders": "Folder",
        "Upload": "Unggah",
    ]
}
