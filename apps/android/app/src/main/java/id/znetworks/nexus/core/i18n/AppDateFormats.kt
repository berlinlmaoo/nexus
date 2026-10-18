package id.znetworks.nexus.core.i18n

import java.text.DateFormatSymbols
import java.time.chrono.IsoChronology
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.format.FormatStyle
import java.time.temporal.ChronoField
import java.util.Locale

/** Owner's English short month spelling, independent of Android ICU / desktop CLDR revisions. */
object AppDateFormats {
    fun ofPattern(pattern: String, locale: Locale = Locale.getDefault()): DateTimeFormatter {
        if (locale.language != "en" || !pattern.contains("MMM")) return DateTimeFormatter.ofPattern(pattern, locale)
        val months = DateFormatSymbols(locale).shortMonths.take(12).mapIndexed { index, text ->
            (index + 1L) to if (index == 8) "Sep" else text
        }.toMap()
        val builder = DateTimeFormatterBuilder()
        var quoted = false
        var start = 0
        var i = 0
        while (i < pattern.length) {
            if (pattern[i] == '\'') {
                if (i + 1 < pattern.length && pattern[i + 1] == '\'') { i += 2; continue }
                quoted = !quoted
            }
            if (!quoted && pattern[i] == 'M') {
                var end = i + 1
                while (end < pattern.length && pattern[end] == 'M') end++
                if (end - i == 3) {
                    if (start < i) builder.appendPattern(pattern.substring(start, i))
                    builder.appendText(ChronoField.MONTH_OF_YEAR, months)
                    start = end
                }
                i = end
            } else i++
        }
        if (start < pattern.length) builder.appendPattern(pattern.substring(start))
        return builder.toFormatter(locale)
    }

    fun localizedDateTime(date: FormatStyle, time: FormatStyle, locale: Locale = Locale.getDefault()): DateTimeFormatter =
        ofPattern(DateTimeFormatterBuilder.getLocalizedDateTimePattern(date, time, IsoChronology.INSTANCE, locale), locale)
}
