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
        // Audit R1: the cookie is an application header, and OkHttp keeps those across a redirect to
        // another host. A network interceptor sees every hop (redirects included) and drops it there.
        .addNetworkInterceptor { chain ->
            val r = chain.request()
            if (r.header("Cookie") != null && !mayCarrySession(r.url.host)) chain.proceed(r.newBuilder().removeHeader("Cookie").build())
            else chain.proceed(r)
        }
        .build()

    fun url(path: String): HttpUrl = baseUrl.resolve(path) ?: error("Bad path: $path")

    /** Set by the container: where [getCached] keeps the last good answer per key and per person. */
    var cache: ResponseCache? = null

    /** A read's value, and when it came off the disk instead of the server (null = live). */
    data class Cached<T>(val value: T, val savedAtMillis: Long?)

    /**
     * A read that falls back to the last good answer ONLY when nobody answered (API.md §1.11). A
     * server refusal is still an error: a cache is no reason to paper over one.
     */
    suspend fun <T> getCached(path: String, key: String, serializer: KSerializer<T>): Cached<T> {
        try {
            val element = get(path, kotlinx.serialization.json.JsonElement.serializer())
            val value = try { json.decodeFromJsonElement(serializer, element) } catch (e: Exception) { throw ApiError.Decoding(e) }
            cache?.save(key, element.toString())
            return Cached(value, null)
        } catch (e: ApiError) {
            if (!e.nobodyAnswered()) throw e
            val hit = cache?.load(key) ?: throw e
            val value = runCatching { json.decodeFromString(serializer, hit.body) }.getOrElse { throw e }
            return Cached(value, hit.savedAtMillis)
        }
    }

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
     * Streams a file to [target] with the session, resuming a partial download: if [target] already
     * holds bytes and [etag] names the same version, a `Range` + `If-Range` request continues it; a
     * server answering 200 instead (new build published meanwhile) replaces it whole, so two builds
     * are never spliced. Returns the ETag of what is now on disk. Reports (bytesDone, bytesTotal).
     */
    suspend fun download(
        pathOrUrl: String,
        target: java.io.File,
        etag: String?,
        /** Told the version as soon as the headers arrive, so a download cut mid-way can resume (audit S7). */
        onEtag: (String?) -> Unit = {},
        /** The response headers of a successful answer (Legal names a saved file from its Content-Disposition). */
        onHeaders: (okhttp3.Headers) -> Unit = {},
        onProgress: (Long, Long) -> Unit = { _, _ -> },
    ): String? {
        // A malformed absolute URL from the server is a failed download, not a crash (audit S8).
        val url = if (pathOrUrl.startsWith("http")) runCatching { pathOrUrl.toHttpUrl() }.getOrElse { throw ApiError.Transport(IOException("Bad download URL")) }
            else url(pathOrUrl)
        val session = sessionProvider()
        val have = if (target.exists() && etag != null) target.length() else 0L
        val req = Request.Builder().url(url).header("Accept", "*/*").apply {
            if (session != null && mayCarrySession(url.host)) header("Cookie", "${session.cookieName}=${session.token}")
            if (have > 0) { header("Range", "bytes=$have-"); header("If-Range", etag!!) }
        }.build()
        val res = try { http.newCall(req).await() } catch (e: IOException) { throw ApiError.Transport(e) }
        res.use {
            if (!it.isSuccessful) throw classify(it.code, runCatching { it.body.string() }.getOrNull(), session)
            val partial = it.code == 206
            val total = if (partial) {
                it.header("Content-Range")?.substringAfter('/')?.toLongOrNull() ?: -1L
            } else it.body.contentLength()
            var done = if (partial) have else 0L
            onEtag(it.header("ETag"))
            onHeaders(it.headers)
            try {
                it.body.byteStream().use { input ->
                    java.io.FileOutputStream(target, partial).use { out ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            done += n
                            onProgress(done, total)
                        }
                    }
                }
            } catch (e: IOException) {
                // What arrived stays on disk for the next attempt to resume.
                throw ApiError.Transport(e)
            }
            return it.header("ETag")
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

    /** A GET answered 200 (with its ETag) or 304 "unchanged since [etag]". */
    sealed interface Conditional<out T> {
        data class Fresh<T>(val value: T, val etag: String?) : Conditional<T>
        data object NotModified : Conditional<Nothing>
    }

    /**
     * GET with `If-None-Match: [etag]` (the Calendar routes, spec 5 Oct 2026): 304 is "unchanged" and
     * keeps what the caller holds; anything else goes through the same cookie, LAN route and 401/426
     * handling as [send].
     */
    suspend fun <T> getConditional(path: String, serializer: KSerializer<T>, etag: String?): Conditional<T> {
        val session = sessionProvider()
        val target = url(path)
        val request = Request.Builder().url(target).get().apply {
            if (!etag.isNullOrBlank()) header("If-None-Match", etag)
            if (session != null && mayCarrySession(target.host)) header("Cookie", "${session.cookieName}=${session.token}")
        }.build()
        val response = try { http.newCall(request).await() } catch (e: IOException) { throw ApiError.Transport(e) }
        response.use { res ->
            if (res.code == 304) return Conditional.NotModified
            val raw = try { res.body.string() } catch (e: IOException) { throw ApiError.Transport(e) }
            if (res.isSuccessful) {
                val value = try { json.decodeFromString(serializer, raw.ifBlank { "{}" }) } catch (e: Exception) { throw ApiError.Decoding(e) }
                return Conditional.Fresh(value, res.header("ETag"))
            }
            throw classify(res.code, raw, session)
        }
    }

    /**
     * Like [send] but hands back the raw 2xx body (GIDEON's `text/event-stream`), through the same
     * headers, cookie, LAN route and 426/401 handling. [readTimeoutMs]: a long answer is not a stall.
     */
    suspend fun sendText(request: Request, readTimeoutMs: Long): String {
        val session = sessionProvider()
        val prepared = request.newBuilder().apply {
            if (session != null && mayCarrySession(request.url.host)) header("Cookie", "${session.cookieName}=${session.token}")
        }.build()
        val client = http.newBuilder().readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS).callTimeout(readTimeoutMs + 30_000, TimeUnit.MILLISECONDS).build()
        val response = try { client.newCall(prepared).await() } catch (e: IOException) { throw ApiError.Transport(e) }
        response.use { res ->
            val raw = try { res.body.string() } catch (e: IOException) { throw ApiError.Transport(e) }
            if (res.isSuccessful) return raw
            throw classify(res.code, raw, session)
        }
    }

    /** SSE on OkHttp's worker thread. Cancellation closes the socket even while waiting for a line. */
    suspend fun sendEventLines(request: Request, readTimeoutMs: Long, onLine: (String) -> Unit): Unit = suspendCancellableCoroutine { cont ->
        val session = sessionProvider()
        val prepared = request.newBuilder().apply {
            if (session != null && mayCarrySession(request.url.host)) header("Cookie", "${session.cookieName}=${session.token}")
        }.build()
        val call = http.newBuilder().readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS).callTimeout(readTimeoutMs + 30_000, TimeUnit.MILLISECONDS)
            .build().newCall(prepared)
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(ApiError.Transport(e)) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    response.use { res ->
                        if (!res.isSuccessful) throw classify(res.code, res.body.string(), session)
                        val source = res.body.source()
                        while (cont.isActive) { val line = source.readUtf8Line() ?: break; onLine(line) }
                    }
                    if (cont.isActive) cont.resume(Unit)
                } catch (e: Exception) { if (cont.isActive) cont.resumeWithException(if (e is IOException) ApiError.Transport(e) else e) }
            }
        })
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
                // The in-app language (never the phone's): the server stores and pushes notifications in it
                // (13 Oct 2026: English unless the person chose Indonesian; iOS 5aaa3fb).
                .header("X-Nexus-Lang", id.znetworks.nexus.core.i18n.AppLanguage.serverCode(id.znetworks.nexus.core.i18n.AppLanguage.current))
                .header("User-Agent", identity.userAgent)
                .apply { if (chain.request().header("Accept") == null) header("Accept", "application/json") }
                .build()
            return chain.proceed(req)
        }
    }

    companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        fun String.toJsonBody(): RequestBody = toRequestBody(JSON_MEDIA)
        /** The API of whichever server this process talks to (NexusConfig.env). */
        fun production(
            identity: ClientIdentity,
            sessionProvider: () -> Session?,
            onUnauthorized: (Session) -> Unit,
            onUpgradeRequired: (ApiError.UpgradeRequired) -> Unit,
            routeInterceptor: Interceptor? = null,
        ) = ApiClient(NexusConfig.base.toHttpUrl(), identity, sessionProvider, onUnauthorized, onUpgradeRequired,
            baseClient = OkHttpClient.Builder().dns(DevHostDns(NexusConfig.DEV_HOST, id.znetworks.nexus.BuildConfig.DEV_ADDRESS,
                { id.znetworks.nexus.BuildConfig.DEBUG && NexusConfig.env == ServerEnv.DEV })).build(),
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
