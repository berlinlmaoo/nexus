import SwiftUI
import PhotosUI
import UIKit

/// Focused port of settings.tsx ("Tuning Room"): profile (name edit, email, role) + account/logout.
/// The web's webhooks/integrations/billing/MCP sections are desktop-oriented; omitted on mobile.
struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var name = ""
    @State private var email = ""
    @State private var googleEmail = ""
    @State private var role: String?
    @State private var workspaceId: String?
    @State private var saving = false
    @State private var savedOK = false
    @State private var saveError: String?
    @State private var loading = true
    @State private var avatarURL: String?
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var uploadingPhoto = false
    @State private var photoError: String?
    @State private var uploadProgress = UploadProgress()
    /// Whatever is switched off for NEXUS, listed at the top with the way to Settings. Empty — the
    /// normal case — draws nothing.
    @State private var deniedKinds: [PermissionKind] = []
    /// The only sheet this view presents. Another `.sheet` added to this view later must share it
    /// through an enum — two on one view and one of them never opens.
    @State private var showDeleteAccount = false
    @Environment(\.scenePhase) private var scenePhase

    private static let roleLabel: [String: String] = ["ONE_ABOVE_ALL": "One Above All", "BOD": "BoD", "MANAGER": "Manager", "STAFF": "Staff"]
    private var initial: String { String((name.isEmpty ? email : name).first ?? "?").uppercased() }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    Group {
                        ForEach(deniedKinds) { PermissionBanner(kind: $0) }
                    }
                    .task { deniedKinds = await Permissions.denied() }
                    .onChange(of: scenePhase) { _, phase in
                        if phase == .active { Task { deniedKinds = await Permissions.denied() } }
                    }
                    // profile header
                    VStack(spacing: 10) {
                        // Shows the photo already on the account; falls back to the initial while
                        // none is set. Tapping the badge opens the library.
                        ZStack(alignment: .bottomTrailing) {
                            AvatarView(url: avatarURL, initial: initial, size: 76)
                            PhotosPicker(selection: $pickedPhoto, matching: .images, photoLibrary: .shared()) {
                                Image(systemName: uploadingPhoto ? "hourglass" : "camera.fill")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 28, height: 28)
                                    .background(NX.violet, in: Circle())
                                    .overlay(Circle().strokeBorder(NX.background, lineWidth: 2))
                            }
                            .disabled(uploadingPhoto)
                        }
                        if avatarURL?.isEmpty == false {
                            Button(T("Remove photo")) { Task { await removePhoto() } }
                                .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                                .disabled(uploadingPhoto)
                        }
                        if let photoError {
                            Text(photoError).font(NXFont.text(11)).foregroundStyle(NX.danger)
                                .multilineTextAlignment(.center)
                        }
                        // Held to a readable width: this column is centred on the avatar, and a bar
                        // spanning the whole screen would read as belonging to the card below it.
                        if uploadProgress.isActive {
                            UploadProgressBar(progress: uploadProgress).frame(maxWidth: 180)
                        }
                        if let role, let label = Self.roleLabel[role.uppercased()] {
                            NexusChip(text: label, tone: .accent, systemImage: "shield.fill")
                        }
                    }
                    .onChange(of: pickedPhoto) { _, item in
                        guard let item else { return }
                        Task { await upload(item) }
                    }
                    .padding(.top, 8)

                    // editable profile
                    VStack(alignment: .leading, spacing: 14) {
                        field(T("NAME")) {
                            TextField(T("Your name"), text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        field(T("EMAIL")) {
                            Text(email.isEmpty ? "—" : email).font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        // Read-only here: a BoD links it from Control Room, and the person only needs
                        // to know which address the company gave them.
                        field(T("GOOGLE WORKSPACE")) {
                            HStack(spacing: 8) {
                                Image(systemName: "at").font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(googleEmail.isEmpty ? NX.mutedFg : NX.violetText)
                                Text(googleEmail.isEmpty ? T("No company Google account linked yet.") : googleEmail)
                                    .font(NXFont.text(googleEmail.isEmpty ? 12 : 15))
                                    .foregroundStyle(googleEmail.isEmpty ? NX.mutedFg : NX.foreground)
                                    .lineLimit(1).truncationMode(.middle)
                                Spacer(minLength: 0)
                            }
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        Button { Task { await save() } } label: {
                            HStack(spacing: 8) {
                                if saving { ProgressView().tint(.white) }
                                Text(savedOK ? T("Saved ✓") : T("Save profile"))
                            }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .nexusCard()

                    AppearanceCard()
                    LanguageCard()
                    OfflineCard()
                    if let wsId = workspaceId { WorkspaceMembersCard(workspaceId: wsId) }
                    SecurityCard()
                    PasskeyCard()

                    // account
                    VStack(spacing: 0) {
                        Button(role: .destructive) { auth.logout() } label: {
                            HStack {
                                Label(T("Logout"), systemImage: "rectangle.portrait.and.arrow.right")
                                    .font(NXFont.text(15, .semibold)).foregroundStyle(NX.danger)
                                Spacer()
                            }
                            .padding(14)
                        }.buttonStyle(.plain)
                    }
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))

                    // Last and set apart from Logout, so the permanent action is never the one a
                    // thumb lands on by habit. The sheet explains what is kept and what goes.
                    Button { showDeleteAccount = true } label: {
                        HStack {
                            Label(T("Delete account"), systemImage: "trash")
                                .font(NXFont.text(15, .semibold)).foregroundStyle(NX.danger)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        }
                        .padding(14)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.danger.opacity(0.3)))
                    .padding(.top, 10)

                    Text("NEXUS by Z Networks").font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.7))
                }
                .padding(16)
            }
            .opacity(loading ? 0.4 : 1)
        }
        .alert(T("Couldn't save"), isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
            Button("OK") { saveError = nil }
        } message: { Text(saveError ?? "") }
        .sheet(isPresented: $showDeleteAccount) { DeleteAccountSheet() }
        .navigationTitle(T("Tuning Room"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            SectionLabel(label)
            content()
        }
    }

    private func load() async {
        name = auth.session?.userName ?? ""
        email = auth.session?.userEmail ?? ""
        if let p = try? await APIClient.shared.profile() {
            name = p.user.name ?? name
            email = p.user.email ?? email
            avatarURL = p.user.avatar
            googleEmail = p.user.googleWorkspaceEmail ?? ""
        }
        if let info = try? await APIClient.shared.workspaceInfo() { role = info.role; workspaceId = info.workspaceId }
        loading = false
    }
    /// The library hands back whatever the camera produced - often HEIC, which the server
    /// rejects. Re-encode to JPEG and cap the long edge so we never hit the 5 MB limit.
    private func upload(_ item: PhotosPickerItem) async {
        uploadingPhoto = true
        photoError = nil
        defer { uploadingPhoto = false; pickedPhoto = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            photoError = T("Couldn't read that photo.")
            return
        }
        let maxEdge: CGFloat = 1024
        let scale = min(1, maxEdge / max(image.size.width, image.size.height))
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: target).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let jpeg = resized.jpegData(compressionQuality: 0.85) else {
            photoError = T("Couldn't read that photo.")
            return
        }
        do {
            avatarURL = try await APIClient.shared.uploadAvatar(fileName: "avatar.jpg", mime: "image/jpeg",
                                                                data: jpeg, progress: uploadProgress)
        } catch {
            photoError = (error as? LocalizedError)?.errorDescription ?? T("Upload failed. Try again.")
        }
    }

    private func removePhoto() async {
        uploadingPhoto = true
        photoError = nil
        defer { uploadingPhoto = false }
        do {
            try await APIClient.shared.deleteAvatar()
            avatarURL = nil
        } catch {
            photoError = (error as? LocalizedError)?.errorDescription ?? T("Upload failed. Try again.")
        }
    }

    private func save() async {
        saving = true; savedOK = false; defer { saving = false }
        let v = name.trimmingCharacters(in: .whitespaces)
        do { try await APIClient.shared.updateProfile(name: v); savedOK = true }
        catch { saveError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save your profile.") }
    }
}
