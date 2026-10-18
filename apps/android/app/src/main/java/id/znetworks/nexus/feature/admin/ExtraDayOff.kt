package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Control Room › Extra day off (BoD / One Above All): X extra day-off days for ONE period (28th → 27th),
// e.g. after an event. Unused days expire with the period; each person gets a push; revocable.

@Serializable data class BonusPerson(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null)
@Serializable data class BonusActor(val id: String? = null, val name: String? = null)
@Serializable data class DayOffBonus(val id: String, val userId: String = "", val user: BonusPerson? = null, val periodKey: String? = null, val days: Int = 0,
                                     val reason: String? = null, val createdAt: String? = null, val grantedBy: BonusActor? = null,
                                     val revokedAt: String? = null, val revokedBy: BonusActor? = null, val active: Boolean? = null) {
    /** The server's word; a revoke timestamp is the fallback for a body without it. */
    val isActive get() = active ?: (revokedAt == null)
    val displayName get() = user?.name?.takeIf { it.isNotEmpty() } ?: user?.email ?: "—"
}
@Serializable data class BonusPeriod(val periodKey: String, val periodLabel: String? = null)
@Serializable data class DayOffBonusList(val periodKey: String, val periodLabel: String? = null, val currentPeriodKey: String? = null, val canManage: Boolean? = null,
                                         val grantablePeriods: List<BonusPeriod> = emptyList(), val grants: List<DayOffBonus> = emptyList())
@Serializable data class DayOffBonusCreated(val periodKey: String? = null, val periodLabel: String? = null, val days: Int? = null, val notified: Int? = null, val grants: List<DayOffBonus>? = null)
@Serializable data class DayOffBonusRevoked(val grant: DayOffBonus? = null, val alreadyRevoked: Boolean? = null)

object ExtraDayOffLogic {
    const val REASON_MAX = 200
    const val MAX_PEOPLE = 200
    val DAYS = 1..31

    fun reasonValid(reason: String) = reason.trim().length in 3..REASON_MAX
    fun canSubmit(period: String?, selected: Int, days: Int, reason: String, busy: Boolean) =
        period != null && selected in 1..MAX_PEOPLE && days in DAYS && reasonValid(reason) && !busy
    /** Active first, then revoked; each keeps the server's newest-first order. */
    fun ordered(grants: List<DayOffBonus>) = grants.filter { it.isActive } + grants.filterNot { it.isActive }
    /** "YYYY-MM" sorts as text: -1 previous, 0 current, 1 next, null when the server did not say. */
    fun tag(key: String, current: String?) = current?.let { key.compareTo(it).coerceIn(-1, 1) }
    fun search(members: List<WsMember>, q: String): List<WsMember> {
        val sorted = members.sortedBy { it.displayName.lowercase() }
        val t = q.trim().lowercase()
        return if (t.isEmpty()) sorted else sorted.filter { t in it.displayName.lowercase() || t in it.email.orEmpty().lowercase() }
    }
}

class DayOffBonusApi(private val api: ApiClient) {
    suspend fun list(period: String?) = api.get("/api/attendance/day-off-bonus" + (period?.let { "?periodKey=$it" } ?: ""), DayOffBonusList.serializer())
    suspend fun grant(userIds: List<String>, period: String, days: Int, reason: String) = api.send(Request.Builder().url(api.url("/api/attendance/day-off-bonus")).post(buildJsonObject {
        put("userIds", JsonArray(userIds.map(::JsonPrimitive))); put("periodKey", period); put("days", days); put("reason", reason.trim())
    }.toString().toJsonBody()).build(), DayOffBonusCreated.serializer())
    suspend fun revoke(id: String) = api.send(Request.Builder().url(api.url("/api/attendance/day-off-bonus/$id")).delete().build(), DayOffBonusRevoked.serializer())
}

private sealed interface Pending { data object Grant : Pending; data class Revoke(val g: DayOffBonus) : Pending }

private val bonusDay = AppDateFormats.ofPattern("d MMM yyyy")
private fun day(iso: String?) = iso?.let { runCatching { bonusDay.format(Instant.parse(it).atZone(ZoneId.of("Asia/Jakarta"))) }.getOrNull() }.orEmpty()

@Composable
fun ExtraDayOffTab(isBoD: Boolean) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val api = remember { DayOffBonusApi(container.api) }
    val admin = adminApi()
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<DayOffBonusList?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var period by remember { mutableStateOf<String?>(null) }
    var members by remember { mutableStateOf<List<WsMember>>(emptyList()) }
    var search by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var days by remember { mutableIntStateOf(1) }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<Pending?>(null) }
    var tick by remember { mutableIntStateOf(0) }

    LaunchedEffect(tick) {
        loadError = null
        try { val l = api.list(period); list = l; if (period == null) period = l.periodKey }
        catch (e: ApiError) { loadError = e.describe(res); if (list != null) problem = loadError } // a failed switch must not leave old grants looking current
        if (members.isEmpty()) members = runCatching { admin.roster(includeRegistered = false).members }.getOrDefault(emptyList())
        loading = false
    }
    val l = list
    fun label(key: String?) = key?.let { k -> l?.grantablePeriods?.firstOrNull { it.periodKey == k }?.periodLabel ?: l?.periodLabel?.takeIf { l.periodKey == k } ?: k }.orEmpty()
    val dayWord = { n: Int -> res.getString(if (n == 1) R.string.xd_day else R.string.xd_days) }
    val peopleWord = { n: Int -> res.getString(if (n == 1) R.string.xd_person else R.string.xd_people) }

    when {
        loading && l == null -> { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return }
        l?.canManage == false || (l == null && !isBoD) -> { TabEmpty(Icons.Filled.Lock, stringResource(R.string.xd_bod_only_sub)); return }
        l == null -> { EmptyState(Icons.Filled.Refresh, stringResource(R.string.xd_load_failed), loadError.orEmpty(), stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize()); return }
    }
    l!!
    val shown = ExtraDayOffLogic.search(members, search)
    val grants = ExtraDayOffLogic.ordered(l.grants)
    val canSubmit = ExtraDayOffLogic.canSubmit(period, selected.size, days, reason, busy)
    val listScroll = rememberScrollState()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.xd_give), fontSize = 17.sp, fontWeight = FontWeight.Bold, color = c.foreground)
            Text(stringResource(R.string.xd_intro), fontSize = 12.sp, color = c.mutedFg)
        }
        notice?.let { Banner(it, c.success) }
        problem?.let { Banner(it, c.danger) }

        Label(stringResource(R.string.xd_period))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            l.grantablePeriods.forEach { p ->
                val on = p.periodKey == period
                val tag = when (ExtraDayOffLogic.tag(p.periodKey, l.currentPeriodKey)) { 0 -> stringResource(R.string.xd_current); -1 -> stringResource(R.string.xd_previous); 1 -> stringResource(R.string.xd_next); else -> null }
                Text(listOfNotNull(p.periodLabel ?: p.periodKey, tag).joinToString(" · "), fontSize = 12.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold, color = if (on) Color.White else c.mutedFg,
                    modifier = Modifier.clip(CircleShape).background(if (on) c.violet else c.muted.copy(alpha = 0.6f))
                        .clickable { if (!on) { period = p.periodKey; notice = null; problem = null; tick++ } }.padding(horizontal = 12.dp, vertical = 7.dp))
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Label(stringResource(R.string.xd_people_selected, selected.size), Modifier.weight(1f))
            TextButton(onClick = { selected = selected + shown.map { it.userId } }, enabled = shown.isNotEmpty()) { Text(stringResource(R.string.xd_select_shown), fontSize = 12.sp) }
            TextButton(onClick = { selected = emptySet() }, enabled = selected.isNotEmpty()) { Text(stringResource(R.string.xd_clear), fontSize = 12.sp) }
        }
        OutlinedTextField(search, { search = it }, singleLine = true, placeholder = { Text(stringResource(R.string.xd_search)) }, modifier = Modifier.fillMaxWidth(),
            trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Filled.Close, stringResource(R.string.xd_clear)) } }, keyboardOptions = AdminKeyboard.Done)
        // The chosen people stay visible while the search narrows the list below.
        if (selected.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            members.filter { it.userId in selected }.sortedBy { it.displayName.lowercase() }.forEach { m ->
                Row(Modifier.clip(CircleShape).background(c.violet.copy(alpha = 0.12f)).clickable { selected = selected - m.userId }.padding(horizontal = 9.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(m.displayName, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.violetText, maxLines = 1); Spacer(Modifier.width(4.dp))
                    Icon(Icons.Filled.Close, stringResource(R.string.xd_remove, m.displayName), Modifier.size(10.dp), tint = c.violetText)
                }
            }
        }
        // A bounded inner list, so fifty names do not push the grants off the page.
        Column(Modifier.fillMaxWidth().heightIn(max = 300.dp).clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp)).verticalScroll(listScroll)) {
            if (shown.isEmpty()) Text(stringResource(R.string.xd_no_match, search), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(14.dp))
            shown.forEachIndexed { i, m ->
                if (i > 0) HorizontalDivider(color = c.border)
                val on = m.userId in selected
                Row(Modifier.fillMaxWidth().clickable { selected = if (on) selected - m.userId else selected + m.userId }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (on) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, Modifier.size(20.dp), tint = if (on) c.violet else c.mutedFg)
                    Spacer(Modifier.width(10.dp)); Avatar(m.name, m.avatar, 28.dp, userId = m.userId); Spacer(Modifier.width(10.dp))
                    Text(m.displayName, fontSize = 14.sp, color = c.foreground, maxLines = 1, modifier = Modifier.weight(1f))
                    Pill(Roles.label(m.role), c.violetText)
                }
            }
        }

        AdminCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Label(stringResource(R.string.xd_days_label)); Spacer(Modifier.width(8.dp))
                Text("$days", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
                IconButton(onClick = { days-- }, enabled = days > 1) { Icon(Icons.Filled.Remove, "−") }
                IconButton(onClick = { days++ }, enabled = days < 31) { Icon(Icons.Filled.Add, "+") }
            }
            Label(stringResource(R.string.xd_reason))
            OutlinedTextField(reason, { reason = it.take(ExtraDayOffLogic.REASON_MAX) }, maxLines = 4, placeholder = { Text(stringResource(R.string.xd_reason_ph)) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done)
            Row {
                if (reason.isNotEmpty() && reason.trim().length < 3) Text(stringResource(R.string.xd_min3), fontSize = 11.sp, color = c.warning)
                Spacer(Modifier.weight(1f)); Text("${reason.length}/${ExtraDayOffLogic.REASON_MAX}", fontSize = 11.sp, color = c.mutedFg)
            }
        }

        Row(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(14.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${selected.size} ${peopleWord(selected.size)} × $days ${dayWord(days)}", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                if (period != null) Text(label(period), fontSize = 11.sp, color = c.mutedFg)
            }
            Button(onClick = { notice = null; problem = null; pending = Pending.Grant }, enabled = canSubmit) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp) else Icon(Icons.Filled.EventAvailable, null, Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.xd_give_short))
            }
        }

        val active = grants.count { it.isActive }
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Label(stringResource(R.string.xd_grants, label(period)), Modifier.weight(1f))
            Text(if (grants.size > active) stringResource(R.string.xd_active_revoked, active, grants.size - active) else stringResource(R.string.xd_active, active), fontSize = 11.sp, color = c.mutedFg)
        }
        if (grants.isEmpty()) EmptyState(Icons.Filled.EventAvailable, stringResource(R.string.xd_none), stringResource(R.string.xd_none_sub), stringResource(R.string.xd_pick),
            { scope.launch { listScroll.scrollTo(0) } }, Modifier.fillMaxWidth())
        else Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card)) {
            grants.forEachIndexed { i, g ->
                if (i > 0) HorizontalDivider(color = c.border)
                Row(Modifier.fillMaxWidth().alpha(if (g.isActive) 1f else 0.5f).padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.Top) {
                    Avatar(g.displayName, g.user?.avatar, 32.dp, userId = g.userId); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(g.displayName, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1); Spacer(Modifier.width(6.dp))
                            Pill("+${g.days} DO", if (g.isActive) c.success else c.mutedFg)
                        }
                        g.reason?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 12.sp, color = c.mutedFg, maxLines = 3) }
                        Text(if (g.isActive) stringResource(R.string.xd_by, g.grantedBy?.name ?: "—", day(g.createdAt)) else stringResource(R.string.xd_revoked_by, g.revokedBy?.name ?: "—", day(g.revokedAt)), fontSize = 10.sp, color = c.mutedFg)
                    }
                    if (g.isActive) TextButton(onClick = { notice = null; problem = null; pending = Pending.Revoke(g) }, enabled = !busy) { Text(stringResource(R.string.xd_revoke), color = c.danger, fontSize = 12.sp) }
                }
            }
        }
    }

    // ONE confirmation for grant and revoke.
    pending?.let { p ->
        val title: String; val message: String
        when (p) {
            Pending.Grant -> {
                val who = if (selected.size == 1) members.firstOrNull { it.userId in selected }?.displayName ?: "1 ${peopleWord(1)}" else "${selected.size} ${peopleWord(selected.size)}"
                title = stringResource(R.string.xd_confirm_grant); message = stringResource(R.string.xd_confirm_grant_msg, who, days, dayWord(days), label(period), reason.trim())
            }
            is Pending.Revoke -> { title = stringResource(R.string.xd_confirm_revoke, p.g.displayName); message = stringResource(R.string.xd_confirm_revoke_msg, p.g.days, dayWord(p.g.days), p.g.reason.orEmpty()) }
        }
        AlertDialog(onDismissRequest = { pending = null }, title = { Text(title) }, text = { Text(message) },
            confirmButton = { TextButton(onClick = {
                pending = null
                scope.launch {
                    busy = true
                    try {
                        when (p) {
                            Pending.Grant -> {
                                val per = period ?: return@launch
                                val r = api.grant(selected.toList(), per, days, reason)
                                val n = r.grants?.size ?: selected.size; val d = r.days ?: days; val notified = r.notified ?: n
                                val who = when { notified < n -> res.getString(R.string.xd_notified_some, notified, n); n == 1 -> res.getString(R.string.xd_notified_one); else -> res.getString(R.string.xd_notified_all, n) }
                                notice = res.getString(R.string.xd_granted, n, peopleWord(n), d, dayWord(d), r.periodLabel ?: label(per), who)
                                selected = emptySet(); reason = ""; days = 1
                            }
                            is Pending.Revoke -> {
                                val r = api.revoke(p.g.id)
                                notice = if (r.alreadyRevoked == true) res.getString(R.string.xd_already_revoked) else res.getString(R.string.xd_revoked, r.grant?.displayName ?: p.g.displayName)
                            }
                        }
                        tick++
                    } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) } finally { busy = false }
                }
            }) { Text(if (p is Pending.Grant) stringResource(R.string.xd_give) else stringResource(R.string.xd_revoke), color = if (p is Pending.Grant) c.violetText else c.danger) } },
            dismissButton = { TextButton(onClick = { pending = null }) { Text(stringResource(R.string.cancel)) } })
    }
}

@Composable
private fun Label(text: String, modifier: Modifier = Modifier) =
    Text(text.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Nx.colors.mutedFg, letterSpacing = 0.5.sp, modifier = modifier)

@Composable
private fun Banner(text: String, tone: Color) =
    Text(text, fontSize = 13.sp, color = Nx.colors.foreground, modifier = Modifier.fillMaxWidth().background(tone.copy(alpha = 0.1f), RoundedCornerShape(12.dp)).padding(12.dp))
