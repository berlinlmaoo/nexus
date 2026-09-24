import Foundation
#if !targetEnvironment(macCatalyst)
import BackgroundTasks
#endif
import UIKit

/// Keeping the offline copy warm while nobody is looking.
///
/// Launch is the wrong moment for this work. Somebody who opens NEXUS on a site with no bars has
/// already arrived, and whatever was not fetched before they left the office is not going to be
/// fetched now. iOS offers two ways to work ahead, and this registers for both because they are
/// good at different things:
///
///   • REFRESH is short — seconds — and iOS runs it often, around the times of day this person
///     actually opens the app. It re-fetches the small half: today's attendance, the board, the
///     requests, the tasks. Its job is that the next cold open is already current.
///   • PROCESSING is long and runs when the phone is idle and charging, which in practice means
///     overnight. It fetches the FILES — the half it would be rude to do on somebody's commute.
///
/// iOS decides when, and is entitled to decide never: a phone that is never idle and never
/// charging gets no processing window at all, and a person who force-quits the app gets nothing
/// until they open it again. So nothing here is load-bearing. Every screen still works if none of
/// this ever runs; the launch warm-up does the same work in the foreground, and this only means
/// there is less of it left to do.
enum BackgroundRefresh {
    /// Also listed in Info.plist under BGTaskSchedulerPermittedIdentifiers. iOS checks the two
    /// against each other at registration and traps the app if they disagree, which is a good
    /// trade: a typo here is a crash on the first launch rather than a feature that silently
    /// never runs.
    static let dataTaskId = "id.znetworks.nexus.refresh"
    static let mediaTaskId = "id.znetworks.nexus.prefetch"

    /// Must be called before `didFinishLaunchingWithOptions` returns — iOS rejects a handler
    /// registered any later, and the rejection is a trap, not a return value.
    static func register() {
        #if !targetEnvironment(macCatalyst)
        // The Bool is thrown away on purpose. It reports "already registered", which can only
        // happen if this were called twice, and there is nothing useful to do about it here.
        _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: dataTaskId, using: nil) { task in
            handle(task, media: false)
        }
        _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: mediaTaskId, using: nil) { task in
            handle(task, media: true)
        }
        #endif
    }

    /// Asked for on the way to the background, which is the only moment iOS will accept a request
    /// that is worth making: an app in the foreground is not a candidate for either window.
    static func schedule() {
        #if !targetEnvironment(macCatalyst)
        // Nothing to warm for somebody who is not signed in, and a request submitted anyway would
        // wake the app up to discover that.
        guard Keychain.load() != nil else { return }

        let refresh = BGAppRefreshTaskRequest(identifier: dataTaskId)
        // The earliest, not the actual: iOS treats it as a floor and then decides for itself,
        // usually much later. An hour asks to be considered a few times a day without pretending
        // this app deserves more than that.
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(refresh)

        let prefetch = BGProcessingTaskRequest(identifier: mediaTaskId)
        prefetch.requiresNetworkConnectivity = true
        // Deliberately false. Requiring power is the usual advice and it is wrong here: the phones
        // this matters for belong to people who are out at a site all day, and the one thing they
        // reliably do is charge overnight — but the one thing they might NOT do is charge before
        // the day nobody has signal. `shouldFetchMedia()` already refuses a metered connection,
        // which is the protection that actually costs somebody money.
        prefetch.requiresExternalPower = false
        prefetch.earliestBeginDate = Date(timeIntervalSinceNow: 4 * 60 * 60)
        try? BGTaskScheduler.shared.submit(prefetch)
        #endif
    }

    #if !targetEnvironment(macCatalyst)
    private static func handle(_ task: BGTask, media: Bool) {
        // Immediately, not at the end: if the app is killed inside this window nothing else will
        // ask for the next one, and the feature quietly stops existing on that phone forever.
        schedule()

        guard let userId = Keychain.load()?.userId else {
            task.setTaskCompleted(success: false)
            return
        }

        let work = Task { @MainActor in
            if media {
                OfflineSync.shared.syncMedia(userId: userId)
                // syncMedia returns the moment it has started its own task, so this window would
                // end instantly and iOS would record a run that fetched nothing. Wait on the work
                // itself, and let the expiration handler below be what stops it.
                await OfflineSync.shared.waitForMedia()
            } else {
                await OfflineSync.shared.syncData(userId: userId)
            }
        }

        // iOS gives no warning beyond this call, and an app that overruns is not asked again for
        // a long time. Cancelling is enough: every loop inside checks `Task.isCancelled`, and a
        // half-finished pass leaves the caches exactly as complete as it got.
        task.expirationHandler = {
            work.cancel()
            Task { @MainActor in OfflineSync.shared.cancelMedia() }
        }

        Task {
            await work.value
            task.setTaskCompleted(success: !work.isCancelled)
        }
    }
    #endif
}
