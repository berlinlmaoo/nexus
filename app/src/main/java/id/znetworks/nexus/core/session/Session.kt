package id.znetworks.nexus.core.session

import kotlinx.serialization.Serializable

/**
 * The signed-in person. Sent as `Cookie: <cookieName>=<token>`; the cookie name is whatever the
 * server returned (it salts the token), never hard-coded (API.md §1.3).
 */
@Serializable
data class Session(
    val token: String,
    val cookieName: String,
    val userId: String,
    val userName: String = "",
    val userEmail: String = "",
    /** Epoch millis when the server said the token dies (issued + expiresInSeconds). 0 = unknown. */
    val expiresAtMillis: Long = 0,
)
