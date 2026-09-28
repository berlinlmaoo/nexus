package id.znetworks.nexus.feature.people

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.net.URLEncoder

// Leaderboard (API.md §2.6) and the member record (`/api/members/<id>/record`, owner request
// 28 Sep 2026, as iOS MemberRecordModels.swift). Scoped like Reports: self, direct reports, BoD all.

@Serializable data class BoardRow(val userId: String, val name: String? = null, val avatar: String? = null, val totalXp: Int = 0, val level: Int = 0, val levelName: String? = null)
@Serializable data class BoardPeriod(val start: String? = null, val end: String? = null)
@Serializable data class Leaderboard(val rows: List<BoardRow> = emptyList(), val period: BoardPeriod? = null)

@Serializable data class RecPerson(val id: String, val name: String? = null, val email: String? = null, val avatar: String? = null,
                                   val role: String? = null, val joinedAt: String? = null, val isSelf: Boolean = false)
@Serializable data class ViewerRights(val scope: String? = null, val canManageAttendance: Boolean = false, val canRemoveXp: Boolean = false)
@Serializable data class RecPeriod(val key: String = "", val from: String? = null, val to: String? = null, val label: String? = null, val isCurrent: Boolean = false,
                                   val days: Int? = null, val daysElapsed: Int? = null, val previousKey: String? = null, val nextKey: String? = null)
@Serializable data class RecScore(val worked: Int = 0, val working: Int = 0, val surplus: Int? = null, val totalWorked: Int? = null)
@Serializable data class RecCounts(val present: Int = 0, val permit: Int = 0, val leave: Int = 0, val sick: Int = 0, val dayOff: Int = 0, val absent: Int = 0,
                                   val lateDays: Int = 0, val lateMinutes: Int = 0)
@Serializable data class RecDayOff(val quota: Int? = null, val bonusDays: Int? = null, val used: Int? = null, val usedRaw: Int? = null, val remaining: Int? = null)
@Serializable data class XpTotals(val gained: Int = 0, val lost: Int = 0, val net: Int = 0, val removed: Int = 0)
@Serializable data class RecSummary(val score: RecScore? = null, val counts: RecCounts? = null, val dayOff: RecDayOff? = null, val xp: XpTotals? = null)

/** tone: P present, L late, I permit, C leave, S sick, D day off, A absent, "" nothing. */
@Serializable data class RecDay(val date: String, val day: Int? = null, val weekday: String? = null, val tone: String? = null,
                                val isToday: Boolean = false, val isFuture: Boolean = false, val lateMinutes: Int? = null, val penaltyXp: Int? = null)

@Serializable data class NameRef(val id: String? = null, val name: String? = null)
@Serializable data class RecRequest(val id: String, val type: String? = null, val status: String? = null, val startDate: String? = null, val endDate: String? = null,
                                    val days: Int? = null, val reason: String? = null, val reviewNote: String? = null, val reviewedBy: NameRef? = null, val isAuto: Boolean = false)
@Serializable data class Removal(val at: String? = null, val by: NameRef? = null, val note: String? = null)
@Serializable data class XpEntry(val id: String, val amount: Int = 0, val originalAmount: Int? = null, val createdAt: String? = null, val reason: String? = null,
                                 val kind: String? = null, val label: String? = null, val dateKey: String? = null, val detail: String? = null,
                                 val lateMinutes: Int? = null, val removed: Removal? = null, val canRemove: Boolean = false) {
    val shown: Int get() = originalAmount ?: amount
    val signed: String get() = if (shown > 0) "+$shown" else "$shown"
}
@Serializable data class RecXp(val entries: List<XpEntry> = emptyList(), val totals: XpTotals? = null, val hasOlder: Boolean = false, val olderPeriod: String? = null)
@Serializable data class XpPage(val period: String? = null, val xp: RecXp = RecXp())

@Serializable
data class MemberRecord(val person: RecPerson, val viewer: ViewerRights? = null, val period: RecPeriod = RecPeriod(), val summary: RecSummary? = null,
                        val days: List<RecDay> = emptyList(), val xp: RecXp? = null, val requests: List<RecRequest> = emptyList())

object PeopleLogic {
    /** Dense ranking: equal scores share a place (1, 2, 2, 4). */
    fun ranks(rows: List<BoardRow>): List<Pair<Int, BoardRow>> {
        val sorted = rows.sortedByDescending { it.totalXp }
        return sorted.mapIndexed { i, r -> (sorted.indexOfFirst { it.totalXp == r.totalXp } + 1) to r }
    }
}

@Serializable data class XpLogRow(val id: String, val amount: Int = 0, val reason: String = "", val createdAt: String? = null, val lateMinutes: Int? = null)
@Serializable data class XpLogUser(val id: String? = null, val name: String? = null, val avatar: String? = null)
@Serializable data class XpLog(val rows: List<XpLogRow> = emptyList(), val user: XpLogUser? = null)

/** The peer-scoped ledger (`/api/gamification/xp-log`): its 403 is how iOS says "not a colleague". */
object XpLogLogic {
    /** Zero rows are server bookkeeping (a waiver, a removed deduction): nothing moved, nothing to say. */
    fun entries(log: XpLog) = log.rows.filter { it.amount != 0 }.map(::entry)
    /** "attendance:late", "peer:report:…:bounty", "admin:adjust:<note>", "quest:…" → the record's kinds. */
    fun entry(r: XpLogRow): XpEntry {
        val p = r.reason.split(":", limit = 3)
        val kind = when (p.getOrNull(0) to p.getOrNull(1)) {
            "attendance" to "late" -> "late"; "attendance" to "alpha" -> "alpha"; "attendance" to "nocheckout" -> "nocheckout"
            "peer" to "report" -> if (r.reason.endsWith(":bounty")) "peer_bounty" else "peer_penalty"
            "admin" to "adjust" -> "admin_adjust"
            else -> if (p.firstOrNull() == "quest") "quest" else null
        }
        return XpEntry(r.id, r.amount, createdAt = r.createdAt, reason = r.reason, kind = kind, label = r.reason,
            detail = if (kind == "admin_adjust") p.getOrNull(2) else null, lateMinutes = r.lateMinutes)
    }
}

class PeopleApi(private val api: ApiClient) {
    suspend fun xpLog(userId: String, limit: Int = 20) = api.get("/api/gamification/xp-log?userId=${URLEncoder.encode(userId, "UTF-8")}&limit=$limit", XpLog.serializer())
    suspend fun leaderboard() = api.getCached("/api/gamification/leaderboard", "leaderboard", Leaderboard.serializer())
    suspend fun record(userId: String, period: String?) =
        api.get("/api/members/${URLEncoder.encode(userId, "UTF-8")}/record" + (period?.let { "?period=$it" } ?: ""), MemberRecord.serializer())
    suspend fun olderXp(userId: String, period: String) =
        api.get("/api/members/${URLEncoder.encode(userId, "UTF-8")}/record?period=$period&only=xp", XpPage.serializer())
    /** BoD: give back ONE deduction; the nightly jobs do not take it again. 409 = already removed. */
    suspend fun removeXp(transactionId: String, note: String?) =
        api.send(Request.Builder().url(api.url("/api/gamification/xp-transactions/$transactionId/refund"))
            .post(buildJsonObject { note?.trim()?.takeIf { it.isNotEmpty() }?.let { put("note", it) } }.toString().toJsonBody()).build(), JsonObject.serializer())
}
