import Foundation
import WatchConnectivity

/// Hands the signed-in session to the Apple Watch.
///
/// The watch has no login of its own: a passkey cannot be moved between devices, and nobody types a
/// password on a watch twice. So the phone — which has already done the hard part — publishes what
/// it holds, and the watch stores it in its own Keychain.
final class PhoneSessionBridge: NSObject, WCSessionDelegate {
    static let shared = PhoneSessionBridge()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Application context rather than a message: the watch only ever wants the LATEST session, and
    /// a queued backlog of messages would just replay tokens that are already dead. The context also
    /// survives the watch being out of range or switched off — it is delivered when it next wakes.
    func publish(_ session: Session?) {
        guard WCSession.isSupported() else { return }
        let connectivity = WCSession.default
        guard connectivity.activationState == .activated else { return }

        // Empty data is an explicit "signed out", which a missing key could not express: the watch
        // has to be able to tell a logout apart from the phone simply not having spoken yet.
        let payload = session.flatMap { try? JSONEncoder().encode($0) } ?? Data()
        try? connectivity.updateApplicationContext(["session": payload])
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        guard activationState == .activated else { return }
        // Publish whatever is already in the Keychain, so a watch paired after signing in does not
        // have to wait for the next login to catch up.
        Task { @MainActor in self.publish(Keychain.load()) }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// The user switched to a different watch. Reactivating is what re-establishes the link.
    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
}
