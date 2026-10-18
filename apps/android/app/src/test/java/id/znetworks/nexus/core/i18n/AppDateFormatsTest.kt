package id.znetworks.nexus.core.i18n

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class AppDateFormatsTest {
    private val date = LocalDateTime.of(2026, 9, 1, 14, 5)
    @Test fun shortMonthSpellingDoesNotDependOnTheEnglishRegion() {
        for (locale in listOf(Locale.UK, Locale.US, AppLanguage.ENGLISH_FORMATS)) {
            assertEquals("Tue, 1 Sep 2026, 14:05", AppDateFormats.ofPattern("EEE, d MMM yyyy, HH:mm", locale).format(date))
        }
    }
    @Test fun otherMonthsAndIndonesianAndFullMonthNamesKeepTheirFormatting() {
        val id = Locale.forLanguageTag("id-ID")
        for (month in 1..12) {
            val at = date.withMonth(month)
            assertEquals(DateTimeFormatter.ofPattern("d MMM yyyy", id).format(at), AppDateFormats.ofPattern("d MMM yyyy", id).format(at))
            if (month != 9) assertEquals(DateTimeFormatter.ofPattern("d MMM", Locale.UK).format(at), AppDateFormats.ofPattern("d MMM", Locale.UK).format(at))
        }
        assertEquals("1 September", AppDateFormats.ofPattern("d MMMM", Locale.UK).format(date))
    }
    @Test fun quotedLiteralsAndMachineDatesAreUntouched() {
        assertEquals("MMM 1 Sep", AppDateFormats.ofPattern("'MMM' d MMM", Locale.UK).format(date))
        assertEquals("1 Sep '26", AppDateFormats.ofPattern("d MMM ''yy", Locale.UK).format(date))
        assertEquals("2026-09-01", AppDateFormats.ofPattern("yyyy-MM-dd", Locale.UK).format(date))
    }
}
