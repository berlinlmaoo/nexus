import Foundation
import UIKit
import UserNotifications

@MainActor
final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    private let center = UNUserNotificationCenter.current()
    private let tokenKey = "nexus.apns-token"
    private let deviceIDKey = "nexus.device-id"
    private let pushActiveKey = "nexus.push-active"
    private let taskPrefix = "nexus.task."
    private let attendancePrefix = "nexus.attendance."

    /// True once our own backend has accepted this device's APNs token.
    ///
    /// It matters because the server sends the SAME reminders this class schedules locally —
    /// `notification-service.ts` fires `task_due_2d` / `task_due_1d` / `task_due_now` at the same
    /// three stages, and `notifyAttendanceReminder` uses the identical title "Attendance reminder"
    /// 15 minutes before the shift. With both alive, every reminder lands TWICE.
    ///
    /// So the local schedule is a FALLBACK, not a second channel: it runs while push can't be
    /// delivered (today the route is missing in production) and switches itself off the moment the
    /// server starts accepting tokens. Persisted, so a cold start knows before the first request.
    private var pushDeliveryActive: Bool {
        get { UserDefaults.standard.bool(forKey: pushActiveKey) }
        set { UserDefaults.standard.set(newValue, forKey: pushActiveKey) }
    }

    // MARK: diagnostics
    //
    // Everything below only exists so a human can answer "did push actually work?" on a real
    // device. The APNs token used to live in UserDefaults and be shown nowhere, and a failed
    // registration was swallowed entirely — so a silent failure and a working setup looked
    // identical from the outside. You cannot send a test push without the token.

    /// Set by the app delegate when APNs refuses to issue a token (no entitlement, no network,
    /// no provisioning profile for push, …). `nil` means "no failure recorded".
    private(set) var registrationError: String?

    /// The hex APNs token, or nil if one was never issued.
    var deviceToken: String? { UserDefaults.standard.string(forKey: tokenKey) }

    /// "sandbox" (development build) or "production" (TestFlight/App Store). A push sent to the
    /// wrong APNs host is rejected with BadDeviceToken, which is the classic "it silently
    /// doesn't work" case.
    var environmentName: String { pushEnvironment }

    /// Whether this device is still scheduling its own reminders because the server can't deliver
    /// them yet. Surfaced in Tuning Room so the behaviour isn't invisible.
    var localFallbackActive: Bool { !pushDeliveryActive }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func recordRegistrationFailure(_ error: Error) {
        registrationError = error.localizedDescription
    }

    func activate(userId: String) async {
        do {
            let settings = await center.notificationSettings()
            let granted: Bool
            if settings.authorizationStatus == .notDetermined {
                granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            } else {
                granted = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
            }
            guard granted else { return }
            UIApplication.shared.registerForRemoteNotifications()
            await registerStoredToken()
            await reconcileReminders(userId: userId)
        } catch {
            // Notifications are additive; a denial or scheduling failure must never block the app.
        }
    }

    func receivedDeviceToken(_ data: Data) async {
        let token = data.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: tokenKey)
        registrationError = nil
        await registerStoredToken()
        // The token arrives asynchronously, so on a first launch the local reminders were already
        // queued by the time the server accepted it. Clear them here too.
        if pushDeliveryActive { await cancelLocallyScheduledReminders() }
    }

    func unregister(session: Session) async {
        guard let token = UserDefaults.standard.string(forKey: tokenKey) else { return }
        try? await APIClient.shared.unregisterPushDevice(token: token, session: session)
    }

    func reconcileReminders(userId: String) async {
        // Server is delivering these — drop anything we queued earlier and stay out of its way,
        // otherwise the user gets each reminder twice (see `pushDeliveryActive`).
        guard !pushDeliveryActive else { await cancelLocallyScheduledReminders(); return }
        async let taskResult = try? APIClient.shared.myTasks(assigneeId: userId)
        async let attendanceResult = try? APIClient.shared.attendanceToday()
        if let tasks = await taskResult { await scheduleTaskReminders(tasks) }
        if let attendance = await attendanceResult { await scheduleAttendanceReminder(attendance) }
    }

    private func cancelLocallyScheduledReminders() async {
        let pending = await center.pendingNotificationRequests()
        let ours = pending.map(\.identifier).filter { $0.hasPrefix(taskPrefix) || $0.hasPrefix(attendancePrefix) }
        guard !ours.isEmpty else { return }
        center.removePendingNotificationRequests(withIdentifiers: ours)
    }

    /// Result of the last attempt to hand the token to our own backend, or nil if it worked.
    /// This used to be `try?` with nothing kept: if the route was missing or rejected the token,
    /// the app carried on looking perfectly healthy while push could never arrive.
    private(set) var backendError: String?

    private func registerStoredToken() async {
        guard Keychain.load() != nil,
              let token = UserDefaults.standard.string(forKey: tokenKey)
        else { return }
        do {
            try await APIClient.shared.registerPushDevice(
                token: token,
                deviceId: deviceID,
                environment: pushEnvironment
            )
            backendError = nil
            pushDeliveryActive = true
        } catch {
            backendError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            // Server can't take the token → it can't send anything either, so the local fallback
            // has to come back. This is what makes the switch self-correcting in both directions.
            pushDeliveryActive = false
        }
    }

    private var deviceID: String {
        if let value = UserDefaults.standard.string(forKey: deviceIDKey) { return value }
        let value = UUID().uuidString
        UserDefaults.standard.set(value, forKey: deviceIDKey)
        return value
    }

    /// Development-signed builds carry a readable embedded provisioning profile. TestFlight/App
    /// Store builds do not, and use production APNs.
    private var pushEnvironment: String {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              text.contains("<string>development</string>")
        else { return "production" }
        return "sandbox"
    }

    private func scheduleTaskReminders(_ tasks: [MyTask]) async {
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(taskPrefix) })

        let now = Date()
        let active = tasks.compactMap { task -> (MyTask, Date)? in
            let status = (task.status ?? "").uppercased()
            guard status != "DONE", status != "CANCELLED", let due = parseISO(task.dueDate) else { return nil }
            return (task, normalizedDueDate(due))
        }.sorted { $0.1 < $1.1 }

        // iOS keeps at most 64 pending local notifications. Three reminders for the nearest 20
        // tasks leaves room for attendance and system-managed requests.
        for (task, due) in active.prefix(20) {
            if due <= now {
                let marker = "nexus.overdue.\(task.id)"
                guard UserDefaults.standard.string(forKey: marker) != task.dueDate else { continue }
                UserDefaults.standard.set(task.dueDate, forKey: marker)
                await addNotification(
                    id: "\(taskPrefix)\(task.id).overdue",
                    title: "Task overdue",
                    body: "\(task.title ?? "A task") has passed its due date.",
                    date: now.addingTimeInterval(3),
                    userInfo: ["type": "task_due", "taskId": task.id]
                )
                continue
            }

            for days in [2, 1, 0] {
                guard let fire = jakartaCalendar.date(byAdding: .day, value: -days, to: due), fire > now else { continue }
                let title = days == 0 ? "Task due today" : "Task due in \(days) day\(days == 1 ? "" : "s")"
                await addNotification(
                    id: "\(taskPrefix)\(task.id).d\(days)",
                    title: title,
                    body: task.title ?? "You have an upcoming task deadline.",
                    date: fire,
                    userInfo: ["type": "task_due", "taskId": task.id]
                )
            }
        }
    }

    private func scheduleAttendanceReminder(_ attendance: AttendanceToday) async {
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(attendancePrefix) })
        guard attendance.today?.hasCheckedIn != true,
              let day = attendance.attendanceDateKey,
              let start = attendance.myShift?.startTime,
              let shiftStart = parseShift(day: day, time: start),
              let fire = jakartaCalendar.date(byAdding: .minute, value: -15, to: shiftStart),
              fire > Date()
        else { return }
        await addNotification(
            id: "\(attendancePrefix)\(day).checkin",
            title: "Attendance reminder",
            body: "Your shift starts at \(start). Don't forget to check in.",
            date: fire,
            userInfo: ["type": "attendance_checkin", "date": day]
        )
    }

    /// A queued tap the server answered with a refusal. Delivered at once, because the person is
    /// usually not looking at the app when the queue drains — and a refused check-in that nobody is
    /// told about becomes an absence at 02:00.
    func reportQueueRefusal(kind: PendingAttendance.Kind, at: Date) async {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        let content = UNMutableNotificationContent()
        content.title = kind == .checkIn ? T("Offline check-in refused") : T("Offline check-out refused")
        content.body = (kind == .checkIn ? T("Your check-in at") : T("Your check-out at")) + " \(f.string(from: at)) "
            + T("was outside the office radius when it was sent. Open Attendance for what to do next.")
        content.sound = .default
        content.userInfo = ["type": "attendance_queue_refused", "link": "/attendance"]
        try? await center.add(UNNotificationRequest(identifier: "nexus.queue-refused.\(UUID().uuidString)", content: content, trigger: nil))
    }

    private func addNotification(id: String, title: String, body: String, date: Date, userInfo: [String: String]) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = userInfo
        var components = jakartaCalendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        components.timeZone = jakartaCalendar.timeZone
        let request = UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
        try? await center.add(request)
    }

    private var jakartaCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Jakarta")!
        return calendar
    }

    private func normalizedDueDate(_ date: Date) -> Date {
        let parts = jakartaCalendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard parts.hour == 0, parts.minute == 0 else { return date }
        var due = parts
        due.hour = 9
        return jakartaCalendar.date(from: due) ?? date
    }

    private func parseShift(day: String, time: String) -> Date? {
        let values = (day.split(separator: "-") + time.split(separator: ":")).compactMap { Int($0) }
        guard values.count >= 5 else { return nil }
        return jakartaCalendar.date(from: DateComponents(
            timeZone: jakartaCalendar.timeZone,
            year: values[0], month: values[1], day: values[2], hour: values[3], minute: values[4]
        ))
    }

    private func parseISO(_ value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    /// A tap on a notification. Until 0.1.5 this did nothing at all — the app opened on whatever it
    /// was last showing, and the person went looking for the request the push was about.
    ///
    /// Only the string values are kept: that is all the server sends (src/lib/apns.ts) and all the
    /// router reads, and `[String: String]` crosses to the main actor without a warning where the
    /// raw `[AnyHashable: Any]` would not.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        var info: [String: String] = [:]
        for (key, value) in response.notification.request.content.userInfo {
            if let key = key as? String, let value = value as? String { info[key] = value }
        }
        Task { @MainActor in AppRouter.shared.openNotification(info) }
        completionHandler()
    }
}

final class NotificationAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationManager.shared
        // Here rather than in NexusApp.init: iOS refuses a handler registered after this method
        // returns, and refuses it by trapping.
        BackgroundRefresh.register()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await NotificationManager.shared.receivedDeviceToken(deviceToken) }
    }

    /// APNs refusing to issue a token was previously not handled at all — the app looked exactly
    /// the same whether push was working or completely dead. Keep the reason so Tuning Room can
    /// show it instead of an empty box.
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in NotificationManager.shared.recordRegistrationFailure(error) }
    }
}
