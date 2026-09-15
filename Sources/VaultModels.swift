import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault — the office's shared shelf.
//
// Every one of these mirrors what `serializeVaultItem` / `serializeShare` send, and nothing here
// carries a storage path: the server addresses bytes by ITEM ID and resolves the path itself. That
// is not a detail of the wire format, it is the property that makes a share link safe, so a field
// named `storageKey` appearing in this file later would mean something upstream went wrong.
// ─────────────────────────────────────────────────────────────────────────────

struct VaultPerson: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let avatar: String?
}

struct VaultItem: Codable, Identifiable, Hashable {
    let id: String
    /// "FOLDER" or "FILE". A String rather than an enum for the same reason the server stores one:
    /// a third kind can be added without a migration, and an unknown value must not fail decoding
    /// of the whole listing.
    let kind: String
    let name: String
    let mimeType: String?
    let size: Int?
    let width: Int?
    let height: Int?
    let parentId: String?
    /// `/api/vault/items/<id>/raw` — the only address the app is ever given for the bytes.
    let url: String?
    let downloadUrl: String?
    let uploader: VaultPerson?
    let owner: VaultPerson?
    let childCount: Int
    let shareCount: Int
    let minReadRole: String?
    let trashed: Bool
    let createdAt: String?
    let canModify: Bool

    var isFolder: Bool { kind == "FOLDER" }
    /// Locked by a role threshold somewhere up the tree. Shown as a small padlock, never used to
    /// decide anything — the server decides, on every request.
    var isRestricted: Bool { minReadRole != nil }
}

struct VaultCrumb: Codable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct VaultQuota: Codable, Hashable {
    let usedBytes: Int
    let totalBytes: Int
}

struct VaultListing: Codable {
    let items: [VaultItem]
    let breadcrumb: [VaultCrumb]
    let parentId: String?
    let canWrite: Bool
    let canManageAccess: Bool
    let quota: VaultQuota
}

/// How long a link stays alive. The raw values are the presets the server accepts, verbatim.
enum VaultExpiry: String, CaseIterable, Identifiable {
    case d3 = "3d", d7 = "7d", d14 = "14d", d30 = "30d", permanent = "permanent"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .d3:        return T("3 days")
        case .d7:        return T("7 days")
        case .d14:       return T("2 weeks")
        case .d30:       return T("1 month")
        case .permanent: return T("Forever")
        }
    }
}

struct VaultShare: Codable, Identifiable, Hashable {
    let id: String
    let slug: String
    let itemId: String
    let url: String
    let requireAuth: Bool
    let allowDownload: Bool
    let expiresAt: String?
    let revokedAt: String?
    /// "active" | "expired" | "revoked". Expired and revoked stay apart all the way to the UI,
    /// because "it ran out" and "somebody switched it off" are different answers to the same
    /// question and only one of them is worth asking a colleague about.
    let status: String
    let viewCount: Int
    let createdAt: String?
}

struct VaultSharesResponse: Codable { let shares: [VaultShare] }

/// What a share link resolves to for somebody who may not have an account at all.
struct VaultPublicFile: Codable {
    struct FileInfo: Codable {
        let name: String
        let mimeType: String?
        let size: Int?
    }
    let slug: String
    let requireAuth: Bool
    let allowDownload: Bool
    let file: FileInfo
    let previewUrl: String
    let downloadUrl: String?
}


// ─────────────────────────────────────────────────────────────────────────────
// Google Workspace — penautan akun dari Control Room di HP.
//
// Hanya MENAUTKAN, bukan membuat. Membuat mailbox mengisi seat lisensi berbayar dan
// menampilkan sandi sementara yang hanya muncul sekali; keduanya pekerjaan meja, bukan
// sesuatu yang pantas dilakukan sambil berjalan dengan satu tangan.
// ─────────────────────────────────────────────────────────────────────────────

struct GoogleWorkspaceAccount: Codable, Identifiable, Hashable {
    var id: String { email }
    let email: String
    let fullName: String
    let suspended: Bool
    let isAdmin: Bool
    let domain: String
    /// Profil NEXUS yang sudah memakai akun ini, atau nil.
    let linkedTo: LinkedTo?
    struct LinkedTo: Codable, Hashable { let id: String; let name: String }
}

struct GoogleWorkspaceAccounts: Codable {
    let configured: Bool
    let domains: [String]?
    let accounts: [GoogleWorkspaceAccount]
    let error: String?
}


// ─────────────────────────────────────────────────────────────────────────────
// Keanggotaan tim + project per orang — dropdown di Control Room -> Users.
//
// Satu panggilan untuk SELURUH daftar, bukan satu per baris: layar ini menggambar 49 baris,
// dan versi per-baris berarti 49 permintaan jaringan sebelum apa pun terlihat. Pola yang sama
// sudah dipakai daftar akun Google di layar yang sama.
// ─────────────────────────────────────────────────────────────────────────────

struct UserMemberships: Codable, Sendable {
    let projects: [ProjectRow]
    let teams: [TeamRow]

    struct ProjectRow: Codable, Identifiable, Sendable {
        let id: String
        let name: String
        let color: String?
        let role: String
        /// nil = ditambahkan langsung ke project; berisi nama tim = ikut lewat tim itu.
        /// Perbedaannya penting: keanggotaan lewat tim ditulis ulang oleh sinkronisasi tim,
        /// jadi mencabutnya dari halaman project tidak bertahan.
        let viaTeam: String?
    }
    struct TeamRow: Codable, Identifiable, Sendable {
        let id: String
        let name: String
        let color: String?
        let role: String
        let division: String?
    }
}

struct UserMembershipsResponse: Codable, Sendable {
    let byUser: [String: UserMemberships]
}
