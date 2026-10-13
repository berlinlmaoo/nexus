package id.znetworks.nexus.core.time

import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Office time is Asia/Jakarta (WIB) whatever the phone's own time zone says (PRD §2.6).
 */
object OfficeTime {
    val ZONE: ZoneId = ZoneId.of("Asia/Jakarta")

    private val MONTH_KEY = DateTimeFormatter.ofPattern("yyyy-MM")

    fun today(now: Instant = Instant.now()): LocalDate = now.atZone(ZONE).toLocalDate()

    /** `YYYY-MM-DD` office date, as the server's `attendanceDateKey`. */
    fun dateKey(date: LocalDate): String = date.toString()

    /**
     * The attendance period key. A period runs from the 28th of the previous month to the 27th,
     * so 28 Sep–27 Oct is "2026-10". iOS used the calendar month here, which is wrong on the
     * 28th–31st (API.md §1.11 discrepancy); this follows the server's `attendancePeriodKey`.
     */
    fun periodKey(date: LocalDate): String {
        val month = YearMonth.from(date).let { if (date.dayOfMonth >= 28) it.plusMonths(1) else it }
        return month.format(MONTH_KEY)
    }

    /** First and last office date of the period [key] (`YYYY-MM`). */
    fun periodRange(key: String): ClosedRange<LocalDate> {
        val month = YearMonth.parse(key, MONTH_KEY)
        return month.minusMonths(1).atDay(28)..month.atDay(27)
    }
}
