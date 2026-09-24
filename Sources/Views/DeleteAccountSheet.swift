import SwiftUI

/// The signed-in person deleting their OWN account (App Store 5.1.1(v)). Not the admin path —
/// AdminUserDetailView deletes somebody else, through a different endpoint with different rules.
///
/// A sheet with a typed confirmation rather than a one-tap dialog: this is the one action in the
/// app that cannot be taken back, and a confirmation button sits exactly where a thumb already is.
struct DeleteAccountSheet: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var busy = false
    @State private var problem: String?
    @FocusState private var fieldFocused: Bool

    /// Exactly the word, as the server's own guard spells it. Case matters: "delete" typed in
    /// passing should not be enough for something permanent.
    private var confirmed: Bool { typed.trimmingCharacters(in: .whitespacesAndNewlines) == "DELETE" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 10) {
                        Image(systemName: "person.crop.circle.badge.xmark")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(NX.danger)
                        Text(T("Delete your NEXUS account?"))
                            .font(NXFont.display(20, .bold))
                            .foregroundStyle(NX.foreground)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        consequence("lock.fill", T("You can no longer sign in — in this app or on the web."))
                        consequence("person.crop.circle.badge.minus", T("Your name, email and photo are removed."))
                        consequence("building.2.fill", T("Your company keeps your attendance and task history, shown under \"Deleted account\"."))
                        consequence("exclamationmark.triangle.fill", T("This cannot be undone."))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .nexusCard()

                    VStack(alignment: .leading, spacing: 7) {
                        SectionLabel(T("Type DELETE to confirm"))
                        TextField("", text: $typed, prompt: Text("DELETE").foregroundColor(NX.mutedFg.opacity(0.6)))
                            .font(.system(size: 16, weight: .semibold, design: .monospaced))
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .focused($fieldFocused)
                            .disabled(busy)
                            .padding(12)
                            .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(confirmed ? NX.danger.opacity(0.6) : .clear, lineWidth: 1.5))
                    }

                    // The server's own sentence, e.g. the 409 for the only owner of a workspace
                    // other people are still in — it says what to do first, which nothing here knows.
                    if let problem {
                        Text(problem)
                            .font(NXFont.text(13, .semibold))
                            .foregroundStyle(NX.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(NX.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    Button { Task { await delete() } } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(.white) }
                            Text(busy ? T("Deleting…") : T("Delete my account"))
                        }
                    }
                    .buttonStyle(NexusPrimaryButton(tint: NX.danger))
                    .disabled(!confirmed || busy)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Delete account"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Cancel")) { dismiss() }.disabled(busy)
                }
            }
        }
        // Swiping the sheet away mid-request would leave the answer with nobody to act on it.
        .interactiveDismissDisabled(busy)
    }

    private func consequence(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(NX.danger)
                .frame(width: 20)
            Text(text)
                .font(NXFont.text(14))
                .foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func delete() async {
        guard confirmed else { return }
        fieldFocused = false
        busy = true
        problem = nil
        do {
            try await APIClient.shared.deleteOwnAccount()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete your account. Try again.")
            busy = false
            return
        }
        // Through the ONE logout path, not a local copy of it: that is what wipes the Keychain,
        // the response cache, the offline files, the queued check-ins and GIDEON's transcript.
        // RootView then swaps to the login screen, which takes this sheet down with it.
        auth.logout()
    }
}
