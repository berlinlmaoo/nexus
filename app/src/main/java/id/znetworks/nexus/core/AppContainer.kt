package id.znetworks.nexus.core

import android.content.Context
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.KeystoreSessionCipher
import id.znetworks.nexus.core.session.SessionStore
import id.znetworks.nexus.feature.auth.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

/**
 * Manual dependency graph. Small enough that a DI framework would add build time and no safety;
 * revisit when the feature count makes wiring by hand error-prone.
 */
class AppContainer(context: Context) {
    val identity = ClientIdentity.current()

    val sessionStore = SessionStore(
        file = File(context.noBackupFilesDir, "session/session.bin"),
        cipher = KeystoreSessionCipher(),
    )

    private val _upgradeRequired = MutableStateFlow<ApiError.UpgradeRequired?>(null)
    /** Last 426 seen on any call. The version gate (next milestone) persists and renders it. */
    val upgradeRequired: StateFlow<ApiError.UpgradeRequired?> = _upgradeRequired.asStateFlow()

    val api: ApiClient = ApiClient.production(
        identity = identity,
        sessionProvider = { sessionStore.current },
        onUnauthorized = { refused -> auth.sessionEnded(refused) },
        onUpgradeRequired = { _upgradeRequired.value = it },
    )

    val auth = AuthRepository(api, sessionStore)
}
