package id.znetworks.nexus.feature.home

import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.Storage
import android.app.Application
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.TrendingDown
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material.icons.filled.WatchLater
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.material.icons.filled.Close
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.AttendanceKind
import id.znetworks.nexus.feature.attendance.AttendanceToday
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.feature.inbox.InboxApi
import id.znetworks.nexus.feature.projects.BoardTask
import id.znetworks.nexus.feature.projects.PriorityChip
import id.znetworks.nexus.feature.projects.Project
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.scrollEdges
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

data class HomeState(
    val game: Gamification? = null,
    val avatar: String? = null,
    val projects: List<Project> = emptyList(),
    val tasks: List<BoardTask> = emptyList(),
    val unread: Int = 0,
    val today: AttendanceToday? = null,
    val checkInQueued: Boolean = false,
    val checkOutQueued: Boolean = false,
    val loaded: Boolean = false,
    val savedAt: Long? = null,
    val claiming: String? = null,
    val claimError: String? = null,
)

class HomeViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val projectsApi = ProjectsApi(c.api)
    private val inbox = InboxApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(HomeState())
    val state = _state.asStateFlow()
    val shortcuts = c.shortcuts

    fun load() = viewModelScope.launch {
        shortcuts.refresh()
        val me = c.sessionStore.current?.userId ?: return@launch
        val profile = async { runCatching { id.znetworks.nexus.feature.auth.ProfileApi(c.api).profile() }.getOrNull() }
        val game = async { runCatching { c.api.getCached("/api/gamification/me", "gamification", Gamification.serializer()) }.getOrNull() }
        val projects = async { runCatching { projectsApi.projects() }.getOrNull() }
        val tasks = async { runCatching { projectsApi.myTasks(me) }.getOrNull() }
        val unread = async { runCatching { inbox.list().unreadCount }.getOrNull() }
        val today = async {
            runCatching {
                c.attendanceApi.today().also {
                    c.todayCache.save(me, it)
                    // Fresh anyway: the work session follows it (idempotent).
                    c.workTrail.sync(it, c.attendanceQueue.state.value.has(AttendanceKind.CHECK_OUT))
                }
            }.getOrNull() ?: c.todayCache.load(me)?.today
        }
        val q = c.attendanceQueue.state.value
        val g = game.await()
        val t = tasks.await()
        _state.update { s ->
            s.copy(
                game = g?.value ?: s.game,
                avatar = profile.await()?.avatar ?: s.avatar,
                projects = projects.await()?.value ?: s.projects,
                tasks = t?.value ?: s.tasks,
                unread = unread.await() ?: s.unread,
                today = today.await() ?: s.today,
                checkInQueued = q.has(AttendanceKind.CHECK_IN),
                checkOutQueued = q.has(AttendanceKind.CHECK_OUT),
                loaded = true,
                savedAt = listOfNotNull(g?.savedAtMillis, t?.savedAtMillis).minOrNull(),
            )
        }
    }

    /** XP is granted ONLY here, never on completion. One claim at a time (no double send). */
    fun claim(q: Quest) {
        if (_state.value.claiming != null) return
        _state.update { it.copy(claiming = q.key, claimError = null) }
        viewModelScope.launch {
            try {
                val body = buildJsonObject { put("questKey", q.key) }.toString().toJsonBody()
                val r = c.api.send(Request.Builder().url(c.api.url("/api/gamification/quests/claim")).post(body).build(), ClaimResult.serializer())
                // Refetch rather than patch: the award can move the level. If that fails the claim
                // still happened, so mark it here instead of leaving a Claim button that would 409.
                val fresh = runCatching { c.api.get("/api/gamification/me", Gamification.serializer()) }.getOrNull()
                _state.update { s ->
                    s.copy(game = fresh ?: s.game?.let { g ->
                        g.copy(xp = r.xp ?: g.xp, quests = g.quests.map { if (it.key == q.key) it.copy(claimed = true, claimable = false) else it })
                    })
                }
            } catch (e: ApiError) {
                _state.update { it.copy(claimError = (e as? ApiError.Http)?.serverMessage ?: res.getString(R.string.home_claim_failed)) }
            }
            _state.update { it.copy(claiming = null) }
        }
    }
}

private val VIOLET_GRAD = listOf(Color(0xFFC4B5FD), Color(0xFF7C3AED))
private val GREEN_GRAD = listOf(Color(0xFF6EE7B7), Color(0xFF059669))
private val AMBER_GRAD = listOf(Color(0xFFFCD34D), Color(0xFFEA580C))
private val ORANGE_GRAD = listOf(Color(0xFFFB923C), Color(0xFFEA580C))

@Composable
fun HomeScreen(
    onOpenAttendance: () -> Unit,
    onOpenInbox: () -> Unit,
    onSearch: () -> Unit,
    onOpenProject: (String) -> Unit,
    onOpenTask: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenWeb: (String) -> Unit,
    onOpenGideon: () -> Unit = {},
    vm: HomeViewModel = viewModel(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    val session = (context.applicationContext as NexusApplication).container.sessionStore.current
    val homeScroll = rememberScrollState()
    var stat by rememberSaveable { mutableStateOf<Int?>(null) }
    var levelOpen by rememberSaveable { mutableStateOf(false) }
    // Every visit re-reads: a task finished elsewhere, a check-in, a claimed quest.
    LaunchedEffect(Unit) { vm.load() }

    // Card rects, not state: written on every scroll frame, read only when a card is tapped (iOS MorphFrameStore).
    val statRects = remember { mutableMapOf<Int, androidx.compose.ui.geometry.Rect>() }
    Box(Modifier.fillMaxSize()) {
    PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load() }, modifier = Modifier.fillMaxSize().background(c.background)) {
        Column(Modifier.fillMaxSize().scrollEdges(homeScroll, c.background, vertical = true).verticalScroll(homeScroll).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Greeting(session?.userName)
            AttendanceCard(s, onOpenAttendance)
            LevelCard(s.game) { levelOpen = true }
            SearchRow(s.unread, onSearch, onOpenInbox)
            s.savedAt?.let { Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), fontSize = 12.sp, color = c.mutedFg) }
            StatCards(s, statRects) { stat = it }
            XpRulesCard()
            QuickActions(onOpenAttendance, onOpenWeb)
            ShortcutsCard(vm.shortcuts, onOpenProject)
            AgendaCard(s.tasks, onOpenTask)
            ProfileCard(session?.userName, s.avatar, s.game, onOpenSettings)
            Spacer(Modifier.height(72.dp))
        }
    }
    // GIDEON's launcher lives on Home only (iOS floating button).
    // The round GIDEON launcher with its mark (iOS / web), not a violet sparkle square.
    androidx.compose.material3.FloatingActionButton(onClick = onOpenGideon, containerColor = c.card, contentColor = c.foreground,
        shape = androidx.compose.foundation.shape.CircleShape,
        modifier = Modifier.align(Alignment.BottomStart).padding(20.dp).size(52.dp).border(1.dp, c.border, androidx.compose.foundation.shape.CircleShape)) {
        id.znetworks.nexus.ui.components.GideonMark(24.dp, contentDescription = "GIDEON")
    }
    }
    // Grows from the tapped card, one gradient, no scrim (iOS MorphFlip; owner, 29 Sep, point 5).
    stat?.let { i -> StatMorph(i, statRects[i], s, vm, onOpenProject, onOpenTask) { stat = null } }
    if (levelOpen) LevelSheet(s.game) { levelOpen = false }
}

// region pieces

@Composable
private fun Card(modifier: Modifier = Modifier, padding: Int = 14, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(
        modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(padding.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) { content() }
}

@Composable
private fun Caption(text: String) =
    Text(text.uppercase(Locale.getDefault()), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp, color = Nx.colors.mutedFg)

@Composable
private fun Greeting(name: String?) {
    val c = Nx.colors
    val hour = Instant.now().atZone(OfficeTime.ZONE).hour
    Column(Modifier.padding(top = 8.dp)) {
        Text(stringResource(when (HomeLogic.greeting(hour)) {
            HomeLogic.Greeting.MORNING -> R.string.home_morning
            HomeLogic.Greeting.AFTERNOON -> R.string.home_afternoon
            HomeLogic.Greeting.EVENING -> R.string.home_evening
        }), fontSize = 20.sp, color = c.foreground.copy(alpha = 0.8f))
        Text("${name?.ifBlank { null } ?: stringResource(R.string.home_commander)}!", fontFamily = DisplayFont, fontWeight = FontWeight.Bold,
            fontSize = 30.sp, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/** Attendance is the core on Android: its state, one tap from Home. */
@Composable
private fun AttendanceCard(s: HomeState, onOpen: () -> Unit) {
    val c = Nx.colors
    val rec = s.today?.today
    val hhmm = { iso: String? -> iso?.let { runCatching { LocalNotifier.hhmm(Instant.parse(it).toEpochMilli()) }.getOrNull() } ?: "—" }
    // iOS attendanceLine: "Flexi 12:00–15:00" for a flexi shift.
    val shift = s.today?.myShift?.let { sh -> if (sh.startTime != null && sh.endTime != null) (if (sh.flexi == true) "Flexi " else "") + "${sh.startTime}–${sh.endTime}" else null }
    val (line, tone) = when {
        s.today == null && !s.loaded -> stringResource(R.string.home_att_loading) to c.mutedFg
        s.today?.pendingCheckout != null -> stringResource(R.string.home_att_pending_checkout) to c.warning
        rec?.hasCheckedOut == true -> stringResource(R.string.home_att_done, hhmm(rec.checkInAt), hhmm(rec.checkOutAt)) to c.success
        s.checkOutQueued -> stringResource(R.string.home_att_out_queued) to c.warning
        rec?.hasCheckedIn == true -> stringResource(R.string.home_att_in, hhmm(rec.checkInAt)) to c.success
        s.checkInQueued -> stringResource(R.string.home_att_in_queued) to c.warning
        s.today?.isRestDayToday == true -> stringResource(R.string.home_att_rest) to c.mutedFg
        else -> (if (shift != null) stringResource(R.string.home_att_not_yet_shift, shift) else stringResource(R.string.home_att_not_yet)) to c.warning
    }
    // The action iOS writes on the card: "Check in" while nobody has; otherwise a chevron.
    val notIn = s.today != null && rec?.hasCheckedIn != true && !s.checkInQueued && s.today?.isRestDayToday != true && s.today?.pendingCheckout == null
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp))
            .clickable(onClick = onOpen).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp).background(tone.copy(alpha = 0.14f), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.WatchLater, null, tint = tone)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.home_attendance), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
            Text(line, fontSize = 13.sp, color = tone, fontWeight = FontWeight.SemiBold)
        }
        if (notIn) Text(stringResource(R.string.home_att_check_in), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.violetText)
        else Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next), tint = c.mutedFg, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun LevelCard(g: Gamification?, onOpen: () -> Unit) {
    val c = Nx.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(18.dp))
            .clickable(onClick = onOpen).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp).background(Brush.verticalGradient(ORANGE_GRAD), CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.AutoAwesome, null, tint = Color.White)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(g?.xp?.levelName ?: "—", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.foreground, maxLines = 1)
                Spacer(Modifier.width(6.dp))
                // "…" until the numbers are in: "Lv.0 / 0 XP" looks like a fact.
                Text(g?.let { "Lv.${it.xp.level}" } ?: "…", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                if ((g?.streak?.current ?: 0) > 0) {
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Filled.LocalFireDepartment, null, tint = c.warning, modifier = Modifier.size(12.dp))
                    Text("${g!!.streak.current}", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.warning)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                LinearProgressIndicator(progress = { g?.levelFraction ?: 0f }, color = c.foreground, trackColor = c.muted,
                    modifier = Modifier.weight(1f).height(6.dp).clip(CircleShape))
                Spacer(Modifier.width(8.dp))
                Text(g?.xpLabel(Locale.getDefault()) ?: "… XP", fontSize = 10.sp, color = c.mutedFg)
            }
        }
    }
}

@Composable
private fun SearchRow(unread: Int, onSearch: () -> Unit, onInbox: () -> Unit) {
    val c = Nx.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.weight(1f).height(48.dp).clip(CircleShape).background(c.card).border(1.dp, c.border, CircleShape).clickable(onClick = onSearch)
                .padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Search, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.home_search), fontSize = 14.sp, color = c.mutedFg)
        }
        Spacer(Modifier.width(12.dp))
        Box {
            Box(Modifier.size(48.dp).clip(CircleShape).background(c.card).border(1.dp, c.border, CircleShape).clickable(onClick = onInbox),
                contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Notifications, stringResource(R.string.tab_inbox), tint = c.foreground)
            }
            if (unread > 0) Text(if (unread > 99) "99+" else "$unread", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).offset(x = 3.dp, y = (-3).dp).background(c.danger, CircleShape).padding(horizontal = 5.dp, vertical = 2.dp))
        }
    }
}

private data class StatDatum(val value: Int, val total: Int?, val label: Int, val icon: ImageVector, val grad: List<Color>)

private fun stats(s: HomeState) = listOf(
    StatDatum(s.projects.size, null, R.string.home_stat_projects, Icons.Filled.ViewKanban, VIOLET_GRAD),
    // "Task" (9 Oct): the count and its list leave out work done over 30 days ago; the agenda still sees every task.
    HomeTasks.recent(s.tasks).let { recent -> StatDatum(recent.count { it.isDone }, recent.size, R.string.home_stat_mission, Icons.Filled.Checklist, GREEN_GRAD) },
    StatDatum(s.game?.questsDone ?: 0, s.game?.quests?.size ?: 0, R.string.home_stat_quest, Icons.Filled.AutoAwesome, AMBER_GRAD),
)

@Composable
private fun StatCards(s: HomeState, rects: MutableMap<Int, androidx.compose.ui.geometry.Rect>, onOpen: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        stats(s).forEachIndexed { i, d ->
            Column(
                Modifier.weight(1f).onGloballyPositioned { rects[i] = it.boundsInRoot() }.clip(RoundedCornerShape(24.dp)).background(Brush.linearGradient(d.grad)).clickable { onOpen(i) }
                    .padding(vertical = 16.dp, horizontal = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(Modifier.size(38.dp).background(Color.White.copy(alpha = 0.25f), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                    Icon(d.icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("${d.value}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Color.White)
                    d.total?.let { Text("/$it", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(bottom = 3.dp)) }
                }
                Text(stringResource(d.label), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.9f),
                    textAlign = TextAlign.Center, maxLines = 2)
            }
        }
    }
}

/**
 * The stat card's detail as iOS MorphFlip / the web's layoutId: drawn full size in the middle, then a
 * scale + translate makes it START exactly on the tapped card and spring to full (response 0.4,
 * damping 0.84). One gradient top to bottom, no scrim; the list fades in once it has landed. A tap
 * outside, the close button or back shrinks it back into the card.
 */
@Composable
private fun StatMorph(i: Int, source: androidx.compose.ui.geometry.Rect?, s: HomeState, vm: HomeViewModel,
                      onOpenProject: (String) -> Unit, onOpenTask: (String) -> Unit, onClose: () -> Unit) {
    val d = stats(s)[i]
    val scope = rememberCoroutineScope()
    val progress = remember { androidx.compose.animation.core.Animatable(if (source == null) 1f else 0f) }
    var target by remember { mutableStateOf<androidx.compose.ui.geometry.Rect?>(null) }
    val spring = androidx.compose.animation.core.spring<Float>(dampingRatio = 0.84f, stiffness = 247f)
    LaunchedEffect(target) { if (target != null) progress.animateTo(1f, spring) }
    var closing by remember { mutableStateOf(false) }
    fun close(then: () -> Unit = {}) {
        if (closing) return
        closing = true
        scope.launch { if (source != null) progress.animateTo(0f, spring); onClose(); then() }
    }
    androidx.activity.compose.BackHandler { close() }
    Box(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { close() } }) {
        Column(
            Modifier.align(Alignment.Center).padding(horizontal = 18.dp).widthIn(max = 560.dp)
                .onGloballyPositioned { if (target == null) target = it.boundsInRoot() }
                .graphicsLayer {
                    val t = target
                    val src = source
                    if (src != null && t == null) { alpha = 0f; return@graphicsLayer } // measuring: no flash
                    if (src == null || t == null || t.width <= 1f) return@graphicsLayer
                    val f = 1f - progress.value
                    transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0f)
                    scaleX = 1f + (src.width / t.width - 1f) * f
                    scaleY = 1f + (src.height / t.height - 1f) * f
                    translationX = (src.left - t.left) * f
                    translationY = (src.top - t.top) * f
                }
                .shadow(24.dp, RoundedCornerShape(28.dp), ambientColor = d.grad.last(), spotColor = d.grad.last())
                .clip(RoundedCornerShape(28.dp))
                .background(Brush.linearGradient(d.grad))
                .pointerInput(Unit) { detectTapGestures { } } // a tap on the card is not a tap outside
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp).background(Color.White.copy(alpha = 0.25f), RoundedCornerShape(18.dp)), contentAlignment = Alignment.Center) {
                    Icon(d.icon, null, tint = Color.White, modifier = Modifier.size(26.dp))
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("${d.value}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 38.sp, color = Color.White)
                        d.total?.let { Text("/$it", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(bottom = 5.dp)) }
                    }
                    Text(stringResource(d.label), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.9f))
                }
                Box(Modifier.size(32.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.22f)).clickable { close() }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = Color.White, modifier = Modifier.size(16.dp))
                }
            }
            // The header scales with the card; the list fades in once it has landed (web: delay 0.15 s).
            Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()).graphicsLayer { alpha = ((progress.value - 0.85f) / 0.15f).coerceIn(0f, 1f) },
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (i) {
                    0 -> if (s.projects.isEmpty()) SheetEmpty(stringResource(R.string.home_no_projects))
                    else s.projects.take(40).forEach { p -> SheetRow(p.name, p.status.orEmpty().lowercase().replaceFirstChar(Char::titlecase)) { close { onOpenProject(p.id) } } }
                    1 -> HomeTasks.recent(s.tasks).let { recent -> if (recent.isEmpty()) SheetEmpty(stringResource(R.string.home_no_tasks))
                    else recent.take(40).forEach { t ->
                        SheetRow(t.title, stringResource(if (t.isDone) R.string.home_done else R.string.home_open)) { close { onOpenTask(t.id) } }
                    } }
                    else -> QuestList(s, vm)
                }
            }
        }
    }
}

@Composable
private fun SheetEmpty(text: String) = Text(text, fontSize = 13.sp, color = Color.White.copy(alpha = 0.85f), modifier = Modifier.padding(vertical = 8.dp))

@Composable
private fun SheetRow(title: String, meta: String, trailing: @Composable () -> Unit = {}, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.14f))
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(8.dp))
        Text(meta, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color.White.copy(alpha = 0.8f))
        trailing()
    }
}

@Composable
private fun SheetRow(title: String, meta: String, onClick: () -> Unit) = SheetRow(title, meta, {}, onClick)

/** The only place quest XP can be claimed on the phone (as on iOS). Claimed wins over claimable. */
@Composable
private fun QuestList(s: HomeState, vm: HomeViewModel) {
    val quests = s.game?.quests.orEmpty()
    s.claimError?.let {
        Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color.White,
            modifier = Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.18f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp))
    }
    if (quests.isEmpty()) SheetEmpty(stringResource(R.string.home_no_quests))
    quests.take(40).forEach { q ->
        SheetRow(q.title, "${q.progress}/${q.target} · +${q.xpReward} XP", trailing = {
            when {
                q.claimed == true -> { Spacer(Modifier.width(8.dp)); Icon(Icons.Filled.CheckCircle, stringResource(R.string.home_claimed), tint = Color.White, modifier = Modifier.size(18.dp)) }
                q.claimable == true -> {
                    Spacer(Modifier.width(8.dp))
                    val busy = s.claiming == q.key
                    Box(
                        Modifier.clip(CircleShape).background(Color.White.copy(alpha = if (s.claiming != null && !busy) 0.5f else 1f))
                            .clickable(enabled = s.claiming == null) { vm.claim(q) }.padding(horizontal = 12.dp, vertical = 5.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (busy) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp, color = Color(0xFFEA580C))
                        else Text(stringResource(R.string.home_claim), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color(0xFFEA580C))
                    }
                }
            }
        })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LevelSheet(g: Gamification?, onClose: () -> Unit) {
    val c = Nx.colors
    ModalBottomSheet(onDismissRequest = onClose, containerColor = c.card) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp).background(Brush.verticalGradient(ORANGE_GRAD), CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.AutoAwesome, null, tint = Color.White, modifier = Modifier.size(26.dp))
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(g?.xp?.levelName ?: "—", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
                    Text(stringResource(R.string.home_level_n, g?.xp?.level ?: 0), fontSize = 13.sp, color = c.mutedFg)
                }
            }
            LinearProgressIndicator(progress = { g?.levelFraction ?: 0f }, color = c.foreground, trackColor = c.muted, modifier = Modifier.fillMaxWidth().height(10.dp).clip(CircleShape))
            Row {
                Text("${g?.xp?.totalXp ?: 0} XP", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
                g?.xp?.nextFloor?.let { Text(stringResource(R.string.home_next_xp, it), fontSize = 12.sp, color = c.mutedFg) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                LevelStat(stringResource(R.string.home_streak), "${g?.streak?.current ?: 0} 🔥", Modifier.weight(1f))
                LevelStat(stringResource(R.string.home_quests_claimed), "${g?.questsDone ?: 0}", Modifier.weight(1f))
                LevelStat(stringResource(R.string.home_total_xp), "${g?.xp?.totalXp ?: 0}", Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun LevelStat(label: String, value: String, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.background(c.muted.copy(alpha = 0.5f), RoundedCornerShape(14.dp)).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        Text(label, fontSize = 11.sp, color = c.mutedFg, textAlign = TextAlign.Center)
    }
}

private val PENALTIES = listOf(
    XpRules.Row("-1 XP/min", R.string.xp_late, R.string.xp_late_note, true),
    XpRules.Row("-25 XP", R.string.xp_no_checkout, R.string.xp_per_incident, true),
    XpRules.Row("-25 XP", R.string.xp_offsite_rejected, R.string.xp_per_incident, true),
    XpRules.Row("-150 XP", R.string.xp_no_show, R.string.xp_per_day, true),
)
// No automatic bonus: XP is quest-only, assigned by BoD (server period-rewards.ts).
// Owner, 16 Oct 2026: quests as they really are (made by BoD and up, the XP the quest sets) and BoD adjustments;
// the old +30 / +50 / +20 lines were promises the server never kept. Same rows as the web XpRulesCard.
private val BONUSES = listOf(
    XpRules.Row("Per quest", R.string.xp_side_quest, R.string.xp_heads_call, false),
    XpRules.Row("± XP", R.string.xp_beyond_target, R.string.xp_mgmt_call, false),
)

@Composable
private fun XpRulesCard() {
    val c = Nx.colors
    var open by rememberSaveable { mutableStateOf(false) }
    Card {
        Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).background(c.muted, CircleShape), contentAlignment = Alignment.Center) { Icon(Icons.Filled.CardGiftcard, null, tint = c.foreground) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.xp_rules), fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                Text(stringResource(R.string.xp_rules_sub), fontSize = 12.sp, color = c.mutedFg)
            }
            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = c.mutedFg)
        }
        AnimatedVisibility(open) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(top = 4.dp)) {
                HorizontalDivider(color = c.border)
                XpSection(stringResource(R.string.xp_penalties), Icons.AutoMirrored.Filled.TrendingDown, c.danger, PENALTIES)
                XpSection(stringResource(R.string.xp_bonuses), Icons.AutoMirrored.Filled.TrendingUp, c.success, BONUSES)
                Text(stringResource(R.string.xp_footnote), fontSize = 11.sp, color = c.mutedFg)
            }
        }
    }
}

@Composable
private fun XpSection(title: String, icon: ImageVector, tone: Color, rows: List<XpRules.Row>) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = tone, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(5.dp))
            // A sentence-case heading, no uppercase eyebrow (run 19 decision 1).
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Nx.colors.foreground)
        }
        rows.forEachIndexed { i, r ->
            if (i > 0) HorizontalDivider(color = c.border.copy(alpha = 0.6f))
            Row(verticalAlignment = Alignment.Top) {
                Text(r.xp, fontSize = 13.sp, fontWeight = FontWeight.Black, color = tone, modifier = Modifier.width(84.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(r.rule), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    Text(stringResource(r.note), fontSize = 11.sp, color = c.mutedFg)
                }
                Spacer(Modifier.width(6.dp))
                Text(stringResource(if (r.auto) R.string.xp_auto else R.string.xp_manual), fontSize = 10.sp, fontWeight = FontWeight.Bold,
                    color = if (r.auto) c.violetText else c.mutedFg,
                    modifier = Modifier.background(if (r.auto) c.accentBg else c.muted, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp))
            }
        }
    }
}

@Composable
private fun QuickActions(onOpenAttendance: () -> Unit, onOpenWeb: (String) -> Unit) {
    val c = Nx.colors
    val showThreads = id.znetworks.nexus.ui.components.rememberIsCompany() == true
    // The master Calendar's entry follows the server's flags.calendar.
    // Three across: six tiles two-wide push the agenda a whole screen down.
    val tiles = listOfNotNull(
        // Chat is a tab now: Z Vault takes its place (company only, as in More) — NAV-HOME-GROUP.
        (Triple(R.string.mt_vault, Icons.Filled.Storage, c.violetText) to { onOpenWeb("/vault") }).takeIf { showThreads },
        Triple(R.string.home_attendance, Icons.Filled.WatchLater, c.success) to onOpenAttendance,
        Triple(R.string.home_q_leaderboard, Icons.Filled.EmojiEvents, c.warning) to { onOpenWeb("/leaderboard") },
        Triple(R.string.home_q_rooms, Icons.Filled.MeetingRoom, c.danger) to { onOpenWeb("/room-booking") },
        // Threads is the company's (iOS 14b086f): no tile until known, none outside Z Networks.
        (Triple(R.string.home_q_threads, Icons.Filled.Forum, c.violetText) to { onOpenWeb("/threads") }).takeIf { showThreads },
        // The Calendar is a tab too: Ticket takes its place.
        Triple(R.string.mt_ticket, Icons.Filled.ConfirmationNumber, c.blue) to { onOpenWeb("/tickets") },
    )
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        tiles.chunked(3).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { (t, go) ->
                    val (label, icon, tint) = t
                    Column(
                        Modifier.weight(1f).heightIn(min = 96.dp).clip(RoundedCornerShape(18.dp)).background(c.card)
                            .border(1.dp, c.border, RoundedCornerShape(18.dp)).clickable(onClick = go).padding(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
                    ) {
                        Box(Modifier.size(44.dp).background(tint.copy(alpha = 0.14f), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                            Icon(icon, null, tint = tint)
                        }
                        Text(stringResource(label), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, textAlign = TextAlign.Center, maxLines = 2, minLines = 2)
                    }
                }
            }
        }
    }
}

@Composable
private fun ShortcutsCard(shortcuts: ProjectShortcuts, onOpenProject: (String) -> Unit) {
    val lists by shortcuts.lists.collectAsStateWithLifecycle()
    // Pinned first, in the server's order (synced with the web and the other devices); a project in
    // both lists reads as a duplicate, so pinned wins.
    val recent = lists.recent.filterNot { r -> lists.pinned.any { it.id == r.id } }
    if (lists.pinned.isEmpty() && recent.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (lists.pinned.isNotEmpty()) {
            Caption(stringResource(R.string.home_pinned))
            ShortcutRows(lists.pinned, pinned = true, shortcuts, onOpenProject)
        }
        if (recent.isNotEmpty()) {
            Caption(stringResource(if (lists.pinned.isEmpty()) R.string.home_projects else R.string.home_recent))
            ShortcutRows(recent, pinned = false, shortcuts, onOpenProject)
        }
    }
}

@Composable
private fun ShortcutRows(refs: List<ShortcutRef>, pinned: Boolean, shortcuts: ProjectShortcuts, onOpenProject: (String) -> Unit) {
    val c = Nx.colors
    Card(padding = 0) {
        Column {
            refs.forEachIndexed { i, ref ->
                if (i > 0) HorizontalDivider(color = c.border)
                Row(Modifier.fillMaxWidth().clickable { onOpenProject(ref.id) }.padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    id.znetworks.nexus.feature.projects.ProjectMark(ref.icon, 32.dp, projectId = ref.id)
                    Spacer(Modifier.width(10.dp))
                    Text(ref.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    IconButton(onClick = { shortcuts.togglePin(ref) }) {
                        Icon(if (pinned) Icons.Filled.PushPin else Icons.Outlined.PushPin, stringResource(if (pinned) R.string.home_unpin else R.string.home_pin),
                            tint = if (pinned) c.violetText else c.mutedFg, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun AgendaCard(tasks: List<BoardTask>, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    val agendaScroll = rememberScrollState()
    val today = OfficeTime.today()
    var picked by rememberSaveable { mutableStateOf(today.toString()) }
    val day = LocalDate.parse(picked)
    val byDay = remember(tasks, today) { HomeLogic.agenda(tasks, today) }
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.home_agenda), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Text(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).format(day).replaceFirstChar(Char::titlecase), fontSize = 11.sp, color = c.mutedFg)
        }
        Row(Modifier.scrollEdges(agendaScroll, c.card).horizontalScroll(agendaScroll).padding(end = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (0 until 14).map { today.plusDays(it.toLong()) }.forEach { d ->
                val on = d == day
                val has = byDay[d].orEmpty().isNotEmpty()
                Column(
                    Modifier.width(46.dp).clip(RoundedCornerShape(14.dp)).background(if (on) c.violet else c.muted.copy(alpha = 0.5f))
                        .clickable { picked = d.toString() }.padding(vertical = 9.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                        color = if (on) Color.White.copy(alpha = 0.85f) else c.mutedFg)
                    Text("${d.dayOfMonth}", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = if (on) Color.White else c.foreground)
                    Box(Modifier.size(5.dp).background(if (!has) Color.Transparent else if (on) Color.White else c.violet, CircleShape))
                }
            }
        }
        val items = byDay[day].orEmpty()
        if (items.isEmpty()) Text(stringResource(R.string.home_agenda_empty), fontSize = 12.sp, color = c.mutedFg)
        items.forEach { t ->
            Row(Modifier.fillMaxWidth().clickable { onOpenTask(t.id) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (t.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null,
                    tint = if (t.isDone) c.success else c.mutedFg.copy(alpha = 0.5f), modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(t.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (t.isDone) c.mutedFg else c.foreground,
                        textDecoration = if (t.isDone) TextDecoration.LineThrough else null, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    t.taskList?.let { l -> Text(listOfNotNull(l.project?.name, l.name).joinToString(" · "), fontSize = 10.sp, color = c.mutedFg, maxLines = 1) }
                }
                PriorityChip(t.priority)
            }
        }
    }
}

@Composable
private fun ProfileCard(name: String?, avatar: String?, g: Gamification?, onOpenSettings: () -> Unit) {
    val c = Nx.colors
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(name, avatar, 52.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ProfileRow(stringResource(R.string.home_level), "${g?.xp?.level ?: 0} · ${g?.xp?.levelName ?: "—"}")
                ProfileRow(stringResource(R.string.home_points_period), "%,d".format(Locale.getDefault(), g?.xp?.totalXp ?: 0))
            }
        }
        OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp)) {
            Text(stringResource(R.string.home_settings), color = c.foreground, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun ProfileRow(label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label.uppercase(), fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Nx.colors.mutedFg, modifier = Modifier.weight(1f).alignByBaseline())
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Nx.colors.foreground, maxLines = 1, modifier = Modifier.alignByBaseline())
    }
}

// endregion

/** Home's Task card and list (THREADS-TASK-FOLDERS): done work stays only for 30 days (completedAt, else updatedAt). */
object HomeTasks {
    const val DONE_DAYS = 30L
    fun recent(tasks: List<id.znetworks.nexus.feature.projects.BoardTask>, now: java.time.Instant = java.time.Instant.now()): List<id.znetworks.nexus.feature.projects.BoardTask> {
        val cutoff = now.minus(java.time.Duration.ofDays(DONE_DAYS))
        return tasks.filter { t ->
            if (!t.isDone) return@filter true
            val at = (t.completedAt ?: t.updatedAt)?.let { runCatching { java.time.Instant.parse(it) }.getOrNull() }
            at == null || at.isAfter(cutoff) // no date known: kept, as before
        }
    }
}

