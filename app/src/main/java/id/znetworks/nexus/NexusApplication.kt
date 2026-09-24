package id.znetworks.nexus

import android.app.Application
import id.znetworks.nexus.core.AppContainer

class NexusApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
