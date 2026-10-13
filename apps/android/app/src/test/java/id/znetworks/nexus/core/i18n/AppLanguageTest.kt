package id.znetworks.nexus.core.i18n

import org.junit.Assert.assertEquals
import org.junit.Test

class AppLanguageTest {
    // Berlin 29 Sep (point 3): English by default, never the phone's language; a choice is kept.
    @Test fun englishUnlessChosen() {
        assertEquals("en", AppLanguage.resolve(stored = null, current = null))           // phone in Indonesian, nothing chosen
        assertEquals("in", AppLanguage.resolve(stored = "in", current = null))
        assertEquals("en", AppLanguage.resolve(stored = "en", current = "in"))           // the stored choice wins
        assertEquals("in", AppLanguage.resolve(stored = null, current = "in"))           // chosen in-app before this rule
        assertEquals("in", AppLanguage.resolve(stored = null, current = "id-ID"))
        assertEquals("en", AppLanguage.resolve(stored = null, current = "fr"))            // anything else: English
        assertEquals("en", AppLanguage.resolve(stored = "xx", current = null))
    }

    @Test fun datesAndNumbersFollowTheAppLanguage() {
        val d = java.time.LocalDate.of(2026, 10, 14)
        val f = { tag: String -> java.time.format.DateTimeFormatter.ofPattern("EEE, d MMM", AppLanguage.locale(tag)).format(d) }
        org.junit.Assert.assertEquals("Wed, 14 Oct", f(AppLanguage.ENGLISH))
        org.junit.Assert.assertEquals("Rab, 14 Okt", f(AppLanguage.INDONESIAN))
        org.junit.Assert.assertEquals("1,000", java.text.NumberFormat.getNumberInstance(AppLanguage.locale(AppLanguage.ENGLISH)).format(1000))
        org.junit.Assert.assertEquals("1.000", java.text.NumberFormat.getNumberInstance(AppLanguage.locale(AppLanguage.INDONESIAN)).format(1000))
    }
}
