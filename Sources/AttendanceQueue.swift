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
    /// Whose tap this is. Optional so queues written by 0.1.5 still decode; those are adopted by
    /// the session that ends next (`holdForSignIn`) or replayed by the one that is signed in.
    var ownerId: String? = nil
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

    private init() {
        load()
        heldFlag = UserDefaults.standard.bool(forKey: Self.heldKey)
    }

    var count: Int { pending.count }

    // MARK: - held for an update

    /// Entries are waiting because the server refused this BUILD (426), not because it was away.
    ///
    /// Persisted, like the entries themselves: both have to survive a relaunch while locked and
    /// then the App Store update. The entries live in Application Support, which an update never
    /// touches, and the updated build drains them on its first signed-in launch (NexusApp's
    /// `.task(id: userId)` → `flush`) under their original tap time and idempotency key.
    private var heldFlag = false
    private static let heldKey = "nexus.attendanceQueue.heldForUpdate"
    var isHeldForUpdate: Bool { heldFlag && !pending.isEmpty }
    /// The "saved on this phone" popup is owed. Not persisted: it is said when the refusal
    /// happens and when Attendance opens, not on every relaunch of a locked app — the cover
    /// already carries a line about the saved tap.
    var heldNoticeDue = false
    /// Which kinds are waiting, so the popup can say check-in, check-out or both.
    var heldKinds: Set<PendingAttendance.Kind> { Set(pending.map(\.kind)) }

    /// Called when a replay or a live tap met 426 UPGRADE_REQUIRED.
    func holdForUpdate(_ why: String) {
        lastError = why
        heldFlag = true
        UserDefaults.standard.set(true, forKey: Self.heldKey)
        heldNoticeDue = true
    }

    private func releaseHold() {
        guard heldFlag else { return }
        heldFlag = false
        heldNoticeDue = false
        UserDefaults.standard.removeObject(forKey: Self.heldKey)
    }

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
            attempts: 0,
            ownerId: Keychain.load()?.userId
        )
        // The selfie is the bulky part, so it lives beside the index rather than inside it.
        try? selfie.write(to: selfieURL(id), options: .atomic)
        pending.append(entry)
        save()
    }

    // MARK: - replaying

    func flush() async {
        guard !flushing, !pending.isEmpty else { return }
        // While the server refuses this build, every replay is a selfie uploaded only to be refused
        // with 426. The entries wait on disk (Application Support survives an App Store update) and
        // the updated build drains them on its first launch. If the gate is lowered by
        // "Check again", the next flush goes ahead as usual.
        guard AppVersionGate.shared.required == nil else { return }
        flushing = true
        defer { flushing = false }

        // Only the signed-in person's own taps. `persist` already drops anybody else's at sign-in;
        // this is the second lock, so a replay can never go out under another person's cookie.
        let me = Keychain.load()?.userId
        // Oldest first: the order people actually tapped is the order the day has to be rebuilt in,
        // otherwise a check-out can arrive before the check-in it belongs to.
        for entry in pending.sorted(by: { $0.deviceAt < $1.deviceAt })
            where entry.ownerId == nil || entry.ownerId == me {
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
                // `.outsideRadius` comes back as a VALUE, not an error — the live screen answers it
                // with the offsite sheet. Until 0.1.5 the replay discarded it, deleted the entry, and
                // the person was marked absent that night without a word. The server judges the
                // coordinates that were stored, so a retry cannot change the answer: a check-out is
                // re-sent as an offsite one for approval (what the sheet would have offered), and a
                // check-in — which has no offsite form — is dropped but SAID, on screen and as a
                // notification.
                let outcome: AttendanceOutcome
                switch entry.kind {
                case .checkIn:
                    outcome = try await APIClient.shared.checkIn(
                        lat: entry.lat, lng: entry.lng, selfie: selfie, notes: entry.notes,
                        fix: fix,
                        clientId: entry.id, deviceAt: entry.deviceAt, uptimeSec: entry.uptimeSec,
                        tooFarAsOutcome: true)
                case .checkOut:
                    var first = try await APIClient.shared.checkOut(
                        lat: entry.lat, lng: entry.lng, selfie: selfie,
                        reflection: entry.reflection ?? "",
                        offsite: entry.offsite, reason: entry.reason,
                        fix: fix,
                        clientId: entry.id, deviceAt: entry.deviceAt, uptimeSec: entry.uptimeSec)
                    if case .outsideRadius = first, !entry.offsite {
                        first = try await APIClient.shared.checkOut(
                            lat: entry.lat, lng: entry.lng, selfie: selfie,
                            reflection: entry.reflection ?? "",
                            offsite: true,
                            reason: T("Checked out while NEXUS was unreachable; the phone was outside the office radius at the time."),
                            fix: fix,
                            clientId: entry.id, deviceAt: entry.deviceAt, uptimeSec: entry.uptimeSec)
                    }
                    outcome = first
                }
                remove(entry.id)
                if case .outsideRadius = outcome {
                    let when = Self.clock(entry.deviceAt)
                    lastError = entry.kind == .checkIn
                        ? T("Your check-in at") + " \(when) " + T("was refused when it was sent: the phone was outside the office radius. Ask your approver to record it.")
                        : T("Your check-out at") + " \(when) " + T("was refused when it was sent: outside the office radius.")
                    await NotificationManager.shared.reportQueueRefusal(kind: entry.kind, at: entry.deviceAt)
                    continue
                }
                lastError = nil
                // Anything getting through proves this build is accepted again.
                releaseHold()
                // An offline check-in that just landed is the moment the work-hours trail may
                // start — and nothing else fetches today's record here, so ask for it.
                if entry.kind == .checkIn { Task { await WorkLocationTracker.shared.reconcileFromServer() } }
            } catch APIError.offline {
                // Still unreachable. Stop here rather than hammering the rest of the queue.
                return
            } catch APIError.unauthorized {
                // Nothing to retry until the person logs back in; leave the queue intact.
                return
            } catch APIError.upgradeRequired(let why) {
                // The server refused the BUILD, not the tap. Counting it as an attempt would drop a
                // genuine check-in after five activations, for a reason the person fixes by updating,
                // not by doing anything to the tap. So: keep it untouched, stop, and say why — the
                // update cover is already coming up and `holdForUpdate` raises the popup on it.
                holdForUpdate(why)
                return
            } catch {
                bumpAttempts(entry.id, message: error.localizedDescription)
                return
            }
        }
    }

    /// Everything, selfies included. Called on logout: a queued tap belongs to the person who
    /// made it, and until 0.1.5 it stayed on the phone and was replayed under whoever signed in
    /// next — their cookie, the previous person's selfie and coordinates.
    func clearAll() {
        for entry in pending { try? FileManager.default.removeItem(at: selfieURL(entry.id)) }
        pending = []
        lastError = nil
        releaseHold()
        try? FileManager.default.removeItem(at: indexURL)
        AttendancePresence.refresh()
    }

    /// The session ended without the person asking (a 401: the 30-day token ran out, or the
    /// password was reset elsewhere). Their queued taps are KEPT: deleting them is a check-in the
    /// server never sees and a TK the next morning. Entries from before owners were recorded are
    /// stamped with the session that is ending, so a different person signing in next cannot
    /// replay them.
    func holdForSignIn(owner: String?) {
        guard let owner, pending.contains(where: { $0.ownerId == nil }) else { return }
        for i in pending.indices where pending[i].ownerId == nil { pending[i].ownerId = owner }
        save()
    }

    /// A sign-in succeeded. Taps that belong to somebody else are deleted, selfies included; the
    /// person's own ones stay and `flush` sends them under their original tap time.
    func keepOnly(owner: String) {
        let foreign = pending.filter { $0.ownerId != nil && $0.ownerId != owner }
        guard !foreign.isEmpty else { return }
        for entry in foreign { remove(entry.id) }
    }

    /// "09:04" in office time, for the one sentence that names a refused tap.
    private static func clock(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        return f.string(from: date)
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
