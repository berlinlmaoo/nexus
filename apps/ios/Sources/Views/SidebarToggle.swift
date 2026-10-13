import SwiftUI

// The iPad / Mac sidebar toggle, the way Notion does it (owner, 14 Oct 2026):
// - sidebar open: the only control is the panel icon in the sidebar's own header (SidebarBrandHeader);
// - sidebar closed: a small ≡ sits inline right before the page title (NXPageHeader, the project header,
//   Dashboard, Calendar, GIDEON) and opens it again;
// - ⌘\ toggles it from anywhere (SidebarRoot);
// - a pointer resting on ≡ peeks the sidebar as a floating panel that goes away when the pointer leaves.
// The old round handle floating in the gutter between the sidebar and the page is gone.

/// What the detail column needs to know about the sidebar. nil on the phone (there is no sidebar).
struct SidebarControl {
    /// True while the sidebar is collapsed (`.detailOnly`).
    var collapsed: Bool
    /// Opens or closes the sidebar, animated.
    var toggle: () -> Void
    /// Shows (true) the floating peek panel while the sidebar is collapsed.
    var peek: (Bool) -> Void
}

private struct SidebarControlKey: EnvironmentKey {
    static let defaultValue: SidebarControl? = nil
}

extension EnvironmentValues {
    var sidebarControl: SidebarControl? {
        get { self[SidebarControlKey.self] }
        set { self[SidebarControlKey.self] = newValue }
    }
}

/// The ≡ in front of a page title. Draws nothing unless the sidebar is collapsed, so a header can always
/// include it.
struct SidebarReopenButton: View {
    @Environment(\.sidebarControl) private var control

    var body: some View {
        if let control, control.collapsed {
            Button { control.toggle() } label: {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(NX.mutedFg)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            // Notion: resting the pointer on ≡ shows the sidebar floating over the page.
            .onHover { inside in if inside { control.peek(true) } }
            .help(T("Show sidebar") + "  ⌘\\")
            .accessibilityLabel(T("Show sidebar"))
        }
    }
}

/// For a screen that keeps its navigation bar: ≡ as the bar's first item while the sidebar is collapsed,
/// and no empty item otherwise.
struct SidebarReopenToolbar: ViewModifier {
    @Environment(\.sidebarControl) private var control

    func body(content: Content) -> some View {
        content.toolbar {
            if control?.collapsed == true {
                ToolbarItem(placement: .topBarLeading) { SidebarReopenButton() }
            }
        }
    }
}
