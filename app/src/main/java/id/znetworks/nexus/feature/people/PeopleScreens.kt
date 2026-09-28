package id.znetworks.nexus.feature.people

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.ChatApi
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.projects.dueDate
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
private fun peopleApi(): PeopleApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { PeopleApi(c.api) }
}

@Composable
fun LeaderboardScreen(onBack: () -> Unit, onOpenPerson: (String) -> Unit) {
    val api = peopleApi()
    val c = Nx.colors
    val context = LocalContext.current
    val me = (context.applicationContext as NexusApplication).container.sessionStore.current?.userId
    var board by remember { mutableStateOf<Leaderboard?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) { try { board = api.leaderboard().value; error = null } catch (e: ApiError) { error = e.describe(context.resources) } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.home_q_leaderboard), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
        val b = board
        when {
            b == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            b == null -> TabEmpty(Icons.Filled.EmojiEvents, error!!)
            b.rows.isEmpty() -> TabEmpty(Icons.Filled.EmojiEvents, stringResource(R.string.lb_empty))
            else -> PullToRefreshBox(isRefreshing = false, onRefresh = { tick++ }) {
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { Text(stringResource(R.string.lb_period_note), fontSize = 12.sp, color = c.mutedFg) }
                    items(PeopleLogic.ranks(b.rows), key = { it.second.userId }) { (rank, r) ->
                        val mine = r.userId == me
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (mine) c.violet.copy(alpha = 0.1f) else c.card)
                            .border(1.dp, if (mine) c.violet else c.border, RoundedCornerShape(16.dp)).clickable { onOpenPerson(r.userId) }.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Text(when (rank) { 1 -> "🥇"; 2 -> "🥈"; 3 -> "🥉"; else -> "#$rank" }, fontSize = if (rank <= 3) 22.sp else 14.sp,
                                fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.width(40.dp), textAlign = TextAlign.Center)
                            Avatar(r.name, r.avatar, 36.dp); Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(r.name ?: "—", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                                Text(stringResource(R.string.home_level_n, r.level) + (r.levelName?.let { " · $it" } ?: ""), fontSize = 11.sp, color = c.mutedFg)
                            }
                            Text("%,d".format(Locale.getDefault(), r.totalXp), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.violetText)
                        }
                    }
                }
            }
        }
    }
}

private fun toneColor(t: String?, c: id.znetworks.nexus.ui.theme.NxColors): Color = when (t) {
    "P" -> c.success; "L" -> c.warning; "I" -> Color(0xFF0EA5E9); "C" -> Color(0xFFA78BFA); "S" -> Color(0xFFF472B6); "D" -> Color(0xFF94A3B8); "A" -> c.danger
    else -> c.muted
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MemberProfileScreen(userId: String, onBack: () -> Unit, onOpenChat: (String) -> Unit) {
    val api = peopleApi()
    val c = Nx.colors
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val res = context.resources
    val scope = rememberCoroutineScope()
    var period by remember { mutableStateOf<String?>(null) }
    var rec by remember { mutableStateOf<MemberRecord?>(null) }
    var hidden by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var boardRow by remember { mutableStateOf<BoardRow?>(null) }
    var older by remember { mutableStateOf<List<XpEntry>>(emptyList()) }
    var olderKey by remember { mutableStateOf<String?>(null) }
    var removing by remember { mutableStateOf<XpEntry?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(userId) { boardRow = runCatching { api.leaderboard().value.rows.firstOrNull { it.userId == userId } }.getOrNull() }
    LaunchedEffect(userId, period, tick) {
        try { val r = api.record(userId, period); rec = r; older = emptyList(); olderKey = r.xp?.olderPeriod.takeIf { r.xp?.hasOlder == true }; hidden = false }
        catch (e: ApiError) { if (e is ApiError.Http && e.status == 403) hidden = true else error = e.describe(res) }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
        }
        val r = rec
        if (r == null && !hidden && error == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        if (r == null && boardRow == null) { TabEmpty(Icons.Filled.Person, error ?: stringResource(R.string.pf_unavailable)); return@Column }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            val name = r?.person?.name ?: boardRow?.name ?: "—"
            val isMe = r?.person?.isSelf == true || userId == container.sessionStore.current?.userId
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(name, r?.person?.avatar ?: boardRow?.avatar, 64.dp); Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(name, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.foreground)
                        if (isMe) { Spacer(Modifier.width(6.dp)); Pill(stringResource(R.string.pf_you), c.violetText) }
                    }
                    Text(listOfNotNull(r?.person?.role?.let(::roleLabel), r?.person?.email).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                    r?.person?.joinedAt?.let { dueDate(it) }?.let { Text(stringResource(R.string.pf_joined, DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(it)), fontSize = 12.sp, color = c.mutedFg) }
                }
            }
            if (!isMe) OutlinedButton(onClick = {
                scope.launch { runCatching { ChatApi(container.api).create("DM", listOf(userId), null) }.onSuccess { onOpenChat(it.id) }.onFailure { e -> notice = (e as? ApiError)?.describe(res) } }
            }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.pf_message)) }
            // Level: from the leaderboard (BoD and One Above All sit outside the ranking).
            Card {
                Text(stringResource(R.string.home_level).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                boardRow?.let { b ->
                    Text("%,d XP".format(Locale.getDefault(), b.totalXp), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
                    Text(stringResource(R.string.home_level_n, b.level) + (b.levelName?.let { " · $it" } ?: ""), fontSize = 13.sp, color = c.violetText)
                } ?: Text(stringResource(if (r?.person?.role in setOf("BOD", "ONE_ABOVE_ALL")) R.string.pf_outside_ranking else R.string.pf_no_points), fontSize = 13.sp, color = c.mutedFg)
            }
            if (hidden || r == null) return@Column
            // Period bar
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { period = r.period.previousKey }, enabled = r.period.previousKey != null) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, null) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(r.period.label ?: r.period.key, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.foreground)
                    Text(stringResource(R.string.pf_period_note), fontSize = 10.sp, color = c.mutedFg)
                }
                IconButton(onClick = { period = r.period.nextKey }, enabled = r.period.nextKey != null) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) }
            }
            r.summary?.let { sm ->
                Card {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(stringResource(R.string.pf_score), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.weight(1f))
                        sm.score?.let { s ->
                            Text("${s.worked}/${s.working}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
                            if ((s.surplus ?: 0) > 0) Text(" +${s.surplus}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = c.success)
                        }
                    }
                    if (r.period.isCurrent) r.period.daysElapsed?.let { el -> Text(stringResource(R.string.pf_day_of, el, r.period.days ?: 0), fontSize = 11.sp, color = c.mutedFg) }
                    sm.counts?.let { ct ->
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(R.string.rp_present to (ct.present to "P"), R.string.rp_permit to (ct.permit to "I"), R.string.rp_leave to (ct.leave to "C"),
                                R.string.rp_sick to (ct.sick to "S"), R.string.rp_day_off to (ct.dayOff to "D"), R.string.pf_absent_tk to (ct.absent to "A")).forEach { (l, v) ->
                                Row(Modifier.background(toneColor(v.second, c).copy(alpha = 0.14f), RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) {
                                    Text("${v.first}", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = c.foreground); Spacer(Modifier.width(4.dp))
                                    Text(stringResource(l), fontSize = 12.sp, color = c.mutedFg)
                                }
                            }
                        }
                        Text(if (ct.lateDays > 0) stringResource(R.string.pf_late_total, ct.lateMinutes, ct.lateDays) else stringResource(R.string.pf_never_late), fontSize = 12.sp, color = c.mutedFg)
                    }
                    sm.dayOff?.let { d -> Text(stringResource(R.string.pf_dayoff_line, d.usedRaw ?: d.used ?: 0, d.quota ?: 4, d.remaining ?: 0) +
                        if ((d.bonusDays ?: 0) > 0) " · " + stringResource(R.string.pf_incl_extra, d.bonusDays ?: 0) else "", fontSize = 12.sp, color = c.mutedFg) }
                    sm.xp?.let { x -> Text(stringResource(R.string.pf_xp_line, x.gained, x.lost) + if (x.removed > 0) " · " + stringResource(R.string.pf_removed_by_bod, x.removed) else "", fontSize = 12.sp, color = c.mutedFg) }
                }
            }
            if (r.days.isNotEmpty()) Card {
                Text(stringResource(R.string.pf_streak_board), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    r.days.forEach { d ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(d.weekday?.take(2).orEmpty(), fontSize = 9.sp, color = c.mutedFg)
                            Box(Modifier.size(24.dp).background(if (d.isFuture) Color.Transparent else toneColor(d.tone, c), RoundedCornerShape(6.dp))
                                .border(if (d.isToday) 1.5.dp else 1.dp, if (d.isToday) c.violet else c.border, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                                Text("${d.day ?: ""}", fontSize = 9.sp, color = if (d.tone.isNullOrEmpty() || d.isFuture) c.mutedFg else Color.White, fontWeight = FontWeight.Bold)
                            }
                            Box(Modifier.size(5.dp).background(if ((d.penaltyXp ?: 0) != 0) c.danger else Color.Transparent, CircleShape))
                        }
                    }
                }
                Text(stringResource(R.string.pf_streak_note), fontSize = 11.sp, color = c.mutedFg)
            }
            r.xp?.let { xp ->
                Card {
                    Text(stringResource(R.string.pf_xp_log), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                    val all = xp.entries + older
                    if (all.isEmpty()) Text(stringResource(R.string.rp_no_penalties), fontSize = 12.sp, color = c.mutedFg)
                    all.forEach { e ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(xpTitle(e), fontSize = 13.sp, color = if (e.removed != null) c.mutedFg else c.foreground, textDecoration = if (e.removed != null) TextDecoration.LineThrough else null)
                                Text(listOfNotNull(e.dateKey ?: chatTime(e.createdAt), e.removed?.by?.name?.let { stringResource(R.string.pf_removed_by, it) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                            }
                            Text(e.signed, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (e.shown >= 0) c.success else c.danger,
                                textDecoration = if (e.removed != null) TextDecoration.LineThrough else null)
                            if (e.canRemove && e.removed == null && r.viewer?.canRemoveXp == true) TextButton(onClick = { removing = e }) { Text(stringResource(R.string.pf_remove), fontSize = 12.sp) }
                        }
                    }
                    olderKey?.let { k -> TextButton(onClick = {
                        scope.launch { runCatching { api.olderXp(userId, k) }.onSuccess { p -> older = older + p.xp.entries; olderKey = p.xp.olderPeriod.takeIf { p.xp.hasOlder } } }
                    }) { Text(stringResource(R.string.pf_load_older)) } }
                }
            }
            Card {
                Text(stringResource(R.string.pf_requests), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                if (r.requests.isEmpty()) Text(stringResource(if (isMe) R.string.pf_no_requests_me else R.string.pf_no_requests), fontSize = 12.sp, color = c.mutedFg)
                r.requests.forEach { q ->
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(if (q.isAuto) stringResource(R.string.pf_auto_cut) else requestLabel(q.type), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                            Pill(statusLabel(q.status), when (q.status) { "APPROVED" -> c.success; "REJECTED" -> c.danger; else -> c.warning })
                        }
                        Text(listOfNotNull(q.startDate?.take(10), q.endDate?.take(10)?.takeIf { it != q.startDate?.take(10) }).joinToString(" – ") +
                            ((q.days ?: 1).takeIf { it > 1 }?.let { " · $it " + stringResource(R.string.pf_days) } ?: ""), fontSize = 11.sp, color = c.mutedFg)
                        q.reviewedBy?.name?.let { Text(stringResource(R.string.pf_reviewed_by, it) + (q.reviewNote?.takeIf { n -> n.isNotBlank() }?.let { n -> " — $n" } ?: ""), fontSize = 11.sp, color = c.mutedFg) }
                    }
                }
            }
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
    removing?.let { e ->
        var note by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { removing = null }, title = { Text(stringResource(R.string.pf_remove_q, e.signed)) },
            text = { Column { Text(stringResource(R.string.pf_remove_body), fontSize = 13.sp); OutlinedTextField(note, { note = it }, singleLine = true, placeholder = { Text(stringResource(R.string.tk_decision_note)) }) } },
            confirmButton = { TextButton(onClick = {
                removing = null
                scope.launch { try { api.removeXp(e.id, note); tick++ } catch (x: ApiError) { notice = (x as? ApiError.Http)?.serverMessage ?: x.describe(res) } }
            }) { Text(stringResource(R.string.pf_remove)) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) } })
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
}

private fun roleLabel(role: String) = when (role) {
    "ONE_ABOVE_ALL" -> "One Above All"; "BOD" -> "BoD"; "MANAGER" -> "Manager"; "STAFF" -> "Staff"
    else -> role.lowercase().replaceFirstChar(Char::titlecase)
}

@Composable
private fun requestLabel(t: String?) = stringResource(when (t) {
    "LEAVE" -> R.string.rp_leave; "SICK" -> R.string.rp_sick; "PERMIT" -> R.string.rp_permit; "DAY_OFF" -> R.string.rp_day_off; "RED_DATE" -> R.string.pf_red_date
    else -> R.string.rp_pen_other
})

@Composable
private fun statusLabel(s: String?) = stringResource(when (s) { "APPROVED" -> R.string.tk_approved; "REJECTED" -> R.string.tk_rejected; else -> R.string.tk_pending })

/** The reason in the app's language, by kind; unknown kinds keep the server's words (iOS RecordXpEntry.title). */
@Composable
private fun xpTitle(e: XpEntry): String {
    val note = e.detail?.trim().orEmpty()
    return when (e.kind) {
        "late" -> stringResource(R.string.rp_pen_late) + (e.lateMinutes?.takeIf { it > 0 }?.let { " · $it min" } ?: note.takeIf { it.isNotEmpty() }?.let { " · $it" } ?: "")
        "nocheckout" -> stringResource(R.string.rp_pen_no_checkout)
        "alpha" -> stringResource(R.string.pf_absent_tk)
        "peer_penalty" -> stringResource(R.string.pf_peer_penalty)
        "peer_bounty" -> stringResource(R.string.pf_peer_bounty)
        "admin_adjust" -> stringResource(R.string.pf_admin_adjust) + (if (note.isNotEmpty()) " · $note" else "")
        "quest" -> stringResource(R.string.pf_quest_done)
        "quest_penalty" -> stringResource(R.string.pf_quest_penalty)
        "bonus" -> "Bonus" + (if (note.isNotEmpty()) " · $note" else "")
        "task_done" -> stringResource(R.string.pf_task_done)
        "streak" -> stringResource(R.string.pf_streak_bonus)
        else -> e.label ?: e.reason ?: "XP"
    }
}
