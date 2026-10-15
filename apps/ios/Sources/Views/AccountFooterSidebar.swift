import SwiftUI

// The iPad / Mac sidebar's fixed chrome, matched to the dev web's AppSidebar.tsx (Mac parity, 13 Oct 2026):
//
//   header   NEXUS logo + "NEXUS / Phaëthon" + collapse button, then a "Search… ⌘K" field-like row
//   footer   avatar + name / email, theme toggle, keyboard shortcuts, language EN / ID, log out
//
// "Phaëthon" is the web's fixed product line (AppSidebar.tsx writes it as a literal), not the workspace
// name, so it is a literal here too. The phone keeps its own AccountFooter (RootView.swift) in More.

/// Header of the sidebar: brand row and the search row.
struct SidebarBrandHeader: View {
    let onCollapse: () -> Void
    let onSearch: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                HStack(spacing: 10) {
                    Image("NexusLogo")
                        .resizable().scaledToFit()
                        .frame(width: 30, height: 30)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: "NEXUS")
                            .font(NXFont.text(15, .semibold))
                            .foregroundStyle(NX.foreground)
                        Text(verbatim: "Phaëthon")
                            .font(NXFont.text(12))
                            .foregroundStyle(NX.mutedFg)
                    }
                    .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 4)
                SidebarIconButton(systemImage: "sidebar.leading", label: T("Collapse sidebar"), action: onCollapse)
            }
            .padding(.horizontal, 10)

            Button(action: onSearch) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13, weight: .regular))
                    Text(T("Search…"))
                        .font(NXFont.text(14))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(verbatim: "⌘K")
                        .font(NXFont.text(11, .medium))
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
                .foregroundStyle(NX.mutedFg)
                .padding(.horizontal, 10)
                .frame(minHeight: 34)
                .background(NX.background.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .padding(.horizontal, 10)
            .accessibilityLabel(T("Search"))
        }
        .padding(.top, 8)
        .padding(.bottom, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
    }
}

/// Footer of the sidebar: who is signed in and the four quick controls the web keeps there.
struct SidebarAccountFooter: View {
    /// Opens the profile (Settings), as the old footer card did.
    let onOpenProfile: () -> Void
    /// Opens the keyboard shortcuts sheet (the same one ⌘/ opens).
    let onShortcuts: () -> Void
    @Environment(AuthStore.self) private var auth
    @Environment(\.colorScheme) private var scheme
    @State private var appearance = AppAppearance.shared
    @State private var language = AppLanguage.shared
    /// The Keychain session has no avatar: fetched once for the photo.
    @State private var avatar: String?
    @State private var signOutBlocked = false

    var body: some View {
        HStack(spacing: 6) {
            if let s = auth.session {
                let name = s.userName.isEmpty ? s.userEmail : s.userName
                Button(action: onOpenProfile) {
                    HStack(spacing: 8) {
                        AvatarView(url: avatar, initial: String(name.first ?? "?").uppercased(), size: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(name).font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                            Text(s.userEmail).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint(T("Settings"))
            } else {
                Spacer(minLength: 0)
            }
            // The web flips between light and dark from whatever is showing now.
            SidebarIconButton(systemImage: scheme == .dark ? "sun.max" : "moon",
                              label: scheme == .dark ? T("Light mode") : T("Dark mode")) {
                appearance.theme = scheme == .dark ? .light : .dark
            }
            SidebarIconButton(systemImage: "keyboard", label: T("Keyboard shortcuts"), action: onShortcuts)
            Button {
                language.lang = language.lang == .id ? .en : .id
            } label: {
                HStack(spacing: 2) {
                    Image(systemName: "translate").font(.system(size: 12, weight: .regular))
                    Text(verbatim: language.lang == .id ? "ID" : "EN").font(NXFont.text(11, .bold)).monospacedDigit()
                }
                .foregroundStyle(NX.mutedFg)
                .frame(minWidth: 32, minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel(T("Language"))
            // The same rule as everywhere else in the app: no sign-out during a running workday.
            SidebarIconButton(systemImage: "rectangle.portrait.and.arrow.right", label: AppLanguage.signOutOwn, tint: NX.mutedFg) {
                if !auth.signOutIfAllowed() { signOutBlocked = true }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .overlay(alignment: .top) { Rectangle().fill(NX.border).frame(height: 1) }
        .task(id: auth.session?.userId) { avatar = try? await APIClient.shared.profile().user.avatar }
        .signOutBlockedAlert(isPresented: $signOutBlocked)
    }
}

/// A quiet 32 pt icon button (web: h-7 w-7 ghost icon buttons in the sidebar header / footer).
struct SidebarIconButton: View {
    let systemImage: String
    let label: String
    var tint: Color = NX.mutedFg
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .help(label)
        .accessibilityLabel(label)
    }
}
