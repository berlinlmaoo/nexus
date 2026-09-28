package id.znetworks.nexus.feature.auth

import android.content.Context
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import okhttp3.Request

/** A code went out: to [email] (the server's canonical form), resendable after [cooldownSeconds]. */
data class CodeSent(val email: String, val cooldownSeconds: Int)

@Serializable
data class Passkey(val id: String, val label: String? = null, val createdAt: String? = null, val lastUsedAt: String? = null)

@Serializable
data class PasskeyList(val passkeys: List<Passkey> = emptyList())

/** The person closed the system passkey sheet: not an error, the screen stays as it was. */
class PasskeyCancelled : Exception()

/** No passkey for NEXUS on this phone (or the provider has none to offer). */
class NoPasskey : Exception()

/**
 * Sign-up, password reset, email/password change and passkeys (API.md §2.1). The unauthenticated
 * calls go without a session: their 401 is an answer, never a sign-out.
 */
class AccountApi(private val api: ApiClient) {

    private suspend fun call(path: String, body: JsonObject, authed: Boolean, method: String = "POST"): JsonObject {
        val req = Request.Builder().url(api.url(path)).method(method, body.toString().toJsonBody()).build()
        return api.send(req, JsonObject.serializer(), authed = authed)
    }

    private fun sent(o: JsonObject, fallback: String) = CodeSent(
        (o["email"] as? JsonPrimitive)?.contentOrNull ?: fallback,
        (o["resendCooldownSeconds"] as? JsonPrimitive)?.intOrNull ?: (o["resendInSeconds"] as? JsonPrimitive)?.intOrNull ?: 60,
    )

    // region sign-up

    suspend fun registerStart(name: String, email: String, password: String, workspaceCode: String?): CodeSent =
        sent(call("/api/auth/register", buildJsonObject {
            put("name", name.trim()); put("email", email.trim()); put("password", password)
            workspaceCode?.trim()?.takeIf { it.isNotEmpty() }?.let { put("workspaceCode", it) }
        }, authed = false), email.trim())

    /** The workspace code must be sent again here: this is the call that acts on it. */
    suspend fun registerVerify(email: String, code: String, workspaceCode: String?) {
        call("/api/auth/register/verify", buildJsonObject {
            put("email", email); put("code", code.trim())
            workspaceCode?.trim()?.takeIf { it.isNotEmpty() }?.let { put("workspaceCode", it) }
        }, authed = false)
    }

    suspend fun registerResend(email: String) = sent(call("/api/auth/register/resend", buildJsonObject { put("email", email) }, authed = false), email)

    // endregion

    // region password reset

    suspend fun resetRequest(email: String) = sent(call("/api/auth/password/reset/request", buildJsonObject { put("email", email.trim()) }, authed = false), email.trim())

    suspend fun resetVerify(email: String, code: String, password: String) {
        call("/api/auth/password/reset/verify", buildJsonObject { put("email", email); put("code", code.trim()); put("password", password) }, authed = false)
    }

    suspend fun resetResend(email: String) = sent(call("/api/auth/password/reset/resend", buildJsonObject { put("email", email) }, authed = false), email)

    // endregion

    // region signed in: email, password

    suspend fun changeEmailRequest(email: String) = sent(call("/api/user/email/request", buildJsonObject { put("email", email.trim()) }, authed = true), email.trim())

    /** Returns the canonical new email, to be written into the stored session. */
    suspend fun changeEmailVerify(email: String, code: String): String =
        (call("/api/user/email/verify", buildJsonObject { put("email", email); put("code", code.trim()) }, authed = true)["email"] as? JsonPrimitive)?.contentOrNull ?: email

    suspend fun changePassword(current: String, new: String) {
        call("/api/user/password", buildJsonObject { put("currentPassword", current); put("newPassword", new) }, authed = true, method = "PATCH")
    }

    // endregion

    // region passkeys

    suspend fun passkeys() = api.get("/api/auth/passkey", PasskeyList.serializer()).passkeys

    /** A 404 means it is already gone: that is what the person wanted. */
    suspend fun revokePasskey(id: String) {
        try {
            api.send(Request.Builder().url(api.url("/api/auth/passkey/$id")).delete().build(), JsonObject.serializer())
        } catch (e: ApiError.Http) {
            if (e.status != 404) throw e
        }
    }

    /** Options → system sheet → verify. [activity] must be an Activity context. */
    suspend fun addPasskey(activity: Context, label: String) {
        val options = call("/api/auth/passkey/register/options", JsonObject(emptyMap()), authed = true)
        val challenge = challengeOf(options)
        val response = try {
            CredentialManager.create(activity).createCredential(activity, CreatePublicKeyCredentialRequest(options.toString())) as CreatePublicKeyCredentialResponse
        } catch (e: CreateCredentialCancellationException) {
            throw PasskeyCancelled()
        }
        call("/api/auth/passkey/register/verify", buildJsonObject {
            put("credential", api.json.parseToJsonElement(response.registrationResponseJson))
            put("challenge", challenge)
            put("label", label.take(60))
        }, authed = true)
    }

    suspend fun passkeyLogin(activity: Context): LoginResponse {
        val options = call("/api/auth/passkey/login/options", JsonObject(emptyMap()), authed = false)
        val challenge = challengeOf(options)
        val credential = try {
            CredentialManager.create(activity).getCredential(activity, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options.toString())))).credential
        } catch (e: GetCredentialCancellationException) {
            throw PasskeyCancelled()
        } catch (e: NoCredentialException) {
            throw NoPasskey()
        }
        val json = (credential as? PublicKeyCredential)?.authenticationResponseJson ?: throw NoPasskey()
        val body = buildJsonObject { put("credential", api.json.parseToJsonElement(json)); put("challenge", challenge) }
        return api.send(Request.Builder().url(api.url("/api/auth/passkey/login/verify")).post(body.toString().toJsonBody()).build(),
            LoginResponse.serializer(), authed = false)
    }

    private fun challengeOf(o: JsonObject) = (o["challenge"] as? JsonPrimitive)?.contentOrNull.orEmpty()

    // endregion

    companion object {
        /** Sign-up validation: the first message in field order name → email → password → code. */
        fun firstValidationMessage(body: JsonObject?): String? {
            val details = (body?.get("details") as? JsonObject) ?: return null
            for (k in listOf("name", "email", "password", "workspaceCode")) {
                val m = (details[k] as? JsonArray)?.firstOrNull() as? JsonPrimitive
                if (m?.contentOrNull != null) return m.content
            }
            return null
        }

        /** A wait the server named: `retryAfterSeconds` / `resendInSeconds` in the body. */
        fun retryAfter(body: JsonObject?): Int? =
            ((body?.get("retryAfterSeconds") ?: body?.get("resendInSeconds")) as? JsonPrimitive)?.intOrNull

        fun attemptsRemaining(body: JsonObject?): Int? = (body?.get("attemptsRemaining") as? JsonPrimitive)?.intOrNull
    }
}
