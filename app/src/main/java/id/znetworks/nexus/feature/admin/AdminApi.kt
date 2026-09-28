package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.net.URLEncoder

// API.md §2.6 Control Room. The server re-checks every role; the app only decides what is drawn.

@Serializable data class Approver(val id: String? = null, val name: String? = null, val avatar: String? = null)
@Serializable data class ShiftDay(val start: String? = null, val end: String? = null)

@Serializable
data class WsMember(
    val id: String,
    val userId: String,
    val name: String? = null,
    val email: String? = null,
    val avatar: String? = null,
    val phoneNumber: String? = null,
    val googleWorkspaceEmail: String? = null,
    val role: String = "STAFF",
    val attendanceRole: String? = null,
    val attendanceShiftStartTime: String? = null,
    val attendanceShiftEndTime: String? = null,
    val attendanceShiftByDay: Map<String, ShiftDay>? = null,
    val flexiTimeEnabled: Boolean = false,
    val noGeofenceMode: Boolean = false,
    val restDays: List<Int> = emptyList(),
    val approverId: String? = null,
    val approver: Approver? = null,
    val joinedAt: String? = null,
) { val displayName: String get() = name ?: email ?: "—" }

@Serializable data class Registered(val id: String, val name: String? = null, val email: String? = null, val avatar: String? = null)

@Serializable
data class WsRoster(val workspaceId: String? = null, val workspaceName: String? = null, val role: String? = null,
                    val members: List<WsMember> = emptyList(), val availableUsers: List<Registered> = emptyList())

@Serializable data class MProject(val id: String, val name: String = "", val icon: String? = null, val role: String? = null, val viaTeam: String? = null)
@Serializable data class MTeam(val id: String, val name: String = "", val color: String? = null, val role: String? = null)
@Serializable data class UserMemberships(val projects: List<MProject> = emptyList(), val teams: List<MTeam> = emptyList())
@Serializable data class Memberships(val byUser: Map<String, UserMemberships> = emptyMap())

object Roles {
    val ALL = listOf("ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF")
    fun tier(r: String?) = when (r) { "ONE_ABOVE_ALL" -> 4; "BOD" -> 3; "MANAGER" -> 2; else -> 1 }
    private fun tierOrZero(r: String?) = if (r == null) 0 else tier(r)
    /** Server canAssign: BoD and above only; roles strictly below yours, One Above All may give any. */
    fun assignable(mine: String?) = tierOrZero(mine).let { t -> if (t < 3) emptyList() else ALL.filter { t == 4 || tier(it) < t } }
    /** May [mine] change [target]'s role or remove them? Same rule as [assignable]. */
    fun canEdit(mine: String?, target: String?) = tierOrZero(mine).let { t -> t >= 3 && (t == 4 || tier(target) < t) }
    fun label(r: String?) = when (r) { "ONE_ABOVE_ALL" -> "One Above All"; "BOD" -> "BoD"; "MANAGER" -> "Manager"; else -> "Staff" }

    /** Roster A–Z, filtered by role and by a name/email search. */
    fun filter(members: List<WsMember>, role: String, q: String): List<WsMember> {
        val t = q.trim().lowercase()
        return members.filter { role == "ALL" || it.role == role }
            .filter { t.isEmpty() || it.displayName.lowercase().contains(t) || it.email.orEmpty().lowercase().contains(t) }
            .sortedBy { it.displayName.lowercase() }
    }

    /** Staff/managers with no approver: their requests go to every BoD (approval chart). */
    fun unplaced(members: List<WsMember>) = members.filter { (it.role == "STAFF" || it.role == "MANAGER") && it.approverId == null }

    /** Would pointing [memberUserId] at [approverUserId] close a loop? (the server refuses it too). */
    fun makesCycle(members: List<WsMember>, memberUserId: String, approverUserId: String): Boolean {
        val byUser = members.associateBy { it.userId }
        var cur: String? = approverUserId
        val seen = mutableSetOf<String>()
        while (cur != null && seen.add(cur)) {
            if (cur == memberUserId) return true
            cur = byUser[cur]?.approverId
        }
        return false
    }
}

class AdminApi(private val api: ApiClient) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun roster(includeRegistered: Boolean = true) =
        api.get("/api/workspaces/members" + if (includeRegistered) "?includeRegistered=1" else "", WsRoster.serializer())

    suspend fun memberships() = runCatching { api.get("/api/admin/users/memberships", Memberships.serializer()).byUser }.getOrDefault(emptyMap())

    suspend fun invite(email: String, role: String, workspaceId: String, absorb: Boolean = false) = send("POST", "/api/workspaces/members", buildJsonObject {
        put("email", email.trim()); put("role", role); put("workspaceId", workspaceId); if (absorb) put("absorbPersonalWorkspace", true)
    })

    /** Send ONLY the keys being changed; a JSON null is literal (omitted ≠ null). */
    suspend fun patchMember(memberId: String, workspaceId: String, fields: Map<String, JsonElement>) =
        send("PATCH", "/api/workspaces/members", JsonObject(mapOf("memberId" to JsonPrimitive(memberId), "workspaceId" to JsonPrimitive(workspaceId)) + fields))

    suspend fun setApprover(m: WsMember, workspaceId: String, approverId: String?) =
        patchMember(m.id, workspaceId, mapOf("approverId" to (approverId?.let { JsonPrimitive(it) } ?: JsonNull)))

    suspend fun removeMember(memberId: String, workspaceId: String) =
        api.send(Request.Builder().url(api.url("/api/workspaces/members?memberId=${enc(memberId)}&workspaceId=${enc(workspaceId)}")).delete().build(), JsonObject.serializer())

    suspend fun updateAccount(userId: String, fields: Map<String, JsonElement>) = send("PATCH", "/api/admin/users/$userId", JsonObject(fields))

    suspend fun deleteUser(userId: String) = api.send(Request.Builder().url(api.url("/api/admin/users/$userId")).delete().build(), JsonObject.serializer())

    suspend fun send(method: String, path: String, body: JsonObject): JsonObject =
        api.send(Request.Builder().url(api.url(path)).method(method, body.toString().toJsonBody()).build(), JsonObject.serializer())
}
