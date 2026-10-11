package id.znetworks.nexus.core.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import id.znetworks.nexus.core.session.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLHandshakeException

/**
 * The office LAN shortcut (API.md §1.2, iOS `LANRoute`). Inside the office the same server answers
 * at `lan.nexus.znetworks.id` (private address, real certificate), so a selfie crosses the switch
 * instead of the office uplink, and attendance keeps working when the office's internet is down
 * (15 Sep 2026: 164 requests went through it while every phone outside got 530).
 *
 * One decision point: an interceptor that rewrites the host. Probing never blocks a request.
 */
class LanRoute(
    /** Maps a public-host URL to its LAN twin (host swap in the app; a second server in tests). */
    private val toLan: (HttpUrl) -> HttpUrl?,
    private val probe: suspend () -> Boolean,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val onLan = AtomicBoolean(false)
    private val probing = AtomicBoolean(false)
    @Volatile private var lastProbeAt = 0L
    @Volatile var plausible = false
        private set
    private var retryJob: Job? = null

    val active: Boolean get() = plausible && onLan.get()

    /** Wi-Fi/Ethernet appeared or changed, or the app came to the foreground. */
    fun onNetwork(wifiOrEthernet: Boolean) {
        plausible = wifiOrEthernet
        if (!wifiOrEthernet) {
            // Cellular or nothing: public host immediately, no probe (a private name on somebody
            // else's network is not our office).
            onLan.set(false)
            return
        }
        reprobe(force = true)
    }

    /** Lazy probe with a 2 s cooldown, used on first requests and foregrounds. */
    fun reprobe(force: Boolean = false) {
        if (!plausible) return
        if (!force && now() - lastProbeAt < COOLDOWN_MS) return
        if (!probing.compareAndSet(false, true)) return
        lastProbeAt = now()
        scope.launch {
            try {
                onLan.set(runCatching { probe() }.getOrDefault(false))
            } finally {
                probing.set(false)
            }
        }
    }

    /** A transport failure on the LAN: off it at once, try again in 30 s. */
    fun demote() {
        onLan.set(false)
        retryJob?.cancel()
        retryJob = scope.launch {
            delay(RETRY_MS)
            reprobe(force = true)
        }
    }

    val interceptor = Interceptor { chain ->
        val original = chain.request()
        val lanUrl = if (active) toLan(original.url) else null
        if (lanUrl == null) {
            reprobe()
            return@Interceptor chain.proceed(original)
        }
        val lanRequest = original.newBuilder().url(lanUrl).build()
        // A bodiless request gets a 10 s leash on the LAN; one with a body keeps the normal 60 s.
        val leashed = if (original.body == null) {
            chain.withConnectTimeout(10, TimeUnit.SECONDS).withReadTimeout(10, TimeUnit.SECONDS)
        } else chain
        try {
            leashed.proceed(lanRequest)
        } catch (e: IOException) {
            demote()
            // Sent again over the public host only if it provably never reached the server
            // (API.md §1.6); never after a timeout or a dropped connection.
            if (replayable(original, e)) chain.proceed(original) else throw e
        }
    }

    companion object {
        const val COOLDOWN_MS = 2_000L
        const val RETRY_MS = 30_000L

        fun replayable(request: Request, e: IOException): Boolean {
            if (request.method == "GET" || request.method == "HEAD") return true
            return e is UnknownHostException || e is ConnectException || e is NoRouteToHostException || e is SSLHandshakeException
        }

        /** The app's wiring: host swap, Wi-Fi-bound 300 ms probe of `/api/user/profile` (200 only). */
        fun create(
            context: Context,
            identity: ClientIdentity,
            session: () -> Session?,
            scope: CoroutineScope,
        ): LanRoute {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            val wifi = AtomicReference<Network?>(null)
            val route = LanRoute(
                toLan = { url -> if (url.host.equals(NexusConfig.PUBLIC_HOST, true)) url.newBuilder().host(NexusConfig.LAN_HOST).build() else null },
                probe = probe@{
                    // The office shortcut is production's; a DEV session never goes to the LAN host.
                    if (NexusConfig.env != ServerEnv.PRODUCTION) return@probe false
                    val s = session() ?: return@probe false
                    val net = wifi.get() ?: return@probe false
                    val client = OkHttpClient.Builder()
                        // Bound to the Wi-Fi network: a probe never leaves over mobile data.
                        .socketFactory(net.socketFactory)
                        .connectTimeout(300, TimeUnit.MILLISECONDS)
                        .readTimeout(300, TimeUnit.MILLISECONDS)
                        .callTimeout(600, TimeUnit.MILLISECONDS)
                        .retryOnConnectionFailure(false)
                        .build()
                    val req = Request.Builder().url("https://${NexusConfig.LAN_HOST}/api/user/profile")
                        .header("Cookie", "${s.cookieName}=${s.token}")
                        .header("Accept", "application/json")
                        .header("X-Nexus-Client", identity.clientTag)
                        .header("User-Agent", identity.userAgent)
                        .build()
                    // 200 only: a 401 on the LAN host must not look like being signed out, and
                    // anything else is simply "not the office".
                    runCatching { client.newCall(req).execute().use { it.code == 200 } }.getOrDefault(false)
                },
                scope = scope,
            )
            cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    val local = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                    wifi.set(if (local) network else null)
                    route.onNetwork(local)
                }

                override fun onLost(network: Network) {
                    wifi.compareAndSet(network, null)
                    route.onNetwork(false)
                }
            })
            return route
        }
    }
}
