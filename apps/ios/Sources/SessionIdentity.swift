import Foundation

struct Session: Codable, Sendable, Equatable {
    var token: String
    var cookieName: String
    var userId: String
    var userName: String
    var userEmail: String

    /// The exact header value the backend expects: `<cookieName>=<jwt>`. All 197 API routes'
    /// `auth()` validate this as a normal web session.
    var cookieHeader: String { "\(cookieName)=\(token)" }
    /// IDs are opaque server handles; this accepts both legacy IDs and UUIDs without rewriting them.
    func refreshedIdentity(id: String, name: String?, email: String?) -> Session? {
        guard !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        var next = self
        next.userId = id
        next.userName = name ?? userName
        next.userEmail = email ?? userEmail
        return next
    }
}

