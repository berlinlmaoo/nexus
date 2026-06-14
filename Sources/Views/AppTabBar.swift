import SwiftUI

/// Drives the tab bar's scroll-shrink. Tab roots feed their scroll offset; the bar reads `compact`
/// and scales down while the user scrolls down (back to full near the top).
@Observable final class TabBarShrink {
    var compact = false
    private var last: CGFloat = 0
    func update(_ y: CGFloat) {
        if y < 40 { compact = false; last = y; return }   // near the top → always full size
        let dy = y - last
        if dy > 8 { compact = true }            // scrolling down → shrink
        else if dy < -8 { compact = false }     // scrolling up → grow back
        last = y
    }
}

private struct TabBarShrinkKey: EnvironmentKey {
    static let defaultValue = TabBarShrink()   // shared default → reading without injection is harmless
}
extension EnvironmentValues {
    var tabBarShrink: TabBarShrink {
        get { self[TabBarShrinkKey.self] }
        set { self[TabBarShrinkKey.self] = newValue }
    }
}

extension View {
    /// Feed a tab root's vertical scroll offset to the shrink model (iOS 18+; no-op below).
    @ViewBuilder func tracksTabBarShrink(_ model: TabBarShrink) -> some View {
        if #available(iOS 18.0, *) {
            onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y } action: { _, y in model.update(y) }
        } else {
            self
        }
    }

    /// iOS 26 Liquid Glass clipped to `shape`; frosted-material fallback below 26.
    @ViewBuilder func liquidGlassBar<S: InsettableShape>(_ shape: S) -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.regularMaterial, in: shape).overlay(shape.strokeBorder(.primary.opacity(0.08)))
        }
    }
}

/// The app's bottom tab bar: native-style icon+label items on a frosted material (no drop shadow),
/// that SHRINKS (not minimizes) while scrolling down. Honors Reduce Motion.
struct AppTabBar: View {
    @Binding var selection: Int
    var shrink: TabBarShrink
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let items: [(icon: String, label: String)] = [
        ("house.fill", "Home"),
        ("checklist", "Tasks"),
        ("tray.fill", "Inbox"),
        ("square.stack.fill", "Projects"),
        ("ellipsis", "More"),
    ]
    private var compact: Bool { shrink.compact && !reduceMotion }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items.indices, id: \.self) { i in
                let active = selection == i
                Button {
                    Haptics.tap()
                    if reduceMotion { selection = i }
                    else { withAnimation(.spring(response: 0.34, dampingFraction: 0.8)) { selection = i } }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: items[i].icon).font(.system(size: 21, weight: active ? .semibold : .regular))
                        Text(items[i].label).font(NXFont.text(10, active ? .bold : .medium))
                    }
                    .foregroundStyle(active ? NX.violet : NX.mutedFg)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(items[i].label)
            }
        }
        .padding(.horizontal, 6)
        .liquidGlassBar(RoundedRectangle(cornerRadius: 26, style: .continuous))   // iOS 26 Liquid Glass
        .scaleEffect(compact ? 0.86 : 1, anchor: .bottom)   // mengecil on scroll-down (render-only → no reflow)
        .animation(.spring(response: 0.36, dampingFraction: 0.82), value: compact)
        .padding(.horizontal, 22)
        .padding(.top, 6)
    }
}
