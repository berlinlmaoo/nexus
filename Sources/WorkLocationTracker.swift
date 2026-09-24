import Foundation
import CoreLocation
import SwiftUI
import UIKit

// Live location while checked in (0.1.6).
//
// Owner's rule, and the whole of it: NEXUS records a position ONLY between a check-in the server
// has accepted and the check-out. Inside the office nothing is sent and no continuous GPS runs —
// region monitoring alone watches the door. Outside, a point about every 15 minutes, plus one on
// leaving and one on coming back. The server turns "outside for 1h30 / 2h" into pushes and at 2h30
// checks the person out offsite; managers and the BoD see the path (LocationTrailView).
//
// Every decision lives in WorkTrailMachine (WorkTrailPolicy.swift, Foundation-only and probed);
// this file only carries those decisions out against CoreLocation, the disk and the network.

/// The pre-prompt shown before iOS's own "Always" dialog. Its own tiny observable so a view can
/// present it without the tracker (an NSObject delegate) having to be observable itself.
@MainActor
@Observable
final class WorkLocationPrompt {
    static let shared = WorkLocationPrompt()

    enum Mode: Equatable {
        /// iOS will still show its dialog: Continue asks for Always.
        case ask
        /// iOS has been asked before and will not ask again (or location is off entirely):
        /// the only way to Always is the Settings app, so that is what the button does.
        case settings
    }

    var isPresented = false
    var mode: Mode = .ask
}

#if !targetEnvironment(macCatalyst)

@MainActor
final class WorkLocationTracker: NSObject, CLLocationManagerDelegate {
    static let shared = WorkLocationTracker()

    private static let regionId = "nexus.worktrail.office"
    /// iOS asks for Always exactly once per install; after that only Settings can grant it.
    private static let alwaysAskedKey = "nexus.worktrail.always-asked"
    /// "recordId|on" or "recordId|denied": what the server was last told for which record, so the
    /// status endpoint is called on a change and not on every refresh.
    private static let reportedKey = "nexus.worktrail.reported"
    /// The record the pre-prompt was last shown for. Once per check-in, never a nag.
    private static let promptedKey = "nexus.worktrail.prompted"

    private var machine = WorkTrailMachine()
    /// Created in `bootstrap` (from didFinishLaunching) and never before: a region event that
    /// relaunches the app is delivered to whichever manager exists once launching is done, so it
    /// has to exist by then — and on the main thread, which is where its delegate calls arrive.
    private var manager: CLLocationManager?
    private var continuousOn = false
    private var flushing = false
    private var ticker: Timer?
    private var awaitingAlwaysAnswer = false
    /// Between deciding to show the pre-prompt and the person answering it. Attendance refreshes
    /// several times in those seconds; none of them may report "denied" for a question still open.
    private var promptPending = false
    private var bootstrapped = false

    private override init() { super.init() }

    // MARK: - entry points

    /// From `application(_:didFinishLaunchingWithOptions:)`, on every launch — including the
    /// background relaunch iOS performs for a region crossing (`launchOptions[.location]`). Picks
    /// the state back up from disk and re-arms whatever that state says should be running.
    func bootstrap() {
        guard !bootstrapped else { return }
        bootstrapped = true
        machine = WorkTrailMachine(state: Self.loadState())
        let m = CLLocationManager()
        m.delegate = self
        manager = m
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        if machine.state.isActive, let fence = machine.state.fence {
            apply([.armRegion(fence)])
            if machine.state.zone == .outside { apply([.startContinuous]) }
            startTicker()
        } else {
            // Nothing should be running. A region left behind by a crash or an old build would keep
            // relaunching the app for nothing, so it is cleared here.
            disarm()
            if !machine.state.pending.isEmpty { startTicker(); Task { await flush() } }
        }
        tick()
    }

    /// Called by AttendancePresence every time the app's idea of today's attendance moves: a load
    /// of the Attendance screen, a check-in or check-out, a queue change, a foreground refresh.
    /// Idempotent — it only starts or stops something when the answer changed.
    func sync(today: AttendanceToday?) {
        guard bootstrapped, Keychain.load() != nil else { return }
        guard let today else { return }
        let queue = AttendanceQueue.shared.pending
        // A check-out tapped offline is still a check-out: the person has said their day is over.
        if queue.contains(where: { $0.kind == .checkOut }) {
            if machine.state.isActive { stop(keepUnsent: true) }
            return
        }
        guard let rec = today.today, rec.hasCheckedIn, !rec.hasCheckedOut else {
            // No open record for today — checked out, nothing yet, or a new day.
            if machine.state.isActive { stop(keepUnsent: true) }
            return
        }
        guard let office = rec.officeLocation, let lat = office.latitude, let lng = office.longitude else {
            // Nothing to measure "outside" against. The server cannot either, so this is not a gap.
            if machine.state.isActive { stop(keepUnsent: true) }
            return
        }
        let fence = WorkTrailFence(lat: lat, lng: lng, radius: office.radiusMeters ?? 100)
        let fx = machine.start(recordId: rec.id, checkInAt: Self.parseISO(rec.checkInAt), fence: fence, now: Date())
        guard machine.state.isActive else { return }   // too old to start (shift cap)
        persist()
        apply(fx)
        startTicker()
        ensurePermission(for: rec.id)
    }

    /// Fetches today and feeds it through AttendancePresence, which calls `sync`. Used when the app
    /// comes to the foreground and when the offline queue lands a check-in — two moments where
    /// nothing else would fetch today's record.
    func reconcileFromServer() async {
        guard Keychain.load() != nil else { return }
        guard let today = try? await APIClient.shared.attendanceToday() else { return }
        AttendancePresence.refresh(today: today)
    }

    /// Logout: nothing of this person's trail may survive on the phone, sent or not.
    func stopForLogout() {
        stop(keepUnsent: false)
        promptPending = false
        awaitingAlwaysAnswer = false
        WorkLocationPrompt.shared.isPresented = false
        UserDefaults.standard.removeObject(forKey: Self.reportedKey)
        UserDefaults.standard.removeObject(forKey: Self.promptedKey)
    }

    // MARK: - permission

    private var status: CLAuthorizationStatus { manager?.authorizationStatus ?? .notDetermined }
    private var hasAlways: Bool { status == .authorizedAlways }

    private func ensurePermission(for recordId: String) {
        switch status {
        case .authorizedAlways:
            report("on", recordId: recordId)
        case .authorizedWhenInUse, .notDetermined, .denied, .restricted:
            // Once per record: the sheet explains, iOS (or Settings) decides, and the answer stands
            // for the rest of the day. A refusal is reported, and the app keeps doing what While
            // Using allows — tracking while it is open.
            let prompted = UserDefaults.standard.string(forKey: Self.promptedKey)
            if prompted != recordId {
                UserDefaults.standard.set(recordId, forKey: Self.promptedKey)
                presentPrePrompt()
            } else if !promptPending && !awaitingAlwaysAnswer {
                report("denied", recordId: recordId)
            }
            if status == .authorizedWhenInUse, UIApplication.shared.applicationState == .active { startForegroundUpdates() }
        @unknown default:
            break
        }
    }

    private func presentPrePrompt() {
        let alreadyAsked = UserDefaults.standard.bool(forKey: Self.alwaysAskedKey)
        let mode: WorkLocationPrompt.Mode
        switch status {
        case .denied, .restricted: mode = .settings
        case .authorizedWhenInUse: mode = alreadyAsked ? .settings : .ask
        default: mode = .ask
        }
        promptPending = true
        // A beat after the check-in card, so the sheet does not race the card's own dismissal.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            WorkLocationPrompt.shared.mode = mode
            WorkLocationPrompt.shared.isPresented = true
        }
    }

    /// The pre-prompt's primary button.
    func prePromptAccepted() {
        WorkLocationPrompt.shared.isPresented = false
        promptPending = false
        guard let m = manager else { return }
        switch WorkLocationPrompt.shared.mode {
        case .settings:
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            // Coming back from Settings is a didChangeAuthorization (if they changed it) or nothing.
            if let id = machine.state.recordId, !hasAlways { report("denied", recordId: id) }
        case .ask:
            UserDefaults.standard.set(true, forKey: Self.alwaysAskedKey)
            awaitingAlwaysAnswer = true
            m.requestAlwaysAuthorization()
            // If iOS decides not to show its dialog at all, nothing will call back: settle it
            // ourselves once it is clear no dialog came up.
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if awaitingAlwaysAnswer, UIApplication.shared.applicationState == .active { settleAlwaysAnswer() }
            }
        }
    }

    /// "Not now": Always was refused, in so many words.
    func prePromptDeclined() {
        WorkLocationPrompt.shared.isPresented = false
        promptPending = false
        if let id = machine.state.recordId { report("denied", recordId: id) }
        if status == .authorizedWhenInUse { startForegroundUpdates() }
    }

    private func settleAlwaysAnswer() {
        awaitingAlwaysAnswer = false
        guard let id = machine.state.recordId else { return }
        if hasAlways {
            report("on", recordId: id)
            stopForegroundUpdatesIfAny()
            if let fence = machine.state.fence { apply([.armRegion(fence)]) }
            if machine.state.zone == .outside { apply([.startContinuous]) }
        } else {
            report("denied", recordId: id)
            if status == .authorizedWhenInUse, UIApplication.shared.applicationState == .active { startForegroundUpdates() }
        }
    }

    private func report(_ state: String, recordId: String) {
        let key = "\(recordId)|\(state)"
        guard UserDefaults.standard.string(forKey: Self.reportedKey) != key else { return }
        Task {
            do {
                try await APIClient.shared.postLocationStatus(recordId: recordId, state: state)
                UserDefaults.standard.set(key, forKey: Self.reportedKey)
            } catch {
                // Left unrecorded, so the next sync says it again.
            }
        }
    }

    // MARK: - effects

    private func apply(_ effects: [WorkTrailEffect]) {
        guard let m = manager else { return }
        for effect in effects {
            switch effect {
            case .armRegion(let fence):
                // Region monitoring needs Always. Under While Using the foreground updates below
                // decide inside/outside from fixes instead, for as long as the app is open.
                guard hasAlways, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { continue }
                // iOS reports crossings of small circles late and unreliably; 100 m is the
                // practical floor. The server still judges every point against the real radius.
                let radius = min(max(fence.radius, 100), m.maximumRegionMonitoringDistance)
                let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: fence.lat, longitude: fence.lng),
                                              radius: radius, identifier: Self.regionId)
                region.notifyOnEntry = true
                region.notifyOnExit = true
                m.startMonitoring(for: region)
                m.requestState(for: region)
            case .startContinuous:
                guard hasAlways else { continue }
                // Outside only. Background-capable with the blue pill showing, so the person can
                // always see that NEXUS is using location — and only while they are outside.
                m.allowsBackgroundLocationUpdates = true
                m.pausesLocationUpdatesAutomatically = false
                m.showsBackgroundLocationIndicator = true
                m.desiredAccuracy = kCLLocationAccuracyHundredMeters
                m.distanceFilter = 50
                m.activityType = .other
                m.startUpdatingLocation()
                // The safety net if iOS or the person kills the app while outside: a significant
                // move relaunches it, and `bootstrap` resumes from disk.
                m.startMonitoringSignificantLocationChanges()
                continuousOn = true
            case .stopContinuous:
                guard hasAlways else { continue }
                m.stopUpdatingLocation()
                m.stopMonitoringSignificantLocationChanges()
                m.allowsBackgroundLocationUpdates = false
                continuousOn = false
            case .requestFix:
                if !continuousOn { m.desiredAccuracy = kCLLocationAccuracyHundredMeters; m.requestLocation() }
            case .flush:
                Task { await flush() }
            case .disarmAll:
                disarm()
            }
        }
    }

    private func disarm() {
        guard let m = manager else { return }
        for region in m.monitoredRegions where region.identifier == Self.regionId { m.stopMonitoring(for: region) }
        m.stopUpdatingLocation()
        m.stopMonitoringSignificantLocationChanges()
        if m.authorizationStatus == .authorizedAlways { m.allowsBackgroundLocationUpdates = false }
        continuousOn = false
        if machine.state.pending.isEmpty { stopTicker() }
    }

    private func stop(keepUnsent: Bool) {
        let fx = machine.stop(keepUnsent: keepUnsent)
        persist()
        apply(fx)
        if fx.isEmpty { disarm() }
    }

    // While Using only: the app may watch while it is open, and not a moment longer.
    private var foregroundOnly = false
    private func startForegroundUpdates() {
        guard let m = manager, machine.state.isActive, status == .authorizedWhenInUse else { return }
        foregroundOnly = true
        m.desiredAccuracy = kCLLocationAccuracyHundredMeters
        m.distanceFilter = 50
        m.startUpdatingLocation()
        continuousOn = true
    }
    private func stopForegroundUpdatesIfAny() {
        guard foregroundOnly, let m = manager else { return }
        foregroundOnly = false
        m.stopUpdatingLocation()
        continuousOn = false
    }

    @objc private func appDidBecomeActive() {
        if awaitingAlwaysAnswer { settleAlwaysAnswer() }
        if machine.state.isActive, status == .authorizedWhenInUse { startForegroundUpdates() }
        tick()
    }

    @objc private func appDidEnterBackground() {
        stopForegroundUpdatesIfAny()
    }

    // MARK: - clock

    private func startTicker() {
        guard ticker == nil else { return }
        // Fires while the app runs — which, outside the office, is all the time (continuous
        // background updates keep it running). Inside, the app is suspended and nothing is due.
        let t = Timer(timeInterval: 60, repeats: true) { _ in
            MainActor.assumeIsolated { WorkLocationTracker.shared.tick() }
        }
        t.tolerance = 15
        RunLoop.main.add(t, forMode: .common)
        ticker = t
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }

    private func tick() {
        let fx = machine.tick(now: Date())
        if !fx.isEmpty { persist(); apply(fx) }
        if !machine.state.isActive && machine.state.pending.isEmpty { stopTicker() }
    }

    // MARK: - upload

    /// Sends everything pending, one batch at a time, oldest record first. Stops at the first
    /// failure and keeps what was not sent — the next point or the next tick tries again.
    private func flush() async {
        guard !flushing, Keychain.load() != nil else { return }
        flushing = true
        defer { flushing = false }
        // A region crossing relaunches the app with seconds to live; this buys the upload its time.
        beginBackgroundTime()
        defer { endBackgroundTime() }

        while let batch = machine.nextBatch() {
            let ids = Set(batch.points.map(\.id))
            do {
                let reply = try await APIClient.shared.postLocationTrail(recordId: batch.recordId, points: batch.points)
                let fx = machine.sent(ids, recordId: batch.recordId, reply: reply, now: Date())
                persist()
                // `.flush` is this loop itself; everything else (a stop) is carried out now.
                apply(fx.filter { $0 != .flush })
            } catch APIError.http(let code, _) where [400, 403, 409, 410, 422].contains(code) {
                // Refused on its merits; retrying the same body cannot change the answer.
                machine.failed(ids, dropBatch: true, now: Date())
                persist()
            } catch {
                machine.failed(ids, dropBatch: false, now: Date())
                persist()
                return
            }
        }
    }

    /// Held on the instance rather than in a local: the expiry handler is a @Sendable closure, and
    /// a captured local `var` cannot be mutated from one.
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private func beginBackgroundTime() {
        guard bgTask == .invalid else { return }
        bgTask = UIApplication.shared.beginBackgroundTask(withName: "nexus.worktrail.flush") { [weak self] in
            MainActor.assumeIsolated { self?.endBackgroundTime() }
        }
    }
    private func endBackgroundTime() {
        guard bgTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(bgTask)
        bgTask = .invalid
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        MainActor.assumeIsolated {
            if awaitingAlwaysAnswer, m.authorizationStatus != .notDetermined { settleAlwaysAnswer(); return }
            guard let id = machine.state.recordId else { return }
            switch m.authorizationStatus {
            case .authorizedAlways:
                report("on", recordId: id)
                stopForegroundUpdatesIfAny()
                if let fence = machine.state.fence { apply([.armRegion(fence)]) }
                if machine.state.zone == .outside { apply([.startContinuous]) }
            case .authorizedWhenInUse, .denied, .restricted:
                // Downgraded in Settings mid-shift: say so, and fall back to what is still allowed.
                report("denied", recordId: id)
                for region in m.monitoredRegions where region.identifier == Self.regionId { m.stopMonitoring(for: region) }
                m.stopMonitoringSignificantLocationChanges()
                if m.authorizationStatus == .authorizedWhenInUse, UIApplication.shared.applicationState == .active {
                    startForegroundUpdates()
                } else {
                    m.stopUpdatingLocation()
                    continuousOn = false
                }
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        MainActor.assumeIsolated {
            guard region.identifier == Self.regionId, state != .unknown else { return }
            handle(machine.determined(inside: state == .inside, lastKnown: Self.point(m.location), now: Date()))
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didEnterRegion region: CLRegion) {
        MainActor.assumeIsolated {
            guard region.identifier == Self.regionId else { return }
            handle(machine.determined(inside: true, lastKnown: Self.point(m.location), now: Date()))
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didExitRegion region: CLRegion) {
        MainActor.assumeIsolated {
            guard region.identifier == Self.regionId else { return }
            handle(machine.determined(inside: false, lastKnown: Self.point(m.location), now: Date()))
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        MainActor.assumeIsolated {
            guard let loc = locations.last, let p = Self.point(loc) else { return }
            handle(machine.fix(p, now: Date()))
            tick()
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        // A transient "no fix right now". The next update, region event or tick carries on.
    }

    nonisolated func locationManager(_ m: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        // Too many regions, or monitoring unavailable. The continuous path and the fix-based
        // inside/outside test still work while the app runs; nothing to recover here.
    }

    private func handle(_ fx: [WorkTrailEffect]) {
        persist()
        apply(fx)
    }

    // MARK: - persistence

    private static var stateURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("work-location-trail.json")
    }

    private func persist() {
        guard let data = try? JSONEncoder().encode(machine.state) else { return }
        // `completeUntilFirstUserAuthentication`, not the default complete protection: a region
        // event can relaunch the app while the phone is locked, and a file it cannot read then is
        // a state it cannot resume.
        try? data.write(to: Self.stateURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func loadState() -> WorkTrailState {
        guard let data = try? Data(contentsOf: stateURL),
              let state = try? JSONDecoder().decode(WorkTrailState.self, from: data) else { return WorkTrailState() }
        return state
    }

    // MARK: - helpers

    private static func point(_ loc: CLLocation?) -> WorkTrailPoint? {
        guard let loc, loc.horizontalAccuracy >= 0 else { return nil }
        return WorkTrailPoint(recordId: "", lat: loc.coordinate.latitude, lng: loc.coordinate.longitude,
                              accuracy: loc.horizontalAccuracy, at: loc.timestamp, event: .point)
    }

    private static func parseISO(_ s: String?) -> Date? { WorkTrailWire.parseISO(s) }
}

#else

/// The Mac never takes attendance (see AttendanceView), so it never tracks either. Same surface,
/// so every call site compiles unchanged and does nothing.
@MainActor
final class WorkLocationTracker {
    static let shared = WorkLocationTracker()
    func bootstrap() {}
    func sync(today: AttendanceToday?) {}
    func reconcileFromServer() async {}
    func stopForLogout() {}
    func prePromptAccepted() { WorkLocationPrompt.shared.isPresented = false }
    func prePromptDeclined() { WorkLocationPrompt.shared.isPresented = false }
}

#endif

// MARK: - pre-prompt UI

/// Hosts the pre-prompt sheet on a view of its own, so it never shares a view with another
/// `.sheet` (two on one view and one of them never opens).
struct WorkLocationPromptHost: View {
    @State private var prompt = WorkLocationPrompt.shared

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .sheet(isPresented: $prompt.isPresented) {
                WorkLocationPromptSheet(mode: prompt.mode)
                    .presentationDetents([.medium, .large])
                    .interactiveDismissDisabled()
            }
    }
}

struct WorkLocationPromptSheet: View {
    let mode: WorkLocationPrompt.Mode

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "location.circle.fill")
                .font(.system(size: 40, weight: .semibold)).foregroundStyle(NX.violetText)
            Text(T("Location during work hours"))
                .font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
            Text(T("NEXUS records your location only during work hours, from check-in to check-out, so your manager knows when you're out of the office. Outside those hours your location is not recorded."))
                .font(NXFont.text(14)).foregroundStyle(NX.foreground.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Text(mode == .settings
                 ? T("To do that while the app is closed, open Settings › NEXUS › Location and choose Always.")
                 : T("On the next screen, choose \"Change to Always Allow\". Inside the office nothing is sent; outside, one point about every 15 minutes."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button { WorkLocationTracker.shared.prePromptAccepted() } label: {
                Text(mode == .settings ? T("Open Settings") : T("Continue"))
            }
            .buttonStyle(NexusPrimaryButton())
            Button { WorkLocationTracker.shared.prePromptDeclined() } label: {
                Text(T("Not now")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
            }
            .buttonStyle(.plain)
        }
        .padding(24)
        .background(NX.background.ignoresSafeArea())
    }
}
