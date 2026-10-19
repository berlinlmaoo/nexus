import SwiftUI

struct FormEditorsRow: View {
    let editors: [FormEditor]
    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: -8) {
                ForEach(Array(editors.prefix(3))) { person in
                    AvatarView(url: person.avatar, initial: String(person.name.prefix(1)), size: 26, userId: person.userId, name: person.name)
                }
            }
            if editors.count > 3 { Text("+\(editors.count - 3)").font(NXFont.text(11, .semibold)) }
            Text(String(format: T("Also editing: %@"), editors.map(\.name).joined(separator: ", ")))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
            Spacer(minLength: 0)
        }.padding(.horizontal, 16).padding(.vertical, 8).background(NX.card)
            .accessibilityIdentifier("form.live.editors")
    }
}

struct FormQuestionEditors: View {
    let editors: [FormEditor]
    private var tone: Color {
        guard let hex = editors.first?.color?.replacingOccurrences(of: "#", with: ""), let rgb = UInt(hex, radix: 16) else { return NX.violetText }
        return Color(uiColor: UIColor(rgb: rgb))
    }
    private var label: String {
        guard let first = editors.first else { return "" }
        return editors.count == 1 ? String(format: T("%@ is editing"), first.name)
            : String(format: T("%@ and %@ more are editing"), first.name, AppNumber.int(editors.count - 1))
    }
    var body: some View {
        if !editors.isEmpty {
            RoundedRectangle(cornerRadius: 12).strokeBorder(tone, lineWidth: 2)
                .overlay(alignment: .topTrailing) {
                    Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(tone)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(NX.card, in: Capsule()).padding(5)
                }.accessibilityLabel(label)
        }
    }
}

struct FormCoeditLifecycle: ViewModifier {
    let lease: FormRoomLease
    let room: String?
    let selectedId: String?
    let openFieldId: String?
    let onOps: (Notification) -> Void
    let onPresence: (Notification) -> Void
    let onReconnect: () async -> Void
    let onRevoked: (Notification) -> Void
    let onFocus: () -> Void
    func body(content: Content) -> some View {
        content
            .onChange(of: room, initial: true) { _, room in lease.update(room) }
            .onAppear { lease.update(room); Task { await onReconnect() } }
            .onDisappear { if openFieldId == nil { lease.update(nil) } }
            .onReceive(NotificationCenter.default.publisher(for: .nexusFormOps), perform: onOps)
            .onReceive(NotificationCenter.default.publisher(for: .nexusFormPresence), perform: onPresence)
            .onReceive(NotificationCenter.default.publisher(for: .nexusRoomRevoked), perform: onRevoked)
            .onReceive(NotificationCenter.default.publisher(for: .nexusRealtimeConnected)) { _ in Task { await onReconnect() } }
            .onChange(of: selectedId) { _, _ in onFocus() }
            .onChange(of: openFieldId) { _, _ in onFocus() }
    }
}

/// A question editor pushed on a phone still belongs to the open builder. Its room survives that
/// push, then leaves on closing the builder or destroying its state (including sign-out).
final class FormRoomLease {
    private var room: String?
    @MainActor func update(_ next: String?) {
        guard room != next else { return }
        if let old = room { RealtimeClient.shared.leave(old) }
        room = next
        if let next { RealtimeClient.shared.join(next) }
    }
    deinit { let old = room; Task { @MainActor in if let old { RealtimeClient.shared.leave(old) } } }
}

/// UIKit positions are UTF-16 offsets. Restore only when the expected remote render has landed;
/// another keystroke changes the text and makes the snapshot ineligible.
@MainActor final class FormCaretSnapshot {
    private weak var view: UIView?
    private let expected: String
    private let start: Int
    private let end: Int
    private init(view: UIView, expected: String, start: Int, end: Int) {
        self.view = view; self.expected = expected; self.start = start; self.end = end
    }
    static func capture(expected: [String: String]) -> FormCaretSnapshot? {
        func responder(_ view: UIView) -> UIView? { if view.isFirstResponder { return view }; return view.subviews.lazy.compactMap(responder).first }
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        guard let view = windows.lazy.compactMap(responder).first, let key = view.accessibilityIdentifier,
              let text = expected[key], let input = view as? UITextInput, let range = input.selectedTextRange else { return nil }
        return FormCaretSnapshot(view: view, expected: text, start: input.offset(from: input.beginningOfDocument, to: range.start), end: input.offset(from: input.beginningOfDocument, to: range.end))
    }
    func restoreAfterRender() {
        Task { @MainActor in
            for _ in 0..<5 {
                await Task.yield()
                guard let view, view.isFirstResponder, view.window != nil, let input = view as? UITextInput else { return }
                let all = input.textRange(from: input.beginningOfDocument, to: input.endOfDocument)
                if let all, input.text(in: all) == expected {
                    let count = input.offset(from: input.beginningOfDocument, to: input.endOfDocument)
                    if let a = input.position(from: input.beginningOfDocument, offset: min(start, count)),
                       let b = input.position(from: input.beginningOfDocument, offset: min(end, count)) { input.selectedTextRange = input.textRange(from: a, to: b) }
                    return
                }
                try? await Task.sleep(for: .milliseconds(20))
            }
        }
    }
}
