import SwiftUI

struct HomeRealtimeRefresh: ViewModifier {
    let onXP: () async -> Void
    let onCalendar: () async -> Void
    let onAttendance: () async -> Void
    @Environment(\.scenePhase) private var phase
    @State private var visible = false
    func body(content: Content) -> some View {
        content.onAppear { visible = true }.onDisappear { visible = false }
            .onReceive(NotificationCenter.default.publisher(for: .nexusOwnXPChanged)) { _ in
                if visible && LiveRefresh.inFront(phase) { Task { await onXP() } }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nexusCalendarChanged)) { _ in
                if visible && LiveRefresh.inFront(phase) { Task { await onCalendar() } }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nexusAttendanceChanged)) { _ in
                if visible && LiveRefresh.inFront(phase) { Task { await onAttendance() } }
            }
    }
}
