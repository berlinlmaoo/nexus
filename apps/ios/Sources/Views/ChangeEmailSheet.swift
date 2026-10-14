import SwiftUI

// MARK: - API
//
// Mirrors src/app/api/user/email/{request,verify}/route.ts and the web's EmailChangeField in
// apps/web/src/routes/_app/settings.tsx. Kept in this file, as an extension, so the
// change-email flow does not have to thread through APIClient.swift's own request helpers.

/// `POST /api/user/email/request` → `{ ok, resendInSeconds }`.
struct EmailChangeSent: Decodable {
    let ok: Bool?
    let resendInSeconds: Int?
}

/// `POST /api/user/email/verify` → `{ ok, email }`, the address as the server canonicalised it.
struct EmailChangeDone: Decodable {
    let ok: Bool?
    let email: String?
}

/// A 429 that says how long to wait. /request answers its per-address cooldown with
/// `resendInSeconds` in the body and the rate limiter with a `Retry-After` header; either way the
/// button counts that down instead of inviting a tap the server will refuse again.
struct EmailChangeWait: LocalizedError {
    let message: String
    let seconds: Int?
    var errorDescription: String? { message }
}

extension APIClient {
    /// Sends a 6-digit code to the NEW address. Nothing changes on the account until `verify`.
    /// `currentPassword` is required by servers from 29 Sep 2026 (a stolen phone must not be enough
    /// to move the account to another address).
    func requestEmailChange(to email: String, currentPassword: String) async throws -> EmailChangeSent {
        try await postEmailChange("/api/user/email/request", body: ["email": email, "currentPassword": currentPassword],
                                  decode: EmailChangeSent.self)
    }

    /// Commits the change. The server checks the code was requested by THIS account and that the
    /// address is still free, so both refusals come back as its own sentence.
    func verifyEmailChange(email: String, code: String) async throws -> EmailChangeDone {
        try await postEmailChange("/api/user/email/verify", body: ["email": email, "code": code],
                                  decode: EmailChangeDone.self)
    }

    // `Response`, not `T`: a generic parameter named T shadows the T("…") localisation function.
    private func postEmailChange<Response: Decodable>(_ path: String, body: [String: String],
                                                      decode: Response.Type) async throws -> Response {
        var req = makeRequest(path, method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await perform(req)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = Self.serverMessage(data)
            if http.statusCode == 429 {
                let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                let seconds = (obj?["resendInSeconds"] as? NSNumber)?.intValue
                    ?? http.value(forHTTPHeaderField: "Retry-After").flatMap { Int($0) }
                throw EmailChangeWait(message: message ?? T("Too many attempts. Wait a moment and try again."),
                                      seconds: seconds)
            }
            throw APIError.http(http.statusCode, message)
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}

// MARK: - Row

/// The EMAIL field in Tuning Room, tappable. It owns its own `.sheet` rather than adding one to
/// SettingsView: that view already presents Delete account, and two `.sheet`s on one view means
/// one of them never opens. A sheet on this child is a different view, so both work.
struct EmailChangeRow: View {
    @Binding var email: String
    @Environment(AuthStore.self) private var auth
    @State private var changing = false

    var body: some View {
        Button { changing = true } label: {
            HStack(spacing: 8) {
                Text(email.isEmpty ? "—" : email).font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                // Same word the web uses ("Ubah"), and visibly a link so the grey box stops reading
                // as a field nobody can change.
                Text(T("Change")).font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(T("Change the email you sign in with"))
        .sheet(isPresented: $changing) {
            ChangeEmailSheet(current: email) { email = $0 }.environment(auth)
        }
    }
}

// MARK: - Sheet

/// New address → code sent to it → verify. Two steps rather than one form because the address is
/// locked once a code is out: the code only proves ownership of THAT address, and the server
/// refuses it for any other.
struct ChangeEmailSheet: View {
    let current: String
    let onChanged: (String) -> Void

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    private enum Step { case address, code }
    private enum Field { case email, password, code }

    @State private var step: Step = .address
    @State private var newEmail = ""
    @State private var currentPassword = ""
    /// The exact string the code was requested for. /verify must be sent the same address, so it
    /// is frozen here rather than read back from a field somebody could still be editing.
    @State private var sentTo = ""
    @State private var code = ""
    @State private var busy = false
    @State private var problem: String?
    @State private var info: String?
    /// When the server will accept another request. Covers both Send and Resend, because /request
    /// checks the same `resendAvailableAt` for either.
    @State private var cooldownUntil: Date?
    @FocusState private var focus: Field?

    private var trimmed: String { newEmail.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    if step == .address { addressStep } else { codeStep }
                    if let problem {
                        // The server's own sentence, verbatim: it knows why (address taken, code
                        // expired, wrong code), and nothing here does.
                        Text(problem)
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                            .background(NX.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    if let info {
                        Text(info)
                            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Change your email"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Cancel")) { dismiss() }.disabled(busy)
                }
            }
        }
        // Swiping away mid-verify would leave a changed account with a screen still showing the
        // old address.
        .interactiveDismissDisabled(busy)
        .onAppear { focus = .email }
    }

    // MARK: pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                SectionLabel(T("Current email"))
                Text(current.isEmpty ? "—" : current)
                    .font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(1).truncationMode(.middle)
            }
            point("envelope.badge", T("We send a 6-digit code to the NEW address, to prove it's yours. Nothing changes until you enter it."))
            // Checked against the server: the session is keyed on the account id, so this one
            // stays signed in; passkey sign-in finds the account by the passkey, not the address.
            point("person.badge.key", T("From then on you sign in with the new email. Your password and passkeys keep working, and you stay signed in here."))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func point(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NX.violetText).frame(width: 20)
            Text(text).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var addressStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(T("NEW EMAIL"))
                TextField("", text: $newEmail, prompt: Text(verbatim: "name@example.com").foregroundColor(NX.mutedFg.opacity(0.6)))
                    .font(NXFont.text(16))
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
                    .focused($focus, equals: .email)
                    .disabled(busy)
                    .padding(12)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(T("Current password"))
                SecureField("", text: $currentPassword)
                    .font(NXFont.text(16))
                    .textContentType(.password)
                    .submitLabel(.send)
                    .onSubmit { Task { await send() } }
                    .focused($focus, equals: .password)
                    .disabled(busy)
                    .padding(12)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(T("To confirm it's you. Your old email is told about the change."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            cooldownAware { left in
                Button { Task { await send() } } label: {
                    HStack(spacing: 8) {
                        if busy { ProgressView().tint(.white) }
                        Text(busy ? T("Sending code…")
                             : left > 0 ? String(format: T("Try again in %ds"), left)
                             : T("Send code to this address"))
                            .monospacedDigit()
                    }
                }
                .buttonStyle(NexusPrimaryButton())
                .disabled(busy || left > 0 || trimmed.isEmpty || currentPassword.isEmpty)
            }
        }
    }

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(String(format: T("We sent a 6-digit code to %@. Check your spam folder too."), sentTo))
                .font(NXFont.text(14)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 7) {
                SectionLabel(T("VERIFICATION CODE"))
                TextField("", text: $code, prompt: Text(verbatim: "000000").foregroundColor(NX.mutedFg.opacity(0.5)))
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                    .tracking(6)
                    .multilineTextAlignment(.center)
                    .keyboardType(.numberPad)
                    // Lets iOS lift the code straight out of the email in Mail.
                    .textContentType(.oneTimeCode)
                    .focused($focus, equals: .code)
                    .disabled(busy)
                    .padding(12)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onChange(of: code) { _, v in
                        // The server takes exactly six digits; a pasted "123 456" or a seventh
                        // keystroke is trimmed here instead of being refused there.
                        let digits = String(v.filter(\.isNumber).prefix(6))
                        if digits != v { code = digits }
                    }
            }
            Button { Task { await verify() } } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(.white) }
                    Text(busy ? T("Verifying…") : T("Verify & change email"))
                }
            }
            .buttonStyle(NexusPrimaryButton())
            .disabled(busy || code.count != 6)

            HStack {
                Button {
                    problem = nil; info = nil; code = ""
                    step = .address
                    focus = .email
                } label: {
                    Label(T("Use a different email"), systemImage: "arrow.left")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                }
                .buttonStyle(.plain)
                .disabled(busy)
                Spacer()
                cooldownAware { left in
                    Button { Task { await send(resending: true) } } label: {
                        Text(left > 0 ? String(format: T("Resend in %ds"), left) : T("Resend code"))
                            .font(NXFont.text(13, .bold))
                            .foregroundStyle(left > 0 ? NX.mutedFg : NX.violetText)
                            .monospacedDigit()
                    }
                    .buttonStyle(.plain)
                    .disabled(busy || left > 0)
                }
            }
        }
    }

    /// Re-renders once a second only while a cooldown is running, and hands the seconds left down.
    @ViewBuilder
    private func cooldownAware<Content: View>(@ViewBuilder _ content: @escaping (Int) -> Content) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            content(Self.secondsLeft(until: cooldownUntil, at: ctx.date))
        }
    }

    private static func secondsLeft(until: Date?, at now: Date) -> Int {
        guard let until else { return 0 }
        return max(0, Int(until.timeIntervalSince(now).rounded(.up)))
    }

    // MARK: actions

    private func send(resending: Bool = false) async {
        let address = resending ? sentTo : trimmed
        problem = nil; info = nil
        // Same shape the server checks (EMAIL_RE); caught here only so the common typo is named
        // before a round trip. The server stays the judge, including of "that's your current one".
        if address.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
            problem = T("That email address doesn't look right.")
            return
        }
        focus = nil
        busy = true
        defer { busy = false }
        do {
            let res = try await APIClient.shared.requestEmailChange(to: address, currentPassword: currentPassword)
            sentTo = address
            code = ""
            cooldownUntil = Date().addingTimeInterval(TimeInterval(res.resendInSeconds ?? 60))
            if resending { info = T("A new code is on its way to your email.") }
            step = .code
            focus = .code
        } catch let wait as EmailChangeWait {
            problem = wait.message
            if let s = wait.seconds { cooldownUntil = Date().addingTimeInterval(TimeInterval(s)) }
        } catch APIError.unauthorized {
            dismiss()
            auth.logout()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the code.")
        }
    }

    private func verify() async {
        guard code.count == 6 else { return }
        problem = nil; info = nil
        focus = nil
        busy = true
        do {
            let res = try await APIClient.shared.verifyEmailChange(email: sentTo, code: code)
            let changed = res.email ?? sentTo
            // The Keychain session carries the address too (the sidebar, form autofill and the
            // watch read it from there), so it is updated here rather than left showing the old
            // one until the next sign-in. The token itself stays valid: the server keys it on the
            // account id.
            auth.updateEmail(changed)
            onChanged(changed)
            // Refresh the cached profile so an offline Tuning Room does not bring the old address
            // back. Best effort: the change is already committed on the server.
            _ = try? await APIClient.shared.profile()
            Haptics.success()
            busy = false
            dismiss()
        } catch let wait as EmailChangeWait {
            busy = false
            problem = wait.message
        } catch APIError.unauthorized {
            busy = false
            dismiss()
            auth.logout()
        } catch {
            busy = false
            problem = (error as? LocalizedError)?.errorDescription ?? T("Wrong or expired code.")
        }
    }
}
