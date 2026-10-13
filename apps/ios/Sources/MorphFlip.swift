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
///
/// A reference type, and deliberately NOT observable. The cards that publish these rects live inside a
/// ScrollView, so their frames in the outer named space change on every single scroll frame. Carried by
/// a PreferenceKey into `@State` (which is what this used to be) that meant the host screen's whole body
/// was invalidated at display rate just for scrolling — on a 120Hz phone, 120 full rebuilds a second.
/// Nobody reads a rect until a card is actually tapped, so the values are parked in a box whose mutation
/// SwiftUI does not see. Do not turn this back into state or the dashboard goes right back to stuttering.
final class MorphFrameStore {
    private var frames: [String: CGRect] = [:]
    /// `.zero` for an id that has not been measured yet — MorphFlip treats that as "no source" and
    /// shows the modal full-size rather than hiding it.
    subscript(id: String) -> CGRect {
        get { frames[id] ?? .zero }
        set { frames[id] = newValue }
    }
}

extension View {
    /// Record this view's frame under `id` (in coordinate space `space`) for a later FLIP morph.
    func morphSource(_ id: String, in space: String, store: MorphFrameStore) -> some View {
        background(
            GeometryReader { p in
                let rect = p.frame(in: .named(space))
                // onAppear + onChange rather than `.preference`: the write lands in the store and stops
                // there, so a scroll re-measures this one hidden GeometryReader and nothing else.
                Color.clear
                    .onAppear { store[id] = rect }
                    .onChange(of: rect) { _, n in store[id] = n }
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
