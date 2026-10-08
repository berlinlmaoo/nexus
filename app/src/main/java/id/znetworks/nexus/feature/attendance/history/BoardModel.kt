package id.znetworks.nexus.feature.attendance.history

import id.znetworks.nexus.feature.attendance.requests.PersonRef
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

data class BoardMember(
    val id: String,
    val name: String,
    val cells: Map<String, AttTone>,
    val rows: Map<String, HistoryRow>,
    /** Effective day-off quota for the period (member quota + extra days); 4 when the server sent none. */
    val quota: Int = BoardModel.DEFAULT_QUOTA,
) {
    /** Days worked: present (a check-in), approved permit, or WFH, as on web and iOS. */
    val worked: Int get() = cells.values.count { it == AttTone.PRESENT || it == AttTone.PERMIT || it == AttTone.WFH }
}

/** The Score cell: "22/22" capped at the working days, plus the surplus ("+3") when there is one. */
data class Score(val shown: Int, val target: Int, val surplus: Int) {
    val text: String get() = "$shown/$target"
}

object BoardModel {
    /** After today in the office's time zone. */
    fun isFuture(dayKey: String, today: java.time.LocalDate = id.znetworks.nexus.core.time.OfficeTime.today()): Boolean =
        runCatching { java.time.LocalDate.parse(dayKey.take(10)).isAfter(today) }.getOrDefault(false)

    /** A member-record day: real records for everyone; id-less rows and empty past days for the BoD; never the future. */
    fun dayOpens(row: HistoryRow?, canManage: Boolean, future: Boolean): Boolean = when {
        future -> false
        row != null -> row.id != null || canManage
        else -> canManage
    }

    /** Rows are drawn only under the period they were fetched for (audit T6). */
    fun rowsFor(period: String, rowsPeriod: String?, rows: List<HistoryRow>): List<HistoryRow> = if (rowsPeriod == period) rows else emptyList()

    const val DEFAULT_QUOTA = 4

    /** Working days: the period's calendar days minus that person's day-off quota (31 → 27 with 4). */
    fun workingDays(periodDays: Int, quota: Int) = maxOf(0, periodDays - quota)

    /** A day cut from the quota for being >120 min late is still worked, so worked can exceed it. */
    fun score(worked: Int, periodDays: Int, quota: Int): Score {
        val target = workingDays(periodDays, quota)
        return Score(minOf(worked, target), target, maxOf(0, worked - target))
    }

    /** Every office date of the 28→27 period [periodKey], in order. */
    fun days(periodKey: String): List<LocalDate> {
        val r = OfficeTime.periodRange(periodKey)
        return generateSequence(r.start) { it.plusDays(1) }.takeWhile { !it.isAfter(r.endInclusive) }.toList()
    }

    /**
     * One row per person, A–Z (as iOS and the web). The roster and the rows together: on the first
     * day of a period only those who already checked in have rows, and the board must still show
     * everybody else (bug from the main session, 28 Sep 2026).
     */
    fun members(rows: List<HistoryRow>, viewerId: String?, selfName: String, roster: List<PersonRef> = emptyList()): List<BoardMember> {
        val byUser = rows.groupBy { it.user?.id ?: viewerId ?: "me" }
        val rosterById = roster.filter { !it.id.isNullOrBlank() }.associateBy { it.id!! }
        return (rosterById.keys + byUser.keys).distinct().map { uid ->
            val rs = byUser[uid].orEmpty()
            val person = rosterById[uid]
            BoardMember(
                id = uid,
                name = rs.firstNotNullOfOrNull { it.user?.name } ?: person?.name ?: person?.email
                    // The viewer's own name only on the viewer's own row (audit R6); anyone else unnamed is "—".
                    ?: if (uid == viewerId || uid == "me") selfName else "—",
                cells = rs.associate { it.dayKey to AttTone.of(it) },
                rows = rs.associateBy { it.dayKey },
                quota = rs.firstNotNullOfOrNull { it.user?.dayOffQuota } ?: person?.dayOffQuota ?: DEFAULT_QUOTA,
            )
        }.sortedBy { it.name.lowercase() }
    }

    /**
     * The person is outside the office right now (Berlin, 8 Oct, as the web board): today's row has an
     * `outsideSince` and no check-out yet. Returns the outsideSince instant, else null.
     */
    fun outsideNow(row: HistoryRow?, today: String = id.znetworks.nexus.core.time.OfficeTime.today().toString()): String? =
        row?.takeIf { it.dayKey == today && it.checkOutAt == null }?.outsideSince?.takeIf { it.isNotBlank() }

    /** Period key [offset] periods away from today's. */
    fun periodKey(offset: Int, today: LocalDate = OfficeTime.today()): String {
        val base = OfficeTime.periodKey(today)
        return java.time.YearMonth.parse(base).plusMonths(offset.toLong()).toString()
    }
}
