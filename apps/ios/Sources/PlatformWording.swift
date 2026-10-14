import Foundation
import LocalAuthentication

/// Words that depend on the device the app runs on (UI tour run 11, MC-6 / MC-13): a Mac is clicked, not
/// tapped, and it has Touch ID (or nothing) rather than Face ID.
///
/// Each call site passes the WHOLE sentence for every variant, and each variant has its own Indonesian
/// entry: gluing a translated verb into a translated sentence breaks the grammar in one language or the other.
enum PlatformWording {
    /// Mac Catalyst, or the iPhone app running on a Mac.
    static let isMac: Bool = {
        #if targetEnvironment(macCatalyst)
        return true
        #else
        return ProcessInfo.processInfo.isiOSAppOnMac
        #endif
    }()

    enum Biometry { case faceID, touchID, opticID, none }

    /// What this device unlocks a passkey with. Read once: it does not change while the app runs.
    static let biometry: Biometry = {
        let context = LAContext()
        var error: NSError?
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return isMac ? .touchID : .none
        }
    }()

    /// "Tap" on a touch screen, "Click" on a Mac: the English sentence for each, translated whole.
    static func tapOrClick(tap: String, click: String) -> String {
        T(isMac ? click : tap)
    }

    /// The sentence that names this device's biometry. `other` is for a device without Face ID or Touch ID
    /// (the passkey falls back to the device passcode or password).
    static func biometric(faceID: String, touchID: String, other: String) -> String {
        switch biometry {
        case .faceID: return T(faceID)
        case .touchID: return T(touchID)
        case .opticID, .none: return T(other)
        }
    }
}
