package id.znetworks.nexus.core.i18n

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat

/**
 * The app's language (Berlin, 29 Sep 2026; iOS AppLanguage): English by default, whatever the phone's
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

    /** Called before the activity draws: makes the app follow [resolve], never the system language. */
    fun apply(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = AppCompatDelegate.getApplicationLocales().toLanguageTags().takeIf { it.isNotEmpty() }
        val tag = resolve(prefs.getString(KEY, null), current)
        prefs.edit().putString(KEY, tag).apply()
        if (current == null || current.substringBefore('-') != tag) AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
    }

    fun choose(context: Context, tag: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, tag).apply()
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
    }
}
