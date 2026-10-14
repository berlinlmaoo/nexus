package id.znetworks.nexus.core.config

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable

/**
 * Remote config (owner, 28 Sep 2026; iOS RemoteConfig.swift, server lib/app-config.ts):
 * `GET /api/app/config?platform=android` — public, no session, exempt from 426. Flags, numbers and
 * sentences the server can change without a new APK. From now on, a rule or sentence that may change
 * is read from here, not hard-coded.
 *
 * Every value has a built-in default equal to the server's, so an app that never reaches the server
 * behaves as shipped. The last answer is kept on disk and used from the next launch's first frame;
 * unknown keys are ignored; a missing or broken body leaves the previous values in place.
 */
@Serializable data class ConfigFlags(
    val requireAlwaysLocation: Boolean? = null,
    val blockSignOutDuringWorkday: Boolean? = null,
    val fakeGpsReview: Boolean? = null,
    /** The Calendar menu (master calendar); who gets data is decided per person on the server. */
    val calendar: Boolean? = null,
    /** The Calendar widgets. */
    val calendarWidgets: Boolean? = null,
    /** Automatic offsite check-out after 2 h 30 outside (server cd89d72): off unless the server says so (owner, 8 Oct). */
    val outsideAutoCheckout: Boolean? = null,
)
@Serializable data class ConfigValues(val outsideHourAlertMinutes: Int? = null, val calendarPollSeconds: Int? = null)
@Serializable data class ConfigBanner(val id: String, val tone: String? = null, val title: String = "", val message: String = "", val link: String? = null)
@Serializable data class ConfigBody(
    val flags: ConfigFlags? = null,
    val values: ConfigValues? = null,
    val texts: Map<String, Map<String, String>>? = null,
    val banner: ConfigBanner? = null,
) {
    // Reads, with the server's defaults.
    val requireAlwaysLocation get() = flags?.requireAlwaysLocation ?: true
    val blockSignOutDuringWorkday get() = flags?.blockSignOutDuringWorkday ?: true
    val fakeGpsReview get() = flags?.fakeGpsReview ?: true
    /** Minutes outside the office before the local "time left" alert (UPDATES §10). */
    val outsideHourAlertMinutes get() = values?.outsideHourAlertMinutes?.takeIf { it in 1..600 } ?: 60
    val calendar get() = flags?.calendar ?: true
    val calendarWidgets get() = flags?.calendarWidgets ?: true
    /** False (the default): no countdown and no "auto check-out at" anywhere; the reminders stay. */
    val outsideAutoCheckout get() = flags?.outsideAutoCheckout ?: false
    /** How often the Calendar polls while it is on screen (with If-None-Match). */
    val calendarPollSeconds get() = values?.calendarPollSeconds?.takeIf { it in 10..3600 } ?: 60

    /**
     * The server's sentence for [key] in [lang] ("en" / "id"), else its English one when it has none
     * in that language at all, else null (the caller then uses the app's own translated copy).
     */
    fun text(key: String, lang: String): String? {
        texts?.get(lang)?.get(key)?.takeIf { it.isNotEmpty() }?.let { return it }
        if (lang != "en" && texts?.get(lang) == null) texts?.get("en")?.get(key)?.takeIf { it.isNotEmpty() }?.let { return it }
        return null
    }

    companion object {
        /** The app's language as the server spells it: Indonesian is "in"/"id" on Android. */
        fun lang(locale: java.util.Locale): String = if (locale.language == "in" || locale.language == "id") "id" else "en"
    }
}

class RemoteConfig(context: Context, private val fetch: suspend () -> ConfigBody?, private val now: () -> Long = System::currentTimeMillis) {
    private val prefs = context.getSharedPreferences("nexus.remoteConfig", Context.MODE_PRIVATE)
    private val _body = MutableStateFlow(load())
    val body: StateFlow<ConfigBody> = _body.asStateFlow()
    val current: ConfigBody get() = _body.value
    @Volatile private var lastFetch = 0L

    /** On launch (forced) and on every return to the foreground, at most every 5 minutes. */
    suspend fun refresh(force: Boolean = false) {
        val t = now()
        if (!force && t - lastFetch < MIN_GAP_MS) return
        lastFetch = t
        val fresh = runCatching { fetch() }.getOrNull() ?: return
        if (fresh == _body.value) return
        _body.value = fresh
        prefs.edit().putString(KEY, NexusJson.encodeToString(ConfigBody.serializer(), fresh)).apply()
    }

    private fun load(): ConfigBody = prefs.getString(KEY, null)
        ?.let { runCatching { NexusJson.decodeFromString(ConfigBody.serializer(), it) }.getOrNull() } ?: ConfigBody()

    companion object {
        const val MIN_GAP_MS = 5 * 60_000L
        private const val KEY = "body"
    }
}

/** A sentence the server may change: its text in the app's language, else the app's own [fallback]. */
@Composable
fun configText(key: String, fallback: Int): String {
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val body by container.remoteConfig.body.collectAsState()
    val lang = ConfigBody.lang(LocalConfiguration.current.locales[0])
    return body.text(key, lang) ?: stringResource(fallback)
}
