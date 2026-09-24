import SwiftUI

/// Native port of the web's /register (apps/nexus-lovable-ui/src/routes/register.tsx): details,
/// then the 6-digit code from the email, then straight into the app.
///
/// Drawn by LoginView in place of its sign-in card, on the same cream and glow, so it reuses the
/// frosted card and field look rather than inventing a second one. It owns no background.
struct SignUpView: View {
    @Environment(AuthStore.self) private var auth

    /// Prefill from a `/register?code=…` link, or "".
    let initialCode: String
    /// Back to sign-in. Carries the email when the account now exists but the automatic sign-in
    /// did not go through, so the login card can be prefilled with it.
    let onClose: (String?) -> Void

    private enum Step { case details, code }
    private enum Field { case name, email, password, workspace, otp }

    @State private var step: Step = .details
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var workspaceCode = ""
    @State private var otp = ""
    /// The address as the server canonicalised it. /verify, /resend and the sign-in afterwards all
    /// use this rather than the field, which may have been retyped with different case.
    @State private var sentTo = ""
    @State private var expiresMinutes = 10
    /// When the server will accept another code request for this address. One clock for both
    /// Continue and Resend, because the server checks the same `resendAvailableAt` for both.
    @State private var cooldownUntil: Date?
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?
    @FocusState private var focus: Field?

    init(initialCode: String, onClose: @escaping (String?) -> Void) {
        self.initialCode = initialCode
        self.onClose = onClose
        _workspaceCode = State(initialValue: initialCode)
    }

    var body: some View {
        // Centred while it fits, scrollable once it does not: four fields and a helper line do not
        // fit an SE with the keyboard up. `minHeight` rather than a fixed height, so a card taller
        // than the screen grows the scroll content instead of being clipped.
        GeometryReader { geo in
            ScrollView {
                card
                    .frame(maxWidth: 460)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            Image("NexusLogo")
                .resizable().scaledToFit()
                .frame(width: 56, height: 56)
                .shadow(color: NX.violet.opacity(0.3), radius: 14, y: 8)
                .padding(.bottom, 18)

            Text(T("Create account").uppercased())
                .font(NXFont.display(20, .bold))
                .tracking(3)
                .foregroundStyle(NX.onyx)
            Text(step == .details ? T("Create a new NEXUS account.") : T("Enter the verification code from your email."))
                .font(NXFont.text(13))
                .foregroundStyle(NX.mutedFg)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
                .padding(.bottom, 26)

            switch step {
            case .details: detailsStep
            case .code:    codeStep
            }

            Button { onClose(nil) } label: {
                HStack(spacing: 5) {
                    Text(T("Already have an account?")).foregroundStyle(NX.mutedFg)
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
        .padding(.horizontal, 28)
        .padding(.vertical, 34)
        .frame(maxWidth: .infinity)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 38, style: .continuous))
        .background(Color.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 38, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 38, style: .continuous).strokeBorder(.white.opacity(0.65), lineWidth: 1))
        .shadow(color: .black.opacity(0.10), radius: 40, y: 26)
    }

    // MARK: step 1

    private var detailsStep: some View {
        VStack(spacing: 16) {
            fieldBlock(label: T("FULL NAME")) {
                inputField(T("Your name"), text: $name, field: .name)
                    .textContentType(.name)
                    .submitLabel(.next)
                    .onSubmit { focus = .email }
            }
            fieldBlock(label: T("EMAIL")) {
                inputField("you@email.com", text: $email, field: .email)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
            }
            fieldBlock(label: T("PASSWORD")) {
                // `.newPassword` so iOS offers a strong password and saves it against this email —
                // the same pair the sign-in after verification then uses.
                inputField(T("Min. 8 characters"), text: $password, field: .password, secure: true)
                    .textContentType(.newPassword)
                    .submitLabel(.next)
                    .onSubmit { focus = .workspace }
            }
            fieldBlock(label: T("WORKSPACE CODE (OPTIONAL)")) {
                inputField("e.g. A1B2C3D4E5F6", text: $workspaceCode, field: .workspace, mono: true)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit(submitDetails)
                    // The server uppercases too; doing it as they type keeps what they see equal
                    // to what their company wrote down.
                    .onChange(of: workspaceCode) { _, value in
                        let upper = value.uppercased()
                        if upper != value { workspaceCode = upper }
                    }
                Text(T("From your company, to join its workspace. Leave empty to start your own."))
                    .font(NXFont.text(12))
                    .foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 4)
            }

            if let error { errorBox(error) }

            cooldownButton(idle: T("Continue"), busyLabel: T("Sending code…"), action: submitDetails)
                .padding(.top, 8)
        }
    }

    // MARK: step 2

    private var codeStep: some View {
        VStack(spacing: 16) {
            if let info {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "envelope.badge.fill").font(.system(size: 14, weight: .semibold))
                    Text(info).frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(NXFont.text(13, .semibold))
                .foregroundStyle(NX.success)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(Color(hex: "#ecfdf5"), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.success.opacity(0.2)))
            }

            fieldBlock(label: T("VERIFICATION CODE")) {
                TextField("", text: $otp, prompt: Text("000000").foregroundColor(NX.mutedFg.opacity(0.6)))
                    // `.oneTimeCode` is what lets iOS lift the code out of the email in Mail and
                    // offer it above the keyboard; `.numberPad` alone does not.
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                    .tracking(10)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(NX.foreground)
                    .focused($focus, equals: .otp)
                    .padding(.horizontal, 18).padding(.vertical, 14)
                    .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(focus == .otp ? NX.onyx.opacity(0.5) : .white, lineWidth: focus == .otp ? 2 : 1))
                    // Autofill and paste can bring spaces or a longer string; the server only
                    // accepts exactly six digits.
                    .onChange(of: otp) { _, value in
                        let digits = String(value.filter(\.isASCIIDigit).prefix(6))
                        if digits != value { otp = digits }
                    }
            }

            if let error { errorBox(error) }

            Button(action: submitCode) {
                HStack(spacing: 8) {
                    if busy {
                        ProgressView().tint(.white)
                        Text(T("Verifying…"))
                    } else {
                        Text(T("Verify & sign in"))
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
                    error = nil; info = nil
                    step = .details
                } label: {
                    Label(T("Edit details"), systemImage: "arrow.left")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                }
                .buttonStyle(.plain)
                .disabled(busy)
                Spacer()
                // The countdown is the reason the tap is refused, so it is shown rather than a
                // button that silently does nothing.
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let left = secondsLeft(at: ctx.date)
                    Button(action: resend) {
                        Text(left > 0 ? String(format: T("Resend in %ds"), left) : T("Resend code"))
                            .font(NXFont.text(13, .bold))
                            .foregroundStyle(left > 0 ? NX.mutedFg : NX.violetText)
                            .monospacedDigit()
                    }
                    .buttonStyle(.plain)
                    .disabled(busy || left > 0)
                }
            }
            .padding(.top, 4)
        }
    }

    // MARK: pieces

    /// The onyx CTA with the server's cooldown folded in: while it runs the label counts down and
    /// the button is off, instead of inviting a tap the server has already said it will refuse.
    private func cooldownButton(idle: String, busyLabel: String, action: @escaping () -> Void) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let left = secondsLeft(at: ctx.date)
            Button(action: action) {
                HStack(spacing: 8) {
                    if busy {
                        ProgressView().tint(.white)
                        Text(busyLabel)
                    } else if left > 0 {
                        Text(String(format: T("Try again in %ds"), left)).monospacedDigit()
                    } else {
                        Text(idle)
                        Image(systemName: "arrow.right").font(.system(size: 14, weight: .bold))
                    }
                }
                .modifier(OnyxCTA())
            }
            .buttonStyle(.plain)
            .disabled(busy || left > 0)
            .opacity(busy || left > 0 ? 0.7 : 1)
        }
    }

    private func errorBox(_ text: String) -> some View {
        Text(text)
            .font(NXFont.text(13, .semibold))
            .foregroundStyle(NX.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(Color(hex: "#fef2f2"), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.danger.opacity(0.2)))
    }

    @ViewBuilder
    private func fieldBlock<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(NXFont.text(11, .bold)).tracking(1).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 4)
            content()
        }
    }

    /// Same field as LoginView's. `mono` is a parameter rather than a `.font` from the caller,
    /// because the font set in here sits closer to the TextField and would win over one outside.
    @ViewBuilder
    private func inputField(_ placeholder: String, text: Binding<String>, field: Field,
                            secure: Bool = false, mono: Bool = false) -> some View {
        Group {
            if secure {
                SecureField("", text: text, prompt: Text(placeholder).foregroundColor(NX.mutedFg))
            } else {
                TextField("", text: text, prompt: Text(placeholder).foregroundColor(NX.mutedFg))
            }
        }
        // A code people copy off a screen reads best when 0/O and 1/I cannot be confused.
        .font(mono ? .system(size: 16, weight: .semibold, design: .monospaced) : NXFont.text(16))
        .foregroundStyle(NX.foreground)
        .focused($focus, equals: field)
        .disabled(busy)
        .padding(.horizontal, 18).padding(.vertical, 15)
        .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(focus == field ? NX.onyx.opacity(0.5) : .white, lineWidth: focus == field ? 2 : 1)
        )
        .shadow(color: .black.opacity(0.03), radius: 4, y: 2)
    }

    private func secondsLeft(at now: Date) -> Int {
        guard let cooldownUntil else { return 0 }
        return max(0, Int(cooldownUntil.timeIntervalSince(now).rounded(.up)))
    }

    private var trimmedCode: String? {
        let c = workspaceCode.trimmingCharacters(in: .whitespacesAndNewlines)
        return c.isEmpty ? nil : c
    }

    // MARK: actions

    /// Mirrors `registerSchema` (src/lib/validations.ts): name 1–100, a plausible email, password
    /// 8–128. Checked here only so the common mistakes are named before a round trip; the server
    /// stays the judge. Length is counted in UTF-16 units because that is what zod's `.min` counts.
    private func localProblem() -> String? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if n.isEmpty { return T("Fill in your name.") }
        if n.utf16.count > 100 { return T("That name is too long (100 characters at most).") }
        if e.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
            return T("That email address doesn't look right.")
        }
        if password.utf16.count < 8 { return T("Password must be at least 8 characters.") }
        if password.utf16.count > 128 { return T("Password can be 128 characters at most.") }
        return nil
    }

    private func submitDetails() {
        focus = nil
        error = nil
        if let problem = localProblem() { error = problem; return }
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            busy = true
            defer { busy = false }
            do {
                let res = try await APIClient.shared.registerStart(name: n, email: e, password: password,
                                                                   workspaceCode: trimmedCode)
                sentTo = res.email ?? e
                expiresMinutes = max(1, (res.expiresInSeconds ?? 600) / 60)
                cooldownUntil = Date().addingTimeInterval(TimeInterval(res.resendCooldownSeconds ?? 60))
                info = String(format: T("We sent a 6-digit code to %@. It expires in %d minutes — check your spam folder too."),
                              sentTo, expiresMinutes)
                otp = ""
                step = .code
                focus = .otp
            } catch let wait as SignupRetryLater {
                // Deliberately NOT a jump to the code step. The code already in their inbox was
                // issued for whatever password was typed THEN; if they have since edited it, that
                // code would create the account with the old password and the sign-in after it
                // would fail with the new one.
                error = wait.message
                if let s = wait.seconds, s > 0 { cooldownUntil = Date().addingTimeInterval(TimeInterval(s)) }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't sign you up. Try again.")
            }
        }
    }

    private func submitCode() {
        focus = nil
        error = nil
        guard otp.count == 6 else { error = T("Enter the 6-digit code from your email."); return }
        Task {
            busy = true
            defer { busy = false }
            do {
                try await APIClient.shared.registerVerify(email: sentTo, code: otp, workspaceCode: trimmedCode)
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? T("Wrong or expired code.")
                return
            }
            // The account exists from here on, so there is no going back to this screen: /verify
            // would now answer "no pending verification". Sign in through the app's one login path
            // (it stores the session and RootView swaps to the app on its own).
            await auth.login(email: sentTo, password: password)
            if !auth.isAuthenticated {
                auth.loginError = T("Your account is ready. Sign in with your email and password.")
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
                let res = try await APIClient.shared.registerResend(email: sentTo)
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

/// LoginView's onyx CTA, shared by both sign-up buttons so they cannot drift from it.
private struct OnyxCTA: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(NXFont.display(16, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(NX.onyx, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: NX.onyx.opacity(0.25), radius: 18, y: 10)
    }
}

private extension Character {
    /// `isNumber` would also let through Arabic-Indic and full-width digits, which the server's
    /// `^\d{6}$` refuses.
    var isASCIIDigit: Bool { isASCII && isNumber }
}
