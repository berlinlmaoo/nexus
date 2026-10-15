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
    /// Where the bottom hairline starts, from the row's leading edge (0 = the full width).
    var dividerLeading: CGFloat = 0
    @State private var contentWidth: CGFloat = 0

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(items) { item in
                        NXUnderlineTab(item: item, on: item.id == selection) { selection = item.id }
                            .id(Self.key(item.id))
                            .nxTabFrame(Self.key(item.id))
                    }
                }
                .coordinateSpace(.named(NXTabFramesKey.space))
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
        .overlay(alignment: .bottom) {
            Rectangle().fill(NX.border).frame(height: 1).padding(.leading, dividerLeading).allowsHitTesting(false)
        }
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
                            .lineLimit(1)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(NX.muted, in: Capsule())
                            // The pill hugs its digits on one line: a squeezed row wrapped "47" into
                            // "4 / 7" (UI tour run 16, R16-I-01 / R16-B-01).
                            .fixedSize()
                    }
                }
                .fixedSize()
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

/// A horizontal tab row (apply to its ScrollView inside a ScrollViewReader; every tab carries `.id(_)` and
/// `.nxTabFrame(_)`) that
/// - scrolls the active tab into view on appear and whenever it changes (UI tour run 11: the selected tab
///   could sit off-screen, and the leading one was cut hard: "rview", "er kategori");
/// - draws whole tabs only: a tab an edge cuts is masked out, so no fragment such as "oard" or a stray glyph
///   beside "…" shows (UI tour run 15, Q-IA20 / Q-IA22);
/// - while the tabs overflow, keeps an inset on both sides of the row, fades the outer whole tab and puts a
///   chevron in the inset on every side where tabs are hidden, so a row scrolled past its first tabs still
///   says there is more (UI tour run 16, R16-I-03: Legal opened on "Requests | Templates" with Documents
///   gone and no cue; run 12 fix #11, N-09);
/// - reports whether the tabs are wider than the row, for an overflow "…" menu.
struct NXTabRowScroller: ViewModifier {
    let activeId: String
    /// Every tab's id in order.
    let itemIds: [String]
    let proxy: ScrollViewProxy
    var overflowing: Binding<Bool>? = nil
    /// The tabs' own width, measured on the row's HStack.
    let contentWidth: CGFloat
    /// The inset on each side of an overflowing row; the chevron cue sits in it.
    var inset: CGFloat = 20

    @State private var viewportWidth: CGFloat = 0
    /// Every tab's frame in the row's content (for the trailing room) and in the visible row (for the
    /// whole-tab window and the cues). Both come from `nxTabFrame`.
    @State private var frames: [String: CGRect] = [:]
    @State private var visible: [String: CGRect] = [:]

    func body(content: Content) -> some View {
        content
            .coordinateSpace(.named(NXTabFramesKey.viewport))
            .contentMargins(.leading, edge, for: .scrollContent)
            // Room after the last tab, so the row's farthest scroll position is also a tab's start: a scroll
            // to the active tab that clamped at the end used to leave part of a tab at the leading edge.
            .contentMargins(.trailing, edge + trailingRoom, for: .scrollContent)
            .mask { mask.allowsHitTesting(false) }
            .overlay(alignment: .leading) { if hiddenBefore { cue(leading: true) } }
            .overlay(alignment: .trailing) { if hiddenAfter { cue(leading: false) } }
            .onPreferenceChange(NXTabFramesKey.self) { frames = $0 }
            .onPreferenceChange(NXTabViewportFramesKey.self) { visible = $0 }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
                viewportWidth = width
                update()
            }
            .onChange(of: contentWidth) { _, _ in update(); reveal(animated: false) }
            .onAppear { DispatchQueue.main.async { reveal(animated: false) } }
            .onChange(of: activeId) { _, _ in reveal(animated: true) }
            .onChange(of: itemIds) { _, _ in reveal(animated: false) }
    }

    private var overflows: Bool { viewportWidth > 0 && contentWidth > viewportWidth + 1 }
    private var edge: CGFloat { overflows ? inset : 0 }

    /// The part of the row a whole tab may be drawn in.
    private var lo: CGFloat { edge }
    private var hi: CGFloat { viewportWidth - edge }

    private var hiddenBefore: Bool { overflows && visible.values.contains { $0.minX < lo - 0.5 } }
    private var hiddenAfter: Bool { overflows && visible.values.contains { $0.maxX > hi + 0.5 } }

    /// Whole tabs only, with the outer whole tab faded on a side where more tabs lie; before the frames are
    /// known, a plain fade at the trailing edge of an overflowing row.
    @ViewBuilder private var mask: some View {
        if overflows, let window = visibleWindow {
            let span = max(0, window.upperBound - window.lowerBound)
            let fade = min(18, span / 4)
            HStack(spacing: 0) {
                Color.clear.frame(width: max(0, window.lowerBound))
                HStack(spacing: 0) {
                    if hiddenBefore {
                        LinearGradient(colors: [.black.opacity(0.3), .black], startPoint: .leading, endPoint: .trailing)
                            .frame(width: fade)
                    }
                    Rectangle()
                    if hiddenAfter {
                        LinearGradient(colors: [.black, .black.opacity(0.3)], startPoint: .leading, endPoint: .trailing)
                            .frame(width: fade)
                    }
                }
                .frame(width: span)
                Color.clear
            }
        } else if overflows {
            HStack(spacing: 0) {
                Rectangle()
                LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .leading, endPoint: .trailing)
                    .frame(width: 28)
            }
        } else {
            Rectangle()
        }
    }

    /// The span (in the row's own coordinates) that holds only whole tabs.
    private var visibleWindow: ClosedRange<CGFloat>? {
        let whole = visible.values.filter { $0.minX >= lo - 0.5 && $0.maxX <= hi + 0.5 }
        guard let first = whole.map(\.minX).min(), let last = whole.map(\.maxX).max(), last > first else { return nil }
        return first...last
    }

    /// A quiet chevron in the inset where tabs are hidden; a tap brings the next hidden tab in.
    private func cue(leading: Bool) -> some View {
        Button { step(back: leading) } label: {
            Image(systemName: leading ? "chevron.left" : "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(NX.mutedFg)
                .frame(width: inset, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHidden(true)
    }

    private func step(back: Bool) {
        let ordered = itemIds.compactMap { id in visible[id].map { (id, $0) } }
        if back, let target = ordered.last(where: { $0.1.minX < lo - 0.5 }) {
            withAnimation(.snappy(duration: 0.25)) { proxy.scrollTo(target.0, anchor: .leading) }
        } else if !back, let target = ordered.first(where: { $0.1.maxX > hi + 0.5 }) {
            withAnimation(.snappy(duration: 0.25)) { proxy.scrollTo(target.0, anchor: .trailing) }
        }
    }

    private var trailingRoom: CGFloat {
        guard overflows, !frames.isEmpty else { return 0 }
        // The farthest a leading-aligned tab start can be, with both insets in the scroll range.
        let maxOffset = contentWidth + 2 * inset - viewportWidth
        let starts = frames.values.map(\.minX).sorted()
        guard let next = starts.first(where: { $0 >= maxOffset - 0.5 }) else { return 0 }
        return max(0, next - maxOffset)
    }

    private func update() {
        if let overflowing, overflowing.wrappedValue != overflows { overflowing.wrappedValue = overflows }
    }

    /// Brings the active tab into view with the tab before it lined up whole against the leading inset,
    /// so the row never opens on a cut fragment there ("ers" of Members, UI tour run 14, N-07). Near the
    /// row's end the scroll clamps, and the last tab sits whole against the trailing inset.
    private func reveal(animated: Bool) {
        guard let i = itemIds.firstIndex(of: activeId) else { return }
        let target = itemIds[max(0, i - 1)]
        if animated { withAnimation(.snappy(duration: 0.25)) { proxy.scrollTo(target, anchor: .leading) } }
        else { proxy.scrollTo(target, anchor: .leading) }
    }
}


/// Each tab's frame in its row's content (coordinate space `NXTabFramesKey.space`), for NXTabRowScroller.
struct NXTabFramesKey: PreferenceKey {
    static let space = "nxTabRow"
    /// The scroll view itself (set by NXTabRowScroller): frames in it move as the row scrolls.
    static let viewport = "nxTabViewport"
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

/// Each tab's frame in the visible row (coordinate space `NXTabFramesKey.viewport`).
struct NXTabViewportFramesKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

extension View {
    /// Reports this tab's frame to the row's NXTabRowScroller (put the row's HStack in
    /// `.coordinateSpace(.named(NXTabFramesKey.space))`).
    func nxTabFrame(_ id: String) -> some View {
        background {
            GeometryReader { g in
                Color.clear
                    .preference(key: NXTabFramesKey.self, value: [id: g.frame(in: .named(NXTabFramesKey.space))])
                    .preference(key: NXTabViewportFramesKey.self, value: [id: g.frame(in: .named(NXTabFramesKey.viewport))])
            }
        }
    }
}
