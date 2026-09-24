package id.znetworks.nexus.core.net

import android.os.Build
import id.znetworks.nexus.BuildConfig

/**
 * The server's identity. `nexus.znetworks.id` is also the passkey RP id and the host every image
 * URL is built from, so it is a constant, not a setting (API.md §1.1).
 */
object NexusConfig {
    const val PUBLIC_HOST = "nexus.znetworks.id"
    const val LAN_HOST = "lan.nexus.znetworks.id"
    const val PUBLIC_BASE = "https://$PUBLIC_HOST"

    /** Exact match, never a suffix match: the session cookie goes to these two hosts only. */
    fun isNexusHost(host: String?): Boolean =
        host != null && (host.equals(PUBLIC_HOST, ignoreCase = true) || host.equals(LAN_HOST, ignoreCase = true))
}

/** What this build tells the server about itself on every request (API.md §1.4). */
data class ClientIdentity(
    val versionName: String,
    val versionCode: Int,
    val sdkInt: Int,
) {
    /** `android/<x.y.z>/<code>`: the server holds each build to the rules that build can obey. */
    val clientTag: String get() = "android/$versionName/$versionCode"

    /**
     * Must NOT start with `NEXUS/<digits>`: that prefix is how the server recognises iOS builds
     * older than 0.1.6, and copying it would get Android judged by the iOS build table.
     */
    val userAgent: String get() = "NEXUS-Android/$versionName ($versionCode; Android $sdkInt)"

    companion object {
        fun current() = ClientIdentity(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, Build.VERSION.SDK_INT)
    }
}
