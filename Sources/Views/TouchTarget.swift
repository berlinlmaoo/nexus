import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// 44 pt touch targets on small controls (web QA round 2 keyboard/touch 0275d91 + BoD R2 33f3080: "negative
// margins keep the layout"). Apple's minimum hit area is 44×44 pt; a 22 pt checkbox or a 10 pt close
// "x" is hard to hit with a thumb. This grows only the TAPPABLE area: the control is framed to 44×44 and
// given that shape, then the outer negative padding hands the extra room back to the layout, so nothing
// on screen moves or changes size.
// ─────────────────────────────────────────────────────────────────────────────

extension View {
    /// A ≥44×44 pt hit area around a control drawn about `drawn` × `drawnHeight` points (height defaults
    /// to `drawn`), without changing the layout. Apply it to the button's LABEL (inside the Button), so
    /// the button's own hit test uses the grown shape.
    func touchTarget44(drawn: CGFloat, drawnHeight: CGFloat? = nil) -> some View {
        let h: CGFloat = max(0, (44 - drawn) / 2)
        let v: CGFloat = max(0, (44 - (drawnHeight ?? drawn)) / 2)
        return self
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .padding(.horizontal, -h)
            .padding(.vertical, -v)
    }
}
