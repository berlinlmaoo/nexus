import SwiftUI

// Mac / iPad parity for the sidebar's root pages (owner's Mac notes, 13 Oct 2026: "every screen has a
// centred small nav title and floating circle buttons; the web has a left-aligned page header").
//
// In regular width, when a screen is the one the sidebar has selected, it draws `NXPageHeader` (title,
// subtitle, actions at the right) and hides its navigation bar. The same screen pushed from somewhere
// else (Home's quick tiles push Attendance, Leaderboard, Threads and Tickets) keeps its bar and its
// Back button, and the phone keeps its native bar everywhere.

enum NXSidebarPage {
    /// True only when `screen` is the sidebar's current selection in a regular-width layout.
    @MainActor
    static func isRoot(_ screen: NXScreen, hSize: UserInterfaceSizeClass?, router: AppRouter) -> Bool {
        hSize == .regular && router.sidebarScreen == screen
    }

    /// Page gutters of the web's PageBody (`p-4 md:p-8`): 32 under a page header, 16 on the phone.
    static func gutter(_ root: Bool) -> CGFloat { root ? 32 : 16 }
}

extension View {
    /// Puts `header` above the screen and hides the navigation bar while `active`. Always the same
    /// VStack so a size-class change (iPad multitasking) does not rebuild the screen's state.
    /// `phoneSubtitle`: the page header's subtitle, drawn under the navigation bar while the header is not
    /// (iPhone, pushed screens), so the phone reads the same line as the web (UI tour 13 Oct 2026).
    func nxSidebarPageChrome<Header: View>(_ active: Bool, phoneSubtitle: String? = nil,
                                           @ViewBuilder header: () -> Header) -> some View {
        modifier(NXSidebarPageChrome(active: active, phoneSubtitle: phoneSubtitle, header: header()))
    }
}

struct NXSidebarPageChrome<Header: View>: ViewModifier {
    let active: Bool
    var phoneSubtitle: String? = nil
    let header: Header

    func body(content: Content) -> some View {
        VStack(spacing: 0) {
            if active {
                header
            } else if let phoneSubtitle, !phoneSubtitle.isEmpty {
                NXPhoneSubtitle(text: phoneSubtitle)
            }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(NX.background.ignoresSafeArea())
        .toolbar(active ? .hidden : .automatic, for: .navigationBar)
    }
}

/// The web page header's subtitle on the iPhone: one or two muted lines under the navigation bar's title,
/// left-aligned on the 16 pt phone gutter (web PageHeader subtitle, UI tour 13 Oct 2026).
struct NXPhoneSubtitle: View {
    let text: String

    var body: some View {
        Text(text)
            .font(NXFont.text(14))
            .foregroundStyle(NX.mutedFg)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 2)
            .padding(.bottom, 8)
            .background(NX.background)
    }
}

/// The web's tabs row under a page header (PageHeader `tabs`): underline tabs lined up with the title.
struct NXPageTabsRow<ID: Hashable>: View {
    let items: [NXTabItem<ID>]
    @Binding var selection: ID
    var accessibilityName: String = ""

    var body: some View {
        // NXUnderlineTabs pads 12 and each tab 10: 10 more puts the first label under the title (32). The
        // hairline starts there too, with the page's content, not 22 pt left of it (UI tour run 16, R16-I-31).
        NXUnderlineTabs(items: items, selection: $selection, accessibilityName: accessibilityName, dividerLeading: 22)
            .padding(.leading, 10)
            .background(NX.background)
    }
}

/// The header's search box (web `Input` h-9 w-56/w-64 with a leading magnifier).
struct NXHeaderSearchField: View {
    let prompt: String
    @Binding var text: String
    var width: CGFloat = 256

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
            TextField(prompt, text: $text)
                .font(NXFont.text(14))
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Clear search"))
            }
        }
        .padding(.horizontal, 10)
        .frame(width: width, height: 36)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(NX.border))
    }
}

/// An icon-only header button (web `Button isIconOnly size="sm"`), filled when `on`.
struct NXHeaderIconToggle: View {
    let systemImage: String
    let label: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage).font(.system(size: 14, weight: .medium))
                .frame(width: 12)
        }
        .buttonStyle(NXButtonStyle(kind: on ? .primary : .bordered))
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
