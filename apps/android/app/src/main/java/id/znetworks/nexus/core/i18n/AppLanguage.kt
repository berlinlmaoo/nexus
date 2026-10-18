package id.znetworks.nexus.core.i18n

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/**
 * The app's language (owner, 29 Sep 2026; iOS AppLanguage): English by default, whatever the phone's
 * own language, with Bahasa Indonesia as the other choice; the choice is kept.
 */
object AppLanguage {
    const val ENGLISH = "en"
    const val INDONESIAN = "in"
    private const val PREFS = "nexus.language"
    private const val KEY = "tag"

    /** The language to use: the person's choice, else one picked in-app before this rule, else English. */
    fun resolve(stored: String?, current: String?): String =
        stored?.takeIf { it == ENGLISH || it == INDONESIAN }
            ?: current?.substringBefore('-')?.let { if (it == "in" || it == "id") INDONESIAN else if (it == "en") ENGLISH else null }
            ?: ENGLISH

    /**
     * The chosen tag, readable from any thread (request headers): notifications and pushes follow the in-app
     * language, never the phone's (13 Oct 2026). English until [apply] / [load] ran.
     */
    @Volatile var current: String = ENGLISH
        internal set

    /**
     * Dates and numbers in the app's language, not the phone's (owner, 14 Oct 2026; iOS AppDateLocale): an English app
     * on an Indonesian phone says "Wed, 14 Oct", an Indonesian one "Rab, 14 Okt". Rupiah amounts keep id-ID on purpose.
     * English uses en-150 for day-first dates and 24-hour time; AppDateFormats pins "Sep" across ICU/CLDR versions.
     */
    fun locale(tag: String = current): java.util.Locale =
        if (tag == INDONESIAN) java.util.Locale.forLanguageTag("id-ID") else ENGLISH_FORMATS

    val ENGLISH_FORMATS: java.util.Locale = java.util.Locale.forLanguageTag("en-150")

    /** Makes every formatter that reads Locale.getDefault() follow the app's language too. */
    private fun useForFormats(tag: String) = java.util.Locale.setDefault(locale(tag))

    /** Told when the person picks another language (the container sends it to the server). */
    @Volatile var onChosen: ((String) -> Unit)? = null

    /** The server's code for a tag: `id` for Indonesian, `en` otherwise (X-Nexus-Lang, User.uiLanguage). */
    fun serverCode(tag: String): String = if (tag == INDONESIAN) "id" else "en"

    /** Reads the stored choice without touching the UI locale (process start, before any request). */
    fun load(context: Context) {
        current = resolve(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null), null)
        useForFormats(current)
    }

    /** Called before the activity draws: makes the app follow [resolve], never the system language. */
    fun apply(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = AppCompatDelegate.getApplicationLocales().toLanguageTags().takeIf { it.isNotEmpty() }
        val tag = resolve(prefs.getString(KEY, null), current)
        this.current = tag
        useForFormats(tag)
        prefs.edit().putString(KEY, tag).apply()
        if (current == null || current.substringBefore('-') != tag) AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
    }

    fun choose(context: Context, tag: String) {
        val changed = tag != current
        current = tag
        useForFormats(tag)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, tag).apply()
        if (changed) onChosen?.invoke(tag)
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
        // The calendar widgets speak the app's language, not the phone's.
        id.znetworks.nexus.feature.calendar.widget.CalendarWidgetWork.redrawNow(context)
    }
}
