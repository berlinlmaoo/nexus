import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Light underline tabs with counts — the dev web's PageTabs after the UI sweep (12 Oct 2026), which
// replaced the black / violet filled pills. One look for every "which queue / which part" switch in the
// app: Tickets, Notifications, Settings, requests, Control Room. The selected tab is the foreground colour
// with a 2 pt line under it; counts are quiet numbers beside the label.
// ─────────────────────────────────────────────────────────────────────────────

struct NXTabItem<ID: Hashable>: Identifiable {
    let id: ID
    let label: String
    var count: Int? = nil
    var icon: String? = nil
    /// A count that wants attention (an inbox with something in it) is drawn in the accent colour.
    var attention = false
}

struct NXUnderlineTabs<ID: Hashable>: View {
    let items: [NXTabItem<ID>]
    @Binding var selection: ID
    var accessibilityName: String = ""

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(items) { item in
                    NXUnderlineTab(item: item, on: item.id == selection) { selection = item.id }
                }
            }
            .padding(.horizontal, 12)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityName)
    }
}

private struct NXUnderlineTab<ID: Hashable>: View {
    let item: NXTabItem<ID>
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                HStack(spacing: 5) {
                    if let icon = item.icon {
                        Image(systemName: icon).font(.system(size: 12, weight: .medium))
                    }
                    Text(item.label).font(NXFont.text(14, on ? .semibold : .medium)).lineLimit(1)
                    if let count = item.count {
                        Text("\(count)")
                            .font(NXFont.text(12, .semibold)).monospacedDigit()
                            .foregroundStyle(countColor(count))
                    }
                }
                .foregroundStyle(on ? NX.foreground : NX.mutedFg)
                .padding(.horizontal, 10)
                .frame(minHeight: 42)
                Rectangle().fill(on ? NX.foreground : Color.clear).frame(height: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityLabel(item.count.map { "\(item.label), \($0)" } ?? item.label)
    }

    private func countColor(_ count: Int) -> Color {
        item.attention && count > 0 ? NX.violetText : NX.mutedFg
    }
}

/// A light choice chip (the web's segmented / option toggles after the sweep): selected = a soft accent
/// wash with the foreground text, never a filled violet pill.
struct NXChoiceChipStyle: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        content
            .foregroundStyle(on ? NX.foreground : NX.mutedFg)
            .background(on ? NX.accentBg : NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? NX.violet.opacity(0.35) : NX.border))
    }
}

extension View {
    func nxChoiceChip(on: Bool) -> some View { modifier(NXChoiceChipStyle(on: on)) }
}
