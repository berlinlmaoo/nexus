import Foundation
import UIKit
import UserNotifications

@MainActor
final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    private let center = UNUserNotificationCenter.current()
    private let tokenKey = "nexus.apns-token"
    private let deviceIDKey = "nexus.device-id"
    private let taskPrefix = "nexus.task."
    private let attendancePrefix = "nexus.attendance."

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
        await registerStoredToken()
    }

    func unregister(session: Session) async {
        guard let token = UserDefaults.standard.string(forKey: tokenKey) else { return }
        try? await APIClient.shared.unregisterPushDevice(token: token, session: session)
    }

    func reconcileReminders(userId: String) async {
        async let taskResult = try? APIClient.shared.myTasks(assigneeId: userId)
        async let attendanceResult = try? APIClient.shared.attendanceToday()
        if let tasks = await taskResult { await scheduleTaskReminders(tasks) }
        if let attendance = await attendanceResult { await scheduleAttendanceReminder(attendance) }
    }

    private func registerStoredToken() async {
        guard Keychain.load() != nil,
              let token = UserDefaults.standard.string(forKey: tokenKey)
        else { return }
        try? await APIClient.shared.registerPushDevice(
            token: token,
            deviceId: deviceID,
            environment: pushEnvironment
        )
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

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        completionHandler()
    }
}

final class NotificationAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = NotificationManager.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await NotificationManager.shared.receivedDeviceToken(deviceToken) }
    }
}
