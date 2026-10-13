import Foundation
import WidgetKit

/// What the watch app knows about the Calendar, handed to its complications.
///
/// The same `GlanceSnapshot` per scope the phone saves for its widgets, fetched here with the
/// watch's own session and saved into the watch's own shared container — the phone's container is
/// on another device. The complications never talk to the API; they draw this against the clock, so
/// a ring still moves at midnight and a passed task still drops off "Next" while the app sleeps.
@MainActor
enum WatchCalendarGlance {
    /// A face is glanced at all day and the snapshot already holds weeks of tasks, so a fetch on
    /// every raise of the wrist would cost battery and tell nobody anything new.
    private static let minInterval: TimeInterval = 10 * 60
    private static let fetchedAtKey = "nexus.watch.calendar.glanceFetchedAt"

    private static var inFlight = false
    /// A forced refresh (a sign-in) that arrived while another was running: it runs right after, so the
    /// new person's first fetch is never swallowed by the previous one's.
    private static var pendingForce = false
    /// The phone's remote config `flags.calendar && flags.calendarWidgets`, sent in the context
    /// (WatchConnectivityBridge). Absent = an older phone = on.
    static let widgetsOnKey = "nexus.watch.calendarWidgets"
    /// Bumped on sign-out, so an answer that lands after it is dropped instead of putting the
    /// previous person back on the face.
    private static var generation = 0

    /// Fetches all three scopes (Mine / My division / Everyone) and redraws the complications.
    /// Throttled unless `force`. A scope that fails keeps the snapshot it had: offline is not "no tasks".
    static func refresh(force: Bool = false) async {
        mirrorLanguage()
        // Switched off from the server: nothing is fetched (forget() already emptied the face).
        guard UserDefaults.standard.object(forKey: widgetsOnKey) as? Bool ?? true else { return }
        guard let session = WatchAuth.shared.session else { return }
        if inFlight {
            if force { pendingForce = true }
            return
        }
        if !force,
           let last = UserDefaults.standard.object(forKey: fetchedAtKey) as? Date,
           Date().timeIntervalSince(last) < minInterval {
            return
        }
        inFlight = true
        defer {
            inFlight = false
            if pendingForce {
                pendingForce = false
                Task { await refresh(force: true) }
            }
        }
        let started = generation
        let userId = session.userId
        var saved = false
        for scope in GlanceScope.allCases {
            do {
                let snapshot = try await WatchAPI.calendarGlance(session, scope: scope)
                // Signed out, or another account arrived, while this was in flight: never put the
                // previous person's tasks on the next person's face.
                guard started == generation, WatchAuth.shared.session?.userId == userId else { return }
                guard snapshot.userId == userId else { continue }
                GlanceStore.save(snapshot, scope: scope)
                saved = true
            } catch WatchAPI.Failure.server(_) {
                // A reply that did not decode, or a 5xx: that scope's problem only.
                continue
            } catch {
                // Offline, or a dead session (401 — signing in on the phone fixes it): the other
                // scopes would fail the same way, so stop rather than spend more requests learning it.
                break
            }
        }
        guard saved, started == generation else { return }
        UserDefaults.standard.set(Date(), forKey: fetchedAtKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// The complications speak the phone's language, read from the shared container because the
    /// extension cannot see the watch app's own defaults. Redraws only when it actually changed.
    static func mirrorLanguage() {
        let code = WatchLang.isIndonesian ? "id" : "en"
        let changed = (code == "id") != GlanceStore.indonesian
        GlanceStore.saveLanguage(code)
        if changed { WidgetCenter.shared.reloadAllTimelines() }
    }

    /// Signing out: no task of that person stays on the face, and the next person's first fetch is
    /// not throttled by the previous one's. The caller redraws.
    static func forget() {
        generation += 1
        if inFlight { pendingForce = true }
        GlanceStore.clear()
        UserDefaults.standard.removeObject(forKey: fetchedAtKey)
    }
}
