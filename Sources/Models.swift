import Foundation

/// Response from POST /api/auth/app-login.
struct LoginResponse: Decodable, Sendable {
    let ok: Bool
    let token: String
    let cookieName: String
    let user: AppUser
}

struct AppUser: Decodable, Sendable {
    let id: String
    let name: String?
    let email: String?
    let avatar: String?
}

/// One project from GET /api/projects (NexusProject). Lenient: only the fields the list needs,
/// all optional, so backend additions never break decoding.
struct Project: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let color: String?
    let icon: String?
    let status: String?
    let count: Counts?

    struct Counts: Decodable, Sendable {
        let tasks: Int?
        let members: Int?
    }

    enum CodingKeys: String, CodingKey {
        case id, name, color, icon, status
        case count = "_count"
    }

    var taskCount: Int { count?.tasks ?? 0 }
    var memberCount: Int { count?.members ?? 0 }

    /// The icon is either an emoji, a named icon, or an uploaded path ("/api/files/..."). For the
    /// list we show the emoji directly; uploaded photos are wired in a later pass.
    var isUploadedIcon: Bool { (icon ?? "").hasPrefix("/") }
    var emoji: String {
        guard let icon, !icon.isEmpty, !isUploadedIcon else { return "📁" }
        return icon
    }
}
