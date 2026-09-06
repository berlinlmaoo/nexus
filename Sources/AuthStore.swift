import Foundation
import Observation

/// App-wide auth state. The single source of truth for "are we logged in" + the current user.
@MainActor
@Observable
final class AuthStore {
    var session: Session?
    var isLoggingIn = false
    /// Kept separate from `isLoggingIn` so the two buttons on the login screen can each show their
    /// own spinner, while `isBusy` still disables both.
    var isPasskeyLoggingIn = false
    var loginError: String?

    var isAuthenticated: Bool { session != nil }
    var isBusy: Bool { isLoggingIn || isPasskeyLoggingIn }

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
            persist(res, fallbackEmail: email)
        } catch {
            loginError = (error as? LocalizedError)?.errorDescription ?? T("Login failed. Check your email/password.")
        }
    }

    /// Passkey sign-in. An ADDITION to the password path above, not a replacement — the server
    /// answers /api/auth/passkey/login/verify with the identical payload as /api/auth/app-login,
    /// so this shares `persist` rather than storing the session a second way.
    func loginWithPasskey() async {
        isPasskeyLoggingIn = true
        loginError = nil
        defer { isPasskeyLoggingIn = false }
        do {
            let res = try await PasskeyManager.signIn()
            // A passkey login carries no typed email to fall back on; the server's user object does.
            persist(res, fallbackEmail: "")
        } catch PasskeyError.canceled {
            // Closing the Face ID sheet is a decision, not a failure. Leave the screen untouched —
            // painting a red error box because somebody changed their mind is just wrong.
        } catch {
            loginError = (error as? LocalizedError)?.errorDescription
                ?? T("Passkey sign-in failed. Use your password instead.")
        }
    }

    /// The ONE place a successful login becomes a stored session. Both entry points land here so
    /// the Keychain write can never drift between them.
    private func persist(_ res: LoginResponse, fallbackEmail: String) {
        let s = Session(
            token: res.token,
            cookieName: res.cookieName,
            userId: res.user.id,
            userName: res.user.name ?? "",
            userEmail: res.user.email ?? fallbackEmail
        )
        Keychain.save(s)
        session = s
    }

    func logout() {
        if let session {
            Task { await NotificationManager.shared.unregister(session: session) }
        }
        Keychain.clear()
        // A cached roster or task list must not outlive the session that fetched it.
        ResponseCache.clearAll()
        // Nor may a Live Activity: it would keep counting one person's hours on the Lock Screen of
        // a phone that has already been handed to somebody else.
        AttendancePresence.stop()
        session = nil
    }
}
