import SwiftUI

// The dev web's page chrome (apps/nexus-lovable-ui/src/components/PageHeader.tsx + components/ui/button.tsx),
// for the regular width (iPad landscape, Mac): a left-aligned title (text-2xl semibold) with a one-line muted
// subtitle, actions at the right as bordered buttons (h-9, rounded-md, text-sm medium), the primary action
// near-black (web --primary #202023) — not violet — and a hairline under the header. On the phone screens
// keep their native navigation bar; use `NXPageHeader` only where `horizontalSizeClass == .regular`.

/// One page header. `actions` are typically `NXButton`s.
struct NXPageHeader<Actions: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(NXFont.text(26, .semibold))
                        .foregroundStyle(NX.foreground)
                        .lineLimit(1)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(NXFont.text(14))
                            .foregroundStyle(NX.mutedFg)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 12)
                HStack(spacing: 8) { actions() }
                    .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.horizontal, 32)
            .padding(.top, 24)
            .padding(.bottom, 14)
            Rectangle().fill(NX.border).frame(height: 1)
        }
        .background(NX.background)
    }
}

extension NXPageHeader where Actions == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
        self.actions = { EmptyView() }
    }
}

/// The web's buttons: `.primary` = near-black fill, `.bordered` = outline on the card, `.ghost` = text only.
struct NXButtonStyle: ButtonStyle {
    enum Kind { case primary, bordered, ghost, destructive }
    var kind: Kind = .bordered
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        NXButtonBody(configuration: configuration, kind: kind, compact: compact)
    }
}

/// The styled label; a separate view so it can read `isEnabled` (disabled buttons dim, like the web's 50%).
private struct NXButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let kind: NXButtonStyle.Kind
    let compact: Bool
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(NXFont.text(compact ? 13 : 14, .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, compact ? 10 : 14)
            .frame(minHeight: compact ? 30 : 36)
            .background(background(pressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
                if kind == .bordered {
                    RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(NX.border)
                }
            }
            .contentShape(Rectangle())
            .opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.5)
    }

    private var foreground: Color {
        switch kind {
        case .primary: return NX.background
        case .destructive: return .white
        case .bordered, .ghost: return NX.foreground
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .primary: return NX.onyx.opacity(pressed ? 0.9 : 1)
        case .destructive: return NX.danger.opacity(pressed ? 0.9 : 1)
        case .bordered: return pressed ? NX.muted : NX.card
        case .ghost: return pressed ? NX.muted : .clear
        }
    }
}

extension ButtonStyle where Self == NXButtonStyle {
    static var nxPrimary: NXButtonStyle { NXButtonStyle(kind: .primary) }
    static var nxBordered: NXButtonStyle { NXButtonStyle(kind: .bordered) }
    static var nxGhost: NXButtonStyle { NXButtonStyle(kind: .ghost) }
    static var nxDestructive: NXButtonStyle { NXButtonStyle(kind: .destructive) }
}

/// A content card like the web's (`rounded-xl border bg-card`): hairline border, no heavy shadow.
struct NXCard<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
    }
}
