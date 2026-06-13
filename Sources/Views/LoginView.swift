import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Brand.ink, Brand.violet.opacity(0.55)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 22) {
                Spacer()

                VStack(spacing: 8) {
                    Image(systemName: "bolt.shield.fill")
                        .font(.system(size: 52, weight: .bold))
                        .foregroundStyle(.white)
                    Text("NEXUS")
                        .font(.system(size: 38, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Masuk ke workspace lo")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.7))
                }

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .padding(14)
                        .background(.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 14))

                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit(attemptLogin)
                        .padding(14)
                        .background(.white.opacity(0.95), in: RoundedRectangle(cornerRadius: 14))

                    if let err = auth.loginError {
                        Text(err)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.red.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
                    }

                    Button(action: attemptLogin) {
                        HStack {
                            if auth.isLoggingIn { ProgressView().tint(.white) }
                            Text(auth.isLoggingIn ? "Masuk…" : "Masuk")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(Brand.violet, in: RoundedRectangle(cornerRadius: 14))
                        .foregroundStyle(.white)
                    }
                    .disabled(auth.isLoggingIn || email.isEmpty || password.isEmpty)
                    .opacity(email.isEmpty || password.isEmpty ? 0.6 : 1)
                }
                .padding(.horizontal, 4)

                Spacer()
                Text("PATS Group · NEXUS iOS")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
            }
            .padding(24)
        }
    }

    private func attemptLogin() {
        focus = nil
        Task { await auth.login(email: email.trimmingCharacters(in: .whitespaces), password: password) }
    }
}
