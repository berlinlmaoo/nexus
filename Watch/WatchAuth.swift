import Foundation
import WatchConnectivity

/// The signed-in session, as the watch sees it.
///
/// There is no login screen here, and there will not be one. A passkey cannot be moved between
/// devices, and typing a password on a watch is not a thing anybody would do twice. The phone is
/// already signed in, so the phone hands the session over and the watch stores it in its own
/// Keychain — a separate Keychain on a separate device, which is why `Keychain` can be reused
/// verbatim without the two ever colliding.
@Observable
@MainActor
final class WatchAuth {
    static let shared = WatchAuth()

    private(set) var session: Session?
    /// True until the phone has been heard from at least once, so a fresh install can say "open
    /// NEXUS on your iPhone" instead of the blunter "not signed in".
    private(set) var everHeardFromPhone = false

    private init() {
        session = Keychain.load()
        everHeardFromPhone = session != nil
    }

    func apply(_ incoming: Session?) {
        everHeardFromPhone = true
        guard let incoming else {
            // The phone logged out. Anything cached here belonged to that session — the face too.
            Keychain.clear()
            session = nil
            WatchPresence.clear()
            return
        }
        Keychain.save(incoming)
        session = incoming
    }
}

/// Receives the session from the phone.
///
/// Application context rather than messages: the watch only ever needs the LATEST session, and a
/// queued backlog would just replay tokens that are already dead. WatchConnectivity keeps exactly
/// one context and delivers it whenever the watch next wakes, including after a reboot.
final class WatchConnectivityBridge: NSObject, WCSessionDelegate {
    static let shared = WatchConnectivityBridge()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        // Whatever the phone last published is waiting in the context; take it immediately rather
        // than waiting for the phone to change something.
        let context = session.receivedApplicationContext
        guard !context.isEmpty else { return }
        handle(context)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        handle(applicationContext)
    }

    private func handle(_ context: [String: Any]) {
        // The phone's language rides in the same context as the session. A phone build from before
        // it was sent has no "lang": keep whatever is stored. Written on the main actor so the
        // defaults-changed notification the Calendar tab listens for arrives on the main thread.
        if let lang = context["lang"] as? String, lang == "en" || lang == "id" {
            Task { @MainActor in UserDefaults.standard.set(lang, forKey: WatchLang.key) }
        }
        guard let data = context["session"] as? Data else { return }
        // Empty means "signed out" — an explicit value, so a logout is distinguishable from the
        // phone simply not having said anything yet.
        let decoded = data.isEmpty ? nil : try? JSONDecoder().decode(Session.self, from: data)
        Task { @MainActor in WatchAuth.shared.apply(decoded) }
    }
}
