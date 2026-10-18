import Foundation
import Security

/// The logged-in session: the NextAuth JWT (issued by /api/auth/app-login) + the cookie name to
/// send it under, plus the cached user. Persisted in the iOS Keychain so it survives app restarts.
/// Minimal Keychain wrapper for the single session blob. Thread-safe (Security framework).
enum Keychain {
    /// The UI screenshot tour keeps its QA session apart from the person's own (TourMode).
    private static let account = TourMode.isActive ? "nexus.session.tour" : "nexus.session"
    private static let service = "id.znetworks.nexus"
    /// A session saved by an earlier build (backup-able class) was moved to ThisDeviceOnly.
    private static let migratedKey = "nexus.keychain.this-device-only"

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
        // ThisDeviceOnly (security audit, 29 Sep 2026): the session never travels in an iCloud/Finder
        // backup or to a new phone, where anyone restoring it would be signed in as this person.
        // AfterFirstUnlock still, because background refresh and the work-hours trail run while locked.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
        UserDefaults.standard.set(true, forKey: migratedKey)
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
        if !UserDefaults.standard.bool(forKey: migratedKey) {
            // Once: the item an earlier build saved keeps its old class until it is told otherwise.
            let match: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ]
            let change: [String: Any] = [kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
            if SecItemUpdate(match as CFDictionary, change as CFDictionary) == errSecSuccess {
                UserDefaults.standard.set(true, forKey: migratedKey)
            }
        }
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
