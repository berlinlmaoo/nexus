package id.znetworks.nexus.core.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * Every way a call can fail, kept as separate cases because the UI treats them differently
 * (API.md §1.7). `Offline` is not a case here: whether a failure means "queue the tap" is an
 * attendance-only decision, see [meansOriginUnreachable] and [nobodyAnswered].
 */
sealed class ApiError(message: String?, cause: Throwable? = null) : Exception(message, cause) {

    /** Any non-2xx that is not one of the typed cases below. [serverMessage] is shown verbatim. */
    class Http(
        val status: Int,
        val serverMessage: String?,
        val code: String?,
        val body: JsonObject?,
    ) : ApiError(serverMessage ?: "HTTP $status")

    /** 401 on an authenticated call: the session is over. */
    object Unauthorized : ApiError("Unauthorized") {
        private fun readResolve(): Any = Unauthorized
    }

    /** A 2xx whose body did not decode. */
    class Decoding(cause: Throwable) : ApiError(cause.message, cause)

    /** No HTTP response at all: DNS, TLS, connect, timeout, dropped connection. */
    class Transport(cause: Throwable) : ApiError(cause.message, cause)

    /** 426 + `code: "UPGRADE_REQUIRED"`. A bare 426 from a proxy is an ordinary [Http]. */
    class UpgradeRequired(
        val serverMessage: String?,
        val minSupported: String?,
        val storeUrl: String?,
    ) : ApiError(serverMessage ?: "Upgrade required")

    companion object {
        /** Statuses only the edge produces when the origin is away (API.md §1.7). */
        private val EDGE_ONLY = setOf(502, 503, 504, 530) + (520..527)

        /**
         * "The origin never decided": 500, 502–504, 520–527, 530. A list on purpose, not `>= 500`
         * (501/505 mean the request itself was unacceptable). Used ONLY by check-in/out to decide
         * whether a tap may be queued.
         */
        val ORIGIN_UNREACHABLE: Set<Int> = setOf(500, 502, 503, 504, 530) + (520..527)

        fun isEdgeOnly(status: Int) = status in EDGE_ONLY
    }
}

/** True when an attendance tap may be queued: nobody at the origin made a decision. */
fun ApiError.meansOriginUnreachable(): Boolean = when (this) {
    is ApiError.Transport -> true
    is ApiError.Http -> status in ApiError.ORIGIN_UNREACHABLE
    else -> false
}

/**
 * For reads: the only situation where a cached copy replaces an error. An edge-only status WITH
 * a sentence is the app answering, so it does not count.
 */
fun ApiError.nobodyAnswered(): Boolean = when (this) {
    is ApiError.Transport -> true
    is ApiError.Http -> serverMessage == null && ApiError.isEdgeOnly(status)
    else -> false
}

internal object ErrorBody {
    /**
     * Reads `{error}` (falling back to `message`). Returns null for the Cloudflare down-worker
     * body (`code: NEXUS_DOWN` or `down: true`): that is the edge speaking, not the app.
     */
    fun serverMessage(body: JsonObject?): String? {
        body ?: return null
        val code = (body["code"] as? JsonPrimitive)?.contentOrNull
        val down = (body["down"] as? JsonPrimitive)?.booleanOrNull
        if (code == "NEXUS_DOWN" || down == true) return null
        val text = (body["error"] as? JsonPrimitive)?.contentOrNull
            ?: (body["message"] as? JsonPrimitive)?.contentOrNull
        return text?.takeIf { it.isNotBlank() }
    }

    fun code(body: JsonObject?): String? = (body?.get("code") as? JsonPrimitive)?.contentOrNull

    fun parse(json: Json, raw: String?): JsonObject? =
        runCatching { raw?.takeIf { it.isNotBlank() }?.let { json.parseToJsonElement(it) as? JsonObject } }.getOrNull()
}
