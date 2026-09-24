package id.znetworks.nexus.core.net

import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * The one send path for every NEXUS call. Headers, the session cookie, 401 and 426 are decided
 * here once, so no screen can forget them.
 *
 * - No cookie jar: the session is a header we build ourselves (API.md §1.3). A jar would apply
 *   `__Secure-` prefix and domain rules that can silently drop it.
 * - `retryOnConnectionFailure(false)`: OkHttp's default quietly re-sends some POSTs, and a second
 *   check-in or chat message is worse than an error (API.md §1.6).
 * - Inactivity timeouts only (read/write), never a call timeout: a large upload that keeps
 *   moving must not be cut off.
 */
class ApiClient(
    private val baseUrl: HttpUrl,
    private val identity: ClientIdentity,
    private val sessionProvider: () -> Session?,
    /** Called on a 401 from an authenticated call, before [ApiError.Unauthorized] is thrown. */
    private val onUnauthorized: (Session) -> Unit = {},
    /** Called on every recognised 426, from any request (API.md §1.8). */
    private val onUpgradeRequired: (ApiError.UpgradeRequired) -> Unit = {},
    /** Which hosts may receive the cookie. Only tests replace this. */
    private val mayCarrySession: (String) -> Boolean = NexusConfig::isNexusHost,
    baseClient: OkHttpClient = OkHttpClient(),
    /** The LAN shortcut's host rewrite (after identity, so the LAN request carries the same headers). */
    routeInterceptor: Interceptor? = null,
) {
    val json: Json = NexusJson

    val http: OkHttpClient = baseClient.newBuilder()
        .retryOnConnectionFailure(false)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .addInterceptor(IdentityInterceptor(identity))
        .apply { routeInterceptor?.let(::addInterceptor) }
        .build()

    fun url(path: String): HttpUrl = baseUrl.resolve(path) ?: error("Bad path: $path")

    suspend fun <T> get(
        path: String,
        serializer: KSerializer<T>,
        authed: Boolean = true,
        callTimeoutMs: Long? = null,
    ): T = send(Request.Builder().url(url(path)).get().build(), serializer, authed, callTimeoutMs)

    suspend fun <B, T> postJson(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>,
        authed: Boolean = true,
    ): T = send(
        Request.Builder().url(url(path)).post(json.encodeToString(bodySerializer, body).toJsonBody()).build(),
        serializer,
        authed,
    )

    /**
     * Raw bytes of a stored file (`/api/files/…` selfies, request evidence). Those routes need the
     * session, so they go through here, never through a browser or an image library that would
     * drop the cookie (API.md §1.1). Absolute URLs on other hosts are fetched without it.
     */
    suspend fun bytes(pathOrUrl: String): ByteArray {
        val target = if (pathOrUrl.startsWith("http")) pathOrUrl.toHttpUrl() else url(pathOrUrl)
        val session = sessionProvider()
        val req = Request.Builder().url(target).header("Accept", "*/*").apply {
            if (session != null && mayCarrySession(target.host)) header("Cookie", "${session.cookieName}=${session.token}")
        }.build()
        val res = try { http.newCall(req).await() } catch (e: IOException) { throw ApiError.Transport(e) }
        res.use {
            if (it.isSuccessful) return try { it.body.bytes() } catch (e: IOException) { throw ApiError.Transport(e) }
            throw classify(it.code, runCatching { it.body.string() }.getOrNull(), session)
        }
    }

    /**
     * Sends [request] and decodes a 2xx body with [serializer]. [authed] = false is for the calls
     * made without a session (login, sign-up, version policy): their 401 is an answer, not an
     * expired session, and must never sign anybody out.
     */
    suspend fun <T> send(
        request: Request,
        serializer: KSerializer<T>,
        authed: Boolean = true,
        /** A hard ceiling for calls nobody should wait on (the version policy: 8 s). */
        callTimeoutMs: Long? = null,
        /**
         * Send under this session instead of the stored one. Only for logout's push-device DELETE,
         * which must go out with the OLD cookie after the session is cleared (API.md §1.3). A 401
         * here ends nothing.
         */
        asSession: Session? = null,
    ): T {
        val session = asSession ?: if (authed) sessionProvider() else null
        val prepared = request.newBuilder().apply {
            if (session != null && mayCarrySession(request.url.host)) {
                header("Cookie", "${session.cookieName}=${session.token}")
            }
        }.build()

        val response = try {
            val client = if (callTimeoutMs != null) {
                http.newBuilder().callTimeout(callTimeoutMs, TimeUnit.MILLISECONDS).build()
            } else {
                http
            }
            client.newCall(prepared).await()
        } catch (e: IOException) {
            throw ApiError.Transport(e)
        }

        response.use { res ->
            val raw = try {
                res.body.string()
            } catch (e: IOException) {
                throw ApiError.Transport(e)
            }
            if (res.isSuccessful) {
                return try {
                    json.decodeFromString(serializer, raw.ifBlank { "{}" })
                } catch (e: Exception) {
                    throw ApiError.Decoding(e)
                }
            }
            throw classify(res.code, raw, authedSession = if (asSession != null) null else session)
        }
    }

    private fun classify(status: Int, raw: String?, authedSession: Session?): ApiError {
        val body = ErrorBody.parse(json, raw)
        val code = ErrorBody.code(body)
        if (status == 426 && code == "UPGRADE_REQUIRED") {
            val err = ApiError.UpgradeRequired(
                serverMessage = ErrorBody.serverMessage(body),
                minSupported = (body?.get("minSupported") as? JsonPrimitive)?.contentOrNull,
                storeUrl = (body?.get("storeUrl") as? JsonPrimitive)?.contentOrNull,
            )
            onUpgradeRequired(err)
            return err
        }
        if (status == 401 && authedSession != null) {
            onUnauthorized(authedSession)
            return ApiError.Unauthorized
        }
        return ApiError.Http(status, ErrorBody.serverMessage(body), code, body)
    }

    private class IdentityInterceptor(private val identity: ClientIdentity) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request().newBuilder()
                .header("X-Nexus-Client", identity.clientTag)
                .header("User-Agent", identity.userAgent)
                .apply { if (chain.request().header("Accept") == null) header("Accept", "application/json") }
                .build()
            return chain.proceed(req)
        }
    }

    companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        fun String.toJsonBody(): RequestBody = toRequestBody(JSON_MEDIA)
        fun production(
            identity: ClientIdentity,
            sessionProvider: () -> Session?,
            onUnauthorized: (Session) -> Unit,
            onUpgradeRequired: (ApiError.UpgradeRequired) -> Unit,
            routeInterceptor: Interceptor? = null,
        ) = ApiClient(NexusConfig.PUBLIC_BASE.toHttpUrl(), identity, sessionProvider, onUnauthorized, onUpgradeRequired,
            routeInterceptor = routeInterceptor)
    }
}

/**
 * Servers ship more often than apps: unknown fields and missing optional ones must never break a
 * screen, and an unknown enum value falls back to the property's default.
 */
val NexusJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    isLenient = true
    encodeDefaults = true
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = cont.resume(response)
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}
