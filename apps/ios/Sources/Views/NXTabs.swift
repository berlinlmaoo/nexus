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
    @State private var contentWidth: CGFloat = 0

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(items) { item in
                        NXUnderlineTab(item: item, on: item.id == selection) { selection = item.id }
                            .id(Self.key(item.id))
                    }
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
                .scrollTargetLayout()
            }
            // A swipe comes to rest with a whole tab at the leading edge, never a fragment like "ers"
            // (UI tour run 14, N-07).
            .scrollTargetBehavior(.viewAligned)
            // The active tab is scrolled into view and the row fades where more lies
            // (UI tour run 11: the Settings tabs' fifth icon and Legal's "Companie" were cut hard).
            .modifier(NXTabRowScroller(activeId: Self.key(selection), itemIds: items.map { Self.key($0.id) },
                                       proxy: proxy, contentWidth: contentWidth))
        }
        // The insets sit outside the scroller, so a scrolled row never puts a tab flush against either edge:
        // the trailing one ran into the screen edge, a hard "Compani…" behind a faint fade (UI tour run 12,
        // IP11: Legal and Settings).
        .padding(.horizontal, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(NX.border).frame(height: 1).allowsHitTesting(false) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityName)
    }

    private static func key(_ id: ID) -> String { String(describing: id) }
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
                        // A grey count pill, as the web's tabs (UI tour run 15, Q-M24), dotted ("1.234").
                        Text(AppNumber.int(count))
                            .font(NXFont.text(11, .semibold)).monospacedDigit()
                            .foregroundStyle(countColor(count))
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(NX.muted, in: Capsule())
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

/// The edges of a horizontal ScrollView (a filter or tab row wider than the screen) fade out where more
/// content lies that way, so a cut chip reads as "scroll for more" rather than a broken label (UI tour
/// run 10: Legal filters, the project tab strip). iOS 18 fades only the edge that has more; iOS 17 has no
/// scroll geometry and fades the trailing edge alone.
struct NXHorizontalEdgeFade: ViewModifier {
    var width: CGFloat = 24
    @State private var leading = false
    @State private var trailing = true

    func body(content: Content) -> some View {
        tracked(content)
            .mask {
                HStack(spacing: 0) {
                    LinearGradient(colors: [.black.opacity(leading ? 0 : 1), .black], startPoint: .leading, endPoint: .trailing)
                        .frame(width: width)
                    Rectangle()
                    LinearGradient(colors: [.black, .black.opacity(trailing ? 0 : 1)], startPoint: .leading, endPoint: .trailing)
                        .frame(width: width)
                }
            }
    }

    @ViewBuilder private func tracked(_ content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: [Bool].self) { g in
                let start = -g.contentInsets.leading
                let end = g.contentSize.width + g.contentInsets.trailing - g.containerSize.width
                return [g.contentOffset.x > start + 1, g.contentOffset.x < end - 1]
            } action: { _, edges in
                leading = edges[0]
                trailing = edges[1]
            }
        } else {
            content
        }
    }
}

extension View {
    /// Apply to a horizontal ScrollView: see NXHorizontalEdgeFade.
    func nxEdgeFade(_ width: CGFloat = 24) -> some View { modifier(NXHorizontalEdgeFade(width: width)) }
}

// MARK: - Scrolling tab rows

/// A horizontal tab row (apply to its ScrollView inside a ScrollViewReader; every tab carries `.id(_)`) that
/// - scrolls the active tab into view on appear and whenever it changes (UI tour run 11: the selected tab
///   could sit off-screen, and the leading one was cut hard: "rview", "er kategori");
/// - fades both edges where more tabs lie that way (a mask, so it never takes a tap);
/// - reports whether the tabs are wider than the row, for an overflow "…" menu.
struct NXTabRowScroller: ViewModifier {
    let activeId: String
    /// Every tab's id in order.
    let itemIds: [String]
    let proxy: ScrollViewProxy
    var overflowing: Binding<Bool>? = nil
    /// The tabs' own width, measured on the row's HStack.
    let contentWidth: CGFloat
    var fade: CGFloat = 28

    @State private var viewportWidth: CGFloat = 0
    /// Scrolled away from either end (iOS 18 knows the offset; iOS 17 fades the trailing edge while the
    /// row overflows and the leading one never).
    @State private var moreBefore = false
    @State private var moreAfter = false
    /// The scroll geometry has reported at least once. Its action fires on CHANGES only, so until then the
    /// edges come from the widths: at rest the row starts at its leading edge (UI tour run 14, N-09 / N-07:
    /// the row opened with no fade at all, "Tin" and "]" cut hard, because nothing had changed yet).
    @State private var observed = false

    func body(content: Content) -> some View {
        tracked(content)
            .mask {
                HStack(spacing: 0) {
                    LinearGradient(colors: [.black.opacity(moreBefore ? 0 : 1), .black], startPoint: .leading, endPoint: .trailing)
                        .frame(width: fade)
                    Rectangle()
                    LinearGradient(colors: [.black, .black.opacity(moreAfter ? 0 : 1)], startPoint: .leading, endPoint: .trailing)
                        .frame(width: fade)
                }
                .allowsHitTesting(false)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
                viewportWidth = width
                update()
            }
            .onChange(of: contentWidth) { _, _ in update(); reveal(animated: false) }
            // After the first layout, so the scroll to the active tab is a CHANGE the geometry reports (and
            // the faded edges follow it) rather than part of the first value, which reports nothing.
            .onAppear { DispatchQueue.main.async { reveal(animated: false) } }
            .onChange(of: activeId) { _, _ in reveal(animated: true) }
            .onChange(of: itemIds) { _, _ in reveal(animated: false) }
    }

    @ViewBuilder private func tracked(_ content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: [Bool].self) { g in
                [g.contentOffset.x > -g.contentInsets.leading + 1,
                 g.contentOffset.x < g.contentSize.width + g.contentInsets.trailing - g.containerSize.width - 1]
            } action: { _, edges in
                observed = true
                moreBefore = edges[0]
                moreAfter = edges[1]
            }
        } else {
            content
        }
    }

    private var overflows: Bool { viewportWidth > 0 && contentWidth > viewportWidth + 1 }

    private func update() {
        if let overflowing, overflowing.wrappedValue != overflows { overflowing.wrappedValue = overflows }
        if #unavailable(iOS 18.0) { moreAfter = overflows } else if !observed { moreAfter = overflows }
    }

    /// Brings the active tab into view with the tab before it lined up whole against the leading edge,
    /// so the row never opens on a cut fragment there ("ers" of Members, UI tour run 14, N-07); only the
    /// trailing edge can hold a partial tab, under its fade. Centring the active tab left a fragment on
    /// both sides. Near the row's end the scroll clamps, and the last tab sits whole at the trailing edge.
    private func reveal(animated: Bool) {
        guard let i = itemIds.firstIndex(of: activeId) else { return }
        let target = itemIds[max(0, i - 1)]
        if animated { withAnimation(.snappy(duration: 0.25)) { proxy.scrollTo(target, anchor: .leading) } }
        else { proxy.scrollTo(target, anchor: .leading) }
    }
}
