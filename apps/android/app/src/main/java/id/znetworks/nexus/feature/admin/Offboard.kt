package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

// Offboarding (owner, 8 Oct; OFFBOARD-CONTRACT): someone who left keeps every record, loses sign-in.

@Serializable data class FormerMembership(val workspaceId: String? = null, val workspaceName: String? = null, val leftAt: String? = null, val reason: String? = null)
@Serializable data class AdminUserRow(val id: String, val name: String? = null, val email: String? = null, val avatar: String? = null,
                                      val firstJoinedAt: String? = null, val deactivatedAt: String? = null,
                                      val formerMemberships: List<FormerMembership> = emptyList()) {
    val displayName: String get() = name ?: email ?: "—"
    /** The newest exit (the server sends them newest first). */
    val leftAt: String? get() = formerMemberships.firstOrNull()?.leftAt
}
@Serializable data class AdminPagination(val total: Int = 0, val page: Int = 1, val totalPages: Int = 1)
@Serializable data class AdminUsersPage(val users: List<AdminUserRow> = emptyList(), val pagination: AdminPagination = AdminPagination())
@Serializable data class OffboardUser(val id: String? = null, val name: String? = null)
@Serializable data class OffboardResult(val ok: Boolean = false, val user: OffboardUser = OffboardUser(), val leftAt: String? = null, val lastWorkingDay: String? = null,
                                        val workspaces: List<String> = emptyList(), val approverEdgesCleared: List<OffboardUser> = emptyList(),
                                        val pendingRequests: Int = 0, val autoDeductionsCanceled: Int = 0, val openTasks: Int = 0)

object Offboarding {
    val REASONS = listOf("RESIGNED", "CONTRACT_ENDED", "DISMISSED", "OTHER")

    fun reasonLabel(r: String) = when (r) {
        "RESIGNED" -> R.string.off_r_resigned; "CONTRACT_ENDED" -> R.string.off_r_contract
        "DISMISSED" -> R.string.off_r_dismissed; else -> R.string.off_r_other
    }

    /** The app's own sentence per refusal code; null = show the server's text (as the web). */
    fun errorRes(e: Throwable): Int? = when ((e as? ApiError.Http)?.code) {
        "SELF" -> R.string.off_err_self
        "RANK" -> R.string.off_err_rank
        "FORBIDDEN" -> R.string.off_err_forbidden
        "BAD_DATE" -> R.string.off_err_bad_date
        "NOT_MEMBER" -> R.string.off_err_not_member
        "ALREADY_OFFBOARDED" -> R.string.off_err_already
        "NOT_OFFBOARDED" -> R.string.off_err_not_offboarded
        else -> null
    }

    /** Delete account refused: the person has attendance or requests, which are never deleted. */
    fun hasAttendanceData(e: Throwable) = (e as? ApiError.Http)?.let { it.status == 409 && it.code == "HAS_ATTENDANCE_DATA" } == true

    /** The Jakarta date someone joined, the earliest last working day the server accepts. */
    fun joinedDay(iso: String?): LocalDate? = iso?.let { runCatching { Instant.parse(it).atZone(OfficeTime.ZONE).toLocalDate() }.getOrNull() }

    /** Not after today (Jakarta), not before they joined. */
    fun dayValid(day: LocalDate, today: LocalDate, joined: LocalDate?) = !day.isAfter(today) && (joined == null || !day.isBefore(joined))
}

/** The API.md §2.6 user-management calls for offboarding. */
suspend fun AdminApi.leftUsers(): List<AdminUserRow> {
    // Offboarded people have no membership left: they are among the non-members (a few pages at most).
    val out = mutableListOf<AdminUserRow>()
    var page = 1
    while (page <= 10) {
        val p = try { adminUsers(page) } catch (e: ApiError) { return out } // not allowed (below BoD) or an older server: nothing to show
        out += p.users.filter { it.deactivatedAt != null }
        if (page >= p.pagination.totalPages) break
        page++
    }
    return out
}

@Composable
private fun Fact(n: Int, title: String, sub: String, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(10.dp)) {
        Text("$n", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.foreground)
        Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        Text(sub, fontSize = 11.sp, color = c.mutedFg)
    }
}

/**
 * Offboard (web OffboardUserModal): last working day (today by default, never after today nor before they
 * joined), reason, note, and plainly what happens and what stays; afterwards what is left to do.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun OffboardDialog(name: String, joinedAt: String?, onDismiss: () -> Unit, onOpenChart: () -> Unit, onDone: () -> Unit,
                   submit: suspend (day: String, reason: String, note: String?) -> OffboardResult) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    val today = OfficeTime.today()
    val joined = Offboarding.joinedDay(joinedAt)
    var day by rememberSaveable { mutableStateOf(today.toString()) }
    var reason by rememberSaveable { mutableStateOf("RESIGNED") }
    var note by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var result by remember { mutableStateOf<OffboardResult?>(null) }
    var picking by remember { mutableStateOf(false) }
    val dayDate = LocalDate.parse(day)
    val long = { d: LocalDate -> DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.getDefault()).format(d) }
    val r = result
    AlertDialog(
        onDismissRequest = { if (!busy) { if (r != null) onDone() else onDismiss() } },
        title = { Text(if (r != null) stringResource(R.string.off_done_title, r.user.name ?: name) else stringResource(R.string.off_offboard_name, name)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (r != null) {
                    val last = r.lastWorkingDay?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
                    Text(listOfNotNull(last?.let { stringResource(R.string.off_done_last, long(it)) }, r.workspaces.takeIf { it.isNotEmpty() }?.joinToString(", ")).joinToString(" · "),
                        fontSize = 12.sp, color = c.mutedFg)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Fact(r.pendingRequests, stringResource(R.string.off_pending), stringResource(if (r.pendingRequests > 0) R.string.off_pending_some else R.string.off_pending_none), Modifier.weight(1f))
                        Fact(r.openTasks, stringResource(R.string.off_open), stringResource(if (r.openTasks > 0) R.string.off_open_some else R.string.off_open_none), Modifier.weight(1f))
                    }
                    if (r.approverEdgesCleared.isNotEmpty()) Column(Modifier.fillMaxWidth().background(c.warningBg, RoundedCornerShape(12.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(pluralStringResource(R.plurals.off_lost_approver, r.approverEdgesCleared.size, r.approverEdgesCleared.size), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.warningFg)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            r.approverEdgesCleared.forEach { p -> Text(p.name ?: "—", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.warningFg,
                                modifier = Modifier.background(c.card, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) }
                        }
                        Text(stringResource(R.string.off_lost_approver_sub), fontSize = 11.sp, color = c.warningFg)
                        OutlinedButton(onClick = onOpenChart) { Text(stringResource(R.string.off_open_chart)) }
                    }
                    if (r.autoDeductionsCanceled > 0) Text(pluralStringResource(R.plurals.off_deductions_canceled, r.autoDeductionsCanceled, r.autoDeductionsCanceled), fontSize = 11.sp, color = c.mutedFg)
                } else {
                    Text(stringResource(R.string.off_intro), fontSize = 12.sp, color = c.mutedFg)
                    Text(stringResource(R.string.off_last_day), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                    OutlinedButton(onClick = { picking = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(long(dayDate)) }
                    Text(stringResource(R.string.off_reason), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Offboarding.REASONS.forEach { k -> FilterChip(reason == k, { reason = k }, { Text(stringResource(Offboarding.reasonLabel(k))) }, enabled = !busy) }
                    }
                    OutlinedTextField(note, { if (it.length <= 500) note = it }, label = { Text(stringResource(R.string.off_note)) }, minLines = 2, maxLines = 4,
                        enabled = !busy, keyboardOptions = AdminKeyboard.Done, modifier = Modifier.fillMaxWidth())
                    Column(Modifier.fillMaxWidth().background(c.muted, RoundedCornerShape(12.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(stringResource(R.string.off_what_happens).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                        listOf(R.string.off_h1, R.string.off_h2, R.string.off_h3, R.string.off_h4, R.string.off_h5).forEach { Text("• " + stringResource(it), fontSize = 12.sp, color = c.foreground) }
                    }
                    error?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText) }
                }
            }
        },
        confirmButton = {
            if (r != null) TextButton(onClick = onDone) { Text(stringResource(R.string.off_done)) }
            else TextButton(onClick = {
                busy = true; error = null
                scope.launch {
                    try { result = submit(day, reason, note.trim().ifEmpty { null }) }
                    catch (e: ApiError) { error = Offboarding.errorRes(e)?.let(res::getString) ?: (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.off_err_generic) }
                    busy = false
                }
            }, enabled = !busy && Offboarding.dayValid(dayDate, today, joined)) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Text(stringResource(if (busy) R.string.off_offboarding else R.string.off_offboard), color = c.dangerText, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 6.dp))
            }
        },
        dismissButton = { if (r == null) TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
    if (picking) {
        // Dates as UTC midnights, as the Material picker counts them.
        val st = rememberDatePickerState(initialSelectedDateMillis = dayDate.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) =
                    Offboarding.dayValid(Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate(), today, joined)
                override fun isSelectableYear(year: Int) = year <= today.year && (joined == null || year >= joined.year)
            })
        DatePickerDialog(onDismissRequest = { picking = false }, confirmButton = {
            TextButton(onClick = { st.selectedDateMillis?.let { day = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }; picking = false }) { Text("OK") }
        }, dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } }) { DatePicker(st) }
    }
}

/** Reinstate (web ReinstateUserModal): says what comes back and, louder, what does not. */
@Composable
fun ReinstateDialog(user: AdminUserRow, onDismiss: () -> Unit, onBack: (String) -> Unit, reinstate: suspend () -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val workspaces = user.formerMemberships.mapNotNull { it.workspaceName }.distinct()
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.off_reinstate_q, user.displayName)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (workspaces.isNotEmpty()) stringResource(R.string.off_reinstate_body_ws, workspaces.joinToString(", ")) else stringResource(R.string.off_reinstate_body), fontSize = 14.sp, color = c.foreground)
                Text(stringResource(R.string.off_reinstate_not), fontSize = 12.sp, color = c.warningFg,
                    modifier = Modifier.fillMaxWidth().background(c.warningBg, RoundedCornerShape(12.dp)).padding(10.dp))
                error?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText) }
            }
        },
        confirmButton = { TextButton(onClick = {
            busy = true; error = null
            scope.launch {
                try { reinstate(); onBack(res.getString(R.string.off_back, user.displayName)) }
                catch (e: ApiError) { error = Offboarding.errorRes(e)?.let(res::getString) ?: (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                busy = false
            }
        }, enabled = !busy) { Text(stringResource(R.string.off_reinstate), fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}
