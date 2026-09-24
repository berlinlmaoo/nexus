package id.znetworks.nexus.core

import android.content.Context
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.session.KeystoreSessionCipher
import id.znetworks.nexus.core.session.SessionStore
import id.znetworks.nexus.core.version.GateStorage
import id.znetworks.nexus.core.version.VersionGate
import id.znetworks.nexus.core.version.VersionPolicyResponse
import id.znetworks.nexus.feature.auth.AuthRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.io.File

/**
 * Manual dependency graph. Small enough that a DI framework would add build time and no safety;
 * revisit when the feature count makes wiring by hand error-prone.
 */
class AppContainer(context: Context) {
    val identity = ClientIdentity.current()

    /** Lives as long as the process: work that must not die with a screen (queue flush, checks). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val sessionStore = SessionStore(
        file = File(context.noBackupFilesDir, "session/session.bin"),
        cipher = KeystoreSessionCipher(),
    )

    val api: ApiClient = ApiClient.production(
        identity = identity,
        sessionProvider = { sessionStore.current },
        onUnauthorized = { refused -> auth.sessionEnded(refused) },
        onUpgradeRequired = { err -> versionGate.require(err.minSupported, err.storeUrl) },
    )

    val versionGate: VersionGate = VersionGate(
        running = identity.versionName,
        storage = PrefsGateStorage(context),
        fetchPolicy = {
            // Unauthenticated: a signed-out phone must learn it is too old before it signs in.
            api.get("/api/app/version-policy", VersionPolicyResponse.serializer(), authed = false, callTimeoutMs = 8_000).android
        },
    )

    val auth = AuthRepository(api, sessionStore)
}

private class PrefsGateStorage(context: Context) : GateStorage {
    private val prefs = context.getSharedPreferences("nexus.versionGate", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    // commit(), not apply(): a lock must be on disk before the process can be killed.
    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.commit()
    }
}
