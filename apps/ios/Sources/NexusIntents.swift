import AppIntents

/// Opens the attendance screen.
///
/// It opens the screen and stops there, on purpose. Checking in needs a selfie and a location fix,
/// and checking out needs both plus the reflection — none of which a voice command can supply
/// honestly. An intent that "checked you in" without a face would be the easiest attendance path in
/// the app, and therefore the one everybody used.
struct OpenAttendanceIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Attendance"
    static var description = IntentDescription("Opens the attendance screen, ready to check in or out.")

    /// The work happens in the app, in front of the person doing it.
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRouter.shared.go(.attendance)
        return .result()
    }
}

/// The phrases Siri accepts, and the entry that appears in the Shortcuts app.
struct NEXUSShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenAttendanceIntent(),
            phrases: [
                "Open attendance in \(.applicationName)",
                "Check in with \(.applicationName)",
                "Absen di \(.applicationName)"
            ],
            shortTitle: "Attendance",
            systemImageName: "clock.badge.checkmark.fill"
        )
    }
}
