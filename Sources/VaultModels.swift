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
    /// Who may add files here ("MANAGER_PLUS" | "BOD_PLUS"), set on this item itself; nil = no lock of
    /// its own (it follows the folder above). Decoded since 9 Oct 2026; the server always sent it.
    let minWriteRole: String?
    let trashed: Bool
    let createdAt: String?
    let canModify: Bool
    /// `/api/vault/items/<id>/thumb?v=…` for a picture the server can make a small copy of; nil for
    /// everything else and from servers before 9 Oct 2026. Ask for a size with `thumbURL(width:)`.
    let thumbUrl: String?
    /// The content version the server puts in `url`/`thumbUrl` as `?v=` (since 9 Oct 2026). It changes
    /// when the file is replaced, which is what keeps URL-keyed caches (AttachmentCache, ImageLoader)
    /// from ever serving the old bytes under the same item id.
    let fileVersion: String?
    /// Search results only: the folders the item sits in, from the top (since 9 Oct 2026).
    let path: [VaultCrumb]?

    var isFolder: Bool { kind == "FOLDER" }
    /// Locked by a role threshold set on this item. Shown as a small padlock, never used to decide
    /// anything — the server decides, on every request.
    var isRestricted: Bool { minReadRole != nil }
    /// Only some roles may add files here (a lock of its own).
    var isWriteLocked: Bool { minWriteRole != nil }
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
    // Since 9 Oct 2026 — optional, so an older server's answer still decodes.
    let lastViewedAt: String?
    let createdBy: Maker?
    /// Whether THIS viewer may revoke it (its maker, the item's owner, BoD). nil from older servers:
    /// offer Revoke and let the server say no.
    let canRevoke: Bool?

    struct Maker: Codable, Hashable { let id: String; let name: String? }

    var isActive: Bool { status == "active" }
}

struct VaultSharesResponse: Codable {
    let shares: [VaultShare]
    /// Whether this person may make an EXTERNAL link for the item (the uploader, its owner, BoD).
    /// nil from servers before 9 Oct 2026; the item's own `canModify` is the same rule.
    let canShareExternally: Bool?
}

/// One file or folder as a share link sees it (since 9 Oct 2026). Every URL points back at the
/// link's slug plus an item id — never a path — and is re-checked by the server on every use.
struct VaultPublicItem: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let name: String
    let mimeType: String?
    let size: Int?
    let width: Int?
    let height: Int?
    let childCount: Int?
    /// "image" | "video" | "audio" | "pdf", or nil when nothing can preview it.
    let previewKind: String?
    /// nil on a view-only link for a file nothing can preview: there is nothing to fetch.
    let previewUrl: String?
    let downloadUrl: String?
    let thumbUrl: String?
    let fileVersion: String?

    var isFolder: Bool { kind == "FOLDER" }
}

/// One folder inside a shared folder: its live children the link may show, and the path from the
/// shared folder down to it (never above it).
struct VaultPublicListing: Codable {
    struct Folder: Codable, Hashable { let id: String; let name: String }
    let folder: Folder
    let breadcrumb: [VaultCrumb]
    let allowDownload: Bool
    let items: [VaultPublicItem]
}

/// What a share link resolves to for somebody who may not have an account at all.
struct VaultPublicFile: Codable {
    struct FileInfo: Codable {
        let name: String
        let mimeType: String?
        let size: Int?
    }
    struct Person: Codable, Hashable { let name: String }
    struct FolderInfo: Codable, Hashable { let id: String; let name: String }
    let slug: String
    let requireAuth: Bool
    let allowDownload: Bool
    let file: FileInfo
    let previewUrl: String
    let downloadUrl: String?
    // Since 9 Oct 2026 — all optional.
    /// "FILE" or "FOLDER"; nil (a file) from older servers.
    let kind: String?
    let expiresAt: String?
    let sharedBy: Person?
    let previewKind: String?
    let thumbUrl: String?
    let item: VaultPublicItem?
    let folder: FolderInfo?
    let zipUrl: String?

    var isFolder: Bool { kind == "FOLDER" }
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


/// Hasil pembuatan mailbox Google Workspace.
///
/// `temporaryPassword` hanya ada DI SINI, sekali. Server tidak menyimpannya dan tidak bisa
/// menampilkannya lagi — layar yang menutup panel ini membuangnya untuk selamanya.
struct CreatedGoogleAccount: Codable, Sendable {
    let created: Bool
    let linked: Bool
    let account: Account
    /// Sandi TIDAK ikut notifikasi dalam aplikasi; ia hanya lewat email pribadi.
    let notified: Notified?
    let error: String?

    struct Account: Codable, Sendable { let email: String; let fullName: String; let temporaryPassword: String }
    struct Notified: Codable, Sendable { let inApp: Bool; let email: Bool; let emailTo: String? }
}

extension VaultItem {
    /// A file or folder seen through a share link, in the shape the vault's own tiles and viewer
    /// take. Its addresses are the LINK's (slug + item id), not the member routes', and it can do
    /// nothing a member can: no renaming, no moving, no links of its own.
    static func fromLink(_ p: VaultPublicItem) -> VaultItem {
        VaultItem(id: p.id, kind: p.kind, name: p.name, mimeType: p.mimeType, size: p.size, width: p.width,
                  height: p.height, parentId: nil, url: p.previewUrl, downloadUrl: p.downloadUrl, uploader: nil,
                  owner: nil, childCount: p.childCount ?? 0, shareCount: 0, minReadRole: nil, minWriteRole: nil,
                  trashed: false, createdAt: nil, canModify: false, thumbUrl: p.thumbUrl,
                  fileVersion: p.fileVersion, path: nil)
    }
}
