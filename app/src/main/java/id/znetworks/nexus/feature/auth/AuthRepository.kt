package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.core.session.SessionStore
import kotlinx.serialization.Serializable

@Serializable
data class DeleteBody(val confirm: String)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class LoginUser(
    val id: String,
    val name: String? = null,
    val email: String? = null,
    val avatar: String? = null,
)

/** `/api/auth/app-login` and `/api/auth/passkey/login/verify` answer with this same payload. */
@Serializable
data class LoginResponse(
    val ok: Boolean = false,
    val token: String,
    val cookieName: String,
    val expiresInSeconds: Long = 0,
    val user: LoginUser,
)

/**
 * The single place a login becomes a stored session and a session goes away.
 *
 * Two different endings, on purpose (PRD REQ-ATT-16):
 * - [signOut]: the person tapped Logout or deleted the account. Everything goes, queued
 *   attendance included, because the phone may be handed to somebody else.
 * - [sessionEnded]: a 401. Same wipe, except queued attendance taps, which wait for the same
 *   person to sign back in.
 */
class AuthRepository(
    private val api: ApiClient,
    private val store: SessionStore,
    private val now: () -> Long = System::currentTimeMillis,
) {
    /** Hooks for the features that own per-session state (attendance queue, tracker, caches). */
    interface SessionListener {
        fun onSignedIn(session: Session) {}
        fun onSignedOut(session: Session?, deliberate: Boolean) {}
    }

    private val listeners = mutableListOf<SessionListener>()

    fun addListener(listener: SessionListener) {
        listeners += listener
    }

    /** Throws [id.znetworks.nexus.core.net.ApiError]; a 401 here means wrong credentials. */
    suspend fun login(email: String, password: String): Session {
        val res = api.postJson(
            "/api/auth/app-login",
            LoginRequest(email.trim(), password),
            LoginRequest.serializer(),
            LoginResponse.serializer(),
            authed = false,
        )
        return persist(res, fallbackEmail = email.trim())
    }

    /** A passkey sign-in answers exactly like app-login: stored through the same path. */
    fun signedInWith(res: LoginResponse): Session = persist(res, fallbackEmail = res.user.email.orEmpty())

    /** After a verified email change: the token stays valid, only the stored address changes. */
    fun updateEmail(email: String) {
        store.current?.let { store.save(it.copy(userEmail = email)) }
    }

    private fun persist(res: LoginResponse, fallbackEmail: String): Session {
        val session = Session(
            token = res.token,
            cookieName = res.cookieName,
            userId = res.user.id,
            userName = res.user.name.orEmpty(),
            userEmail = res.user.email ?: fallbackEmail,
            expiresAtMillis = if (res.expiresInSeconds > 0) now() + res.expiresInSeconds * 1000 else 0,
        )
        store.save(session)
        listeners.forEach { it.onSignedIn(session) }
        return session
    }

    /**
     * Deactivates and anonymises the account (API.md §2.1), then the full logout. A 409 (last owner
     * of a workspace, last admin) is thrown with the server's sentence.
     */
    suspend fun deleteAccount() {
        api.postJson("/api/user/account/delete", DeleteBody("DELETE"), DeleteBody.serializer(), kotlinx.serialization.json.JsonObject.serializer())
        signOut()
    }

    fun signOut() {
        val old = store.current
        store.clear()
        listeners.forEach { it.onSignedOut(old, deliberate = true) }
    }

    /** Called from the API client on a 401. Only ends the session that actually got refused. */
    fun sessionEnded(refused: Session) {
        val current = store.current ?: return
        if (current.token != refused.token) return
        store.clear()
        listeners.forEach { it.onSignedOut(current, deliberate = false) }
    }
}
