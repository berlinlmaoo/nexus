package id.znetworks.nexus.core

import id.znetworks.nexus.core.net.ApiClient
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * The signed-in person's workspace role, fetched once (iOS `Viewer`). It decides what is DRAWN and
 * nothing else: every route re-checks the role, so hiding a button is a courtesy, not security.
 */
class Viewer(private val api: ApiClient) {
    @Volatile var role: String? = null
        private set
    /**
     * The caller belongs to the company workspace (Z Networks): Z Vault and Threads are the company's
     * (Berlin, 29 Sep 2026; iOS 14b086f). Null until loaded, and company-only screens stay hidden till then.
     */
    @Volatile var isCompany: Boolean? = null
        private set
    val isCompanyMember: Boolean get() = isCompany == true
    /**
     * May make a Pipeline board: a member of the company workspace (PIPELINE-DASHBOARD §16, 11 Oct — many boards;
     * the server's pipelineProjectId is always null now and is not read). Absent on an older server = no entry.
     */
    @Volatile var canAccessPipeline: Boolean = false
        private set
    private val lock = Mutex()

    /** The server's own isBoD(), mirrored once so call sites cannot drift apart. */
    val isBoD: Boolean get() = role in setOf("ONE_ABOVE_ALL", "BOD")
    val canAdminister: Boolean get() = role in setOf("ONE_ABOVE_ALL", "BOD", "MANAGER")

    suspend fun load(): String? = lock.withLock {
        if (role != null && isCompany != null) return@withLock role
        runCatching { api.get("/api/workspaces/members", JsonObject.serializer()) }.getOrNull()?.let { o ->
            role = (o["role"] as? JsonPrimitive)?.content ?: role
            isCompany = (o["isCompany"] as? JsonPrimitive)?.booleanOrNull ?: isCompany
            canAccessPipeline = (o["canAccessPipeline"] as? JsonPrimitive)?.booleanOrNull ?: false
        }
        role
    }

    /** A new session must not inherit the last person's role. */
    fun reset() { role = null; isCompany = null; canAccessPipeline = false }
}
