import SwiftUI

struct HomeRealtimeRefresh: ViewModifier {
    let onXP: () async -> Void
    /// The person's tasks changed somewhere (calendar or project task event).
    let onTasks: () async -> Void
    /// Home is back on screen, or the app is back in front: the stat tiles read again (R-13).
    let onStats: () async -> Void
    let onAttendance: () async -> Void
    @Environment(\.scenePhase) private var phase
    @State private var visible = false
    @State private var appearedBefore = false
    /// One pending reload per kind: a burst of events (a board move sends several) is one request.
    @State private var tasksPending: Task<Void, Never>?
    @State private var statsPending: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .onAppear {
                visible = true
                if appearedBefore { statsPending = debounced(statsPending, onStats) }
                appearedBefore = true
            }
            .onDisappear { visible = false }
            .onChange(of: phase) { _, now in
                if visible && LiveRefresh.inFront(now) { statsPending = debounced(statsPending, onStats) }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nexusOwnXPChanged)) { _ in
                if visible && LiveRefresh.inFront(phase) { Task { await onXP() } }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nexusCalendarChanged)) { _ in
                if visible && LiveRefresh.inFront(phase) { tasksPending = debounced(tasksPending, onTasks) }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nexusProjectTasksChanged)) { _ in
                if visible && LiveRefresh.inFront(phase) { tasksPending = debounced(tasksPending, onTasks) }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nexusAttendanceChanged)) { _ in
                if visible && LiveRefresh.inFront(phase) { Task { await onAttendance() } }
            }
    }

    private func debounced(_ pending: Task<Void, Never>?, _ work: @escaping () async -> Void) -> Task<Void, Never> {
        pending?.cancel()
        return Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await work()
        }
    }
}
