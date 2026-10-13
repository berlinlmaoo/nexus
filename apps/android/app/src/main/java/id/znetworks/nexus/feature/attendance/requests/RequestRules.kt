package id.znetworks.nexus.feature.attendance.requests

import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.AttendanceToday
import java.time.Instant
import java.time.LocalDate

/**
 * What the composer may offer and when it may submit (PRD §2.8), ported from iOS
 * `RequestComposerSheet`. Pure, so every rule is a unit test.
 *
 * [canGrant] = canManageAttendance (BoD). Since 29 Sep (Berlin, server BACKDATED_SELF, iOS ed7545e) filing
 * your OWN request is the same for everyone, a BoD included: today or later, a photo for sick and permit,
 * the quota; only the permit's location is still skipped for a BoD. A past day is filed by a BoD for the
 * person (Control Room), never from this composer.
 */
class RequestRules(private val today: AttendanceToday?, private val canGrant: Boolean) {

    /** Only what this person can actually file: a type whose only outcome is a refusal is not offered. */
    val types: List<String>
        get() = buildList {
            if (leaveUsable) add("LEAVE")
            addAll(listOf("SICK", "PERMIT", "DAY_OFF"))
            if (redDateUsable) add("RED_DATE")
        }

    private val redDateUsable: Boolean
        get() {
            val total = today?.redDateQuota ?: return false
            return total > 0 && total - (today.redDateUsedThisMonth ?: 0) > 0
        }

    private val leaveUsable: Boolean
        get() {
            val l = today?.annualLeave ?: return false
            return l.eligible == true && (l.remaining ?: 0) > 0
        }

    /** Today or later for every type, for everyone filing their own (the server says BACKDATED_SELF). */
    @Suppress("UNUSED_PARAMETER")
    fun earliest(type: String, now: Instant = Instant.now()): LocalDate? = OfficeTime.today(now)

    fun remainingDays(type: String): Int? = when (type) {
        "DAY_OFF" -> today?.let { maxOf(0, (it.dayOffQuota ?: 0) - (it.dayOffUsedThisMonth ?: 0)) }
        "RED_DATE" -> today?.let { maxOf(0, (it.redDateQuota ?: 0) - (it.redDateUsedThisMonth ?: 0)) }
        "LEAVE" -> today?.annualLeave?.remaining
        else -> null
    }

    /** Said before submit: one date is one day, so this is simply "none left". */
    fun quotaExhausted(type: String): Boolean {
        if (today == null) return false
        val left = remainingDays(type) ?: return false
        return left < 1
    }

    fun showsAttachment(type: String) = type == "SICK" || type == "PERMIT"
    /** Sick and permit need their photo from everyone filing their own, a BoD included (iOS ed7545e). */
    fun attachmentRequired(type: String) = showsAttachment(type)
    fun needsLocation(type: String) = !canGrant && type == "PERMIT"

    /** Named by what it is evidence of, never "sick-note.jpg" for a permit (REQ-ATT-30). */
    fun cameraFileName(type: String) = if (type == "SICK") "sick-note.jpg" else "permit-photo.jpg"

    fun missing(
        type: String,
        reason: String,
        hasAttachment: Boolean,
        hasLocation: Boolean,
        date: LocalDate,
        now: Instant = Instant.now(),
        prefillReason: String? = null,
        /** Annual leave is a range: its length in days, 0 while none is picked (ignored for other types). */
        leaveDays: Int = 0,
    ): Missing? {
        val r = reason.trim()
        return when {
            quotaExhausted(type) -> Missing.QUOTA
            type == "LEAVE" && leaveDays < 1 -> Missing.DATES
            earliest(type, now)?.let { date.isBefore(it) } == true -> Missing.DATE
            r.length < 3 || (prefillReason != null && r == prefillReason.trim()) -> Missing.REASON
            attachmentRequired(type) && !hasAttachment -> Missing.ATTACHMENT
            needsLocation(type) && !hasLocation -> Missing.LOCATION
            else -> null
        }
    }

    enum class Missing { QUOTA, DATE, DATES, REASON, ATTACHMENT, LOCATION }

    companion object {
        const val MAX_ATTACHMENT_BYTES = 10L * 1024 * 1024
    }
}

/**
 * Annual leave as ONE range (Berlin 29 Sep, iOS ed7545e): first day, last day, every day between; the
 * whole range may not be longer than the days left, and goes out as one request startDate..endDate.
 */
object LeaveRange {
    fun days(start: LocalDate, end: LocalDate): Int = java.time.temporal.ChronoUnit.DAYS.between(start, end).toInt() + 1

    /** Null when it fits; else the range's length, for "That's N days — only M left." */
    fun tooLong(start: LocalDate, end: LocalDate, left: Int?): Int? = days(start, end).takeIf { left != null && it > left }
}

/** One queue for a reviewer: a filed request or an offsite check-out (iOS `SubmissionEntry`). */
sealed interface SubmissionEntry {
    val id: String
    val statusKey: String
    val isPending: Boolean get() = statusKey == "PENDING"
    /** The day it is ABOUT. */
    val dayKey: String
    /** When decided, "" if not. */
    val decidedKey: String
    /** The Jakarta day a settled row counts from for the date window. */
    val windowKey: String
    fun matches(q: String): Boolean

    data class Req(val r: AttendanceRequest) : SubmissionEntry {
        override val id get() = "req-" + r.id
        override val statusKey get() = r.statusKey
        override val dayKey get() = r.startDate.orEmpty().take(10)
        override val decidedKey get() = r.reviewedAt.orEmpty()
        override val windowKey get() = jakartaDay(r.reviewedAt ?: r.updatedAt ?: r.startDate)
        override fun matches(q: String) = contains(r.user?.name, q) || contains(r.reason, q)
    }

    data class Offsite(val o: OffsiteCheckout) : SubmissionEntry {
        override val id get() = "off-" + o.id
        override val statusKey get() = o.approval.orEmpty().uppercase()
        override val dayKey get() = o.attendanceDate.orEmpty().take(10)
        override val decidedKey get() = o.approvedAt.orEmpty()
        override val windowKey get() = jakartaDay(o.approvedAt ?: o.attendanceDate)
        override fun matches(q: String) = contains(o.user?.name, q) || contains(o.reason, q)
    }

    companion object {
        fun jakartaDay(iso: String?): String {
            if (iso.isNullOrBlank()) return ""
            return runCatching { OfficeTime.today(Instant.parse(iso)).toString() }.getOrElse { iso.take(10) }
        }

        private fun fold(s: String) = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
            .replace(Regex("\\p{M}"), "").lowercase()

        /** Case- and accent-insensitive: "desi" finds "Dési". */
        fun contains(hay: String?, q: String) = hay != null && fold(hay).contains(fold(q))
    }
}

enum class SubmissionWindow { RECENT, PERIOD }

object SubmissionFilter {
    /**
     * Pending never drops out by date (it is the work queue). Settled rows: "Last 3 days" (today and
     * the two before, open forward) or this 28→27 period. Sorted pending first; pending by the day
     * it is about, settled by newest decision.
     */
    fun apply(
        entries: List<SubmissionEntry>,
        status: String,
        window: SubmissionWindow,
        query: String,
        today: LocalDate,
    ): List<SubmissionEntry> {
        val q = query.trim()
        val range: Pair<String, String?>? = if (status == "PENDING") null else when (window) {
            SubmissionWindow.RECENT -> today.minusDays(2).toString() to null
            SubmissionWindow.PERIOD -> OfficeTime.periodRange(OfficeTime.periodKey(today)).let { it.start.toString() to it.endInclusive.toString() }
        }
        return entries.withIndex().filter { (_, e) ->
            if (status != "ALL" && e.statusKey != status) return@filter false
            if (range != null && !e.isPending) {
                val k = e.windowKey
                if (k.isEmpty() || k < range.first) return@filter false
                if (range.second != null && k > range.second!!) return@filter false
            }
            q.isEmpty() || e.matches(q)
        }.sortedWith { a, b ->
            val x = a.value
            val y = b.value
            when {
                x.isPending != y.isPending -> if (x.isPending) -1 else 1
                !x.isPending && x.decidedKey != y.decidedKey -> y.decidedKey.compareTo(x.decidedKey)
                x.dayKey != y.dayKey -> y.dayKey.compareTo(x.dayKey)
                else -> a.index.compareTo(b.index)
            }
        }.map { it.value }
    }
}
