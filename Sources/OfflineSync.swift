import Foundation
import Network
import SwiftUI

/// Everything NEXUS needs in order to be useful with no signal, fetched while there still is one.
///
/// The app has always cached what somebody happened to open. That is the wrong half: the moment
/// the network goes is exactly the moment nobody has opened anything yet. This fetches ahead —
/// today's attendance, this period's board, the projects this person is actually in and their
/// tasks, the submissions queue — and then the FILES those things point at, so a receipt or a
/// selfie can still be looked at on a site with no bars.
///
/// Two stages, and the difference matters:
///   • DATA is small, fast and always worth doing. The splash waits for it.
///   • MEDIA is large and slow. It runs on afterwards, never blocks anything, is skipped on a
///     metered connection, and lives inside a budget it enforces itself.
///
/// Nothing here ever deletes or writes anything on the server. The worst a failed sync can do is
/// leave the app showing what it had before.
@MainActor
final class OfflineSync: ObservableObject {
    static let shared = OfflineSync()

    enum Stage: Equatable { case idle, data, media, done }

    @Published private(set) var stage: Stage = .idle
    /// What it is doing, in words somebody would use. Shown on the splash.
    @Published private(set) var status = ""
    /// 0…1 once the amount of work is known; nil while it is not.
    @Published private(set) var progress: Double?
    @Published private(set) var lastDataSync: Date?
    @Published private(set) var lastMediaSync: Date?
    /// How much of the phone the offline copies are using, refreshed after a media pass.
    @Published private(set) var offlineBytes = 0

    private var running = false
    private var mediaTask: Task<Void, Never>?
    private let monitor = NWPathMonitor()
    private var metered = false
    private var offline = false

    private enum Key {
        static let lastData = "offline.lastDataSync"
        static let lastMedia = "offline.lastMediaSync"
        static let mediaOverCellular = "offline.mediaOverCellular"
    }

    /// Whether the person has allowed the big downloads on mobile data. Off by default: a 1 GB
    /// prefetch on somebody's own quota is not a default anybody would have chosen.
    var mediaOverCellular: Bool {
        get { UserDefaults.standard.bool(forKey: Key.mediaOverCellular) }
        set { UserDefaults.standard.set(newValue, forKey: Key.mediaOverCellular) }
    }

    private init() {
        lastDataSync = UserDefaults.standard.object(forKey: Key.lastData) as? Date
        lastMediaSync = UserDefaults.standard.object(forKey: Key.lastMedia) as? Date
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.metered = path.isExpensive || path.isConstrained
                self?.offline = path.status != .satisfied
            }
        }
        monitor.start(queue: DispatchQueue(label: "id.znetworks.nexus.netpath"))
    }

    /// True when there is nothing worth showing yet — the first launch, or a reinstall.
    var isCold: Bool { lastDataSync == nil }

    /// How stale what the app is showing might be, in words. nil when it was refreshed just now.
    var freshnessLabel: String? {
        guard let at = lastDataSync else { return nil }
        let seconds = Date().timeIntervalSince(at)
        if seconds < 120 { return nil }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .full
        return String(format: T("Showing data from %@"), f.localizedString(for: at, relativeTo: Date()))
    }

    // MARK: - the passes

    /// The small, fast half. Safe to await: it gives up on the network rather than on the person.
    @discardableResult
    func syncData(userId: String) async -> Bool {
        guard !running else { return false }
        running = true
        stage = .data
        progress = 0
        defer { running = false }

        let api = APIClient.shared
        // Ordered by what somebody opening the app actually looks at first.
        var steps: [(String, () async -> Void)] = [
            (T("Today's attendance"), { _ = try? await api.attendanceToday() }),
            (T("Your tasks"), { _ = try? await api.myTasks(assigneeId: userId) }),
            (T("Your projects"), { _ = try? await api.projects() }),
            (T("Your profile"), { _ = try? await api.profile(); _ = try? await api.gamification() }),
            (T("Attendance board"), {
                let month = Self.monthKey()
                _ = try? await api.attendanceHistory(scope: "me", month: month)
                _ = try? await api.attendanceRequests(scope: "me")
            }),
            (T("Your submissions"), { _ = try? await api.mySubmissions() }),
        ]
        // Each project the person is in, with its tasks. Fetched after the list, because the list
        // is what says which projects those are.
        steps.append((T("Project details"), { [weak self] in
            guard let projects = try? await api.projects() else { return }
            for (i, p) in projects.enumerated() {
                if Task.isCancelled { return }
                _ = try? await api.project(p.id)
                _ = try? await api.projectTasks(p.id)
                await MainActor.run { self?.status = String(format: T("Project %d of %d"), i + 1, projects.count) }
            }
        }))

        for (i, step) in steps.enumerated() {
            if Task.isCancelled { break }
            status = step.0
            await step.1()
            progress = Double(i + 1) / Double(steps.count)
        }
        lastDataSync = Date()
        UserDefaults.standard.set(lastDataSync, forKey: Key.lastData)
        stage = .done
        status = ""
        progress = nil
        return true
    }

    /// The large half: the files those records point at. Never awaited by anything the person is
    /// waiting on, and it stops itself the moment the connection turns metered.
    func syncMedia(userId: String) {
        mediaTask?.cancel()
        mediaTask = Task { [weak self] in
            guard let self else { return }
            guard await self.shouldFetchMedia() else { return }
            await MainActor.run { self.stage = .media }
            let api = APIClient.shared

            // 1. Attendance evidence for this period — the selfies a board cell opens.
            var files: [(url: String, name: String)] = []
            if let rows = try? await api.attendanceHistory(scope: "me", month: Self.monthKey()) {
                for r in rows {
                    // Stored under the ABSOLUTE url, because that is the string the image loader
                    // will later look it up by: a selfie is drawn by `CachedImage`, which is handed
                    // `AttendanceRow.fileURL(...)` — the same relative path with the host already
                    // glued on. Saving it under the raw path would put the file on the device and
                    // still leave the board blank, which is the worst of both.
                    if let u = AttendanceRow.fileURL(r.checkInPhotoUrl)?.absoluteString {
                        files.append((u, "checkin-\(r.idv).jpg"))
                    }
                    if let u = AttendanceRow.fileURL(r.checkOutPhotoUrl)?.absoluteString {
                        files.append((u, "checkout-\(r.idv).jpg"))
                    }
                }
            }
            // 2. Whatever hangs off the tasks of the projects this person is in.
            if let projects = try? await api.projects() {
                for p in projects {
                    if Task.isCancelled { return }
                    guard let tasks = try? await api.projectTasks(p.id) else { continue }
                    for t in tasks.prefix(80) {
                        if Task.isCancelled { return }
                        guard let atts = try? await api.taskAttachments(t.id) else { continue }
                        for a in atts {
                            guard let u = a.url, !u.isEmpty else { continue }
                            // A film nobody asked for is not worth somebody's storage; the viewer
                            // still streams anything larger on demand.
                            if let size = a.size, size > 40 << 20 { continue }
                            files.append((u, a.name ?? "file"))
                        }
                    }
                }
            }

            let total = max(files.count, 1)
            for (i, f) in files.enumerated() {
                if Task.isCancelled { return }
                guard await self.shouldFetchMedia() else { return }
                _ = try? await api.downloadAttachment(url: f.url, fileName: f.name, offline: true)
                await MainActor.run {
                    self.progress = Double(i + 1) / Double(total)
                    self.status = String(format: T("Files %d of %d"), i + 1, total)
                }
            }
            AttachmentCache.sweepOffline()
            let used = AttachmentCache.offlineBytes()
            await MainActor.run {
                self.offlineBytes = used
                self.lastMediaSync = Date()
                UserDefaults.standard.set(self.lastMediaSync, forKey: Key.lastMedia)
                self.stage = .done
                self.status = ""
                self.progress = nil
            }
        }
    }

    /// Everything, in the order somebody would want it: the small half first so the app is usable,
    /// then the files in the background.
    func syncAll(userId: String) async {
        await syncData(userId: userId)
        syncMedia(userId: userId)
    }

    func cancelMedia() { mediaTask?.cancel(); mediaTask = nil }

    /// Wiped with the session, like every other cache: an offline copy of somebody's project files
    /// must not outlive their login.
    func reset() {
        cancelMedia()
        AttachmentCache.clearOffline()
        UserDefaults.standard.removeObject(forKey: Key.lastData)
        UserDefaults.standard.removeObject(forKey: Key.lastMedia)
        lastDataSync = nil
        lastMediaSync = nil
        offlineBytes = 0
        stage = .idle
    }

    private func shouldFetchMedia() async -> Bool {
        await MainActor.run { !offline && (!metered || mediaOverCellular) }
    }

    static func monthKey(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM"
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: date)
    }
}
