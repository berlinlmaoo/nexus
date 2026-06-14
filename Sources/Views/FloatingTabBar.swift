import SwiftUI

/// Drives the floating tab bar's scroll-shrink. Tab roots feed it their scroll offset; the bar
/// reads `compact` and scales down while the user scrolls down (and back up near the top).
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
}

/// Instagram-style floating tab bar: a dark rounded pill with icon items and a sliding
/// active-highlight. Shrinks (not minimizes) while scrolling down. Honors Reduce Motion.
struct FloatingTabBar: View {
    @Binding var selection: Int
    var shrink: TabBarShrink
    @Namespace private var ns
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let items: [(icon: String, label: String)] = [
        ("house.fill", "Home"),
        ("checklist", "Tasks"),
        ("tray.fill", "Inbox"),
        ("square.stack.fill", "Projects"),
        ("ellipsis", "More"),
    ]
    private let pill = Color(hex: "#1c1d22")   // fixed charcoal (IG-style), independent of light/dark
    private var compact: Bool { shrink.compact && !reduceMotion }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(items.indices, id: \.self) { i in
                let active = selection == i
                Button {
                    Haptics.tap()
                    if reduceMotion { selection = i }
                    else { withAnimation(.spring(response: 0.34, dampingFraction: 0.78)) { selection = i } }
                } label: {
                    Image(systemName: items[i].icon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(active ? .white : .white.opacity(0.5))
                        .frame(maxWidth: .infinity).frame(height: 42)
                        .background {
                            if active {
                                Capsule().fill(.white.opacity(0.16)).matchedGeometryEffect(id: "tabhl", in: ns)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(items[i].label)
            }
        }
        .padding(5)
        .background(pill, in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.08)))
        .shadow(color: .black.opacity(0.28), radius: 18, x: 0, y: 8)
        .scaleEffect(compact ? 0.74 : 1, anchor: .bottom)   // mengecil on scroll-down (render-only → no reflow)
        .opacity(compact ? 0.96 : 1)
        .animation(.spring(response: 0.36, dampingFraction: 0.82), value: compact)
        .padding(.horizontal, 26)
        .padding(.top, 6)
    }
}
