import Foundation

/// What the Home Screen is allowed to know about a day, beyond attendance.
///
/// ─────────────────────────────────────────────────────────────────────────────
/// Why this exists at all.
///
/// A widget extension has no session and does not get to make a network request here — it is woken
/// for a few milliseconds and handed whatever is already on disk. So every interesting widget idea
/// ("tasks due today", "unread", "your XP") ran into the same wall: the only thing shared with the
/// extension was `AttendanceSnapshot`, and it describes exactly one subject.
///
/// Widening what the app writes is the whole job. Once these numbers are on the other side of the
/// App Group, a medium widget, a Lock Screen XP complication and an iOS 18 Control Widget are each
/// an afternoon of layout rather than a rearchitecture.
///
/// Deliberately kept SEPARATE from `AttendanceSnapshot` rather than bolted onto it. The two are
/// written at different moments by different screens — attendance the instant somebody taps
/// check-in, this one when the dashboard finishes loading — and a single blob would mean whichever
/// writer ran last silently blanked the other half.
///
/// Foundation only: this file is compiled into the widget extension, which must not drag in the
/// app's networking or its appearance work.
/// ─────────────────────────────────────────────────────────────────────────────
struct NexusGlance: Codable, Hashable {
    /// Local day stamp, same rule and same function as `AttendanceSnapshot.dateKey`: a widget that
    /// cannot tell today from yesterday gives a confident wrong answer, which is worse than saying
    /// "open me".
    var dateKey: String

    /// Assigned to me and not done.
    var openTasks: Int
    /// Of those, due today (Jakarta).
    var dueToday: Int
    /// Of those, already past their due date.
    var overdue: Int

    var unreadNotifications: Int

    var totalXp: Int
    var level: Int
    var levelName: String?
    /// Consecutive days, or nil when the server did not say.
    var streak: Int?

    var updatedAt: Date

    /// Nothing to draw. A brand-new install and a person with an empty week look the same here, and
    /// that is correct — both want the widget to say "nothing waiting", not to show zeros in a grid.
    var isEmpty: Bool {
        openTasks == 0 && unreadNotifications == 0 && totalXp == 0
    }

    /// Same refusal as `AttendanceSnapshot.state`: a widget only updates while the app runs, so
    /// yesterday's "3 due today" must not be shown as today's.
    func isFresh(today: String = AttendanceSnapshot.currentDateKey()) -> Bool {
        dateKey == today
    }

    // MARK: - storage

    /// The same App Group as the attendance snapshot, under its own key — see the note above about
    /// why they are two blobs and not one.
    private static let key = "nexus.glance"

    static func load() -> NexusGlance? {
        guard let store = UserDefaults(suiteName: AttendanceSnapshot.appGroup),
              let data = store.data(forKey: key)
        else { return nil }
        return try? JSONDecoder().decode(NexusGlance.self, from: data)
    }

    func save() {
        // A nil suite is normal, not an error: it is what Mac Catalyst sees.
        guard let store = UserDefaults(suiteName: AttendanceSnapshot.appGroup),
              let data = try? JSONEncoder().encode(self)
        else { return }
        store.set(data, forKey: Self.key)
    }

    /// Logging out has to erase this too. A widget left showing one person's XP survives on a phone
    /// handed to somebody else — the same reason `AttendanceSnapshot.clear()` exists.
    static func clear() {
        UserDefaults(suiteName: AttendanceSnapshot.appGroup)?.removeObject(forKey: key)
    }
}
