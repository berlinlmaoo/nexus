import Foundation
import UIKit

/// A check-in or check-out the server never received.
///
/// Attendance is the one thing in this app that cannot be re-created later: if the server is
/// unreachable at 09:00, nobody can prove afterwards that they arrived on time. Chat and projects
/// can wait an hour; this cannot. So the tap is written to disk with everything the server will
/// eventually need, and replayed once the network is back.
struct PendingAttendance: Codable, Identifiable, Sendable {
    enum Kind: String, Codable, Sendable { case checkIn, checkOut }

    /// Also the server-side idempotency key. Generated once, here, and reused on every retry so a
    /// reply that got lost on the way back cannot turn into a second check-in.
    let id: String
    let kind: Kind
    /// When the person actually tapped — this becomes the recorded time, not the moment the queue
    /// happens to drain.
    let deviceAt: Date
    /// Seconds since the device booted. Stored because a wall clock is trivial to move while an
    /// uptime that stays consistent across a whole queue is not, which is what makes an audit
    /// possible if a recorded time is ever disputed.
    let uptimeSec: Int
    let lat: Double
    let lng: Double
    /// The rest of what CoreLocation reported. Offline is the easiest moment to fake a position,
    /// so it is the last moment that should reach the server without its supporting signals.
    let accuracyM: Double?
    let altitudeM: Double?
    let speedMps: Double?
    let simulated: Bool?
    let fromAccessory: Bool?
    let notes: String?
    let reflection: String?
    let offsite: Bool
    let reason: String?
    /// Retries are bounded: a tap the server keeps refusing must not loop forever.
    var attempts: Int
}

@MainActor
@Observable
final class AttendanceQueue {
    static let shared = AttendanceQueue()

    private(set) var pending: [PendingAttendance] = []
    private(set) var lastError: String?
    private var flushing = false

    /// After this many failed replays the entry is dropped and reported. Reaching it means the
    /// server is answering and refusing, not that it is unreachable — retrying cannot help.
    private let maxAttempts = 5

    private let dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("attendance-queue", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    private var indexURL: URL { dir.appendingPathComponent("queue.json") }
    private func selfieURL(_ id: String) -> URL { dir.appendingPathComponent("\(id).jpg") }

    private init() { load() }

    var count: Int { pending.count }

    // MARK: - storing

    /// Called when a live attempt failed because the server could not be reached at all.
    /// `id` is the idempotency key, and the caller passes the SAME one it already sent on the live
    /// attempt. That matters for the case nobody sees coming: a tap that actually reached the
    /// server and was recorded, whose reply was lost on the way back. Replayed under the same id
    /// the server hands back the record it already has; replayed under a fresh one it looks like a
    /// second check-in, gets refused, and the queue eventually throws the tap away.
    func enqueue(id: String = UUID().uuidString,
                 kind: PendingAttendance.Kind, lat: Double, lng: Double, selfie: Data,
                 notes: String? = nil, reflection: String? = nil,
                 offsite: Bool = false, reason: String? = nil,
                 fix: LocationManager.Fix? = nil) {
        let entry = PendingAttendance(
            id: id,
            kind: kind,
            deviceAt: Date(),
            uptimeSec: Int(ProcessInfo.processInfo.systemUptime),
            lat: lat, lng: lng,
            accuracyM: fix?.accuracyM, altitudeM: fix?.altitudeM, speedMps: fix?.speedMps,
            simulated: fix?.simulated, fromAccessory: fix?.fromAccessory,
            notes: notes, reflection: reflection,
            offsite: offsite, reason: reason,
            attempts: 0
        )
        // The selfie is the bulky part, so it lives beside the index rather than inside it.
        try? selfie.write(to: selfieURL(id), options: .atomic)
        pending.append(entry)
        save()
    }

    // MARK: - replaying

    func flush() async {
        guard !flushing, !pending.isEmpty else { return }
        flushing = true
        defer { flushing = false }

        // Oldest first: the order people actually tapped is the order the day has to be rebuilt in,
        // otherwise a check-out can arrive before the check-in it belongs to.
        for entry in pending.sorted(by: { $0.deviceAt < $1.deviceAt }) {
            guard let selfie = try? Data(contentsOf: selfieURL(entry.id)) else {
                // No selfie means nothing sendable is left; drop it rather than retry forever.
                remove(entry.id)
                continue
            }
            // Rebuilt from what was stored so the replay carries exactly the evidence the live
            // attempt would have carried.
            let fix = entry.accuracyM.map {
                LocationManager.Fix(
                    latitude: entry.lat, longitude: entry.lng,
                    accuracyM: $0, altitudeM: entry.altitudeM, speedMps: entry.speedMps,
                    capturedAt: entry.deviceAt,
                    simulated: entry.simulated ?? false,
                    fromAccessory: entry.fromAccessory ?? false)
            }
            do {
                switch entry.kind {
                case .checkIn:
                    _ = try await APIClient.shared.checkIn(
                        lat: entry.lat, lng: entry.lng, selfie: selfie, notes: entry.notes,
                        fix: fix,
                        clientId: entry.id, deviceAt: entry.deviceAt, uptimeSec: entry.uptimeSec)
                case .checkOut:
                    _ = try await APIClient.shared.checkOut(
                        lat: entry.lat, lng: entry.lng, selfie: selfie,
                        reflection: entry.reflection ?? "",
                        offsite: entry.offsite, reason: entry.reason,
                        fix: fix,
                        clientId: entry.id, deviceAt: entry.deviceAt, uptimeSec: entry.uptimeSec)
                }
                remove(entry.id)
                lastError = nil
            } catch APIError.offline {
                // Still unreachable. Stop here rather than hammering the rest of the queue.
                return
            } catch APIError.unauthorized {
                // Nothing to retry until the person logs back in; leave the queue intact.
                return
            } catch {
                bumpAttempts(entry.id, message: error.localizedDescription)
                return
            }
        }
    }

    // MARK: - persistence

    private func remove(_ id: String) {
        pending.removeAll { $0.id == id }
        try? FileManager.default.removeItem(at: selfieURL(id))
        save()
    }

    private func bumpAttempts(_ id: String, message: String) {
        guard let i = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[i].attempts += 1
        lastError = message
        if pending[i].attempts >= maxAttempts {
            // The server is answering and refusing. Keeping it would replay a rejection forever.
            remove(id)
            lastError = message
        } else {
            save()
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(pending) else { return }
        try? data.write(to: indexURL, options: .atomic)
        // Every mutation of the queue funnels through here, so this is the single place that can
        // keep the Island honest about what has and has not reached the server.
        AttendancePresence.refresh()
    }

    private func load() {
        guard let data = try? Data(contentsOf: indexURL),
              let rows = try? JSONDecoder().decode([PendingAttendance].self, from: data) else { return }
        pending = rows
    }
}
