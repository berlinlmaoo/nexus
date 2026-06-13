import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        ZStack {
            NX.inkGradient.ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                VStack(spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(.white.opacity(0.12))
                            .frame(width: 76, height: 76)
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 36, weight: .black))
                            .foregroundStyle(.white)
                    }
                    Text("NEXUS")
                        .font(NXFont.display(40, .black))
                        .foregroundStyle(.white)
                        .tracking(1)
                    Text("Masuk ke workspace lo")
                        .font(NXFont.text(15, .medium))
                        .foregroundStyle(.white.opacity(0.7))
                }

                VStack(spacing: 12) {
                    field("Email", text: $email, field: .email, secure: false)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                    field("Password", text: $password, field: .password, secure: true)
                        .submitLabel(.go)
                        .onSubmit(attemptLogin)

                    if let err = auth.loginError {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                            Text(err).font(NXFont.text(13, .semibold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(NX.danger.opacity(0.85), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    Button(action: attemptLogin) {
                        HStack(spacing: 8) {
                            if auth.isLoggingIn { ProgressView().tint(.white) }
                            Text(auth.isLoggingIn ? "Masuk…" : "Masuk")
                        }
                    }
                    .buttonStyle(NexusPrimaryButton())
                    .disabled(auth.isLoggingIn || email.isEmpty || password.isEmpty)
                    .opacity(email.isEmpty || password.isEmpty ? 0.55 : 1)
                    .padding(.top, 2)
                }

                Spacer()
                Text("PATS Group · NEXUS iOS")
                    .font(NXFont.text(11, .medium))
                    .foregroundStyle(.white.opacity(0.45))
            }
            .padding(28)
        }
    }

    @ViewBuilder
    private func field(_ placeholder: String, text: Binding<String>, field: Field, secure: Bool) -> some View {
        Group {
            if secure {
                SecureField("", text: text, prompt: Text(placeholder).foregroundColor(NX.mutedFg))
                    .textContentType(.password)
            } else {
                TextField("", text: text, prompt: Text(placeholder).foregroundColor(NX.mutedFg))
                    .textContentType(.emailAddress)
            }
        }
        .font(NXFont.text(16, .medium))
        .foregroundStyle(NX.foreground)
        .focused($focus, equals: field)
        .padding(15)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(focus == field ? NX.violet : .clear, lineWidth: 2)
        )
    }

    private func attemptLogin() {
        focus = nil
        Task { await auth.login(email: email.trimmingCharacters(in: .whitespaces), password: password) }
    }
}
