import SwiftUI

/// Faithful native port of the web login (src/routes/login.tsx): cream bg + soft color glows,
/// frosted white card, X logo, "NEXUS PHAËTHON" tracked title, uppercase labels, ONYX CTA, coral pill.
struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
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

            card
                .padding(.horizontal, 22)
        }
        .preferredColorScheme(.light)   // login is light-only on web
    }

    private var card: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Image("NexusLogo")
                    .resizable().scaledToFit()
                    .frame(width: 72, height: 72)
                    .shadow(color: NX.violet.opacity(0.3), radius: 16, y: 10)
                    .padding(.bottom, 22)

                Text("NEXUS PHAËTHON")
                    .font(NXFont.display(22, .bold))
                    .tracking(4)
                    .foregroundStyle(NX.onyx)
                    .padding(.bottom, 30)

                // Access ID
                fieldBlock(label: "ACCESS ID (EMAIL)") {
                    inputField("commander@nexus.app", text: $email, field: .email, secure: false)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                }

                // Encryption Key
                fieldBlock(label: "ENCRYPTION KEY") {
                    inputField("••••••••", text: $password, field: .password, secure: true)
                        .submitLabel(.go)
                        .onSubmit(attemptLogin)
                }
                .padding(.top, 18)

                if let err = auth.loginError {
                    Text(err)
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
                            Text("Opening uplink…")
                        } else {
                            Text("Enter Mission Control")
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
                .disabled(auth.isLoggingIn)
                .opacity(auth.isLoggingIn ? 0.7 : 1)
                .padding(.top, 26)

                // There is no self-serve reset or signup on mobile — access is granted by a workspace
                // admin (Tuning Room → Members). The old "FORGOT?" / "Request access" looked like
                // links but did nothing, so say what to actually do instead.
                Text("Lupa password atau belum punya akses?\nHubungi admin workspace kamu.")
                    .font(NXFont.text(13))
                    .foregroundStyle(NX.mutedFg)
                    .multilineTextAlignment(.center)
                    .padding(.top, 28)
            }
            .padding(.horizontal, 30)
            .padding(.vertical, 40)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 38, style: .continuous))
            .background(Color.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 38, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 38, style: .continuous).strokeBorder(.white.opacity(0.65), lineWidth: 1))
            .shadow(color: .black.opacity(0.10), radius: 40, y: 26)
        }
        .overlay(alignment: .bottom) {
            Text("SECURE UPLINK READY")
                .font(NXFont.text(10, .bold))
                .tracking(2)
                .foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 7)
                .background(NX.coral, in: Capsule())
                .overlay(Capsule().strokeBorder(.white, lineWidth: 2))
                .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
                .offset(y: 14)
        }
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
            auth.loginError = "Isi Access ID dan Encryption Key dulu ya."
            return
        }
        Task { await auth.login(email: e, password: password) }
    }
}
