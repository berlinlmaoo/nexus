package id.znetworks.nexus.core

import id.znetworks.nexus.core.net.ApiClient
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The signed-in person's workspace role, fetched once (iOS `Viewer`). It decides what is DRAWN and
 * nothing else: every route re-checks the role, so hiding a button is a courtesy, not security.
 */
class Viewer(private val api: ApiClient) {
    @Volatile var role: String? = null
        private set
    private val lock = Mutex()

    /** The server's own isBoD(), mirrored once so call sites cannot drift apart. */
    val isBoD: Boolean get() = role in setOf("ONE_ABOVE_ALL", "BOD")
    val canAdminister: Boolean get() = role in setOf("ONE_ABOVE_ALL", "BOD", "MANAGER")

    suspend fun load(): String? = lock.withLock {
        role ?: runCatching {
            (api.get("/api/workspaces/members", JsonObject.serializer())["role"] as? JsonPrimitive)?.content
        }.getOrNull().also { role = it }
    }

    /** A new session must not inherit the last person's role. */
    fun reset() { role = null }
}
