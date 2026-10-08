import SwiftUI

extension View {
    /// Holds a server room (`project:<id>`, `conversation:<id>`) for as long as this view is on screen,
    /// so the events sent to that room reach the app. nil holds nothing. Rooms are counted, so two
    /// screens of the same project can both hold it; RealtimeClient re-joins whatever is held after
    /// every reconnect.
    func realtimeRoom(_ room: String?) -> some View {
        modifier(RealtimeRoom(room: room))
    }
}

private struct RealtimeRoom: ViewModifier {
    let room: String?

    func body(content: Content) -> some View {
        // A `.task` rather than onAppear/onDisappear: SwiftUI always cancels it when the view goes or
        // the room changes, so a join can never be left without its leave.
        content.task(id: room) {
            guard let room else { return }
            RealtimeClient.shared.join(room)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_600 * 1_000_000_000)
            }
            RealtimeClient.shared.leave(room)
        }
    }
}

/// One quiet line for Tuning Room: whether this device is live right now. Lets someone tell at a
/// glance whether a Mac that is not moving is offline or simply has nothing new to show.
struct RealtimeStatusLine: View {
    @State private var realtime = RealtimeClient.shared

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(tint)
                .frame(width: 7, height: 7)
                .accessibilityHidden(true)
            Text(label)
                .font(NXFont.text(11))
                .foregroundStyle(NX.mutedFg)
        }
        .accessibilityElement(children: .combine)
    }

    private var label: String {
        switch realtime.state {
        case .connected: return T("Realtime: connected")
        case .connecting: return T("Realtime: connecting…")
        case .reconnecting: return T("Realtime: reconnecting…")
        case .off: return T("Realtime: off")
        case .refused: return T("Realtime: off — sign in again")
        }
    }

    private var tint: Color {
        switch realtime.state {
        case .connected: return NX.success
        case .connecting, .reconnecting: return NX.warning
        case .off: return NX.mutedFg
        case .refused: return NX.danger
        }
    }
}
