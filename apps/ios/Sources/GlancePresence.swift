import Foundation
import WidgetKit

/// The funnel between what the app knows about a person's day and what the Home Screen may show.
///
/// Deliberately shaped like `AttendancePresence`: one place that writes the shared blob and one
/// place that reloads timelines. Three screens each publishing their own version of "how many tasks
/// are due" is how one of them ends up counting something slightly different from the others.
///
/// This lives on the app side, NOT in the shared file, because it speaks in `MyTask` and
/// `Gamification` — app-only types the widget extension must never be made to compile.
@MainActor
enum GlancePresence {

    /// Called when the dashboard finishes loading, which is the one moment all three numbers are
    /// known at once. Cheap and idempotent.
    static func refresh(tasks: [MyTask], unread: Int, game: Gamification?) {
        let open = tasks.filter { !$0.isDone }
        let today = AttendanceSnapshot.currentDateKey()
        let last = NexusGlance.load()

        let glance = NexusGlance(
            dateKey: today,
            openTasks: open.count,
            dueToday: open.filter { dayKey($0.dueDate) == today }.count,
            // Strictly BEFORE today. A task due today is not late until the day is over, and
            // counting it as overdue would make the widget accuse somebody every morning.
            overdue: open.filter { key in
                guard let due = dayKey(key.dueDate) else { return false }
                return due < today
            }.count,
            unreadNotifications: max(0, unread),
            // `game` is nil on the first paint and whenever /gamification failed. Writing zeros then
            // put "LV 0" on the widget; the last blob is the better guess.
            totalXp: game?.xp.totalXp ?? last?.totalXp ?? 0,
            level: game?.xp.level ?? last?.level ?? 0,
            levelName: game?.xp.levelName ?? last?.levelName,
            streak: game?.streak?.current ?? last?.streak,
            updatedAt: Date()
        )
        glance.save()
        WidgetCenter.shared.reloadAllTimelines()
        Task { await CalendarWidgetPresence.refresh() }
    }

    /// Logging out erases it, for the same reason attendance is erased: a widget outlives the
    /// session, and a phone gets handed to somebody else.
    static func stop() {
        NexusGlance.clear()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - helpers

    /// The Jakarta day a due date falls on, as the same "yyyy-MM-dd" string everything else here
    /// compares against.
    ///
    /// Parsed rather than string-sliced. A dueDate arrives as a full ISO instant, so the first ten
    /// characters are its UTC day — and for anything due after 17:00 WIB that is the day BEFORE the
    /// one the person sees in the app. Slicing would quietly mark those overdue a day early.
    private static func dayKey(_ iso: String?) -> String? {
        guard let iso, !iso.isEmpty else { return nil }
        guard let date = isoWithFraction.date(from: iso) ?? isoPlain.date(from: iso) else { return nil }
        return AttendanceSnapshot.currentDateKey(date)
    }

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
