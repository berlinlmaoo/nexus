import SwiftUI
import UIKit
import UserNotifications

// MARK: - org role helpers (port of nexus-api assignableRoles / canEditTier)

let orgHierarchy: [String: Int] = ["ONE_ABOVE_ALL": 4, "BOD": 3, "MANAGER": 2, "STAFF": 1]
let orgRoles = ["ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF"]

func assignableRoles(_ viewer: String?) -> [String] {
    let t = orgHierarchy[viewer ?? ""] ?? 0
    if t < 3 { return [] }
    return orgRoles.filter { t == 4 || t > (orgHierarchy[$0] ?? 0) }
}
func canEditTier(_ viewer: String?, _ target: String?) -> Bool {
    let t = orgHierarchy[viewer ?? ""] ?? 0
    if t < 3 { return false }
    return t == 4 || (orgHierarchy[target ?? ""] ?? 0) < t
}
func orgRoleLabel(_ r: String?) -> String {
    switch (r ?? "").uppercased() {
    case "ONE_ABOVE_ALL": return "One Above All"; case "BOD": return "BoD"
    case "MANAGER": return "Manager"; case "STAFF": return "Staff"; default: return r ?? "—"
    }
}

// MARK: - Workspace members (invite / change role / remove)

struct WorkspaceMembersCard: View {
    let workspaceId: String
    @State private var members: [WorkspaceRoster.Member] = []
    @State private var viewerRole: String?
    @State private var loading = true
    @State private var inviteEmail = ""
    @State private var inviteRole = "STAFF"
    @State private var busy = false
    @State private var err: String?
    /// What the last successful invite did, shown under the invite row. Separate from `err` so a
    /// later role change failing does not wipe the confirmation, and vice versa.
    @State private var inviteNotice: InviteNotice?
    @State private var openProfile: ProfileTarget?

    /// Two outcomes worth telling apart: the member is added either way, but only one of them
    /// means the person actually knows about it.
    private struct InviteNotice {
        let text: String
        let emailFailed: Bool
    }

    private var canInvite: Bool { !assignableRoles(viewerRole).isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("MEMBERS").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else {
                if canInvite { inviteRow }
                ForEach(members) { m in memberRow(m) }
                if let err { Text(err).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger) }
            }
        }
        .nexusCard()
        .task { await load() }
        .navigationDestination(item: $openProfile) { MemberProfileView(target: $0) }
    }

    private var inviteRow: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                TextField(T("New member's email"), text: $inviteEmail).keyboardType(.emailAddress).autocorrectionDisabled().textInputAutocapitalization(.never)
                    .font(NXFont.text(14)).padding(10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Menu {
                    ForEach(assignableRoles(viewerRole), id: \.self) { r in Button(orgRoleLabel(r)) { inviteRole = r } }
                } label: {
                    Text(orgRoleLabel(inviteRole)).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                        .padding(.horizontal, 10).padding(.vertical, 8).background(NX.violet.opacity(0.12), in: Capsule())
                }
            }
            Button { Task { await invite() } } label: {
                HStack(spacing: 6) { if busy { ProgressView().scaleEffect(0.7).tint(.white) }; Text(T("Invite")) }
                    .font(NXFont.text(13, .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 9).background(NX.violet, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain).disabled(busy || !inviteEmail.contains("@"))
            if let inviteNotice {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: inviteNotice.emailFailed ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.system(size: 12, weight: .semibold))
                    Text(inviteNotice.text).frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(NXFont.text(12, .semibold))
                .foregroundStyle(inviteNotice.emailFailed ? NX.danger : NX.success)
            }
        }
        .padding(10).background(NX.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func memberRow(_ m: WorkspaceRoster.Member) -> some View {
        HStack(spacing: 10) {
            // The role chip below is a Menu for anyone allowed to edit this person, so only the
            // name half becomes the button — a Menu inside a Button's label never gets the tap.
            Button {
                if let uid = m.userId {
                    openProfile = ProfileTarget(userId: uid, name: m.displayName, avatar: m.avatarURL)
                }
            } label: {
                HStack(spacing: 10) {
                    AvatarView(url: m.avatarURL, initial: m.initial, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        if let e = m.emailText, !e.isEmpty { Text(e).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
                    }
                    Spacer(minLength: 6)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(m.userId == nil)
            if canEditTier(viewerRole, m.role) {
                Menu {
                    ForEach(assignableRoles(viewerRole), id: \.self) { r in
                        Button(orgRoleLabel(r)) { Task { await setRole(m, r) } }
                    }
                    Divider()
                    Button(role: .destructive) { Task { await remove(m) } } label: { Label(T("Remove"), systemImage: "person.badge.minus") }
                } label: { RoleChip(role: m.role ?? "STAFF") }
            } else {
                RoleChip(role: m.role ?? "STAFF")
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        if let r = try? await APIClient.shared.roster() { members = r.members ?? []; viewerRole = r.role }
        loading = false
    }
    private func invite() async {
        busy = true; err = nil; inviteNotice = nil; defer { busy = false }
        let typed = inviteEmail.trimmingCharacters(in: .whitespaces)
        do {
            let res = try await APIClient.shared.inviteWorkspaceMember(email: typed, role: inviteRole, workspaceId: workspaceId)
            let who = res.member?.email ?? typed
            // `emailSent` is optional: a server from before it existed says nothing, and the
            // invite email already went out from those — so only an explicit false is a failure.
            if res.emailSent == false {
                inviteNotice = InviteNotice(text: String(format: T("Added %@, but the invite email couldn't be sent."), who),
                                            emailFailed: true)
            } else {
                inviteNotice = InviteNotice(text: String(format: T("Invite sent to %@ — they'll get an email to set their password."), who),
                                            emailFailed: false)
            }
            inviteEmail = ""
            await load()
        } catch {
            // The server's own sentence when it gave one ("User is already a workspace member",
            // a role above yours), rather than one generic line for every refusal.
            err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't invite member.")
        }
    }
    private func setRole(_ m: WorkspaceRoster.Member, _ role: String) async {
        guard let id = m.id else { return }
        do { _ = try await APIClient.shared.updateWorkspaceMemberRole(memberId: id, role: role, workspaceId: workspaceId) }
        catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't change the role.") }
        await load()
    }
    private func remove(_ m: WorkspaceRoster.Member) async {
        guard let id = m.id else { return }
        do { _ = try await APIClient.shared.removeWorkspaceMember(memberId: id, workspaceId: workspaceId) }
        catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't remove the member.") }
        await load()
    }
}

// MARK: - Language

/// In-app language switch. Reads/writes the shared @Observable store, so picking a language
/// re-renders every screen immediately — no relaunch, unlike the system-locale mechanism.
struct LanguageCard: View {
    @State private var store = AppLanguage.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("LANGUAGE")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            Text(T("Applies immediately across the whole app."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            ForEach(AppLang.allCases) { l in
                Button {
                    store.lang = l
                    // The watch follows the phone's language; it only learns it from the context.
                    PhoneSessionBridge.shared.republish()
                } label: {
                    HStack(spacing: 10) {
                        Text(l.flag).font(.system(size: 20))
                        Text(l.label).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                        Spacer(minLength: 0)
                        Image(systemName: store.lang == l ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(store.lang == l ? NX.onyx : NX.mutedFg.opacity(0.4))
                    }
                    .padding(.vertical, 9).padding(.horizontal, 11)
                    .background(store.lang == l ? NX.muted : Color.clear,
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }
}

// MARK: - Appearance

/// In-app light/dark switch, independent of the iOS Settings toggle.
struct AppearanceCard: View {
    @State private var store = AppAppearance.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("APPEARANCE")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            HStack(spacing: 8) {
                ForEach(AppTheme.allCases) { t in
                    let on = store.theme == t
                    Button { store.theme = t } label: {
                        VStack(spacing: 6) {
                            Image(systemName: t.icon).font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(on ? NX.background : NX.mutedFg)
                            Text(t.label).font(NXFont.text(13, .semibold))
                                .foregroundStyle(on ? NX.background : NX.mutedFg)
                                .lineLimit(1).minimumScaleFactor(0.75)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        // The web's primary (near-black) for the chosen theme, not violet.
                        .background(on ? NX.onyx : NX.muted.opacity(0.5),
                                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }
}

// MARK: - Push diagnostics

/// Everything you need to answer "is push actually working on this phone?", because until now
/// nothing in the app could tell you. The APNs token in particular lived only in UserDefaults —
/// and without it you cannot send yourself a test push from Apple's Push Notifications Console.

// MARK: - Security (change own password)

struct SecurityCard: View {
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var current = ""
    @State private var new1 = ""
    @State private var new2 = ""
    @State private var busy = false
    @State private var msg: (text: String, ok: Bool)?

    /// Regular width is the web's Password card: Current | New side by side and Change password at the
    /// right, no repeat field (PasswordSection in settings.tsx). The phone keeps its repeat field.
    private var web: Bool { hSize == .regular }
    private var valid: Bool { !current.isEmpty && new1.count >= 6 && (web || new1 == new2) }

    var body: some View {
        if web { webBody } else { phoneBody }
    }

    private var phoneBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("Password").uppercased()).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            secureField(T("Current password"), $current)
            secureField(T("New password (min 6)"), $new1)
            secureField(T("Repeat new password"), $new2)
            if let msg { Text(msg.text).font(NXFont.text(12, .semibold)).foregroundStyle(msg.ok ? NX.success : NX.danger) }
            // Near-black like the web's primary, not the old violet fill.
            Button { Task { await change() } } label: {
                HStack(spacing: 6) { if busy { ProgressView().scaleEffect(0.7).tint(NX.background) }; Text(T("Change password")) }
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.background)
                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                    // Near-black always; the disabled plain button dims it (web: 50 %). It was white text on
                    // a pale grey fill, dimmed once more by the disabled button: unreadable (UI tour run 5).
                    .background(NX.onyx, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain).disabled(busy || !valid)
        }
        .nexusCard()
    }

    private var webBody: some View {
        NXCard(padding: 24) {
            VStack(alignment: .leading, spacing: 16) {
                Text(T("Password")).font(NXFont.text(17, .semibold)).foregroundStyle(NX.foreground)
                    .accessibilityAddTraits(.isHeader)
                HStack(alignment: .top, spacing: 16) {
                    webSecure(T("Current password"), $current)
                    webSecure(T("New password"), $new1)
                }
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    if let msg {
                        Text(msg.text).font(NXFont.text(13, .semibold)).foregroundStyle(msg.ok ? NX.success : NX.danger)
                    }
                    Button { Task { await change() } } label: {
                        HStack(spacing: 6) {
                            if busy { ProgressView().controlSize(.small).tint(NX.background) }
                            Text(T("Change password"))
                        }
                    }
                    // The style dims a disabled button to 50 % itself; another .opacity(0.5) made it 25 %.
                    .buttonStyle(.nxPrimary)
                    .disabled(busy || !valid)
                }
            }
        }
    }

    private func webSecure(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
            SecureField("", text: text)
                .font(NXFont.text(15))
                .textFieldStyle(.plain)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                .accessibilityLabel(label)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func secureField(_ ph: String, _ text: Binding<String>) -> some View {
        SecureField(ph, text: text).font(NXFont.text(15)).padding(10)
            .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    private func change() async {
        busy = true; msg = nil; defer { busy = false }
        do {
            try await APIClient.shared.changePassword(current: current, new: new1)
            msg = (web ? T("Password updated.") : T("Password changed ✓"), true)
            current = ""; new1 = ""; new2 = ""
        }
        catch { msg = (web ? T("Couldn't change it. Check your current password.") : T("Failed — check your current password."), false) }
    }
}

// MARK: - Passkeys

/// Enrol this device's Face ID / Touch ID as a passkey. Strictly additive: the password form in
/// SecurityCard above keeps working, and nothing here can take it away.
struct PasskeyCard: View {
    @State private var busy = false
    @State private var msg: (text: String, ok: Bool)?
    @State private var passkeys: [PasskeyInfo] = []
    @State private var loading = true
    @State private var loadFailed = false
    /// The row whose revoke button was tapped — this is what presents the confirmation. Revoking
    /// destroys the credential server-side, so it must never happen on a single tap.
    @State private var revokeTarget: PasskeyInfo?
    /// id of the passkey being revoked right now, so only that row shows a spinner.
    @State private var revoking: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("PASSKEYS")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
            Text(T("Sign in with Face ID or Touch ID instead of typing your password. Your password keeps working."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            enrolled
            if let msg {
                Text(msg.text).font(NXFont.text(12, .semibold)).foregroundStyle(msg.ok ? NX.success : NX.danger)
            }
            addButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
        .task { await load() }
        .alert(revokeTitle,
                            isPresented: Binding(get: { revokeTarget != nil }, set: { if !$0 { revokeTarget = nil } })) {
            Button(T("Revoke"), role: .destructive) {
                if let p = revokeTarget { revokeTarget = nil; Task { await revoke(p) } }
            }
            Button(T("Cancel"), role: .cancel) { revokeTarget = nil }
        } message: {
            Text(T("That passkey stops working everywhere it was saved. This cannot be undone."))
        }
    }

    /// Built outside the `.alert(…)` call so the label lookup never has to happen
    /// inside a string interpolation.
    private var revokeTitle: String {
        guard let p = revokeTarget else { return "" }
        return "\(T("Revoke")) \"\(displayLabel(p))\"?"
    }

    /// The enrolled list, its own property because the card's VStack is already close to
    /// ViewBuilder's ten-child ceiling.
    @ViewBuilder
    private var enrolled: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
        } else if loadFailed {
            Text(T("Couldn't load your passkeys."))
                .font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
        } else if passkeys.isEmpty {
            Text(T("No passkeys yet — add one and this device can sign you in with Face ID."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10).padding(.horizontal, 11)
                .background(NX.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            VStack(spacing: 6) { ForEach(passkeys) { p in row(p) } }
        }
    }

    private func row(_ p: PasskeyInfo) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "key.fill").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.violetText)
                .frame(width: 32, height: 32)
                .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(displayLabel(p)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(detail(p)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
            Spacer(minLength: 6)
            Button { revokeTarget = p } label: {
                Group {
                    if revoking == p.id {
                        ProgressView().scaleEffect(0.6).tint(NX.danger)
                    } else {
                        Image(systemName: "trash").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.danger)
                    }
                }
                .frame(width: 30, height: 30)
                .background(NX.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(busy || revoking != nil)
        }
        .padding(.vertical, 6).padding(.horizontal, 8)
        .background(NX.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var addButton: some View {
        Button { Task { await add() } } label: {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().scaleEffect(0.7).tint(.white)
                } else {
                    Image(systemName: "person.badge.key.fill").font(.system(size: 13, weight: .bold))
                }
                Text(T("Add a passkey"))
            }
            .font(NXFont.text(13, .bold)).foregroundStyle(.white)
            .frame(maxWidth: .infinity).padding(.vertical, 10)
            .background(busy ? NX.mutedFg.opacity(0.4) : NX.violet,
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    /// A passkey enrolled from a browser can arrive with no label at all.
    private func displayLabel(_ p: PasskeyInfo) -> String {
        let name = (p.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? T("Unnamed passkey") : name
    }

    /// "Added 3 Sep 2026 · Last used 5 Sep 2026, 09:12" — the ISO strings never reach the screen.
    private func detail(_ p: PasskeyInfo) -> String {
        var parts: [String] = []
        if let added = ProjDate.parse(p.createdAt) {
            parts.append("\(T("Added")) \(ProjDate.fmt("d MMM yyyy").string(from: added))")
        }
        if let used = ProjDate.parse(p.lastUsedAt) {
            parts.append("\(T("Last used")) \(ProjDate.fmt("d MMM yyyy, HH:mm").string(from: used))")
        } else {
            parts.append(T("Never used"))
        }
        return parts.joined(separator: " · ")
    }

    /// `spinner: false` for the refresh after adding or revoking: the list is already on screen and
    /// swapping it for a ProgressView reads as a glitch.
    @MainActor
    private func load(spinner: Bool = true) async {
        if spinner { loading = true }
        defer { loading = false }
        do {
            passkeys = try await APIClient.shared.passkeyList()
            loadFailed = false
        } catch {
            // Keep whatever is already listed; only an empty card gets the error in its place.
            loadFailed = passkeys.isEmpty
        }
    }

    /// @MainActor because PasskeyManager presents system UI, and because `busy`/`msg` are @State.
    @MainActor
    private func add() async {
        busy = true; msg = nil; defer { busy = false }
        do {
            // What the person will see next to this device in the web app's passkey list. iOS gives
            // a generic model name ("iPhone") rather than the user-set device name, which is fine.
            try await PasskeyManager.register(label: UIDevice.current.name)
            msg = (T("Passkey added ✓"), true)
            await load(spinner: false)
        } catch PasskeyError.canceled {
            // Closing Face ID is a decision, not a failure. Say nothing at all.
        } catch {
            msg = ((error as? LocalizedError)?.errorDescription ?? T("Couldn't add the passkey. Try again."), false)
        }
    }

    @MainActor
    private func revoke(_ p: PasskeyInfo) async {
        revoking = p.id; msg = nil
        defer { revoking = nil }
        do {
            try await APIClient.shared.passkeyRevoke(id: p.id)
            msg = (T("Passkey revoked ✓"), true)
        } catch APIError.http(let code, _) where code == 404 {
            // Already gone on the server, so the list was merely stale: the reload below IS the fix,
            // and calling that a failure would be a lie.
        } catch {
            msg = (T("Couldn't revoke the passkey. Try again."), false)
        }
        await load(spinner: false)
    }
}

/// Avatar image (AsyncImage) with an initial fallback.
struct AvatarView: View {
    let url: String?
    let initial: String
    var size: CGFloat = 36
    private var resolved: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL(string: url.hasPrefix("http") ? url : Config.baseURL.absoluteString + url)
    }
    var body: some View {
        ZStack {
            Circle().fill(NX.accentBg)
            if let resolved {
                // A face stays a face under Smart Invert.
                CachedImage(url: resolved) { img in img.resizable().scaledToFill().accessibilityIgnoresInvertColors() } placeholder: { initialText }
                    .clipShape(Circle())
            } else { initialText }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(NX.border, lineWidth: 0.5))
    }
    private var initialText: some View {
        Text(initial).font(NXFont.text(size * 0.36, .bold)).foregroundStyle(NX.violetText)
    }
}
