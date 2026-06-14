import SwiftUI

/// Instagram-style floating tab bar: a dark rounded pill with icon items and a sliding
/// active-highlight. Replaces the classic full-width tab bar. Honors Reduce Motion.
struct FloatingTabBar: View {
    @Binding var selection: Int
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
        .padding(.horizontal, 26)
        .padding(.top, 6)
    }
}
