package id.znetworks.nexus.feature.people

import id.znetworks.nexus.feature.presence.PresenceLine

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.layout.offset
import androidx.compose.material.icons.outlined.WorkspacePremium
import androidx.compose.foundation.lazy.itemsIndexed
import id.znetworks.nexus.ui.components.PageHeader
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.layout.height
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.draw.alpha
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Email
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
        PageHeader(stringResource(R.string.home_q_leaderboard), subtitle = stringResource(R.string.sub_leaderboard), onBack = onBack)
        val b = board
        when {
            b == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            b == null -> TabEmpty(Icons.Filled.EmojiEvents, error!!)
            b.rows.isEmpty() -> TabEmpty(Icons.Filled.EmojiEvents, stringResource(R.string.lb_empty))
            else -> PullToRefreshBox(isRefreshing = false, onRefresh = { tick++ }) {
                var query by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }
                val ranked = PeopleLogic.ranks(b.rows)
                val shown = PeopleLogic.search(ranked, query)
                // One joined list like the web: no gaps between the rows; the period, search and podium keep their spacing.
                LazyColumn(contentPadding = PaddingValues(16.dp)) {
                    // "Current period · 1 Oct – 31 Oct" (web header; end is exclusive).
                    PeopleLogic.periodDays(b.period)?.let { (from, to) ->
                        item {
                            val f = AppDateFormats.ofPattern("d MMM", Locale.getDefault())
                            Text(stringResource(R.string.lb_current_period) + " · " + f.format(from) + " – " + f.format(to), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(bottom = 8.dp))
                        }
                    }
                    item {
                        id.znetworks.nexus.ui.components.CompactSearchField(query, { query = it }, stringResource(R.string.lb_search_people), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp))
                    }
                    // The web card: "XP ranking for everyone", the podium (2 · 1 · 3), then one list of everyone.
                    if (query.isBlank() && ranked.isNotEmpty()) item(key = "podium") { Box(Modifier.padding(bottom = 12.dp)) { Podium(PeopleLogic.podium(b.rows)) } }
                    if (shown.isEmpty()) item { Text(stringResource(R.string.lb_no_match), fontSize = 14.sp, color = c.mutedFg, modifier = Modifier.padding(8.dp)) }
                    // A tied rank shares its crown / step: ranks come from the whole board (1, 1, 1, 4).
                    itemsIndexed(shown, key = { _, it -> it.second.userId }) { i, (rank, r) ->
                        val mine = r.userId == me
                        val first = i == 0; val last = i == shown.lastIndex
                        val shape = RoundedCornerShape(topStart = if (first) 14.dp else 0.dp, topEnd = if (first) 14.dp else 0.dp,
                            bottomStart = if (last) 14.dp else 0.dp, bottomEnd = if (last) 14.dp else 0.dp)
                        // One outlined list: each row draws its sides and bottom, the first its top too (no doubled lines between rows).
                        Column(Modifier.fillMaxWidth().clip(shape).background(if (mine) c.violet.copy(alpha = 0.08f) else c.card).then(
                            if (first && last) Modifier.border(1.dp, c.border, shape) else Modifier.joinedRowOutline(c.border, first, last))) {
                            Row(Modifier.fillMaxWidth().clickable { onOpenPerson(r.userId) }.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("$rank", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.width(22.dp), textAlign = TextAlign.Center)
                                Box(Modifier.width(26.dp), contentAlignment = Alignment.Center) {
                                    if (rank == 1) Icon(Icons.Outlined.WorkspacePremium, null, tint = Color(0xFFF59E0B), modifier = Modifier.size(18.dp))
                                }
                                Avatar(r.name, r.avatar, 40.dp, userId = r.userId); Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(r.name ?: "—", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(stringResource(R.string.home_level_n, r.level) + (r.levelName?.let { " – $it" } ?: ""), fontSize = 13.sp, color = c.mutedFg, maxLines = 1)
                                }
                                Text("%,d".format(Locale.getDefault(), r.totalXp), fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground)
                            }
                        }
                    }
                    item(key = "xp-audit") { XpAuditCard { tick++ } }
                }
            }
        }
    }
}

/** One step per score; list ranks below remain competition ranks. */
@Composable
private fun Podium(top: List<List<BoardRow>>) {
    val c = Nx.colors
    val dark = Nx.isDark
    data class Step(val bar: Color, val text: Color, val ring: Color, val crown: Color, val height: androidx.compose.ui.unit.Dp, val avatar: androidx.compose.ui.unit.Dp)
    fun style(rank: Int) = when (rank.coerceIn(1, 3)) {
        1 -> Step(if (dark) Color(0x40FBBF24) else Color(0xFFFCD34D), if (dark) Color(0xFFFDE68A) else Color(0xFF78350F), Color(0xFFFCD34D), Color(0xFFF59E0B), 128.dp, 72.dp)
        2 -> Step(if (dark) Color(0x3394A3B8) else Color(0xFFE2E8F0), if (dark) Color(0xFFE2E8F0) else Color(0xFF475569), Color(0xFFCBD5E1), Color(0xFF94A3B8), 96.dp, 56.dp)
        else -> Step(if (dark) Color(0x40FB923C) else Color(0xFFFDBA74), if (dark) Color(0xFFFED7AA) else Color(0xFF7C2D12), Color(0xFFFDBA74), Color(0xFFF97316), 80.dp, 56.dp)
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(10.dp)) {
        Text(stringResource(R.string.lb_ranking_everyone), fontSize = 14.sp, color = c.mutedFg)
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
            listOf(1, 0, 2).forEach { place ->
                val entry = top.getOrNull(place).orEmpty()
                val r = entry.firstOrNull()
                val rank = place + 1
                val st = style(rank)
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.height(80.dp), contentAlignment = Alignment.Center) {
                        if (entry.size == 1) Box(Modifier.border(2.dp, st.ring, CircleShape).padding(2.dp)) { Avatar(r?.name, r?.avatar, st.avatar, userId = r?.userId) }
                        else Box(Modifier.width((32 + (entry.take(3).size - 1).coerceAtLeast(0) * 18 + if (entry.size > 3) 18 else 0).dp).height(36.dp)) {
                            entry.take(3).forEachIndexed { i, person ->
                                Box(Modifier.offset(x = (18 * i).dp).border(2.dp, st.ring, CircleShape).padding(2.dp)) { Avatar(person.name, person.avatar, 28.dp, userId = person.userId) }
                            }
                            if (entry.size > 3) Box(Modifier.offset(x = 54.dp).size(32.dp).background(c.card, CircleShape).border(2.dp, st.ring, CircleShape), contentAlignment = Alignment.Center) {
                                Text("+${entry.size - 3}", fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
                            }
                        }
                        if (entry.size == 1) Box(Modifier.align(Alignment.BottomEnd).offset(x = 4.dp, y = 4.dp).size(24.dp).background(c.card, CircleShape).border(1.dp, c.border, CircleShape),
                            contentAlignment = Alignment.Center) { Icon(Icons.Outlined.WorkspacePremium, null, tint = st.crown, modifier = Modifier.size(14.dp)) }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(if (entry.size > 1) stringResource(R.string.lb_tied, entry.size) else "", fontSize = 12.sp, color = c.mutedFg, minLines = 1)
                    Text(entry.take(2).joinToString(", ") { it.name ?: "—" }.ifEmpty { "—" }, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 2, minLines = 2, textAlign = TextAlign.Center)
                    Text(if (entry.size > 2) stringResource(R.string.lb_more, entry.size - 2) else "", fontSize = 11.sp, color = c.mutedFg, minLines = 1)
                    Text(r?.let { "%,d".format(Locale.getDefault(), it.totalXp) + " XP" } ?: "—", fontSize = 13.sp, color = c.mutedFg)
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth().height(st.height).clip(RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)).background(st.bar),
                        contentAlignment = Alignment.TopCenter) {
                        Text("$rank", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = st.text, modifier = Modifier.padding(top = 10.dp))
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
    /** Deductions being given back right now: their Remove is hidden, so one tap is one request (audit R7). */
    var inFlight by remember { mutableStateOf(setOf<String>()) }
    var openRequest by remember { mutableStateOf<RecRequest?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    // The board's day sheet for this person's days (audit S6, iOS MemberProfileView).
    val dayBoard: id.znetworks.nexus.feature.attendance.history.BoardViewModel = androidx.lifecycle.viewmodel.compose.viewModel(key = "member-days-$userId")
    var dayRows by remember { mutableStateOf<Map<String, id.znetworks.nexus.feature.attendance.history.HistoryRow>>(emptyMap()) }
    LaunchedEffect(rec) {
        val r = rec ?: return@LaunchedEffect
        dayBoard.manageOverride = r.viewer?.canManageAttendance == true
        dayBoard.onChanged = { tick++ }
        val rows = runCatching {
            id.znetworks.nexus.feature.attendance.history.HistoryApi(container.api)
                .history(if (r.person.isSelf) "me" else "workspace", r.period.key, r.person.id).records
        }.getOrDefault(emptyList())
        dayRows = rows.filter { it.user?.id == null || it.user.id == r.person.id }.associateBy { it.dayKey }
    }
    LaunchedEffect(userId) { boardRow = runCatching { api.leaderboard().value.rows.firstOrNull { it.userId == userId } }.getOrNull() }
    var notAPeer by remember { mutableStateOf(false) }
    var ledger by remember { mutableStateOf<List<XpEntry>?>(null) }
    LaunchedEffect(userId, period, tick) {
        try { val r = api.record(userId, period); rec = r; older = emptyList(); olderKey = r.xp?.olderPeriod.takeIf { r.xp?.hasOlder == true }; hidden = false }
        catch (e: ApiError) { if (e is ApiError.Http && e.status == 403) hidden = true else error = e.describe(res) }
        // Record not ours to see: the peer-scoped ledger decides between "not a colleague" and the old ledger.
        if (hidden) try { ledger = XpLogLogic.entries(api.xpLog(userId)); container.viewer.load() }
            catch (e: ApiError) { if (e is ApiError.Http && e.status == 403) notAPeer = true }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
        }
        val r = rec
        if (r == null && !hidden && error == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        if (notAPeer) { TabEmpty(Icons.Filled.Person, stringResource(R.string.pf_not_a_peer)); return@Column }
        if (r == null && boardRow == null) { TabEmpty(Icons.Filled.Person, error ?: stringResource(R.string.pf_unavailable)); return@Column }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            val name = r?.person?.name ?: boardRow?.name ?: "—"
            val isMe = r?.person?.isSelf == true || userId == container.sessionStore.current?.userId
            // One card (PROFILE-TIDY): the picture (tap to view it when there is one), name, pills, two fact rows,
            // and a compact tonal Message that hugs its label.
            Card {
                Row(verticalAlignment = Alignment.Top) {
                    id.znetworks.nexus.ui.components.ZoomableAvatar(r?.person?.avatar ?: boardRow?.avatar, name, 72.dp, userId = userId); Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(name, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        PresenceLine(userId, chip = true)
                        if (isMe) id.znetworks.nexus.feature.presence.SetStatusEntry()
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            r?.person?.role?.let { role -> Pill(roleLabel(role), when (role) { "ONE_ABOVE_ALL", "BOD" -> c.violetText; "MANAGER" -> c.blue; else -> c.mutedFg }) }
                            if (isMe) Pill(stringResource(R.string.pf_you), c.violetText)
                            id.znetworks.nexus.ui.components.LeftTag(r?.person?.leftAt)
                        }
                    }
                }
                r?.person?.email?.let { FactRow(Icons.Filled.Email, it, middleEllipsis = true) }
                r?.person?.joinedAt?.let { dueDate(it) }?.let { FactRow(Icons.Filled.CalendarMonth, stringResource(R.string.pf_joined, AppDateFormats.ofPattern("d MMM yyyy", Locale.getDefault()).format(it))) }
                if (!isMe && r?.person?.leftAt == null) {
                    var opening by remember { mutableStateOf(false) }
                    var dmError by remember { mutableStateOf<String?>(null) }
                    androidx.compose.material3.Surface(onClick = {
                        opening = true; dmError = null
                        scope.launch {
                            runCatching { ChatApi(container.api).create("DM", listOf(userId), null) }
                                .onSuccess { onOpenChat(it.id) }.onFailure { e -> dmError = (e as? ApiError)?.describe(res) ?: res.getString(R.string.ci_err_dm) }
                            opening = false
                        }
                    }, enabled = !opening, shape = RoundedCornerShape(19.dp), color = c.accentBg,
                        modifier = Modifier.minimumInteractiveComponentSize()) {
                        Row(Modifier.height(38.dp).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (opening) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = c.violetText)
                            else Icon(Icons.AutoMirrored.Filled.Chat, null, tint = c.violetText, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.pf_message), color = c.violetText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        }
                    }
                    dmError?.let { Text(it, fontSize = 12.sp, color = c.dangerText) }
                }
            }
            // Level: from the leaderboard (BoD and One Above All sit outside the ranking).
            Card {
                // "TOTAL XP" over the number it labels; the level as a pill on the right (PROFILE-TIDY).
                Text(stringResource(R.string.pp_total_xp).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                boardRow?.let { b ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("%,d".format(Locale.getDefault(), b.totalXp), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = c.foreground, modifier = Modifier.weight(1f))
                        Pill(stringResource(R.string.home_level_n, b.level) + (b.levelName?.let { " · $it" } ?: ""), c.violetText)
                    }
                } ?: Text(stringResource(if (r?.person?.role in setOf("BOD", "ONE_ABOVE_ALL")) R.string.pf_outside_ranking else R.string.pf_no_points), fontSize = 13.sp, color = c.mutedFg)
            }
            if (hidden && (isMe || container.viewer.isBoD)) ledger?.let { l ->
                Card {
                    Text(stringResource(R.string.pf_this_period).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                    if (l.isEmpty()) Text(stringResource(R.string.pf_no_points_moved), fontSize = 12.sp, color = c.mutedFg)
                    l.forEach { e ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(e.signed, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = if (e.amount < 0) c.danger else c.success, modifier = Modifier.width(52.dp))
                            Text(xpTitle(e), fontSize = 13.sp, color = c.foreground, maxLines = 2, modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
            if (hidden || r == null) { MembershipCards(userId, isMe); return@Column }
            // Period bar
            // A little more room above: everything below is that period's record.
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                val prev = r.period.previousKey != null; val next = r.period.nextKey != null
                IconButton(onClick = { period = r.period.previousKey }, enabled = prev, modifier = Modifier.size(48.dp).alpha(if (prev) 1f else 0.35f)) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous)) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(PeopleLogic.recordPeriodLabel(r.period, Locale.getDefault()), fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                    Text(stringResource(R.string.pf_period_note), fontSize = 11.sp, color = c.mutedFg)
                }
                IconButton(onClick = { period = r.period.nextKey }, enabled = next, modifier = Modifier.size(48.dp).alpha(if (next) 1f else 0.35f)) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next)) }
            }
            r.summary?.let { sm ->
                Card {
                    // 1. label · "Day 12 of 30"
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(if (r.period.isCurrent) R.string.pf_this_period else R.string.pp_period).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            color = c.mutedFg, modifier = Modifier.weight(1f))
                        if (r.period.isCurrent) r.period.daysElapsed?.let { el -> Text(stringResource(R.string.pf_day_of, el, r.period.days ?: 0), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg) }
                    }
                    // 2. the score, one baseline
                    sm.score?.let { sc ->
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text("${sc.worked}/${sc.working}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 30.sp, color = c.foreground, modifier = Modifier.alignByBaseline())
                            if ((sc.surplus ?: 0) > 0) Text(" +${sc.surplus}", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.success, modifier = Modifier.alignByBaseline())
                            Text("  " + stringResource(R.string.pf_score), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.alignByBaseline())
                        }
                    }
                    // 3. six equal tiles, a zero muted so the days that happened stand out
                    sm.counts?.let { ct ->
                        listOf(R.string.rp_present to (ct.present to "P"), R.string.rp_permit to (ct.permit to "I"), R.string.rp_leave to (ct.leave to "C"),
                            R.string.rp_sick to (ct.sick to "S"), R.string.rp_day_off to (ct.dayOff to "D"), R.string.pf_absent_tk to (ct.absent to "A")).chunked(3).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { (l, v) ->
                                    Column(Modifier.weight(1f).background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(10.dp)).padding(8.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Box(Modifier.size(8.dp).background(toneColor(v.second, c), RoundedCornerShape(2.dp))); Spacer(Modifier.width(4.dp))
                                            Text(stringResource(l), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        }
                                        Text("${v.first}", fontWeight = FontWeight.Bold, fontSize = 20.sp, color = if (v.first == 0) c.mutedFg else c.foreground)
                                    }
                                }
                            }
                        }
                    }
                    // 4. name … value rows
                    HorizontalDivider(color = c.border)
                    sm.counts?.let { ct ->
                        ValueRow(Icons.Filled.Schedule, stringResource(R.string.pp_late),
                            if (ct.lateDays > 0) pluralStringResource(R.plurals.pp_late_value, ct.lateDays, ct.lateMinutes, ct.lateDays) else stringResource(R.string.pp_never))
                    }
                    sm.dayOff?.let { d ->
                        ValueRow(Icons.Filled.CalendarMonth, stringResource(R.string.pp_allowance),
                            stringResource(R.string.pp_allowance_value, d.usedRaw ?: d.used ?: 0, d.quota ?: 4, d.remaining ?: 0) +
                                if ((d.bonusDays ?: 0) > 0) " · " + stringResource(R.string.pf_incl_extra, d.bonusDays ?: 0) else "")
                    }
                    sm.xp?.let { x ->
                        ValueRow(Icons.Filled.AutoAwesome, "XP", stringResource(R.string.pp_xp_value, x.gained, x.lost) +
                            if (x.removed > 0) " · " + stringResource(R.string.pf_removed_by_bod, x.removed) else "")
                    }
                    // 5. what the score means, last
                    sm.score?.let { sc ->
                        val days = r.period.days ?: 0
                        if (days > 0) Row(verticalAlignment = Alignment.Top) {
                            Icon(Icons.Filled.Info, null, tint = c.mutedFg, modifier = Modifier.size(14.dp).padding(top = 1.dp)); Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.pp_score_note, sc.working, days, (days - sc.working).coerceAtLeast(0)), fontSize = 11.sp, color = c.mutedFg)
                        }
                    }
                }
            }
            if (r.days.isNotEmpty()) Card {
                Text(stringResource(R.string.pf_streak_board), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    r.days.forEach { d ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(d.weekday?.take(2).orEmpty(), fontSize = 9.sp, color = c.mutedFg)
                            Box(Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).clickable(enabled = !d.isFuture) {
                                    dayBoard.selectDay(dayRows[d.date], r.person.id, r.person.name, d.date, d.isFuture)
                                }.background(if (d.isFuture) Color.Transparent else toneColor(d.tone, c), RoundedCornerShape(6.dp))
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
                            if (e.canRemove && e.removed == null && r.viewer?.canRemoveXp == true && e.id !in inFlight) TextButton(onClick = { removing = e }) { Text(stringResource(R.string.pf_remove), fontSize = 12.sp) }
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
                    Column(Modifier.fillMaxWidth().clickable { openRequest = q }.padding(vertical = 2.dp)) {
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
            MembershipCards(userId, isMe)
        }
    }
    notice?.let { AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } }) }
    id.znetworks.nexus.feature.attendance.history.BoardDaySheets(dayBoard)
    // A request in full: the reason the row cuts off, and the reviewer's note (iOS, audit R7).
    openRequest?.let { q ->
        AlertDialog(onDismissRequest = { openRequest = null },
            title = { Text(if (q.isAuto) stringResource(R.string.pf_auto_cut) else requestLabel(q.type)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(statusLabel(q.status), fontWeight = FontWeight.SemiBold)
                    Text(listOfNotNull(q.startDate?.take(10), q.endDate?.take(10)?.takeIf { it != q.startDate?.take(10) }).joinToString(" – "), fontSize = 13.sp)
                    q.reason?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp) }
                    q.reviewedBy?.name?.let { Text(stringResource(R.string.pf_reviewed_by, it) + (q.reviewNote?.takeIf { n -> n.isNotBlank() }?.let { n -> " — $n" } ?: ""), fontSize = 12.sp) }
                }
            },
            confirmButton = { TextButton(onClick = { openRequest = null }) { Text("OK") } })
    }
    removing?.let { e ->
        var note by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { removing = null }, title = { Text(stringResource(R.string.pf_remove_q, e.signed)) },
            text = { Column { Text(stringResource(R.string.pf_remove_body), fontSize = 13.sp); OutlinedTextField(note, { note = it }, singleLine = true, placeholder = { Text(stringResource(R.string.tk_decision_note)) }) } },
            confirmButton = { TextButton(onClick = {
                removing = null
                if (e.id in inFlight) return@TextButton
                inFlight = inFlight + e.id
                scope.launch {
                    try { api.removeXp(e.id, note); tick++ } catch (x: ApiError) { notice = (x as? ApiError.Http)?.serverMessage ?: x.describe(res) }
                    inFlight = inFlight - e.id
                }
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
internal fun xpTitle(e: XpEntry): String {
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

/** An icon and one fact (email, joined), 13 sp; an email is cut in the middle, keeping its domain. */
@Composable
private fun FactRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, middleEllipsis: Boolean = false) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = c.mutedFg, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp))
        Text(text, fontSize = 13.sp, color = c.foreground, maxLines = 1, overflow = if (middleEllipsis) TextOverflow.MiddleEllipsis else TextOverflow.Ellipsis)
    }
}

/** "name … value": name muted with its icon, value right-aligned; too wide for one line → the value goes under the name. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ValueRow(icon: androidx.compose.ui.graphics.vector.ImageVector, name: String, value: String) {
    val c = Nx.colors
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = c.mutedFg, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(8.dp))
            Text(name, fontSize = 13.sp, color = c.mutedFg)
        }
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, textAlign = TextAlign.End, modifier = Modifier.padding(start = 24.dp))
    }
}

/** The outline of a row inside a joined, rounded list: sides, a bottom line, and the top on the first row (14 dp corners). */
private fun Modifier.joinedRowOutline(color: Color, first: Boolean, last: Boolean) = drawBehind {
    val w = 1.dp.toPx(); val r = 14.dp.toPx()
    val path = androidx.compose.ui.graphics.Path().apply {
        addRoundRect(androidx.compose.ui.geometry.RoundRect(w / 2, w / 2, size.width - w / 2, size.height - w / 2,
            topLeftCornerRadius = androidx.compose.ui.geometry.CornerRadius(if (first) r else 0f), topRightCornerRadius = androidx.compose.ui.geometry.CornerRadius(if (first) r else 0f),
            bottomRightCornerRadius = androidx.compose.ui.geometry.CornerRadius(if (last) r else 0f), bottomLeftCornerRadius = androidx.compose.ui.geometry.CornerRadius(if (last) r else 0f)))
    }
    // The top edge is left out below the first row: the row above already drew it as its bottom.
    if (first) drawPath(path, color, style = androidx.compose.ui.graphics.drawscope.Stroke(w))
    else clipRect(top = w) { drawPath(path, color, style = androidx.compose.ui.graphics.drawscope.Stroke(w)) }
}

/** The person's teams and projects you can both see (iOS MemberProfileView teamsCard / projectsCard). */
object MembershipLogic {
    fun teams(all: List<id.znetworks.nexus.feature.admin.Team>, userId: String) = all.filter { t -> t.members.any { it.uid == userId } }
    fun projects(all: List<id.znetworks.nexus.feature.projects.Project>, userId: String) = all.filter { p -> p.members.any { it.uid == userId } }
    /** The status only when it is not Active, so it isn't repeated on every row (iOS, UI tour run 7). */
    fun showStatus(status: String?) = (status ?: "ACTIVE").uppercase() != "ACTIVE"
}

@Composable
private fun MembershipCards(userId: String, isMe: Boolean) {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    var teams by remember(userId) { mutableStateOf<List<id.znetworks.nexus.feature.admin.Team>?>(null) }
    var projects by remember(userId) { mutableStateOf<List<id.znetworks.nexus.feature.projects.Project>?>(null) }
    LaunchedEffect(userId) {
        teams = runCatching { MembershipLogic.teams(id.znetworks.nexus.feature.admin.TeamsApi(container.api).teams(), userId) }.getOrNull()
        projects = runCatching { MembershipLogic.projects(id.znetworks.nexus.feature.projects.ProjectsApi(container.api).projects().value, userId) }.getOrNull()
    }
    // Nothing to say while loading or when the lists could not be read (the record above still shows).
    teams?.let { list ->
        Card {
            Text(stringResource(R.string.pf_teams).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
            if (list.isEmpty()) Text(stringResource(if (isMe) R.string.pf_no_team_me else R.string.pf_no_team), fontSize = 12.sp, color = c.mutedFg)
            list.forEach { t ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).background(id.znetworks.nexus.feature.projects.parseColor(t.color, c.violet), RoundedCornerShape(4.dp)))
                    Spacer(Modifier.width(10.dp))
                    Text(t.name, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
    projects?.let { list ->
        Card {
            Text(stringResource(R.string.pf_projects).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
            if (list.isEmpty()) Text(stringResource(if (isMe) R.string.home_no_projects else R.string.pf_no_project), fontSize = 12.sp, color = c.mutedFg)
            list.forEach { p ->
                // The project's own mark (photo or the grey page), not a colour dot.
                Row(verticalAlignment = Alignment.CenterVertically) {
                    id.znetworks.nexus.feature.projects.ProjectMark(p.icon, 18.dp, projectId = p.id)
                    Spacer(Modifier.width(10.dp))
                    Text(p.name, fontSize = 14.sp, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (MembershipLogic.showStatus(p.status)) Text(id.znetworks.nexus.feature.projects.projectStatusLabel((p.status ?: "").uppercase()), fontSize = 11.sp, color = c.mutedFg)
                }
            }
        }
    }
}
