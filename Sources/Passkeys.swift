import AuthenticationServices
import Foundation
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Passkeys (WebAuthn) — an ADDITION to the password login, never a replacement.
//
// The server owns the whole ceremony: it mints a challenge, verifies the signature, and issues the
// very same session payload as /api/auth/app-login. This file is only two things: the bridge from
// AuthenticationServices' delegate-based API into async/await, and the base64url encoding WebAuthn
// insists on at every boundary.
//
// Prerequisites that live outside this file and are easy to forget:
//   • both entitlement files carry `webcredentials:nexus.znetworks.id`
//   • https://nexus.znetworks.id/.well-known/apple-app-site-association lists
//     "5YR5T42G97.id.znetworks.nexus" under "webcredentials"
// Either one missing and every request fails with a generic, unhelpful error.
// ─────────────────────────────────────────────────────────────────────────────

/// base64url (RFC 4648 §5) ⇄ Data.
///
/// WebAuthn speaks base64url everywhere; Foundation only speaks standard base64. Worse,
/// `Data(base64Encoded:)` returns nil rather than throwing when it meets the `-`/`_` alphabet or a
/// missing `=`, so skipping this step does not look like an encoding bug — it looks like the server
/// sent an empty challenge.
enum Base64URL {
    static func decode(_ string: String) -> Data? {
        var s = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // base64url strips the padding; Foundation wants it back.
        let overhang = s.count % 4
        if overhang > 0 { s += String(repeating: "=", count: 4 - overhang) }
        return Data(base64Encoded: s)
    }

    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum PasskeyError: LocalizedError {
    /// The person dismissed Face ID or the passkey sheet. A normal outcome, NOT a failure — every
    /// caller catches this one first and stays quiet about it.
    case canceled
    /// The ceremony finished but handed back something that is not a platform passkey.
    case noCredential
    /// The server's options were missing `challenge` / `user.id`, or they were not valid base64url.
    case badServerOptions
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .canceled: return T("Passkey sign-in cancelled.")
        case .noCredential: return T("No passkey was returned. Try again.")
        case .badServerOptions: return T("The server sent passkey options this app couldn't read.")
        case .failed(let msg): return msg
        }
    }
}

// MARK: - Server option payloads

/// The subset of POST /api/auth/passkey/register/options this app actually needs.
///
/// The rest of the payload (rp, pubKeyCredParams, authenticatorSelection, excludeCredentials…) is
/// chosen by the server and re-checked by the server; ASAuthorization builds its own equivalents
/// from the platform provider, so decoding those fields here would only add ways to fail.
struct PasskeyRegistrationOptions: Decodable, Sendable {
    struct User: Decodable, Sendable {
        /// base64url — NOT a plain string. Decode before handing it to `userID:`.
        let id: String
        let name: String?
        let displayName: String?
    }
    /// base64url.
    let challenge: String
    let user: User
}

/// POST /api/auth/passkey/login/options. The server deliberately sends no `allowCredentials`, so
/// this is a discoverable-credential flow: iOS offers whichever passkey for the domain it can find
/// on the device or in the iCloud Keychain, and no email has to be typed first.
struct PasskeyAssertionOptions: Decodable, Sendable {
    /// base64url.
    let challenge: String
}

/// One row of GET /api/auth/passkey — a credential already enrolled on this account.
///
/// Everything but `id` is optional on purpose. `label` and `lastUsedAt` are genuinely nullable in
/// the API, and `createdAt` is modelled the same way so one odd row can never fail the decode of
/// the whole list and leave the card looking empty.
struct PasskeyInfo: Decodable, Sendable, Identifiable {
    let id: String
    /// Whatever the enrolling device called itself. Null for passkeys made before labels existed.
    let label: String?
    /// ISO-8601.
    let createdAt: String?
    /// ISO-8601, or null when this passkey has never signed anyone in.
    let lastUsedAt: String?
}

/// GET /api/auth/passkey wraps the array in an object rather than answering a bare array.
struct PasskeyListResponse: Decodable, Sendable {
    let passkeys: [PasskeyInfo]
}

// MARK: - Delegate → async/await bridge

/// Runs exactly one ASAuthorizationController round-trip as an awaitable call.
///
/// Two details make this fiddlier than it looks. The controller holds only WEAK references to its
/// delegate and its presentation-context provider, and nothing else retains the controller while
/// the system sheet is up. So the runner keeps the controller alive AND keeps a strong reference to
/// itself until exactly one of the two delegate callbacks fires; without that the whole thing is
/// deallocated mid-flight and the continuation is never resumed — a task suspended forever.
private final class PasskeyRequestRunner: NSObject,
                                          ASAuthorizationControllerDelegate,
                                          ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<ASAuthorization, Error>?
    private var controller: ASAuthorizationController?
    private var selfRetain: PasskeyRequestRunner?

    /// Main-actor bound on purpose. A `nonisolated` async function runs on the generic executor
    /// even when called from the main actor, and `performRequests()` presents UI.
    @MainActor
    func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { cont in
            self.continuation = cont
            self.selfRetain = self
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    /// Resumes at most once. A second `resume` on the same continuation traps, and AuthenticationServices
    /// is not contractually bound to call only one of the two callbacks.
    private func finish(_ result: Result<ASAuthorization, Error>) {
        guard let cont = continuation else { return }
        continuation = nil
        controller = nil
        // Dropping the self-reference is what deallocates the runner, so hold it on the stack until
        // this method has genuinely finished running.
        let keepAlive = self
        selfRetain = nil
        cont.resume(with: result)
        withExtendedLifetime(keepAlive) {}
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        finish(.success(authorization))
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithError error: Error) {
        finish(.failure(Self.mapped(error)))
    }

    /// Closing the Face ID sheet is a decision, not a fault — it becomes `.canceled` so callers can
    /// tell it apart from an actual failure and show nothing at all.
    private static func mapped(_ error: Error) -> Error {
        if let asError = error as? ASAuthorizationError, asError.code == .canceled {
            return PasskeyError.canceled
        }
        return PasskeyError.failed(error.localizedDescription)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
            ?? ASPresentationAnchor()
    }
}

// MARK: - The two ceremonies

enum PasskeyManager {
    /// Must match `webcredentials:` in NEXUS.entitlements / NEXUS-Catalyst.entitlements and the
    /// host in `Config.baseURL`. Hardcoded rather than derived from the URL because the entitlement
    /// is hardcoded too, and the two drifting apart is the failure worth making obvious.
    static let relyingPartyID = "nexus.znetworks.id"

    /// Enrol a new passkey for the account that is already signed in.
    /// `label` is what the person will see next to this device in the web app's passkey list.
    @MainActor
    static func register(label: String) async throws {
        let options = try await APIClient.shared.passkeyRegisterOptions()
        guard let challenge = Base64URL.decode(options.challenge),
              let userID = Base64URL.decode(options.user.id)
        else { throw PasskeyError.badServerOptions }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyID)
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            // Shown inside the system passkey sheet and in Settings › Passwords. Not UI copy of
            // ours, so deliberately not run through T().
            name: options.user.name ?? options.user.displayName ?? "NEXUS",
            userID: userID
        )

        let runner = PasskeyRequestRunner()
        let authorization = try await runner.perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration
        else { throw PasskeyError.noCredential }

        // AuthenticationServices spells these Data in some SDK generations and Data! in others.
        // Binding through an explicit `Data?` compiles either way AND cannot trap on a nil that an
        // implicitly-unwrapped property would force through silently.
        let clientData: Data? = credential.rawClientDataJSON
        let credentialID: Data? = credential.credentialID
        let attestation: Data? = credential.rawAttestationObject
        guard let clientData, let credentialID else { throw PasskeyError.noCredential }

        var response: [String: Any] = [
            "clientDataJSON": Base64URL.encode(clientData)
        ]
        // Genuinely optional in the API. Omit the key entirely rather than sending null: the
        // server's verifier distinguishes "absent" from "present but unreadable".
        if let attestation {
            response["attestationObject"] = Base64URL.encode(attestation)
        }
        let id = Base64URL.encode(credentialID)
        let payload: [String: Any] = [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": [String: Any](),
            "response": response,
        ]

        // The challenge goes back as the exact STRING the server issued, not a re-encoding of the
        // bytes we decoded from it: the server looks its stored challenge up verbatim.
        try await APIClient.shared.passkeyRegisterVerify(credential: payload,
                                                         challenge: options.challenge,
                                                         label: label)
    }

    /// Sign in with a passkey. No email needed — see `PasskeyAssertionOptions`.
    /// Returns the identical payload as a password login, so the caller stores it the same way.
    @MainActor
    static func signIn() async throws -> LoginResponse {
        let options = try await APIClient.shared.passkeyLoginOptions()
        guard let challenge = Base64URL.decode(options.challenge) else { throw PasskeyError.badServerOptions }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingPartyID)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)

        let runner = PasskeyRequestRunner()
        let authorization = try await runner.perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion
        else { throw PasskeyError.noCredential }

        // See the note in `register` — explicit `Data?` bindings survive both SDK spellings.
        let clientData: Data? = credential.rawClientDataJSON
        let authenticatorData: Data? = credential.rawAuthenticatorData
        let signature: Data? = credential.signature
        let userHandle: Data? = credential.userID
        let credentialID: Data? = credential.credentialID
        guard let clientData, let authenticatorData, let signature, let credentialID
        else { throw PasskeyError.noCredential }

        var response: [String: Any] = [
            "clientDataJSON": Base64URL.encode(clientData),
            "authenticatorData": Base64URL.encode(authenticatorData),
            "signature": Base64URL.encode(signature),
        ]
        // How the server knows WHICH account signed in, since no email was typed. Always present
        // for a discoverable credential, but guard anyway rather than posting an empty string.
        if let userHandle, !userHandle.isEmpty {
            response["userHandle"] = Base64URL.encode(userHandle)
        }
        let id = Base64URL.encode(credentialID)
        let payload: [String: Any] = [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": [String: Any](),
            "response": response,
        ]

        return try await APIClient.shared.passkeyLoginVerify(credential: payload, challenge: options.challenge)
    }
}
