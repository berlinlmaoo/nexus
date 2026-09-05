import Foundation
import Observation

/// App-wide auth state. The single source of truth for "are we logged in" + the current user.
@MainActor
@Observable
final class AuthStore {
    var session: Session?
    var isLoggingIn = false
    var loginError: String?

    var isAuthenticated: Bool { session != nil }

    init() {
        // Restore a persisted session on cold start.
        session = Keychain.load()
    }

    func login(email: String, password: String) async {
        isLoggingIn = true
        loginError = nil
        defer { isLoggingIn = false }
        do {
            let res = try await APIClient.shared.login(email: email, password: password)
            let s = Session(
                token: res.token,
                cookieName: res.cookieName,
                userId: res.user.id,
                userName: res.user.name ?? "",
                userEmail: res.user.email ?? email
            )
            Keychain.save(s)
            session = s
        } catch {
            loginError = (error as? LocalizedError)?.errorDescription ?? T("Login failed. Check your email/password.")
        }
    }

    func logout() {
        if let session {
            Task { await NotificationManager.shared.unregister(session: session) }
        }
        Keychain.clear()
        // A cached roster or task list must not outlive the session that fetched it.
        ResponseCache.clearAll()
        session = nil
    }
}
