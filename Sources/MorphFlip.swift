import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Faithful port of the web dashboard morph (framer-motion shared `layoutId`).
//
// The web morphs the card by sharing a layoutId between the small card and the modal — framer does a
// FLIP: it measures both, then animates the modal from the card's rect using a TRANSFORM (scale +
// translate). The content scales as one unit on the GPU — no layout/reflow — which is why it's smooth.
// SwiftUI's matchedGeometryEffect instead interpolates the *frame* (the content re-lays-out every frame
// = the "kurang smooth" reflow). So we replicate framer's FLIP manually with scaleEffect + offset.
// ─────────────────────────────────────────────────────────────────────────────

/// Collects source-card frames (in a named coordinate space) so a modal can FLIP-morph from the tapped one.
struct MorphFrameKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { $1 })
    }
}

extension View {
    /// Publish this view's frame under `id` (in coordinate space `space`) for a later FLIP morph.
    func morphSource(_ id: String, in space: String) -> some View {
        background(
            GeometryReader { p in
                Color.clear.preference(key: MorphFrameKey.self, value: [id: p.frame(in: .named(space))])
            }
        )
    }
}

/// Renders the modal at full size, then a scale+offset transform makes it START exactly on `source`'s
/// rect and spring to identity when `expanded` flips true — the whole card (header included) scales as
/// ONE unit (no reflow), like the web. Measures its own natural frame once (transforms don't affect
/// layout, so the measurement is the true full-size rect); stays hidden until measured to avoid a flash.
struct MorphFlip: ViewModifier {
    let source: CGRect
    let expanded: Bool
    let space: String
    @Binding var target: CGRect

    func body(content: Content) -> some View {
        let valid = target.width > 1 && source.width > 1
        let collapsed = valid && !expanded
        let sx = valid ? source.width / target.width : 1
        let sy = valid ? source.height / target.height : 1
        let tx = valid ? source.minX - target.minX : 0
        let ty = valid ? source.minY - target.minY : 0
        return content
            .background(
                GeometryReader { p in
                    Color.clear
                        .onAppear { if target == .zero { target = p.frame(in: .named(space)) } }
                        .onChange(of: p.frame(in: .named(space))) { _, n in if target == .zero { target = n } }
                }
            )
            .scaleEffect(x: collapsed ? sx : 1, y: collapsed ? sy : 1, anchor: .topLeading)
            .offset(x: collapsed ? tx : 0, y: collapsed ? ty : 0)
            // Hide ONLY while a real source rect is still being measured. If we never got a source
            // (card frame not published yet), fall back to showing the modal full-size — never invisible.
            .opacity(source.width > 1 && target.width <= 1 ? 0 : 1)
    }
}
