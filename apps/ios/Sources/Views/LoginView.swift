import SwiftUI

/// Faithful native port of the web login (src/routes/login.tsx): cream bg + soft color glows,
/// frosted white card, X logo, "NEXUS PHAËTHON" tracked title, uppercase labels, ONYX CTA, coral pill.
struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @State private var email = ""
    /// nil draws the sign-in card; a value swaps in the sign-up flow, prefilled with that
    /// workspace code ("" when it was opened by hand). Swapped in place rather than presented, so
    /// the glow behind both stays put and nothing is left presented when a finished sign-up
    /// replaces this whole screen with the app.
    @State private var signUpCode: String?
    /// Same idea for the password-reset flow: nil draws the sign-in card (unless sign-up is up).
    /// Only one of the two is ever set — each setter clears the other.
    @State private var resetRequest: NXPasswordResetRequest?
    @State private var password = ""
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        ZStack {
            // bg-[#fdfcfb] + blurred color blobs (primary/orange/purple)
            NX.cream.ignoresSafeArea()
            Circle().fill(NX.onyx.opacity(0.10)).frame(width: 360, height: 360).blur(radius: 100)
                .offset(x: -150, y: -260)
            Circle().fill(NX.coral.opacity(0.22)).frame(width: 360, height: 360).blur(radius: 100)
                .offset(x: 150, y: 320)
            Circle().fill(Color(hex: "#a78bfa").opacity(0.16)).frame(width: 240, height: 300).blur(radius: 90)
                .offset(x: 120, y: -120)

            // A sign-in form has one column of content, so its width is set by reading comfort,
            // not by the screen. Left uncapped it stretched the full 13 inches in landscape and
            // the fields became a metre wide.
            if let code = signUpCode {
                SignUpView(initialCode: code) { typedEmail in
                    // Back to sign-in, carrying the address over so a finished sign-up whose
                    // automatic sign-in failed only needs the password typed again.
                    if let typedEmail, !typedEmail.isEmpty { email = typedEmail }
                    withAnimation(.easeInOut(duration: 0.25)) { signUpCode = nil }
                }
                // A second link tapped mid-flow starts over with its code, instead of the fields
                // silently keeping the first one (@State only reads initialCode once).
                .id(code)
                .transition(.opacity)
            } else if let reset = resetRequest {
                ResetPasswordView(email: reset.email, invited: reset.invited) { typedEmail in
                    // Back to sign-in with the address filled in: after a reset whose automatic
                    // sign-in failed, only the new password is left to type.
                    if let typedEmail, !typedEmail.isEmpty { email = typedEmail }
                    withAnimation(.easeInOut(duration: 0.25)) { resetRequest = nil }
                }
                // A second link mid-flow starts over with its own email and title.
                .id(reset.id)
                .transition(.opacity)
            } else {
                card
                    .frame(maxWidth: 460)
                    .padding(.horizontal, 22)
                    .transition(.opacity)
            }
        }
        .preferredColorScheme(.light)   // login is light-only on web
        // A `/register?code=…` link: on a cold start it is already waiting when this appears; on
        // a warm one it lands while this is on screen.
        // The invite email's `/forgot-password?email=…&invited=1` arrives the same two ways.
        .onAppear {
            takeSignupRequest()
            takePasswordResetRequest()
        }
        .onChange(of: router.signupRequest) { _, _ in takeSignupRequest() }
        .onChange(of: router.passwordResetRequest) { _, _ in takePasswordResetRequest() }
    }

    private func takeSignupRequest() {
        guard let request = router.signupRequest else { return }
        router.signupRequest = nil
        auth.loginError = nil
        withAnimation(.easeInOut(duration: 0.25)) {
            resetRequest = nil
            signUpCode = request.code
        }
    }

    private func takePasswordResetRequest() {
        guard let request = router.passwordResetRequest else { return }
        router.passwordResetRequest = nil
        auth.loginError = nil
        openReset(request)
    }

    private func openReset(_ request: NXPasswordResetRequest) {
        focus = nil
        withAnimation(.easeInOut(duration: 0.25)) {
            signUpCode = nil
            resetRequest = request
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Image("NexusLogo")
                    .resizable().scaledToFit()
                    .frame(width: 72, height: 72)
                    .shadow(color: NX.violet.opacity(0.3), radius: 16, y: 10)
                    .padding(.bottom, 22)

                // The web's wordmark (login.tsx): "NEXUS PHAËTHON".
                Text("NEXUS PHAËTHON")
                    .font(NXFont.display(20, .bold))
                    .tracking(3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(NX.onyx)
                    // Dev builds: a long press picks Production or the DEV server (ServerSwitchViews.swift).
                    .modifier(LoginServerSwitch())
                    .padding(.bottom, 30)

                // Access ID
                fieldBlock(label: T("Email")) {
                    inputField(T("name@company.com"), text: $email, field: .email, secure: false)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                }

                // Encryption Key
                fieldBlock(label: T("Password"), accessory: AnyView(forgotButton)) {
                    inputField("••••••••", text: $password, field: .password, secure: true)
                        .submitLabel(.go)
                        .onSubmit(attemptLogin)
                }
                .padding(.top, 18)

                if let err = auth.loginError {
                    Text(err)
                        .accessibilityIdentifier("login.error")
                        .font(NXFont.text(13, .semibold))
                        .foregroundStyle(NX.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .background(Color(hex: "#fef2f2"), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.danger.opacity(0.2)))
                        .padding(.top, 18)
                }

                // onyx CTA
                Button(action: attemptLogin) {
                    HStack(spacing: 8) {
                        if auth.isLoggingIn {
                            ProgressView().tint(.white)
                            Text(T("Signing in…"))
                        } else {
                            Text(T("Sign in"))
                            Image(systemName: "arrow.right").font(.system(size: 14, weight: .bold))
                        }
                    }
                    .font(NXFont.display(16, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(NX.onyx, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .shadow(color: NX.onyx.opacity(0.25), radius: 18, y: 10)
                }
                .buttonStyle(.plain)
                .disabled(auth.isBusy)
                .opacity(auth.isBusy ? 0.7 : 1)
                .padding(.top, 26)
                // Found by the UI screenshot tour (UITests/NEXUSUITour).
                .accessibilityIdentifier("login.signIn")

                // Passkey is an ADDITION, so nothing above this line moves: the two fields and the
                // onyx CTA stay exactly where they were and keep working on their own.
                HStack(spacing: 10) {
                    Rectangle().fill(NX.onyx.opacity(0.12)).frame(height: 1)
                    Text(T("or").uppercased()).font(NXFont.text(11, .bold)).tracking(1).foregroundStyle(NX.mutedFg)
                    Rectangle().fill(NX.onyx.opacity(0.12)).frame(height: 1)
                }
                .padding(.top, 20)

                // Outlined rather than filled: the password CTA above stays the primary action.
                Button(action: attemptPasskey) {
                    HStack(spacing: 8) {
                        if auth.isPasskeyLoggingIn {
                            ProgressView().tint(NX.onyx)
                        } else {
                            Image(systemName: "key").font(.system(size: 15, weight: .bold))
                        }
                        Text(T("Sign in with a passkey"))
                    }
                    .font(NXFont.display(15, .bold))
                    .foregroundStyle(NX.onyx)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(NX.onyx.opacity(0.18), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(auth.isBusy)
                .opacity(auth.isBusy ? 0.7 : 1)
                .padding(.top, 14)

                // Sign-up is native now (App Store 5.1.1(v) wants account creation and deletion
                // both in the app). A code from a company joins its workspace; no code gives the
                // person one of their own — so this is safe to offer to anyone.
                Button {
                    focus = nil
                    auth.loginError = nil
                    withAnimation(.easeInOut(duration: 0.25)) { signUpCode = "" }
                } label: {
                    HStack(spacing: 5) {
                        Text(T("New here?")).foregroundStyle(NX.mutedFg)
                        Text(T("Request access")).font(NXFont.text(14, .bold)).foregroundStyle(NX.onyx)
                        Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.onyx)
                    }
                    .font(NXFont.text(14))
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(auth.isBusy)
                .padding(.top, 22)

            }
            .padding(.horizontal, 30)
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 38, style: .continuous))
            .background(Color.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 38, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 38, style: .continuous).strokeBorder(.white.opacity(0.65), lineWidth: 1))
            .shadow(color: .black.opacity(0.10), radius: 40, y: 26)
        }
        // No "SECURE SIGN-IN" pill on the card's edge: an eyebrow with nothing to say (decision 1 of run 19).
    }

    @ViewBuilder
    /// Upper-case label as on the web, with an optional control at its right ("FORGOT PASSWORD?").
    private func fieldBlock<Content: View>(label: String, accessory: AnyView? = nil,
                                           @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 8)
                if let accessory { accessory }
            }
            .padding(.horizontal, 4)
            content()
        }
    }

    /// Self-serve reset (email code, the web's /forgot-password flow), at the right of the PASSWORD label
    /// as on the web. Carries whatever is in the email field over, so the first step is usually "Send code".
    private var forgotButton: some View {
        Button {
            auth.loginError = nil
            openReset(NXPasswordResetRequest(email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                                             invited: false))
        } label: {
            Text(T("Forgot password?").uppercased())
                .font(NXFont.text(11, .bold)).tracking(0.5)
                .foregroundStyle(NX.onyx)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(auth.isBusy)
    }

    @ViewBuilder
    private func inputField(_ placeholder: String, text: Binding<String>, field: Field, secure: Bool) -> some View {
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
        .padding(.horizontal, 18).padding(.vertical, 15)
        .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(focus == field ? NX.onyx.opacity(0.5) : .white, lineWidth: focus == field ? 2 : 1)
        )
        .shadow(color: .black.opacity(0.03), radius: 4, y: 2)
    }

    private func attemptLogin() {
        focus = nil
        let e = email.trimmingCharacters(in: .whitespaces)
        guard !e.isEmpty, !password.isEmpty else {
            auth.loginError = T("Enter your email and password first.")
            return
        }
        Task { await auth.login(email: e, password: password) }
    }

    /// No email needed: the server's assertion options carry no allowCredentials, so iOS offers
    /// whichever NEXUS passkey it can find. A dismissed Face ID sheet is swallowed in AuthStore.
    private func attemptPasskey() {
        focus = nil
        auth.loginError = nil
        Task { await auth.loginWithPasskey() }
    }
}
