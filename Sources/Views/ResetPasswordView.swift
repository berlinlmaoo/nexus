import SwiftUI

/// Native port of the web's /forgot-password (apps/nexus-lovable-ui/src/routes/forgot-password.tsx):
/// email, then the 6-digit code from the email together with the new password, then straight into
/// the app with it.
///
/// Also the landing screen for the invite email's "set your password" link
/// (`/forgot-password?email=…&invited=1`): an invited member has an account but has never had a
/// password of their own, and the reset flow is exactly how they get one — only the title changes.
///
/// Drawn by LoginView in place of its sign-in card, like SignUpView, and built from the same
/// pieces (AuthFormPieces.swift). It owns no background.
struct ResetPasswordView: View {
    @Environment(AuthStore.self) private var auth

    /// true when opened from an invite link: "Set your password" rather than "Reset password".
    let invited: Bool
    /// Back to sign-in, carrying the address so the login card can be prefilled with it.
    let onClose: (String?) -> Void

    private enum Step { case email, code }
    private enum Field { case email, otp, password, confirm }

    @State private var step: Step = .email
    @State private var email: String
    @State private var otp = ""
    @State private var password = ""
    @State private var confirm = ""
    /// The address as the server canonicalised it (trimmed, lowercased). /verify, /resend and the
    /// sign-in afterwards use this rather than the field — the OTP row is keyed on it.
    @State private var sentTo = ""
    /// When the server will send another code for this address. One clock for Send code and
    /// Resend, because both endpoints check the same `resendAvailableAt`.
    @State private var cooldownUntil: Date?
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?
    @FocusState private var focus: Field?

    init(email: String, invited: Bool, onClose: @escaping (String?) -> Void) {
        self.invited = invited
        self.onClose = onClose
        _email = State(initialValue: email)
    }

    var body: some View {
        AuthScrollContainer { card }
    }

    private var card: some View {
        VStack(spacing: 0) {
            Image("NexusLogo")
                .resizable().scaledToFit()
                .frame(width: 56, height: 56)
                .shadow(color: NX.violet.opacity(0.3), radius: 14, y: 8)
                .padding(.bottom, 18)

            Text((invited ? T("Set your password") : T("Reset password")).uppercased())
                .font(NXFont.display(20, .bold))
                .tracking(3)
                .foregroundStyle(NX.onyx)
                .multilineTextAlignment(.center)
            Text(step == .email
                 ? T("Enter your email and we'll send you a verification code.")
                 : String(format: T("Enter the code we sent to %@, plus a new password."), sentTo))
                .font(NXFont.text(13))
                .foregroundStyle(NX.mutedFg)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
                .padding(.bottom, 26)

            switch step {
            case .email: emailStep
            case .code:  codeStep
            }

            Button { onClose(nil) } label: {
                HStack(spacing: 5) {
                    Text(T("Remember it after all?")).foregroundStyle(NX.mutedFg)
                    Text(T("Sign in")).font(NXFont.text(14, .bold)).foregroundStyle(NX.onyx)
                }
                .font(NXFont.text(14))
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .padding(.top, 24)
        }
        .modifier(AuthCard())
    }

    // MARK: step 1

    private var emailStep: some View {
        VStack(spacing: 16) {
            AuthForm.fieldBlock(label: T("EMAIL")) {
                inputField("you@email.com", text: $email, field: .email)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit(requestCode)
            }

            if let error { AuthForm.errorBox(error) }

            CooldownCTA(idle: T("Send code"), busyLabel: T("Sending code…"), busy: busy,
                        cooldownUntil: cooldownUntil, action: requestCode)
                .padding(.top, 8)
        }
    }

    // MARK: step 2

    private var codeStep: some View {
        VStack(spacing: 16) {
            if let info { AuthForm.infoBox(info) }

            AuthForm.fieldBlock(label: T("VERIFICATION CODE")) {
                OneTimeCodeField(code: $otp, focused: focus == .otp)
                    .focused($focus, equals: .otp)
                    .disabled(busy)
            }
            AuthForm.fieldBlock(label: T("NEW PASSWORD")) {
                // `.newPassword` so iOS offers a strong password and saves it against this email —
                // the same pair the sign-in right after uses.
                inputField(T("Min. 8 characters"), text: $password, field: .password, secure: true)
                    .textContentType(.newPassword)
                    .submitLabel(.next)
                    .onSubmit { focus = .confirm }
            }
            AuthForm.fieldBlock(label: T("REPEAT NEW PASSWORD")) {
                inputField("••••••••", text: $confirm, field: .confirm, secure: true)
                    .textContentType(.newPassword)
                    .submitLabel(.go)
                    .onSubmit(submitReset)
            }

            if let error { AuthForm.errorBox(error) }

            Button(action: submitReset) {
                HStack(spacing: 8) {
                    if busy {
                        ProgressView().tint(.white)
                        Text(T("Saving…"))
                    } else {
                        Text(invited ? T("Set password & sign in") : T("Reset & sign in"))
                        Image(systemName: "arrow.right").font(.system(size: 14, weight: .bold))
                    }
                }
                .modifier(OnyxCTA())
            }
            .buttonStyle(.plain)
            .disabled(busy || otp.count != 6)
            .opacity(busy || otp.count != 6 ? 0.6 : 1)
            .padding(.top, 8)

            HStack {
                Button {
                    error = nil; info = nil; otp = ""
                    step = .email
                } label: {
                    Label(T("Change email"), systemImage: "arrow.left")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                }
                .buttonStyle(.plain)
                .disabled(busy)
                Spacer()
                ResendCodeButton(busy: busy, cooldownUntil: cooldownUntil, action: resend)
            }
            .padding(.top, 4)
        }
    }

    // MARK: pieces

    /// SignUpView's field, on the shared chrome.
    @ViewBuilder
    private func inputField(_ placeholder: String, text: Binding<String>, field: Field,
                            secure: Bool = false) -> some View {
        Group {
            if secure {
                SecureField("", text: text, prompt: Text(placeholder).foregroundColor(NX.mutedFg))
            } else {
                TextField("", text: text, prompt: Text(placeholder).foregroundColor(NX.mutedFg))
            }
        }
        .font(NXFont.text(16))
        .foregroundStyle(NX.foreground)
        .focused($focus, equals: field)
        .disabled(busy)
        .modifier(AuthFieldChrome(focused: focus == field))
    }

    // MARK: actions

    private func requestCode() {
        focus = nil
        error = nil
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        // Same plausibility check as the web page and SignUpView; the server's zod `.email()` stays
        // the judge, this only names the obvious typo before a round trip.
        guard e.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil else {
            error = T("That email address doesn't look right.")
            return
        }
        Task {
            busy = true
            defer { busy = false }
            do {
                let res = try await APIClient.shared.passwordResetRequest(email: e)
                sentTo = res.email ?? e
                cooldownUntil = Date().addingTimeInterval(TimeInterval(res.resendCooldownSeconds ?? 60))
                // "If", because the server answers the same for an address with no account — it
                // will not say which addresses are registered.
                info = String(format: T("If %@ has a NEXUS account, a 6-digit code is on its way. It expires in %d minutes — check your spam folder too."),
                              sentTo, max(1, (res.expiresInSeconds ?? 600) / 60))
                otp = ""
                step = .code
                focus = .otp
            } catch let wait as SignupRetryLater {
                error = wait.message
                if let s = wait.seconds, s > 0 { cooldownUntil = Date().addingTimeInterval(TimeInterval(s)) }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the code. Try again.")
            }
        }
    }

    /// Mirrors `verifyPasswordResetSchema` (src/lib/validations.ts): code `^\d{6}$`, password
    /// 8–128. Length in UTF-16 units because that is what zod's `.min`/`.max` count. The match
    /// check is the web page's own; the server never sees the second field.
    private func localProblem() -> String? {
        if otp.count != 6 { return T("Enter the 6-digit code from your email.") }
        if password.utf16.count < 8 { return T("Password must be at least 8 characters.") }
        if password.utf16.count > 128 { return T("Password can be 128 characters at most.") }
        if password != confirm { return T("Those passwords don't match.") }
        return nil
    }

    private func submitReset() {
        focus = nil
        error = nil
        if let problem = localProblem() { error = problem; return }
        Task {
            busy = true
            defer { busy = false }
            do {
                try await APIClient.shared.passwordResetVerify(email: sentTo, code: otp, password: password)
            } catch let wait as SignupRetryLater {
                // "Verification attempts exceeded" comes as a 429 with no wait named: the code is
                // dead and only Resend helps, so there is no countdown to start here.
                error = wait.message
                return
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Wrong or expired code.")
                return
            }
            // The password is changed from here on and the code consumed, so there is no staying
            // on this screen. Sign in with the pair just set through the app's one login path
            // (it stores the session and RootView swaps to the app on its own) — the same finish
            // as sign-up.
            await auth.login(email: sentTo, password: password)
            if !auth.isAuthenticated {
                auth.loginError = T("Your password is updated. Sign in with your new password.")
                onClose(sentTo)
            }
        }
    }

    private func resend() {
        error = nil
        info = nil
        Task {
            busy = true
            defer { busy = false }
            do {
                let res = try await APIClient.shared.passwordResetResend(email: sentTo)
                cooldownUntil = Date().addingTimeInterval(TimeInterval(res.resendCooldownSeconds ?? 60))
                otp = ""
                info = T("A new code is on its way to your email.")
            } catch let wait as SignupRetryLater {
                error = wait.message
                if let s = wait.seconds, s > 0 { cooldownUntil = Date().addingTimeInterval(TimeInterval(s)) }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't resend the code.")
            }
        }
    }
}
