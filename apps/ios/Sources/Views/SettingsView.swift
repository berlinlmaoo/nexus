import SwiftUI
import PhotosUI
import UIKit

/// Focused port of settings.tsx ("Tuning Room"): profile (name edit, email, role) + account/logout.
/// The web's integrations/billing/MCP sections are desktop-oriented; omitted on mobile.
struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.horizontalSizeClass) private var hSize
    /// Pushed (Home's avatar on the iPad) rather than the sidebar's own root: the bar then keeps Back.
    @Environment(\.isPresented) private var isPresented
    @State private var name = ""
    /// The profile's phone number, saved with the name (web ProfileSection). Loaded separately: the
    /// shared AppUser does not carry it.
    @State private var phone = ""
    @State private var signOutBlocked = false
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
    /// Only for the "update available" / "update by <date>" row; NexusApp fetches the policy.
    @State private var versionGate = AppVersionGate.shared
    /// The web's Settings tabs (UI sweep, 12 Oct 2026): Profile, Members, Notifications, Security,
    /// Appearance, Claude (MCP). Remembered on this device.
    @AppStorage("nexus.settings.tab") private var tab: SettingsTab = .profile

    private var initial: String { String((name.isEmpty ? email : name).first ?? "?").uppercased() }

    /// Regular width (iPad, Mac): the dev web's Settings (settings.tsx, owner screenshots 278/279) — a
    /// page header, the sections as a list on the left with the chosen one on a pill, and the section's
    /// cards on the right. The phone keeps the tab strip over one column.
    private var webChrome: Bool { hSize == .regular }

    var body: some View {
        Group {
            if webChrome { webBody } else { phoneBody }
        }
        .alert(T("Couldn't save"), isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
            Button("OK") { saveError = nil }
        } message: { Text(saveError ?? "") }
        .sheet(isPresented: $showDeleteAccount) { DeleteAccountSheet() }
        .navigationTitle(webChrome ? "" : T("Settings"))
        .navigationBarTitleDisplayMode(.inline)
        // The sidebar's root draws its own header (webChrome); pushed, the bar stays for Back.
        .toolbar(webChrome && !isPresented ? .hidden : .automatic, for: .navigationBar)
        .task { await load() }
    }

    private var phoneBody: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 18) {
                    notices
                    tabContent
                    footer
                }
                .padding(16)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(spacing: 0) {
                    NXPhoneSubtitle(text: T("Your profile, security, notifications and workspace preferences."))
                    NXUnderlineTabs(items: SettingsTab.allCases.map { NXTabItem(id: $0, label: $0.label, icon: $0.icon) },
                                    selection: $tab, accessibilityName: T("Settings"))
                }
                .background(NX.background)
            }
            .opacity(loading ? 0.4 : 1)
        }
    }

    private var webScroll: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                notices
                webTabContent
                footer
            }
            .frame(maxWidth: 1040, alignment: .leading)
            .padding(.top, 24).padding(.bottom, 32).padding(.trailing, 32)
            .opacity(loading ? 0.4 : 1)
        }
    }

    private var webBody: some View {
        VStack(spacing: 0) {
            NXPageHeader(title: T("Settings"), subtitle: T("Your profile, security, notifications and workspace preferences."))
            // The side menu only where the cards keep a real width beside it. A portrait iPad with the
            // sidebar open left ~340 pt and "Change photo" broke letter by letter (UI tour run 3); there
            // the sections become the tab strip over full-width cards, as on a narrow web window.
            // The threshold was 860 pt, so an iPad in portrait with the sidebar open (~700 pt) always
            // fell back to the strip (UI tour run 5). From 680 pt the list sits at the left in a narrower
            // column and the cards keep ~420 pt, enough for the profile row; wider pages get the web's 230.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 28) {
                    webSideNav
                        .frame(width: 230)
                        .padding(.top, 24)
                    webScroll
                }
                .padding(.leading, 32)
                .frame(minWidth: 860, idealWidth: 860, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                HStack(alignment: .top, spacing: 20) {
                    webSideNav
                        .frame(width: 176)
                        .padding(.top, 24)
                    webScroll
                }
                .padding(.leading, 20)
                .frame(minWidth: 680, idealWidth: 680, maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                VStack(spacing: 0) {
                    NXUnderlineTabs(items: SettingsTab.allCases.map { NXTabItem(id: $0, label: $0.label, icon: $0.icon) },
                                    selection: $tab, accessibilityName: T("Settings"))
                        .padding(.horizontal, 16)
                    webScroll.padding(.leading, 32)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .background(NX.background.ignoresSafeArea())
    }

    /// The sections as the web's vertical list: icon and name, the chosen one on a muted pill.
    private var webSideNav: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(SettingsTab.allCases) { t in
                let on = tab == t
                Button { tab = t } label: {
                    HStack(spacing: 10) {
                        Image(systemName: t.icon).font(.system(size: 15)).frame(width: 20)
                        Text(t.label).font(NXFont.text(15, on ? .medium : .regular)).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(on ? NX.foreground : NX.mutedFg)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .background(on ? NX.muted : Color.clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(T("Settings"))
    }

    /// An update waiting, and whatever is switched off for NEXUS, above every section.
    @ViewBuilder private var notices: some View {
        // A row, not a sheet: Tuning Room is the one place an optional update is
        // mentioned, and it waits to be noticed. A deadline outranks a mere "newer
        // version", so only one of the two is ever drawn.
        if let grace = versionGate.grace {
            UpdateDeadlineRow(grace: grace, storeUrl: versionGate.storeUrl)
        } else if let latest = versionGate.available, let url = versionGate.storeUrl {
            UpdateAvailableRow(version: latest, storeUrl: url)
        }
        Group {
            ForEach(deniedKinds) { PermissionBanner(kind: $0) }
        }
        .task { deniedKinds = await Permissions.denied() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { deniedKinds = await Permissions.denied() } }
        }
    }

    /// Under every section: the server switch (dev builds), whether realtime is live, the name.
    @ViewBuilder private var footer: some View {
        // Branch dev only: Production or the DEV server (ServerSwitchViews.swift).
        ServerSwitchCard()
        // Whether this device is live, so a Mac that shows nothing new can be told apart
        // from a Mac that is not connected.
        HStack {
            Spacer(minLength: 0)
            VStack(spacing: 8) {
                RealtimeStatusLine()
                Text("NEXUS by Z Networks").font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.7))
            }
            Spacer(minLength: 0)
        }
    }

    /// Regular width: Profile is the web's Profile card, Password card, Delete account card (and Logout,
    /// which the web has in its sidebar footer); the other sections are the same cards as on the phone.
    @ViewBuilder private var webTabContent: some View {
        if tab == .profile {
            webProfileCard
            SecurityCard()
            webDeleteCard
            webLogoutCard
        } else {
            tabContent
        }
    }

    // MARK: tabs

    @ViewBuilder private var tabContent: some View {
        switch tab {
        case .profile:
            profileSection
            // The web shows the Password card under Profile (Security keeps it too, with passkeys and sessions).
            SecurityCard()
            accountSection
        case .members:
            if let wsId = workspaceId {
                WorkspaceMembersCard(workspaceId: wsId)
            } else {
                EmptyState(icon: "person.2", title: T("No workspace yet"),
                           subtitle: T("Members appear here once you are in a workspace. Ask a BoD or Manager to add you."), compact: true)
            }
        case .notifications:
            AutomationNotificationsCard()
        case .security:
            SecurityCard()
            PasskeyCard()
            ActiveSessionsCard()
        case .appearance:
            AppearanceCard()
            LanguageCard()
            // iPad keyboard / Mac: the list ⌘/ opens (KeyboardShortcutsHelp.swift). A phone has no keyboard to speak of.
            if UIDevice.current.userInterfaceIdiom != .phone { KeyboardShortcutsCard() }
            OfflineCard()
        case .mcp:
            ClaudeMCPCard()
        }
    }

    @ViewBuilder private var profileSection: some View {
        // The web's Profile card head on the phone too (UI tour 13 Oct 2026): "Profile · Visible to your
        // teammates" (no role badge: web has none there, UI tour run 7), then the photo at the left with Change photo / Remove and the size hint
        // (webPhotoRow), instead of a centred avatar with a "Remove photo" link.
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                webCardTitle(T("Profile"), T("Visible to your teammates"))
                Spacer(minLength: 8)
            }
            webPhotoRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .padding(.top, 8)

        // editable profile
        VStack(alignment: .leading, spacing: 14) {
            field(T("Full name")) {
                TextField(T("Your name"), text: $name)
                    .font(NXFont.text(16)).padding(12)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            // Tappable: opens the change-email sheet (ChangeEmailSheet.swift), which owns
            // its own `.sheet` so this view keeps the single one it already has.
            field(T("Email")) { EmailChangeRow(email: $email) }
            // Read-only here: a BoD links it from Control Room, and the person only needs
            // to know which address the company gave them.
            field(T("Google Workspace")) {
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
            // Saved with the name, as on the web (PATCH /api/user/profile {phoneNumber}).
            field(T("Phone number")) {
                VStack(alignment: .leading, spacing: 5) {
                    TextField(T("08xxxxxxxxxx · outside Indonesia, start with + (e.g. +65…)"), text: $phone)
                        .font(NXFont.text(16)).padding(12)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    Text(T("For numbers outside Indonesia, type + and the country code."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
            // Near-black like the web's primary, not the old violet fill.
            Button { Task { await save() } } label: {
                HStack(spacing: 8) {
                    if saving { ProgressView().tint(NX.background) }
                    Text(savedOK ? T("Saved ✓") : T("Save"))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(NXButtonStyle(kind: .primary))
            .frame(minHeight: 44)
            .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .nexusCard()

    }

    @ViewBuilder private var accountSection: some View {
        // account
        VStack(spacing: 0) {
            Button(role: .destructive) { if !auth.signOutIfAllowed() { signOutBlocked = true } } label: {
                HStack {
                    Label(T("Log out"), systemImage: "rectangle.portrait.and.arrow.right")
                        .font(NXFont.text(15, .semibold)).foregroundStyle(NX.danger)
                    Spacer()
                }
                .padding(14)
            }.buttonStyle(.plain)
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .signOutBlockedAlert(isPresented: $signOutBlocked)
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

    }

    // MARK: Web cards (regular width)

    /// The web's Profile card: "Visible to your teammates", the photo with Change photo / Remove and its
    /// hint, Full name | Email side by side, Google Workspace, Phone number, and Save at the right.
    private var webProfileCard: some View {
        NXCard(padding: 24) {
            VStack(alignment: .leading, spacing: 22) {
                HStack(alignment: .top) {
                    webCardTitle(T("Profile"), T("Visible to your teammates"))
                    Spacer(minLength: 8)
                }
                webPhotoRow
                HStack(alignment: .top, spacing: 16) {
                    webField(T("Full name")) {
                        TextField(T("Your name"), text: $name)
                            .textContentType(.name)
                            .modifier(WebInputStyle())
                    }
                    webField(T("Email")) { WebEmailField(email: $email) }
                }
                webField(T("Google Workspace")) {
                    HStack(spacing: 8) {
                        if googleEmail.isEmpty {
                            Text(T("No company Google account linked yet. A BoD links it from Control Room."))
                                .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                        } else {
                            Image(systemName: "at").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.foreground)
                            Text(googleEmail).font(NXFont.text(15, .medium)).foregroundStyle(NX.foreground)
                                .lineLimit(1).truncationMode(.middle)
                                .textSelection(.enabled)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                    .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                }
                webField(T("Phone number")) {
                    VStack(alignment: .leading, spacing: 5) {
                        TextField(T("08xxxxxxxxxx · outside Indonesia, start with + (e.g. +65…)"), text: $phone)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .modifier(WebInputStyle())
                        Text(T("For numbers outside Indonesia, type + and the country code."))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                }
                Divider().overlay(NX.border)
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    if savedOK {
                        Text(T("Profile saved.")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.success)
                    }
                    Button { Task { await save() } } label: {
                        HStack(spacing: 6) {
                            if saving { ProgressView().controlSize(.small).tint(NX.background) }
                            Text(T("Save"))
                        }
                    }
                    .buttonStyle(.nxPrimary)
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    .opacity(name.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
                }
            }
        }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private var webPhotoRow: some View {
        HStack(alignment: .center, spacing: 16) {
            AvatarView(url: avatarURL, initial: initial, size: 80)
                .overlay(Circle().strokeBorder(NX.border, lineWidth: 2))
                .overlay {
                    if uploadingPhoto {
                        ZStack {
                            Circle().fill(NX.background.opacity(0.6))
                            ProgressView()
                        }
                    }
                }
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    PhotosPicker(selection: $pickedPhoto, matching: .images, photoLibrary: .shared()) {
                        Label(T("Change photo"), systemImage: "photo.badge.plus")
                    }
                    .buttonStyle(.nxBordered)
                    .disabled(uploadingPhoto)
                    if avatarURL?.isEmpty == false {
                        Button { Task { await removePhoto() } } label: {
                            Label(T("Remove"), systemImage: "trash").foregroundStyle(NX.mutedFg)
                        }
                        .buttonStyle(.nxGhost)
                        .disabled(uploadingPhoto)
                    }
                }
                Text(T("PNG, JPG or WEBP. Max 5 MB.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                if let photoError {
                    Text(photoError).font(NXFont.text(12)).foregroundStyle(NX.danger)
                }
                if uploadProgress.isActive {
                    UploadProgressBar(progress: uploadProgress).frame(maxWidth: 180)
                }
            }
            Spacer(minLength: 0)
        }
    }

    /// The web's Delete account card: what it does, and the red button at its right.
    private var webDeleteCard: some View {
        NXCard(padding: 24) {
            VStack(alignment: .leading, spacing: 12) {
                Text(T("Delete account")).font(NXFont.text(16, .semibold)).foregroundStyle(NX.danger)
                Text(T("Permanently delete your NEXUS account. You won't be able to sign in again, and this can't be undone."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Spacer(minLength: 0)
                    Button { showDeleteAccount = true } label: { Label(T("Delete account"), systemImage: "trash") }
                        .buttonStyle(.nxDestructive)
                }
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.danger.opacity(0.4)))
    }

    /// Logout, which the web keeps in its sidebar footer: a card of its own here, after Delete account.
    private var webLogoutCard: some View {
        NXCard(padding: 20) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Log out")).font(NXFont.text(16, .semibold)).foregroundStyle(NX.foreground)
                    Text(T("Sign out of NEXUS on this device.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 8)
                Button { if !auth.signOutIfAllowed() { signOutBlocked = true } } label: {
                    Label(T("Log out"), systemImage: "rectangle.portrait.and.arrow.right").foregroundStyle(NX.danger)
                }
                .buttonStyle(.nxBordered)
            }
        }
        .signOutBlockedAlert(isPresented: $signOutBlocked)
    }

    private func webCardTitle(_ title: String, _ subtitle: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(NXFont.text(17, .semibold)).foregroundStyle(NX.foreground)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                Text(subtitle).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    private func webField<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            // Sentence case, as the web's form labels (no tracked capitals).
            Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
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
        if let number = try? await APIClient.shared.profilePhoneNumber() { phone = number }
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
        do {
            // Name and phone number together, as the web's Save; the field shows the number as stored.
            let stored = try await APIClient.shared.updateProfile(name: v, phoneNumber: phone)
            phone = stored ?? ""
            savedOK = true
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            saveError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save your profile.")
        }
    }
}


/// The Settings tabs, in the web's order.
enum SettingsTab: String, CaseIterable, Identifiable {
    case profile, members, notifications, security, appearance, mcp
    var id: String { rawValue }
    var label: String {
        switch self {
        case .profile: return T("Profile")
        case .members: return T("Members")
        case .notifications: return T("Notifications")
        case .security: return T("Security")
        case .appearance: return T("Appearance")
        case .mcp: return T("Claude (MCP)")
        }
    }
    var icon: String {
        switch self {
        case .profile: return "person"
        case .members: return "person.2"
        case .notifications: return "bell"
        case .security: return "lock"
        case .appearance: return "paintpalette"
        case .mcp: return "powerplug"
        }
    }
}

/// Claude (MCP): connecting Claude to NEXUS happens on the web, where the access token is made and shown
/// once; the app says what it is and opens the page.
struct ClaudeMCPCard: View {
    @Environment(\.openURL) private var openURL
    @State private var copied = false

    /// The server this app talks to (production, or DEV on a dev build), never a hard-coded prod
    /// address (web settings MCP_URL from the origin, QA BoD R2 B19).
    private var mcpURL: String { Config.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/mcp" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(T("Claude (MCP)"), systemImage: "powerplug").font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
            Text(T("Connect Claude (the app, Claude Code or Claude Desktop) to NEXUS so it can read and update your tasks and pages with your access. The connection token is created on the web, in Settings › Claude (MCP), and shown once."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 4) {
                Text(T("Server URL for Claude")).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                HStack(spacing: 8) {
                    Text(mcpURL)
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.foreground)
                        .lineLimit(1).truncationMode(.middle)
                        .textSelection(.enabled)
                    Spacer(minLength: 4)
                    Button {
                        UIPasteboard.general.string = mcpURL
                        copied = true
                    } label: {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(copied ? T("Copied") : T("Copy"))
                }
                .padding(.leading, 12)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NX.border))
            }
            Button {
                if let url = URL(string: Config.baseURL.absoluteString + "/settings") { openURL(url) }
            } label: {
                Label(T("Open on the web"), systemImage: "arrow.up.right.square")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }
}


/// The web's text input (settings.tsx): a bordered box on the page colour, 15 pt.
private struct WebInputStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(NXFont.text(15))
            .textFieldStyle(.plain)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
    }
}

/// The web's Email field: the address in a read-only box and a bordered Change beside it, which opens
/// the same two-step sheet as the phone's row (ChangeEmailSheet). Owns that sheet, so SettingsView keeps
/// its one `.sheet`.
private struct WebEmailField: View {
    @Binding var email: String
    @State private var changing = false

    var body: some View {
        HStack(spacing: 8) {
            // Wraps before it cuts: "qa5...invalid" told nobody which address it was (UI tour run 9, P9).
            // It no longer shrinks: a smaller font than Full name beside it looked broken (run 13, I-23).
            Text(email.isEmpty ? "—" : email)
                .font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
                .lineLimit(2).truncationMode(.middle)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            Button(T("Change")) { changing = true }
                .buttonStyle(.nxBordered)
                .accessibilityHint(T("Change the email you sign in with"))
        }
        .sheet(isPresented: $changing) {
            ChangeEmailSheet(current: email) { email = $0 }
        }
    }
}
