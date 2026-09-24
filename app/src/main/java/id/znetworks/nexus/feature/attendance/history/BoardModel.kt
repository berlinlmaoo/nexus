package id.znetworks.nexus.feature.attendance.history

import id.znetworks.nexus.core.time.OfficeTime
import java.time.LocalDate

/**
 * The BoD's palette (17 Sep 2026), same as the web board and iOS `AttTone`: absent red, present and
 * permit green, sick orange, day off purple, leave yellow, WFH blue.
 */
enum class AttTone { PRESENT, PERMIT, WFH, LEAVE, SICK, DAYOFF, ABSENT, NONE;

    companion object {
        fun of(r: HistoryRow): AttTone {
            when (r.attendanceDayType.orEmpty().uppercase()) {
                "SICK_APPROVED" -> return SICK
                "DAY_OFF_APPROVED" -> return DAYOFF // DAY_OFF and RED_DATE
                "PERMIT_APPROVED" -> return PERMIT
                "LEAVE_APPROVED" -> return LEAVE
                // The server's synthetic "no record on a workday" row: an absence, not a weekend.
                "ABSENT" -> return ABSENT
            }
            val s = r.status.orEmpty().uppercase()
            return when {
                "REMOTE" in s || "WFH" in s -> WFH
                listOf("LEAVE", "SICK", "PERMIT", "OFF", "IZIN", "CUTI").any { it in s } -> LEAVE
                r.checkInAt != null || "PRESENT" in s || "HADIR" in s -> PRESENT
                "ABSENT" in s || "ALPHA" in s -> ABSENT
                else -> NONE
            }
        }
    }
}

data class BoardMember(val id: String, val name: String, val cells: Map<String, AttTone>, val rows: Map<String, HistoryRow>)

object BoardModel {
    /** Every office date of the 28→27 period [periodKey], in order. */
    fun days(periodKey: String): List<LocalDate> {
        val r = OfficeTime.periodRange(periodKey)
        return generateSequence(r.start) { it.plusDays(1) }.takeWhile { !it.isAfter(r.endInclusive) }.toList()
    }

    /** One row per person, the viewer's own first, then by name. */
    fun members(rows: List<HistoryRow>, viewerId: String?, selfName: String): List<BoardMember> =
        rows.groupBy { it.user?.id ?: viewerId ?: "me" }.map { (uid, rs) ->
            BoardMember(
                id = uid,
                name = rs.firstNotNullOfOrNull { it.user?.name } ?: selfName,
                cells = rs.associate { it.dayKey to AttTone.of(it) },
                rows = rs.associateBy { it.dayKey },
            )
        }.sortedWith(compareBy({ it.id != viewerId }, { it.name.lowercase() }))

    /** Period key [offset] periods away from today's. */
    fun periodKey(offset: Int, today: LocalDate = OfficeTime.today()): String {
        val base = OfficeTime.periodKey(today)
        return java.time.YearMonth.parse(base).plusMonths(offset.toLong()).toString()
    }
}
