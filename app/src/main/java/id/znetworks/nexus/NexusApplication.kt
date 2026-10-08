package id.znetworks.nexus

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import id.znetworks.nexus.core.AppContainer
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.feature.attendance.trail.WorkTrailService
import id.znetworks.nexus.feature.push.PushManager
import kotlinx.coroutines.launch

class NexusApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        id.znetworks.nexus.core.offline.DiskFiles.init(cacheDir)
        LocalNotifier.ensureChannels(this)
        WorkTrailService.ensureChannel(this)
        PushManager.ensureChannels(this)
        // Every launch re-registers, as iOS does on every activation: tokens rotate.
        if (container.sessionStore.current != null) { container.push.register(); container.offline.schedule(); id.znetworks.nexus.feature.calendar.widget.CalendarWidgetWork.schedulePeriodic(this) }
        // Queued taps go out on app start after sign-in, and on every foreground (REQ-ATT-13).
        container.flushQueueSoon()
        // Version policy: forced at launch, then at most every 30 min on foreground (REQ-ATT-41).
        container.appScope.launch { container.versionGate.checkPolicy(force = true) }
        // Remote config: forced at launch, then at most every 5 min on foreground.
        container.appScope.launch { container.remoteConfig.refresh(force = true) }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                // Back in the foreground: are we in the office? (API.md §1.2)
                container.lanRoute.reprobe(force = true)
                container.appScope.launch { container.remoteConfig.refresh() }
                // Pinned projects follow the web and the other devices (iOS 286cada); launch counts as a return too.
                if (container.sessionStore.current != null) container.appScope.launch { container.shortcuts.syncPins() }
                // Calendar widgets catch up with whatever changed while the app was away (throttled to 5 min).
                if (container.sessionStore.current != null) container.refreshCalendarWidgets()
                // Unread counts for More and Messages; an open chat list or thread refreshes itself.
                if (container.sessionStore.current != null) { container.badges.refresh(); container.chatEvents.tryEmit(null) }
                container.appScope.launch {
                    container.versionGate.checkPolicy(force = false)
                    // After the gate: a lifted lock lets the held taps go in the same pass.
                    container.flushQueueSoon()
                    // A check-out made on the web, or an automatic one, must stop the trail here.
                    container.reconcileTrail()
                    // The offline copy, when it is getting old (never in front of the person).
                    container.offline.warmIfStale()
                }
            }
        })
    }
}
