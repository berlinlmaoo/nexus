import SwiftUI

/// Focused port of settings.tsx ("Tuning Room"): profile (name edit, email, role) + account/logout.
/// The web's webhooks/integrations/billing/MCP sections are desktop-oriented; omitted on mobile.
struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var name = ""
    @State private var email = ""
    @State private var role: String?
    @State private var workspaceId: String?
    @State private var saving = false
    @State private var savedOK = false
    @State private var loading = true

    private static let roleLabel: [String: String] = ["ONE_ABOVE_ALL": "One Above All", "BOD": "BoD", "MANAGER": "Manager", "STAFF": "Staff"]
    private var initial: String { String((name.isEmpty ? email : name).first ?? "?").uppercased() }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    // profile header
                    VStack(spacing: 10) {
                        Text(initial).font(NXFont.display(28, .black)).foregroundStyle(.white)
                            .frame(width: 76, height: 76).background(NX.violet, in: Circle())
                        if let role, let label = Self.roleLabel[role.uppercased()] {
                            NexusChip(text: label, tone: .accent, systemImage: "shield.fill")
                        }
                    }
                    .padding(.top, 8)

                    // editable profile
                    VStack(alignment: .leading, spacing: 14) {
                        field("NAMA") {
                            TextField("Nama kamu", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        field("EMAIL") {
                            Text(email.isEmpty ? "—" : email).font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        Button { Task { await save() } } label: {
                            HStack(spacing: 8) {
                                if saving { ProgressView().tint(.white) }
                                Text(savedOK ? "Tersimpan ✓" : "Simpan profil")
                            }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .nexusCard()

                    if let wsId = workspaceId { WorkspaceMembersCard(workspaceId: wsId) }
                    SecurityCard()

                    // account
                    VStack(spacing: 0) {
                        Button(role: .destructive) { auth.logout() } label: {
                            HStack {
                                Label("Logout", systemImage: "rectangle.portrait.and.arrow.right")
                                    .font(NXFont.text(15, .semibold)).foregroundStyle(NX.danger)
                                Spacer()
                            }
                            .padding(14)
                        }.buttonStyle(.plain)
                    }
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))

                    Text("NEXUS iOS · PATS Group").font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.7))
                }
                .padding(16)
            }
            .opacity(loading ? 0.4 : 1)
        }
        .navigationTitle("Tuning Room")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            content()
        }
    }

    private func load() async {
        name = auth.session?.userName ?? ""
        email = auth.session?.userEmail ?? ""
        if let p = try? await APIClient.shared.profile() {
            name = p.user.name ?? name
            email = p.user.email ?? email
        }
        if let info = try? await APIClient.shared.workspaceInfo() { role = info.role; workspaceId = info.workspaceId }
        loading = false
    }
    private func save() async {
        saving = true; savedOK = false; defer { saving = false }
        let v = name.trimmingCharacters(in: .whitespaces)
        do { try await APIClient.shared.updateProfile(name: v); savedOK = true }
        catch {}
    }
}
