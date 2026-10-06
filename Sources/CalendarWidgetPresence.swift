import Foundation
import WidgetKit

/// The funnel between the server's calendar and the calendar widgets (0.1.7).
///
/// A widget has no session and never talks to the API, so the app fetches `/api/calendar/glance` for
/// each scope — Mine, My division, Everyone — and leaves the answers in the App Group, where every
/// calendar widget works its picture out of them against the clock (Shared/CalendarGlance.swift).
/// All three are fetched because which scope a widget shows is chosen on the Home Screen, out of the
/// app's sight; each answer is at most ~64 KB and a poll that finds nothing new is a 304.
///
/// Shaped like GlancePresence: one writer, one place that reloads timelines.
@MainActor
enum CalendarWidgetPresence {
    private static var lastRun: Date?
    private static var running = false
    /// Bumped on sign-out: a run still in flight stops instead of blocking the next account's.
    private static var generation = 0
    /// Coming back to the app every few seconds must not mean three requests each time.
    private static let minGap: TimeInterval = 5 * 60
    /// An answer the same as the one saved is neither saved nor redrawn — unless the saved one is this
    /// old: then it is saved again, so a widget's "Updated 14:05" does not fall hours behind.
    private static let resaveAfter: TimeInterval = 2 * 3600
    /// Every calendar widget and Lock Screen accessory (Widgets/CalendarWidgetKit.swift's two bundles).
    /// A calendar kind added there belongs here too, or it only redraws on its own schedule.
    private static let calendarKinds = [
        "NEXUSCalendarMonth", "NEXUSCalendarUpcoming", "NEXUSCalendarWeek",
        "NEXUSCalendarListDo", "NEXUSCalendarListPlan", "NEXUSCalendarListAct", "NEXUSCalendarListLater",
        "NEXUSCalendarNext", "NEXUSCalendarWeekStrip", "NEXUSCalendarRing", "NEXUSCalendarInline",
    ]

    /// When the app comes to the front, after sign-in, after the Calendar or the dashboard loads, and
    /// from the background refresh. Throttled unless `force`. A failed request keeps the last answer —
    /// the widget says how old it is and stops claiming it after two days.
    static func refresh(force: Bool = false) async {
        #if targetEnvironment(macCatalyst)
        // No App Group on the Mac (see AttendanceSnapshot.appGroup): nothing would ever read this.
        return
        #else
        // First, signed in or not: the "Open NEXUS to sign in" a signed-out widget shows is in the
        // app's language too.
        mirrorLanguage()
        guard !running else { return }
        if !force, let last = lastRun, Date().timeIntervalSince(last) < minGap { return }
        guard let userId = Keychain.load()?.userId else { return }
        guard RemoteConfig.shared.calendar, RemoteConfig.shared.calendarWidgets else {
            // Switched off from the server: the widgets fall back to "Open NEXUS" instead of
            // showing whatever they had last.
            if GlanceScope.allCases.contains(where: { GlanceStore.load($0) != nil }) {
                GlanceStore.clear()
                reloadCalendarWidgets()
            }
            return
        }
        running = true
        let gen = generation
        defer { if generation == gen { running = false } }
        lastRun = Date()
        var changed = false
        for scope in GlanceScope.allCases {
            if Task.isCancelled || generation != gen { break }
            guard let snapshot = try? await APIClient.shared.calendarGlance(scope: scope) else { continue }
            // Signed out (or into another account) while the request was in flight: never save
            // somebody's tasks under the next person's widgets.
            guard generation == gen, Keychain.load()?.userId == userId, snapshot.userId == userId else { continue }
            // Nothing new: nothing to save or redraw. Every answer used to count as a change, and
            // reloaded every widget the app has — the attendance one included — from the background
            // refresh too, where WidgetKit budgets reloads (impeccable re-audit, 7 Oct 2026).
            if let saved = GlanceStore.load(scope), saved.userId == userId, saved.snapshot == snapshot,
               Date().timeIntervalSince(saved.savedAt) < resaveAfter {
                continue
            }
            GlanceStore.save(snapshot, scope: scope)
            changed = true
        }
        if changed { reloadCalendarWidgets() }
        #endif
    }

    /// The calendar's own widgets only: the attendance and dashboard widgets share WidgetKit's daily
    /// reload budget, and a calendar answer has nothing new for them.
    private static func reloadCalendarWidgets() {
        for kind in calendarKinds { WidgetCenter.shared.reloadTimelines(ofKind: kind) }
    }

    /// The widgets speak the app's language, which lives in the app's own defaults — out of the
    /// extension's reach — so it is copied into the App Group.
    static func mirrorLanguage() {
        GlanceStore.saveLanguage(AppLanguage.shared.lang.rawValue)
    }

    /// The language was switched in Settings: redraw every widget in it now, not at the next refresh.
    static func languageChanged() {
        mirrorLanguage()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Signing out. AttendancePresence.stop() calls this, so logging out stays ONE place.
    static func stop() {
        generation += 1
        running = false
        GlanceStore.clear()
        lastRun = nil
    }
}
