package id.znetworks.nexus.feature.calendar

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit

// Master Calendar — API models (server spec 5 Oct 2026, nexus 70f0d67, lib/calendar/core.ts). Only the
// API and model layer: the screen and its client rules (dots, counts, trees, quadrants) come after the
// web's phase 2. Days are the server's WIB days ("YYYY-MM-DD"); nothing here derives a day from an ISO
// instant (17:00Z is already the next WIB day — the bug of Agenda.kt's take(10)).

/** Who sees what (every response carries it). Unknown values are treated as [OFF]: nothing to show. */
enum class CalAccess {
    /** Not in the company workspace: an empty state with "Enter workspace code". */
    NONE,
    /** Outside the rollout audience: texts `calendar.off.*`. */
    OFF,
    /** BoD / Manager / One Above All / admin: every task in full. */
    ALL,
    /** Staff: tasks of private projects arrive masked. */
    ALL_EXCEPT_PRIVATE;

    val hasData get() = this == ALL || this == ALL_EXCEPT_PRIVATE

    companion object {
        fun of(raw: String?): CalAccess = when (raw) {
            "none" -> NONE
            "off" -> OFF
            "all" -> ALL
            "all_except_private" -> ALL_EXCEPT_PRIVATE
            else -> OFF
        }
    }
}

@Serializable
data class CalUnit(
    val id: String,
    val name: String = "",
    /** "IP" | "DIVISION" | "GROUP" — a group is a ribbon and never holds people. */
    val kind: String = "DIVISION",
    val parentId: String? = null,
    /** Bagan canvas order: sort by this everywhere. */
    val rank: Int = 0,
    /** Cards (not groups) above it. */
    val depth: Int = 0,
    /** The card right under the top that it belongs to. */
    val sectionId: String? = null,
    val color: String? = null,
    val colorDark: String? = null,
    val logoUrl: String? = null,
    val leadUserId: String? = null,
) { val isGroup get() = kind == "GROUP" }

@Serializable
data class CalPerson(
    val userId: String,
    val name: String? = null,
    val avatar: String? = null,
    val role: String = "STAFF",
    val unitIds: List<String> = emptyList(),
    /** The cards their tasks go to. */
    val homeUnitIds: List<String> = emptyList(),
    // No job titles in the calendar (revised 5 Oct evening): the server no longer sends `titles`.
    val reportsTo: Map<String, String> = emptyMap(),
)

@Serializable data class CalMe(val userId: String, val role: String? = null, val homeUnitIds: List<String> = emptyList())

/** `GET /api/calendar/structure`. For access none/off the arrays are empty and [version] is null. */
@Serializable
data class CalStructure(
    val v: Int = 1,
    val version: String? = null,
    private val access: String? = null,
    val me: CalMe? = null,
    val units: List<CalUnit> = emptyList(),
    val people: List<CalPerson> = emptyList(),
) {
    val accessLevel get() = CalAccess.of(access)
    /** In Bagan order. */
    val unitsByRank get() = units.sortedBy { it.rank }
    val unitById: Map<String, CalUnit> by lazy { units.associateBy { it.id } }
    val personById: Map<String, CalPerson> by lazy { people.associateBy { it.userId } }
    /** The section (card under the top) of a unit, for "Internal task · <division>". */
    fun sectionOf(unitId: String): CalUnit? = unitById[unitId]?.sectionId?.let(unitById::get)
}

@Serializable data class CalProject(val id: String, val name: String = "", val color: String? = null)
@Serializable data class CalParent(val id: String, val title: String = "")
@Serializable data class CalPlacement(val unitId: String, val userIds: List<String> = emptyList())

/** Why a task sits where it does (revised 5 Oct evening). Unknown values read as [PIC]. */
enum class PlacedBy {
    /** Under the Bagan cards of its PICs. */
    PIC,
    /** None of its PICs is in the Bagan (or it has none): under its PROJECT's division, the out-of-Bagan PICs as userIds (maybe none). */
    PROJECT;
    companion object { fun of(raw: String?) = if (raw == "project") PROJECT else PIC }
}

/**
 * One task on the calendar. There is no "No PIC yet" section and no "Abandoned" list (revised 5 Oct
 * evening): a task without a PIC in the Bagan sits under its project's division, and one overdue for
 * longer than `rules.overdueWindowDays` stays on its date (drawn grey until it is done). A masked row (private project, staff viewer) has no id, title, project,
 * priority, parent or linked projects and a stable [key] starting with "x_"; who and when stay. It is
 * shown as "Internal task · <division>" and is never openable.
 */
@Serializable
data class CalItem(
    val key: String,
    val id: String? = null,
    val masked: Boolean = false,
    val title: String? = null,
    /** The WIB day, computed on the server. */
    val day: String,
    /** "HH:MM" WIB, or null for a date-only task. */
    val time: String? = null,
    /** The UTC instant; only for "has a timed task's moment passed". Never a source of [day]. */
    val due: String? = null,
    val status: String = "TODO",
    val done: Boolean = false,
    /** A calendar-only project: no done checkbox, never overdue, never open work. */
    val noStatus: Boolean = false,
    val priority: String? = null,
    val project: CalProject? = null,
    val linkedProjectIds: List<String> = emptyList(),
    val parent: CalParent? = null,
    val assigneeIds: List<String> = emptyList(),
    /** The Bagan cards of its PICs — or, when [placement] is PROJECT, its project's division. */
    val placements: List<CalPlacement> = emptyList(),
    /** "pic" | "project": see [placement]. */
    private val placedBy: String? = null,
    /** PICs not in the Bagan ("Not in the chart yet"). */
    val unplacedIds: List<String> = emptyList(),
    val canEdit: Boolean = false,
    /** Send as `projectContextId` on PATCH /api/tasks/:id. */
    val editProjectId: String? = null,
) {
    /** A masked row cannot be opened; an unmasked one opens (read-only when ![canEdit]). */
    val openable get() = !masked && id != null
    val placement get() = PlacedBy.of(placedBy)
}

@Serializable data class CalRules(val overdueWindowDays: Int = 14, val urgentDays: Int = 3)
@Serializable data class CalHoliday(val day: String, val name: String = "")
@Serializable data class CalExtraPerson(val name: String? = null, val avatar: String? = null)

/** `GET /api/calendar/items?from&to` (≤ 62 days) and `GET /api/calendar/overdue` (same item shape). */
@Serializable
data class CalItems(
    val v: Int = 1,
    val tz: String = "Asia/Jakarta",
    /** The server's WIB today: use it, not the phone's clock, for "today". */
    val today: String,
    val now: String? = null,
    val from: String? = null,
    val to: String? = null,
    private val access: String? = null,
    /** When it differs from the structure held, refetch the structure. Null for access none/off. */
    val structureVersion: String? = null,
    val rules: CalRules? = null,
    val items: List<CalItem> = emptyList(),
    /** Names/avatars of assignees who are not in the structure (former members). */
    val people: Map<String, CalExtraPerson> = emptyMap(),
    val holidays: List<CalHoliday> = emptyList(),
    val truncated: Boolean = false,
) {
    val accessLevel get() = CalAccess.of(access)
    val rulesOrDefault get() = rules ?: CalRules()
    fun nowInstant(): Instant? = now?.let { runCatching { Instant.parse(it) }.getOrNull() }
}

/** `GET /api/calendar/task?id=` — `found` false for a task outside the company workspace or cancelled. */
@Serializable
data class CalTaskLookup(
    val v: Int = 1,
    private val access: String? = null,
    val found: Boolean = false,
    val masked: Boolean = false,
    val canEdit: Boolean = false,
    val editProjectId: String? = null,
    val projectId: String? = null,
) { val accessLevel get() = CalAccess.of(access) }

/** One widget/Watch entry of `/api/calendar/glance`. */
@Serializable
data class GlanceEntry(
    /** Null when masked. */
    val id: String? = null,
    /** Only on a masked row: its stable key. */
    val k: String? = null,
    /** ≤ 60 characters; null when masked. */
    val t: String? = null,
    /** Null for a task without a due date ("Someday"). */
    val day: String? = null,
    val time: String? = null,
    /** Colour: the project's for me, my card's for division, the division's for all. */
    val c: String = "#64748b",
    val p: String? = null,
    val prio: String? = null,
    val done: Boolean = false,
    val m: Boolean = false,
    /** Only present when true: a calendar-only project. */
    val ns: Boolean = false,
)

enum class GlanceScope(val wire: String) { ME("me"), DIVISION("division"), ALL("all") }

/** `GET /api/calendar/glance?scope=` — [scope] is the one actually used (division falls back to me without a Bagan card). */
@Serializable
data class CalGlance(
    val v: Int = 1,
    val tz: String = "Asia/Jakarta",
    val userId: String? = null,
    private val access: String? = null,
    val scope: String? = null,
    val requestedScope: String? = null,
    val today: String,
    val now: String? = null,
    val from: String? = null,
    val to: String? = null,
    val rules: CalRules? = null,
    val items: List<GlanceEntry> = emptyList(),
    /** Open tasks without a due date, ≤ 50. */
    val undated: List<GlanceEntry> = emptyList(),
    val holidays: List<CalHoliday> = emptyList(),
    val truncated: Boolean = false,
) { val accessLevel get() = CalAccess.of(access) }

/**
 * Day keys ("YYYY-MM-DD", WIB, from the server) and the server's own rules over them (core.ts). Pure:
 * a day key is only ever compared, counted or stepped as a calendar date — never cut out of an instant.
 */
object CalDays {
    private val KEY = Regex("""^\d{4}-\d{2}-\d{2}$""")
    fun isDayKey(s: String?): Boolean = s != null && KEY.matches(s) && runCatching { LocalDate.parse(s) }.isSuccess
    fun addDays(day: String, n: Int): String = LocalDate.parse(day).plusDays(n.toLong()).toString()
    /** b − a in days. */
    fun dayDiff(a: String, b: String): Int = ChronoUnit.DAYS.between(LocalDate.parse(a), LocalDate.parse(b)).toInt()

    /**
     * Overdue now (core.ts isOverdueAt): open (not done, not a calendar-only project) and — date-only —
     * its day before the server's today, or — timed — its moment before the server's now.
     */
    fun isOverdue(item: CalItem, today: String, now: Instant?): Boolean {
        if (item.done || item.noStatus) return false
        if (item.time == null) return item.day < today
        val due = item.due?.let { runCatching { Instant.parse(it) }.getOrNull() }
        return if (due != null && now != null) due.isBefore(now) else item.day < today
    }
    // No "Abandoned" list: past rules.overdueWindowDays a task stays on its date, drawn grey (a screen rule, later).
}
