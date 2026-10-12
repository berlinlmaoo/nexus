import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Focus stays in the top-most sheet (web use-modal-focus-trap, QA BoD round 2 33f3080).
//
// A SwiftUI `.keyboardShortcut` is a UIKeyCommand on its hosting controller, and a presented
// controller's next responder is the controller that presented it. So with a sheet up, a key the sheet
// doesn't claim falls through to the screen underneath: ⌘N made a task behind the task popup, ⌘1 swapped
// the screen under a dialog, ⌘[ switched tabs behind it. A screen's own shortcuts call
// `cover.isCovered` first and do nothing while anything (sheet, full-screen cover, alert) is presented
// over the window part they live in.
//
//     @State private var cover = SheetCover()
//     …  .background(SheetCover.Anchor(cover: cover))
//     Button("") { guard !cover.isCovered else { return }; … }.keyboardShortcut("n")
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
final class SheetCover {
    fileprivate weak var view: UIView?

    nonisolated init() {}

    /// True while something is presented over the controller this anchor sits in. False when the
    /// anchor isn't in a window yet (nothing to guard then).
    var isCovered: Bool {
        guard let v = view else { return false }
        return Self.isCovered(v)
    }

    /// The same test for any UIKit view (e.g. a first-responder grid host): is something presented
    /// over the controller that owns `v`?
    static func isCovered(_ v: UIView) -> Bool {
        guard v.window != nil else { return false }
        var responder: UIResponder? = v
        var owner: UIViewController?
        while let r = responder {
            if let vc = r as? UIViewController { owner = vc; break }
            responder = r.next
        }
        guard let owner else { return false }
        // `presentedViewController` answers for the presentation context, which is an ancestor
        // container; asking the top-most parent covers navigation and split children too.
        var container: UIViewController = owner
        while let p = container.parent { container = p }
        guard let presented = container.presentedViewController else { return false }
        // An active search field is presented too, but it is part of the screen, not over it.
        if presented is UISearchController { return false }
        return !presented.isBeingDismissed
    }

    /// The invisible view that lets `SheetCover` find where it lives. Put it in a `.background`.
    struct Anchor: UIViewRepresentable {
        let cover: SheetCover

        func makeUIView(context: Context) -> UIView {
            let v = UIView(frame: .zero)
            v.isUserInteractionEnabled = false
            v.isHidden = true
            cover.view = v
            return v
        }

        func updateUIView(_ uiView: UIView, context: Context) {
            cover.view = uiView
        }
    }
}
