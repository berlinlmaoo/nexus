import SwiftUI
import UIKit

/// A plain "Done" bar pinned above the keyboard while it is up (owner, 29 Sep 2026: forms in
/// Control Room could not close the keyboard). Not a keyboard toolbar: on iOS 26 that is drawn as an
/// empty glass capsule. Put it on a screen's root, together with `.scrollDismissesKeyboard`.
private struct KeyboardDoneBar: ViewModifier {
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if visible {
                    HStack {
                        Spacer()
                        Button {
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                        } label: {
                            Text(T("Done")).font(NXFont.text(15, .bold)).foregroundStyle(NX.violetText)
                                .padding(.horizontal, 18).padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                    }
                    .background(NX.card)
                    .overlay(alignment: .top) { Rectangle().fill(NX.border).frame(height: 0.5) }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in visible = true }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in visible = false }
    }
}

extension View {
    /// Done above the keyboard + drag to dismiss, for a whole screen of fields.
    func keyboardDoneBar() -> some View {
        modifier(KeyboardDoneBar()).scrollDismissesKeyboard(.interactively)
    }
}
