import SwiftUI
import Combine
import Observation

/// The fallback period of the live screens.
enum LiveRefreshPolicy {
    /// Multiplies every screen's fallback period. 1 while the app has no realtime connection;
    /// RealtimeClient raises it while it is connected, because events carry the news then and the
    /// timer is only a safety net, and puts it back to 1 the moment the connection drops.
    @MainActor static var stretch: Double {
        get { LiveRefreshClock.shared.stretch }
        set { LiveRefreshClock.shared.stretch = max(1, newValue) }
    }

    @MainActor static func interval(_ base: TimeInterval) -> TimeInterval { base * stretch }
}

/// Where `LiveRefreshPolicy.stretch` is kept: observable, so a timer loop keyed on it restarts at the
/// new pace the moment it changes. Without that, a screen asleep for its stretched period when the
/// connection dropped would stay asleep for minutes with nothing else to wake it.
@MainActor
@Observable
final class LiveRefreshClock {
    static let shared = LiveRefreshClock()
    fileprivate(set) var stretch: Double = 1
    private init() {}
}

/// Keeps a screen current without a pull to refresh (owner, 8 Oct 2026: a project restored or moved
/// on one device did not show on another until someone reloaded by hand).
///
/// Runs `action`, the screen's own QUIET reload:
/// - when one of `names` is posted (RealtimeClient posts them as the server's events arrive; see
///   RealtimeNames.swift),
/// - at once when the app comes back to the front with this screen up,
/// - at once when the screen comes back into view, if `refreshOnReturn`,
/// - and every `interval` seconds as a fallback (stretched while the realtime connection is up).
///
/// Only while the screen is on screen and the app is in front: pushed under another screen, on
/// another tab, or in the background it does nothing and costs nothing. The timer is a `.task`, so
/// SwiftUI cancels it with the view. The screen's first load stays the screen's own business.
struct LiveRefresh: ViewModifier {
    let interval: TimeInterval
    let names: [Notification.Name]
    /// For an event that carries a `RealtimeKey.kind`: the kinds this screen cares about. nil = all.
    /// An event without a kind always counts.
    let kinds: Set<String>?
    /// The project this screen shows. An event naming another project is not for it; an event
    /// naming none counts.
    let projectId: String?
    /// The task this screen shows. An event naming another task counts only when that task is a
    /// subtask of this one (its `RealtimeKey.parentId`); an event naming none counts.
    let taskId: String?
    /// The conversation this screen shows. An event naming another conversation is not for it; an
    /// event naming none counts.
    let conversationId: String?
    let refreshOnReturn: Bool
    let action: () async -> Void

    @Environment(\.scenePhase) private var scenePhase
    @State private var clock = LiveRefreshClock.shared
    @State private var onScreen = false
    @State private var appearedBefore = false
    /// Something happened while the screen could not refresh (the app was in the background, or the
    /// screen was covered and `refreshOnReturn` is on): catch up the moment it is live again.
    @State private var owed = false
    @State private var running = false
    @State private var again = false

    private var live: Bool { onScreen && Self.inFront(scenePhase) }

    /// What restarts the timer loop: going live or not, and a new pace.
    private struct Pace: Equatable {
        let live: Bool
        let stretch: Double
    }

    /// Whether the app counts as in front. A Mac window stays on screen while another app has the
    /// focus (the scene is `.inactive` then), and a colleague's board is read exactly like that, so
    /// on the Mac only a hidden or minimised app stops. On a phone `.inactive` is the app switcher,
    /// Control Centre or a call, and only `.active` counts. RealtimeClient connects by the same rule.
    static func inFront(_ phase: ScenePhase) -> Bool {
        #if targetEnvironment(macCatalyst)
        return phase != .background
        #else
        return phase == .active
        #endif
    }

    func body(content: Content) -> some View {
        content
            .onAppear {
                if appearedBefore && refreshOnReturn { owed = true }
                appearedBefore = true
                onScreen = true
            }
            .onDisappear { onScreen = false }
            .onChange(of: scenePhase) { _, phase in
                if !Self.inFront(phase), onScreen { owed = true }
            }
            // `id` restarts the loop whenever the screen or the app goes live or stops being live, and
            // when the realtime connection changes the pace; the restart catches up at once if
            // anything was missed meanwhile.
            .task(id: Pace(live: live, stretch: clock.stretch)) {
                guard live else { return }
                if owed {
                    owed = false
                    await fire()
                }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(LiveRefreshPolicy.interval(interval)))
                    if Task.isCancelled { return }
                    await fire()
                }
            }
            .onReceive(events) { note in
                guard wants(note) else { return }
                if live {
                    Task { await fire() }
                } else if onScreen {
                    owed = true
                }
            }
    }

    private var events: AnyPublisher<Notification, Never> {
        Publishers.MergeMany(names.map { NotificationCenter.default.publisher(for: $0) })
            .receive(on: DispatchQueue.main)
            .eraseToAnyPublisher()
    }

    private func wants(_ note: Notification) -> Bool {
        let info = note.userInfo
        if let kinds, let kind = info?[RealtimeKey.kind] as? String, !kinds.contains(kind) { return false }
        if let projectId, let theirs = info?[RealtimeKey.projectId] as? String, theirs != projectId { return false }
        if let taskId, let theirs = info?[RealtimeKey.taskId] as? String, theirs != taskId,
           info?[RealtimeKey.parentId] as? String != taskId { return false }
        if let conversationId, let theirs = info?[RealtimeKey.conversationId] as? String,
           theirs != conversationId { return false }
        return true
    }

    /// One reload at a time. An event that lands while one is running asks for a single pass after
    /// it, instead of a second request racing the first; a burst of events is one extra pass.
    private func fire() async {
        if running {
            again = true
            return
        }
        running = true
        repeat {
            again = false
            await action()
        } while again && live
        running = false
    }
}

extension View {
    /// See `LiveRefresh`. `action` must be quiet: no spinner, no error page, and a failed request
    /// leaves what is on screen alone.
    func liveRefresh(every interval: TimeInterval, on names: [Notification.Name], kinds: Set<String>? = nil,
                     projectId: String? = nil, taskId: String? = nil, conversationId: String? = nil,
                     refreshOnReturn: Bool = false, perform action: @escaping () async -> Void) -> some View {
        modifier(LiveRefresh(interval: interval, names: names, kinds: kinds, projectId: projectId, taskId: taskId,
                             conversationId: conversationId,
                             refreshOnReturn: refreshOnReturn, action: action))
    }
}
