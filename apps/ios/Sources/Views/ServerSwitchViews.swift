import SwiftUI

// The server switch (owner, 12 Oct 2026; branch `dev` only, behind the NEXUS_DEV_SERVER build flag):
// Production or the DEV server over Tailscale, so features that exist only on DEV can be tried in the
// app. Everything here draws nothing when the build cannot switch (ServerEnvironment.isAvailable).

enum ServerSwitch {
    /// Signs out (the two servers know different sessions), then points every request at `env`.
    /// The sign-out request is built before the switch, so it ends the session on the server it belongs to.
    @MainActor
    static func apply(_ env: ServerEnvironment, auth: AuthStore) {
        guard ServerEnvironment.isAvailable, env != ServerEnvironment.current else { return }
        if auth.session != nil { auth.signOut() }
        ServerEnvironment.set(env)
        // A realtime socket still open to the old host must not outlive the switch.
        RealtimeClient.shared.reset()
    }

    static func label(_ env: ServerEnvironment) -> String {
        switch env {
        case .production: return T("Production")
        case .dev: return T("Dev (Tailscale)")
        }
    }
}

/// Tuning Room card: which server, and the switch. Switching asks first, because it signs out.
struct ServerSwitchCard: View {
    @Environment(AuthStore.self) private var auth
    @State private var pending: ServerEnvironment?

    var body: some View {
        if ServerEnvironment.isAvailable {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "server.rack").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.violetText)
                    Text(T("Server")).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                    Spacer(minLength: 0)
                    if ServerEnvironment.isDev { DevServerBadge.pill }
                }
                Picker(T("Server"), selection: Binding(get: { ServerEnvironment.current }, set: { pending = $0 })) {
                    ForEach(ServerEnvironment.allCases) { Text(ServerSwitch.label($0)).tag($0) }
                }
                .pickerStyle(.segmented)
                Text(T("Dev needs Tailscale on this device. Switching signs you out, because the two servers have separate sessions."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            // The Settings cards' own chrome: flat, 24 pt inside, so its text starts where theirs does (UI tour
            // run 19, R19-B-12: a shadow and a different inset on this card only).
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            .alert(T("Switch server?"), isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })) {
                Button(T("Cancel"), role: .cancel) { pending = nil }
                Button(T("Switch and sign out")) {
                    if let env = pending { ServerSwitch.apply(env, auth: auth) }
                    pending = nil
                }
            } message: {
                Text(String(format: T("NEXUS will use %@. You'll sign in again there."), ServerSwitch.label(pending ?? .production)))
            }
        }
    }
}

/// The mark over the whole app while it talks to the DEV server, so a screenshot or a test can never be
/// mistaken for production: an orange edge along the very top of the window, in the status bar's row.
/// It was the "DEV" pill floating under the status bar, and on every iPhone screen it sat on the
/// navigation title ("Ca[DEV]dar", UI tour run 5). The pill stays where there is room for it: the login
/// screen and Settings' server card. Not interactive.
struct DevServerBadge: View {
    static var pill: some View {
        Text("DEV")
            .font(NXFont.text(10, .heavy)).tracking(1)
            .foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Color.orange, in: Capsule())
            .accessibilityLabel(T("Dev server"))
    }

    var body: some View {
        if ServerEnvironment.isDev {
            Rectangle()
                .fill(Color.orange)
                .frame(maxWidth: .infinity)
                .frame(height: 3)
                .ignoresSafeArea(edges: .top)
                .allowsHitTesting(false)
                .accessibilityLabel(T("Dev server"))
        }
    }
}

/// Login screen: a long press on the title picks the server before signing in (dev builds only).
struct LoginServerSwitch: ViewModifier {
    @State private var asking = false
    /// Re-renders the screen after a switch, which `ServerEnvironment` itself does not publish.
    @State private var current = ServerEnvironment.current

    @ViewBuilder
    func body(content: Content) -> some View {
        if ServerEnvironment.isAvailable {
            VStack(spacing: 8) {
                content
                    .onLongPressGesture(minimumDuration: 0.8) { asking = true }
                if current == .dev {
                    HStack(spacing: 6) {
                        DevServerBadge.pill
                        Text(ServerSwitch.label(.dev)).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    }
                }
            }
            .alert(T("Server"), isPresented: $asking) {
                ForEach(ServerEnvironment.allCases) { env in
                    Button(ServerSwitch.label(env) + (env == current ? " ✓" : "")) {
                        ServerEnvironment.set(env)
                        RealtimeClient.shared.reset()
                        current = env
                    }
                }
                Button(T("Cancel"), role: .cancel) {}
            } message: {
                Text(T("Dev needs Tailscale on this device."))
            }
        } else {
            content
        }
    }
}

/// Tuning Room → Notifications (DEV server, 12 Oct 2026): "Automation notifications". Off = what an
/// automation's "Send notification" says lands in the Inbox only, without a push. Default on. Drawn only
/// with explicit loading, failure and unsupported-server states.
struct AutomationNotificationsCard: View {
    @State private var on: Bool?
    @State private var saving = false
    @State private var failed = false
    @State private var loading = true
    @State private var loadFailed = false

    var body: some View {
        Group {
            if let value = on {
                VStack(alignment: .leading, spacing: 8) {
                    Text(T("Notifications")).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                    Toggle(isOn: Binding(get: { value }, set: { v in Task { await save(v) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Label(T("Automation notifications"), systemImage: "bolt.fill")
                                .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                            Text(T("Pushes from project automations. Off: they still land in your Inbox."))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(NX.violet)
                    .disabled(saving)
                    if failed {
                        Text(T("Couldn't change it.")).font(NXFont.text(12)).foregroundStyle(NX.danger)
                    }
                }
                .nexusCard()
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Text(T("Notifications")).font(NXFont.text(15, .bold))
                    if loading {
                        HStack { ProgressView(); Text(T("Loading…")) }
                            .accessibilityIdentifier("notifications.loading")
                    } else if loadFailed {
                        Text(T("Couldn't load notification preferences.")).foregroundStyle(NX.danger)
                        Button(T("Retry")) { Task { await load() } }
                            .buttonStyle(.nxBordered).accessibilityIdentifier("notifications.retry")
                    } else {
                        Text(T("Automation notification preferences aren't available on this server."))
                            .foregroundStyle(NX.mutedFg)
                    }
                }.font(NXFont.text(13)).frame(maxWidth: .infinity, alignment: .leading).nexusCard()
            }
        }
        .task { await load() }
    }

    @MainActor private func load() async {
        loading = true; loadFailed = false
        defer { loading = false }
        do { on = try await APIClient.shared.notificationPrefs().automation }
        catch { loadFailed = true }
    }

    private func save(_ v: Bool) async {
        let before = on
        on = v; saving = true; failed = false
        do { try await APIClient.shared.setAutomationNotifications(v) }
        catch { on = before; failed = true }
        saving = false
    }
}
