import Foundation
import CoreLocation
import SwiftUI
import UIKit

// Live location while checked in (0.1.6).
//
// Owner's rule, and the whole of it: NEXUS records a position ONLY between a check-in the server
// has accepted and the check-out. Inside the office, one "presence" check about once an hour
// (owner, 25 Sep 2026) and no continuous GPS: region monitoring watches the door, and a coarse
// cell/Wi-Fi-level stream keeps the app alive between checks without the blue location pill.
// Outside (owner, 28 Sep 2026), the route itself: GPS-grade fixes, a point per 50 m moved and a
// heartbeat every 5 minutes standing still, uploaded in batches about every 2 minutes, plus a point on
// leaving and on coming back sent at once. Leaving is announced on the phone right away and again an
// hour in, with the time left (local notifications, NotificationManager.outsideAlert). The server
// turns "outside for 1h30 / 2h" into pushes and at 2h30 checks the person out offsite; managers and
// the BoD see the path and the hourly checks (LocationTrailView).
//
// The battery cost is deliberate and bounded: GPS runs continuously only while outside, and an
// outside episode ends at the latest with the automatic check-out 2h30 in. Inside, nothing changes.
//
// Why a stream, and what it costs. A suspended app runs no timer, and iOS offers no "wake me every
// hour" for location: region monitoring only fires on a crossing, significant-change and visit
// monitoring only when the phone moves, and background refresh / silent pushes run when iOS
// chooses. Standard location updates with `allowsBackgroundLocationUpdates` (UIBackgroundModes
// location) are the one thing that keeps the app running in the background, and with
// `pausesLocationUpdatesAutomatically = false` iOS does not pause them. At
// kCLLocationAccuracyThreeKilometers with a 1 km filter they need no GPS — cell and Wi-Fi only —
// so the cost is the process staying resident plus an occasional coarse fix, not the radio cost of
// GPS. Under Always, `showsBackgroundLocationIndicator = false` means no blue pill (Apple: the
// property only affects Always apps; While Using apps always get the indicator in the background).
// None of this is free, and iOS may still end the app (memory pressure, a force-quit): then the
// checks stop until a region crossing relaunches it or the person opens NEXUS, and `resume` takes
// the overdue check at once. Hourly is best-effort by design.
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
    /// What this process has asked CoreLocation for. nil until the first `reconcile`, so that one
    /// always applies in full: services a previous process started (significant-change monitoring
    /// outlives the process) are brought in line with the state instead of being assumed off.
    private enum Updates: Equatable {
        case off
        /// Outside, Always: precise continuous updates, blue pill on.
        case background
        /// Inside (or zone unknown), Always: the coarse stream that keeps the app alive; `precise`
        /// while a presence check (or a one-shot fix) is under way.
        case keepAlive(precise: Bool)
        /// While Using, app in front.
        case foreground(precise: Bool)
    }
    private var updates: Updates?
    /// Some stream is delivering fixes: a one-shot `requestLocation` must not be mixed in.
    private var streamOn: Bool { updates != nil && updates != .off }
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
        // The manager is stored BEFORE it gets a delegate: the "initial authorization" callback that
        // follows its creation must find it, or everything that callback re-arms is dropped.
        manager = m
        m.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidEnterBackground),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        if machine.state.isActive {
            // Resumed from disk after the process was gone (force-quit, a crash, a relaunch by iOS).
            // `reconcile` sets up what the state calls for — and does it again from the
            // authorization callback if the permission is not readable yet this early.
            reconcile(refreshRegionState: true)
            handle(machine.resume(now: Date()))
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
        // `start` is a no-op for a record already being tracked, so on its own it would never put
        // back a setup that went missing. This does, every time today's attendance is refreshed.
        reconcile()
        startTicker()
        ensurePermission(for: rec.id)
        publishOutside()
    }

    /// A GET /api/attendance/today answer, after `sync` has had it: the server's `outsideSince` and
    /// an approved excuse for today, so the Live Activity quotes the same times as the pushes.
    /// `heardAt` is when the server said it (a copy restored from the offline cache is older).
    func heard(today: AttendanceToday, at heardAt: Date) {
        guard bootstrapped, let rec = today.today else { return }
        machine.heardToday(recordId: rec.id, outsideSince: Self.parseISO(rec.outsideSince),
                           excused: today.todayRequest != nil, heardAt: heardAt)
        persist()
        publishOutside()
    }

    /// A leave / sick / permit / day-off request covering today was just filed from this phone. The
    /// server pauses the outside clock for it right away, so the Live Activity drops the countdown
    /// now rather than at the next trail reply.
    func excuseFiledForToday() {
        guard bootstrapped, machine.state.isActive else { return }
        machine.excuseFiled()
        persist()
        publishOutside()
    }

    /// Hands the Live Activity the outside-the-office state, and keeps the phone's own outside
    /// alerts in step with it. Called on every fix, tick, reply and attendance refresh —
    /// `LiveActivityController.updateOutside` only spends an update when what it would draw changes
    /// (a new stage, a new start), the countdown itself is the system's, and `planOutsideAlerts`
    /// only answers with a change.
    private func publishOutside() {
        let now = Date()
        LiveActivityController.updateOutside(machine.outsideStatus(now: now))
        let alerts = machine.planOutsideAlerts(now: now)
        guard !alerts.isEmpty else { return }
        persist()
        let recordId = machine.state.recordId
        for alert in alerts { NotificationManager.shared.outsideAlert(alert, recordId: recordId, now: now) }
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
        reconcile()
    }

    private func settleAlwaysAnswer() {
        awaitingAlwaysAnswer = false
        guard let id = machine.state.recordId else { return }
        report(hasAlways ? "on" : "denied", recordId: id)
        reconcile(refreshRegionState: true)
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
        // Region and continuous updates are not switched here one effect at a time: they follow
        // the state, which the machine has already moved, and `reconcile` makes CoreLocation match
        // it. An effect only says that the setup may have changed (and, for a new region, that its
        // current state should be asked for).
        var setupChanged = false, armed = false
        for effect in effects {
            switch effect {
            case .armRegion: setupChanged = true; armed = true
            case .startContinuous, .stopContinuous, .preciseChanged: setupChanged = true
            default: break
            }
        }
        if setupChanged { reconcile(refreshRegionState: armed) }
        for effect in effects {
            switch effect {
            case .armRegion, .startContinuous, .stopContinuous, .preciseChanged:
                continue   // done by `reconcile` above
            case .requestFix:
                // With a stream running, a fix is on its way anyway (inside, the machine has opened
                // the precise window, which `reconcile` just applied to the keep-alive stream).
                if !streamOn { m.desiredAccuracy = kCLLocationAccuracyHundredMeters; m.requestLocation() }
            case .flush:
                Task { await flush() }
            case .disarmAll:
                disarm()
            }
        }
    }

    /// Makes CoreLocation do what the state and the permission call for — no more, no less.
    /// Idempotent and cheap, so it is called whenever either might have moved: launch, the
    /// authorization callback, returning to the foreground, going to the background, every
    /// attendance refresh, and every decision the machine makes.
    ///   • active, Always → the office region is monitored;
    ///   • outside, Always → continuous background updates + significant-change monitoring;
    ///   • inside or unknown, Always → the coarse keep-alive stream (precise during a check);
    ///   • active, While Using, app in front → foreground-only updates (fixes decide the zone, and the
    ///     presence checks happen only while the app is open);
    ///   • anything else → off.
    private func reconcile(refreshRegionState: Bool = false) {
        guard let m = manager else { return }
        let want = machine.setup
        let status = m.authorizationStatus
        guard want.region != nil else { disarm(); return }
        // Not known yet (read too early after launch): leave whatever is running alone — tearing
        // down a region iOS relaunched the app for could lose the very event it is delivering. The
        // authorization callback that follows calls this again with the real answer.
        guard status != .notDetermined else { return }

        // Region monitoring needs Always. Under While Using the foreground updates below decide
        // inside/outside from fixes instead, for as long as the app is open.
        if let fence = want.region, status == .authorizedAlways,
           CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) {
            // iOS reports crossings of small circles late and unreliably; 100 m is the practical
            // floor. The server still judges every point against the real radius.
            let radius = min(max(fence.radius, 100), m.maximumRegionMonitoringDistance)
            let center = CLLocationCoordinate2D(latitude: fence.lat, longitude: fence.lng)
            let existing = m.monitoredRegions.first { $0.identifier == Self.regionId } as? CLCircularRegion
            if let existing, abs(existing.radius - radius) < 1,
               WorkTrailMachine.distance(existing.center.latitude, existing.center.longitude, center.latitude, center.longitude) < 1 {
                // Already watching this circle (regions outlive the process). Re-registering it
                // would only reset what iOS knows about it. Its state is asked for only while the
                // zone is still unknown: once a zone is known, a fix settles it far more reliably
                // than `requestState`, whose answer lags well behind a phone standing near the edge.
                if refreshRegionState && machine.state.zone == .unknown { m.requestState(for: existing) }
            } else {
                let region = CLCircularRegion(center: center, radius: radius, identifier: Self.regionId)
                region.notifyOnEntry = true
                region.notifyOnExit = true
                m.startMonitoring(for: region)
                m.requestState(for: region)
            }
        } else {
            for region in m.monitoredRegions where region.identifier == Self.regionId { m.stopMonitoring(for: region) }
        }

        let target: Updates
        if want.continuous && status == .authorizedAlways {
            target = .background
        } else if want.keepAlive && status == .authorizedAlways {
            target = .keepAlive(precise: want.precise)
        } else if status == .authorizedWhenInUse && UIApplication.shared.applicationState == .active {
            // Outside, the open app records the route too, and a route needs fixes good to 65 m.
            target = .foreground(precise: want.precise || want.continuous)
        } else {
            target = .off
        }
        guard target != updates else { return }
        switch target {
        case .background:
            // Outside only. Background-capable with the blue pill showing, so the person can
            // always see that NEXUS is using location — and only while they are outside.
            // The route (owner, 28 Sep 2026): GPS-grade accuracy so the line follows the streets, a
            // fix per 50 m (the machine keeps those good to 65 m, and repeats the last one every
            // 5 minutes standing still), never paused by iOS. `.otherNavigation`: on foot, by
            // motorbike or by car — not `.automotiveNavigation`, which would snap fixes to roads
            // and pause off them.
            m.allowsBackgroundLocationUpdates = true
            m.pausesLocationUpdatesAutomatically = false
            m.showsBackgroundLocationIndicator = true
            m.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            m.distanceFilter = WorkTrailMachine.trailSpacing
            m.activityType = .otherNavigation
            m.startUpdatingLocation()
            // The safety net if iOS kills the app while outside: a significant move relaunches it,
            // and `bootstrap` resumes from disk. (After a force-quit iOS relaunches nothing until
            // the person opens the app — then `bootstrap` resumes the same way.)
            m.startMonitoringSignificantLocationChanges()
        case .keepAlive(let precise):
            // Inside. Background-capable so the app keeps running for the hourly check, but WITHOUT
            // the blue pill (Always only — the branch above requires it) and without GPS between
            // checks: at three kilometres iOS answers from cell and Wi-Fi. A check raises the
            // accuracy on the SAME running stream (a one-shot request cannot be mixed with running
            // updates) for at most WorkTrailMachine.preciseTimeout, then drops it again.
            // Significant-change monitoring is outside-only: region exit already relaunches the app.
            m.stopMonitoringSignificantLocationChanges()
            m.allowsBackgroundLocationUpdates = true
            m.pausesLocationUpdatesAutomatically = false
            m.showsBackgroundLocationIndicator = false
            m.activityType = .other
            if precise {
                m.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
                m.distanceFilter = kCLDistanceFilterNone
            } else {
                m.desiredAccuracy = kCLLocationAccuracyThreeKilometers
                m.distanceFilter = 1000
            }
            m.startUpdatingLocation()
        case .foreground(let precise):
            // While Using only: the app may watch while it is open, and not a moment longer.
            m.stopMonitoringSignificantLocationChanges()
            if status == .authorizedAlways { m.allowsBackgroundLocationUpdates = false }
            m.desiredAccuracy = precise ? kCLLocationAccuracyNearestTenMeters : kCLLocationAccuracyHundredMeters
            // A phone lying on a desk moves less than 50 m: during a check every fix is wanted.
            m.distanceFilter = precise ? kCLDistanceFilterNone : 50
            m.startUpdatingLocation()
        case .off:
            m.stopUpdatingLocation()
            m.stopMonitoringSignificantLocationChanges()
            if status == .authorizedAlways { m.allowsBackgroundLocationUpdates = false }
        }
        updates = target
    }

    private func disarm() {
        // Every way tracking ends (check-out, logout, `tracking:false`, the automatic check-out, the
        // shift cap) comes through here: the outside alerts go with it, pending and shown.
        NotificationManager.shared.cancelOutsideAlerts()
        guard let m = manager else { return }
        for region in m.monitoredRegions where region.identifier == Self.regionId { m.stopMonitoring(for: region) }
        m.stopUpdatingLocation()
        m.stopMonitoringSignificantLocationChanges()
        if m.authorizationStatus == .authorizedAlways { m.allowsBackgroundLocationUpdates = false }
        updates = .off
        if machine.state.pending.isEmpty { stopTicker() }
    }

    private func stop(keepUnsent: Bool) {
        let fx = machine.stop(keepUnsent: keepUnsent)
        persist()
        apply(fx)
        if fx.isEmpty { disarm() }
        publishOutside()
    }

    @objc private func appDidBecomeActive() {
        if awaitingAlwaysAnswer { settleAlwaysAnswer() }
        // Puts back anything that should be running and is not — whatever the reason it is not.
        if machine.state.isActive { reconcile() }
        tick()
    }

    @objc private func appDidEnterBackground() {
        // Drops foreground-only (While Using) updates; Always keeps what the state calls for.
        if machine.state.isActive { reconcile() }
    }

    // MARK: - clock

    private func startTicker() {
        guard ticker == nil else { return }
        // Fires while the app runs — which, with Always, is the whole shift: continuous updates
        // outside and the keep-alive stream inside keep it running. It drives the 5-minute
        // heartbeat and the ~2-minute batched upload outside, and the hourly presence check inside.
        // With While Using it runs only while the app is open, and so do the checks.
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
        // The reminder and warning stages arrive with time alone, no crossing and no fix: the
        // minute ticker (which runs all the while outside — continuous updates keep the app alive)
        // is what moves the Live Activity to them.
        publishOutside()
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
                publishOutside()
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
            // Also the "initial" call iOS makes right after the manager is created, on every launch:
            // the first moment the permission is reliably known, so the first moment the setup the
            // saved state calls for can really be put in place.
            if awaitingAlwaysAnswer, m.authorizationStatus != .notDetermined { settleAlwaysAnswer(); return }
            guard let id = machine.state.recordId else { return }
            switch m.authorizationStatus {
            case .authorizedAlways:
                report("on", recordId: id)
            case .authorizedWhenInUse, .denied, .restricted:
                // Downgraded in Settings mid-shift: say so, and fall back to what is still allowed.
                report("denied", recordId: id)
            default:
                break
            }
            reconcile(refreshRegionState: true)
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
        // A crossing (region event or a decisive fix) changes the Live Activity at once.
        publishOutside()
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
    func heard(today: AttendanceToday, at heardAt: Date) {}
    func excuseFiledForToday() {}
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
            Text(T("NEXUS checks your location only during work hours, from check-in to check-out: about once an hour at the office, and your route when you leave it, so your manager can see where you worked. Before check-in and after check-out nothing is recorded."))
                .font(NXFont.text(14)).foregroundStyle(NX.foreground.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
            Text(mode == .settings
                 ? T("To do that while the app is closed, open Settings › NEXUS › Location and choose Always.")
                 : T("On the next screen, choose \"Change to Always Allow\". At the office, one check about every hour; outside it, your route while you're out of the office."))
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
