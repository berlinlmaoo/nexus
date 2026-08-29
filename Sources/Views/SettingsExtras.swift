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
        }
        .padding(10).background(NX.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func memberRow(_ m: WorkspaceRoster.Member) -> some View {
        HStack(spacing: 10) {
            AvatarView(url: m.avatarURL, initial: m.initial, size: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let e = m.emailText, !e.isEmpty { Text(e).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            Spacer(minLength: 6)
            if canEditTier(viewerRole, m.role) {
                Menu {
                    ForEach(assignableRoles(viewerRole), id: \.self) { r in
                        Button(orgRoleLabel(r)) { Task { await setRole(m, r) } }
                    }
                    Divider()
                    Button(role: .destructive) { Task { await remove(m) } } label: { Label("Keluarin", systemImage: "person.badge.minus") }
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
        busy = true; err = nil; defer { busy = false }
        do { try await APIClient.shared.inviteWorkspaceMember(email: inviteEmail.trimmingCharacters(in: .whitespaces), role: inviteRole, workspaceId: workspaceId); inviteEmail = ""; await load() }
        catch { err = T("Couldn't invite member.") }
    }
    private func setRole(_ m: WorkspaceRoster.Member, _ role: String) async {
        guard let id = m.id else { return }
        try? await APIClient.shared.updateWorkspaceMemberRole(memberId: id, role: role, workspaceId: workspaceId); await load()
    }
    private func remove(_ m: WorkspaceRoster.Member) async {
        guard let id = m.id else { return }
        try? await APIClient.shared.removeWorkspaceMember(memberId: id, workspaceId: workspaceId); await load()
    }
}

// MARK: - Language

/// In-app language switch. Reads/writes the shared @Observable store, so picking a language
/// re-renders every screen immediately — no relaunch, unlike the system-locale mechanism.
struct LanguageCard: View {
    @State private var store = AppLanguage.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("LANGUAGE")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
            Text(T("Applies immediately across the whole app."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            ForEach(AppLang.allCases) { l in
                Button { store.lang = l } label: {
                    HStack(spacing: 10) {
                        Text(l.flag).font(.system(size: 20))
                        Text(l.label).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                        Spacer(minLength: 0)
                        Image(systemName: store.lang == l ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(store.lang == l ? NX.violetText : NX.mutedFg.opacity(0.4))
                    }
                    .padding(.vertical, 9).padding(.horizontal, 11)
                    .background(store.lang == l ? NX.violet.opacity(0.10) : Color.clear,
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
            Text(T("APPEARANCE")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
            HStack(spacing: 8) {
                ForEach(AppTheme.allCases) { t in
                    let on = store.theme == t
                    Button { store.theme = t } label: {
                        VStack(spacing: 6) {
                            Image(systemName: t.icon).font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(on ? Color.white : NX.mutedFg)
                            Text(t.label).font(NXFont.text(11, .semibold))
                                .foregroundStyle(on ? Color.white : NX.mutedFg)
                                .lineLimit(1).minimumScaleFactor(0.75)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(on ? NX.violet : NX.muted.opacity(0.5),
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
struct PushDiagnosticsCard: View {
    @State private var status: UNAuthorizationStatus = .notDetermined
    @State private var token: String?
    @State private var environment = ""
    @State private var apnsError: String?
    @State private var backendError: String?
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("PUSH NOTIFICATIONS")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)

            line(T("Permission"), permissionText, permissionTone)
            line(T("APNs environment"), environment.isEmpty ? "—" : environment, .neutral)
            // The token comes from Apple; this line reaching "ok" proves the entitlement and the
            // provisioning profile are right, with our backend not involved at all.
            line(T("Apple"), apnsError == nil ? (token == nil ? T("Waiting for token…") : "ok") : T("Failed"),
                 apnsError == nil ? (token == nil ? .warning : .success) : .danger)
            // Separate line on purpose: Apple can be perfectly happy while our own server refuses
            // to store the token, and those two failures need completely different fixes.
            line(T("NEXUS server"), backendError ?? "ok", backendError == nil ? .success : .danger)

            if let apnsError {
                Text(apnsError).font(NXFont.text(11)).foregroundStyle(NX.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider().overlay(NX.border)

            Text(T("Device token")).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
            if let token {
                Text(token).font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.foreground)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button {
                    UIPasteboard.general.string = token
                    copied = true
                } label: {
                    Label(copied ? T("Copied ✓") : T("Copy token"), systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(NXFont.text(12, .bold)).foregroundStyle(NX.violetText)
                }
                .buttonStyle(.plain)
            } else {
                Text(T("No token yet. Allow notifications, then reopen this screen."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
        .task { await refresh() }
    }

    private func line(_ label: String, _ value: String, _ tone: ChipTone) -> some View {
        HStack(alignment: .top) {
            Text(label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 8)
            Text(value).font(NXFont.text(12, .semibold)).foregroundStyle(tone.fg)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var permissionText: String {
        switch status {
        case .authorized: return T("Allowed")
        case .provisional: return T("Quiet delivery")
        case .denied: return T("Blocked in iOS Settings")
        case .notDetermined: return T("Not asked yet")
        default: return T("Unknown")
        }
    }
    private var permissionTone: ChipTone {
        switch status {
        case .authorized, .provisional: return .success
        case .denied: return .danger
        default: return .warning
        }
    }

    private func refresh() async {
        status = await NotificationManager.shared.authorizationStatus()
        token = NotificationManager.shared.deviceToken
        environment = NotificationManager.shared.environmentName
        apnsError = NotificationManager.shared.registrationError
        backendError = NotificationManager.shared.backendError
    }
}

// MARK: - Security (change own password)

struct SecurityCard: View {
    @State private var current = ""
    @State private var new1 = ""
    @State private var new2 = ""
    @State private var busy = false
    @State private var msg: (text: String, ok: Bool)?

    private var valid: Bool { !current.isEmpty && new1.count >= 6 && new1 == new2 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("SECURITY").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
            secureField(T("Current password"), $current)
            secureField(T("New password (min 6)"), $new1)
            secureField(T("Repeat new password"), $new2)
            if let msg { Text(msg.text).font(NXFont.text(12, .semibold)).foregroundStyle(msg.ok ? NX.success : NX.danger) }
            Button { Task { await change() } } label: {
                HStack(spacing: 6) { if busy { ProgressView().scaleEffect(0.7).tint(.white) }; Text(T("Change password")) }
                    .font(NXFont.text(13, .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 10).background(valid ? NX.violet : NX.mutedFg.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain).disabled(busy || !valid)
        }
        .nexusCard()
    }

    private func secureField(_ ph: String, _ text: Binding<String>) -> some View {
        SecureField(ph, text: text).font(NXFont.text(14)).padding(10)
            .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    private func change() async {
        busy = true; msg = nil; defer { busy = false }
        do { try await APIClient.shared.changePassword(current: current, new: new1); msg = (T("Password changed ✓"), true); current = ""; new1 = ""; new2 = "" }
        catch { msg = (T("Failed — check your current password."), false) }
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
                CachedImage(url: resolved) { img in img.resizable().scaledToFill() } placeholder: { initialText }
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
