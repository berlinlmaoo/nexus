import Foundation
import WatchConnectivity
import WidgetKit

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
        let previous = session
        Keychain.save(incoming)
        session = incoming
        // Another account on the phone without a sign-out ever reaching the watch: the previous
        // person's day and tasks leave the face before anything of the new one arrives.
        if let previous, previous.userId != incoming.userId {
            WatchPresence.clear()
        }
        // Just signed in (or switched): fill the calendar complications now rather than the next time
        // the app comes to the front. The phone re-sends the same session often; only a change fetches.
        if previous?.userId != incoming.userId {
            Task { await WatchCalendarGlance.refresh(force: true) }
        }
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
            Task { @MainActor in
                UserDefaults.standard.set(lang, forKey: WatchLang.key)
                // The calendar complications read the language from the shared container; mirror it
                // there so the face redraws in the new language without waiting for a fetch.
                WatchCalendarGlance.mirrorLanguage()
            }
        }
        // The calendar widgets' switch from the phone's remote config. Off → the complications empty
        // now and fetch nothing until it is back on. Absent (an older phone build) = on.
        let widgetsOn = context["calendarWidgets"] as? Bool ?? true
        Task { @MainActor in
            let was = UserDefaults.standard.object(forKey: WatchCalendarGlance.widgetsOnKey) as? Bool ?? true
            UserDefaults.standard.set(widgetsOn, forKey: WatchCalendarGlance.widgetsOnKey)
            if was && !widgetsOn {
                WatchCalendarGlance.forget()
                WidgetCenter.shared.reloadAllTimelines()
            } else if !was && widgetsOn {
                await WatchCalendarGlance.refresh(force: true)
            }
        }
        guard let data = context["session"] as? Data else { return }
        // Empty means "signed out" — an explicit value, so a logout is distinguishable from the
        // phone simply not having said anything yet.
        let decoded = data.isEmpty ? nil : try? JSONDecoder().decode(Session.self, from: data)
        Task { @MainActor in WatchAuth.shared.apply(decoded) }
    }
}
