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
    private(set) var identityReady = false
    private var refreshingIdentity = false
    var readySession: Session? { identityReady ? session : nil }

    var isAuthenticated: Bool { session != nil }
    var isBusy: Bool { isLoggingIn || isPasskeyLoggingIn }

    init() {
        // Restore a persisted session on cold start.
        session = Keychain.load()
        identityReady = session == nil
    }

    /// A valid token can outlive an ID migration. Never derive ownership from its cached user ID.
    func refreshIdentity() async {
        guard let before = session else { identityReady = true; return }
        guard !refreshingIdentity else { return }
        refreshingIdentity = true
        defer { refreshingIdentity = false; identityReady = true }
        do {
            let user = try await APIClient.shared.profile(fresh: true).user
            guard let current = session, current.token == before.token, current.cookieName == before.cookieName,
                  let next = current.refreshedIdentity(id: user.id, name: user.name, email: user.email) else { return }
            Keychain.save(next)
            if current.userId != next.userId {
                AttendanceQueue.shared.rebindIdentity(from: current.userId, to: next.userId)
                ResponseCache.clearAll()
                OfflineSync.shared.reset()
                Viewer.shared.reset()
                RealtimeClient.shared.reset()
                GideonChat.shared.refreshIdentity()
                CalendarWidgetPresence.stop()
            }
            PhoneSessionBridge.shared.publish(next)
            session = next
            if TourMode.isActive && TourState.shared.identity == "not-checked" {
                TourState.shared.identity = "restored=\(before.userId);current=\(next.userId);sameCredentials=\(before.token == next.token && before.cookieName == next.cookieName)"
            }
        } catch APIError.unauthorized {
            if session?.token == before.token { logout() }
        } catch {
            // Offline: keep the valid session and retry on the next foreground. No invented ID.
        }
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
        // A check-in queued before the session expired belongs to this person only if it is theirs.
        AttendanceQueue.shared.keepOnly(owner: s.userId)
        // The watch cannot sign in on its own, so it learns about this one here.
        PhoneSessionBridge.shared.publish(s)
        session = s
        identityReady = true
    }

    /// The person changed their sign-in email in Tuning Room. The token stays valid (the server
    /// keys the session on the account id), but the Keychain copy also carries the address, and
    /// the sidebar, form autofill and the watch all read it from there — so it is rewritten here
    /// the same way `persist` writes it, instead of showing the old address until the next login.
    func updateEmail(_ email: String) {
        guard var s = session, !email.isEmpty, s.userEmail != email else { return }
        s.userEmail = email
        Keychain.save(s)
        PhoneSessionBridge.shared.publish(s)
        session = s
    }

    /// The person tapped Logout, or deleted the account: everything goes, queued check-ins too.
    func signOut() {
        // Ends this session on the server too (security audit, 29 Sep 2026): until now a copied token
        // stayed valid for its 30 days after the person signed out. Built before the Keychain is
        // cleared, sent without waiting: signing out never depends on the network.
        if Keychain.load() != nil {
            let req = APIClient.shared.makeRequest("/api/auth/app-logout", method: "POST")
            Task.detached { _ = try? await URLSession.shared.data(for: req) }
        }
        AttendanceQueue.shared.clearAll()
        // Unsent spreadsheet edits belong to this account; the next person must not send them.
        SheetOutbox.shared.clearAll()
        logout()
    }

    /// The Logout buttons: false, and nothing happens, while a workday is running
    /// (`AttendancePresence.workdayOpen`) — the button then explains with `SignOutBlockedAlert`.
    /// A 401 still ends the session through `logout()`; only the person's own tap is held.
    @discardableResult
    func signOutIfAllowed() -> Bool {
        // The block exists so the phone keeps following the workday. A Mac never takes attendance
        // or tracks location, so a person checked in on their phone can still sign out on the Mac.
        #if !targetEnvironment(macCatalyst)
        guard !(RemoteConfig.shared.blockSignOutDuringWorkday && AttendancePresence.workdayOpen) else { return false }
        #endif
        signOut()
        return true
    }

    /// The session ENDED, which is what every 401 handler calls. Same wipe as `signOut` except the
    /// queued check-ins, which are kept for the same person's next sign-in (`holdForSignIn`) and
    /// deleted if somebody else signs in instead (`persist` → `keepOnly`).
    func logout() {
        AttendanceQueue.shared.holdForSignIn(owner: session?.userId)
        if let session {
            Task { await NotificationManager.shared.unregister(session: session) }
        }
        Keychain.clear()
        // A cached roster or task list must not outlive the session that fetched it.
        ResponseCache.clearAll()
        // Unsent chat / comment / page drafts belong to the person signing out.
        LocalDrafts.clearAll()
        // Including the files downloaded for offline use: those are somebody's project documents
        // and attendance selfies, and they are the last thing that should survive a handover.
        OfflineSync.shared.reset()
        // Nor may a Live Activity: it would keep counting one person's hours on the Lock Screen of
        // a phone that has already been handed to somebody else.
        Viewer.shared.reset()
        // Nor the realtime connection: it is authenticated as this person, and the next one to sign in
        // must not hear a single event meant for them. NexusApp would close it on the next render too;
        // this closes it now.
        RealtimeClient.shared.reset()
        // Nor a conversation. GIDEON's transcript outlives the panel that draws it, so without this
        // the next person to sign in on the same phone opens it onto somebody else's questions —
        // and onto the file they attached to one.
        GideonChat.shared.reset()
        // Nor an upload queue: every request reads the session afresh, so a file still queued would
        // go up under whoever signs in next. Cancelled, and the copies made for it deleted.
        VaultUploads.shared.reset()
        // A queued check-in is NOT cleared here: see `signOut` / `holdForSignIn` / `keepOnly`.
        AttendancePresence.stop()
        // Location stops with the session, and whatever was not uploaded goes with it: the next
        // person to sign in must not send the last one's positions under their own cookie.
        WorkLocationTracker.shared.stopForLogout()
        PhoneSessionBridge.shared.publish(nil)
        session = nil
    }
}
