import Foundation
import Security

/// The logged-in session: the NextAuth JWT (issued by /api/auth/app-login) + the cookie name to
/// send it under, plus the cached user. Persisted in the iOS Keychain so it survives app restarts.
struct Session: Codable, Sendable {
    var token: String
    var cookieName: String
    var userId: String
    var userName: String
    var userEmail: String

    /// The exact header value the backend expects: `<cookieName>=<jwt>`. All 197 API routes'
    /// `auth()` validate this as a normal web session.
    var cookieHeader: String { "\(cookieName)=\(token)" }
}

/// Minimal Keychain wrapper for the single session blob. Thread-safe (Security framework).
enum Keychain {
    private static let account = "nexus.session"
    private static let service = "id.znetworks.nexus"

    static func save(_ session: Session) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> Session? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let session = try? JSONDecoder().decode(Session.self, from: data)
        else { return nil }
        return session
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
