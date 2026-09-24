package id.znetworks.nexus

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import id.znetworks.nexus.core.AppContainer
import id.znetworks.nexus.feature.attendance.LocalNotifier
import kotlinx.coroutines.launch

class NexusApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        LocalNotifier.ensureChannels(this)
        // Queued taps go out on app start after sign-in, and on every foreground (REQ-ATT-13).
        container.flushQueueSoon()
        // Version policy: forced at launch, then at most every 30 min on foreground (REQ-ATT-41).
        container.appScope.launch { container.versionGate.checkPolicy(force = true) }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                container.appScope.launch {
                    container.versionGate.checkPolicy(force = false)
                    // After the gate: a lifted lock lets the held taps go in the same pass.
                    container.flushQueueSoon()
                }
            }
        })
    }
}
