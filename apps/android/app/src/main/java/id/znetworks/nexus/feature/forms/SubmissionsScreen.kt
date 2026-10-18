package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.ui.graphics.Color
import androidx.compose.material.icons.filled.Check
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material.icons.filled.Add
import kotlinx.coroutines.launch
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.gestures.snapping.SnapPosition
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.feature.projects.valueText
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx

@Composable
private fun formsApi(): FormsApi {
    val ctx = LocalContext.current
    val c = (ctx.applicationContext as NexusApplication).container
    return remember { FormsApi(ctx.applicationContext, c.api, c.sessionStore) }
}

/**
 * My Submissions (owner 29 Sep, UI point 4; iOS SubmissionsView, web submissions.tsx): a read-only
 * kanban of what I sent through forms. Columns are the finance team's "Status" values from the server,
 * after one of ours for what nobody processed yet; each card shows the item's own title, not the form's.
 */
@Composable
fun SubmissionsScreen(onBack: () -> Unit, onOpen: (String) -> Unit, onOpenForms: () -> Unit = {}, onOpenLegal: (String) -> Unit = {}) {
    val api = formsApi()
    val legalApi = id.znetworks.nexus.feature.legal.rememberLegalApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var data by remember { mutableStateOf<Submissions?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    // My Legal requests (owner, 14 Oct 2026) sit above the board; a failure there never hides the board.
    var legal by remember { mutableStateOf<List<id.znetworks.nexus.feature.legal.LgMyRequest>>(emptyList()) }
    LaunchedEffect(tick) {
        try { data = api.mySubmissions().value; error = null } catch (e: ApiError) { error = e.describe(res) }
        runCatching { legal = legalApi.myRequests() }
    }
    // Live: the server pings my room with workspace-changed {kind: "submissions"} when a Legal request moves.
    id.znetworks.nexus.core.realtime.LiveRefresh(Unit, liveMs = null, fallbackMs = 60_000,
        matches = { it.name == id.znetworks.nexus.core.realtime.RealtimeEvents.WORKSPACE_CHANGED && it.kind == "submissions" }) {
        runCatching { legal = legalApi.myRequests() }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        id.znetworks.nexus.ui.components.PageHeader(stringResource(R.string.mt_submissions), subtitle = stringResource(R.string.sub_submissions), onBack = onBack)
        val d = data
        when {
            d == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            d == null -> EmptyState(Icons.Filled.Assignment, stringResource(R.string.form_load_failed), error!!, stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
            // The empty state only when both lists are empty.
            d.submissions.isEmpty() && legal.isEmpty() -> EmptyState(Icons.Filled.Inbox, stringResource(R.string.sub_empty_title), stringResource(R.string.sub_empty_body),
                stringResource(R.string.sub_open_forms), onOpenForms, Modifier.fillMaxSize())
            else -> Column(Modifier.fillMaxSize()) {
                if (legal.isNotEmpty()) id.znetworks.nexus.feature.legal.MyLegalRequestsStrip(legal, onOpenLegal)
                if (d.submissions.isNotEmpty()) SubmissionBoardView(d, onOpen, hasLegalRequests = legal.isNotEmpty())
            }
        }
    }
}

/**
 * The board like the web (submissions.tsx, 12 Oct 2026): filter chips (All · Finance · Multimedia · project ▾ ·
 * Needs my action), "Read-only. The team moves the cards.", then the target projects' status options as columns
 * grouped To-do / In progress / Complete in their colours; an older server's plain status names still work.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
internal fun SubmissionBoardView(d: Submissions, onOpen: (String) -> Unit, hasLegalRequests: Boolean = false) {
    val c = Nx.colors
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("submissions", android.content.Context.MODE_PRIVATE) }
    var kind by rememberSaveable { mutableStateOf<String?>(null) }
    var mine by rememberSaveable { mutableStateOf(false) }
    // The project filter is remembered on this device (web localStorage nx-submissions-project).
    var project by remember { mutableStateOf(prefs.getString("project", null)) }
    fun pickProject(id: String?) { project = id; prefs.edit().apply { if (id == null) remove("project") else putString("project", id) }.apply() }
    val newCol = stringResource(R.string.sub_col_new)
    val board = SubmissionBoard.board(d, kind, project, mine, newCol)
    Column(Modifier.fillMaxSize()) {
        androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            FilterPill(stringResource(R.string.sub_f_all), kind == null) { kind = null }
            if ("finance" in board.kinds) FilterPill(stringResource(R.string.sub_f_finance), kind == "finance") { kind = "finance" }
            if ("multimedia" in board.kinds) FilterPill(stringResource(R.string.sub_f_multimedia), kind == "multimedia") { kind = "multimedia" }
            if (board.projects.isNotEmpty()) Box {
                var open by remember { mutableStateOf(false) }
                // The chosen project's mark in the chip (iOS SubmissionsView); the grey page for "All projects".
                FilterPill((board.projects.firstOrNull { it.id == board.project }?.name ?: stringResource(R.string.sub_f_all_projects)) + " ▾", board.project != null,
                    lead = { id.znetworks.nexus.feature.projects.ProjectMark(null, 13.dp, projectId = board.project) }) { open = true }
                androidx.compose.material3.DropdownMenu(open, { open = false }) {
                    androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.sub_f_all_projects)) }, onClick = { open = false; pickProject(null) },
                        leadingIcon = { if (board.project == null) Icon(Icons.Filled.Check, null) })
                    board.projects.forEach { p ->
                        androidx.compose.material3.DropdownMenuItem(text = { Text("${p.name}  ·  ${p.count}") }, onClick = { open = false; pickProject(p.id) },
                            leadingIcon = { if (board.project == p.id) Icon(Icons.Filled.Check, null) })
                    }
                }
            }
            FilterPill(stringResource(R.string.sub_f_needs_me) + if (board.needCount > 0) "  ${board.needCount}" else "", mine) { mine = !mine }
        }
        Row(Modifier.padding(start = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Lock, null, tint = c.mutedFg, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.sub_read_only_web), fontSize = 12.sp, color = c.mutedFg)
        }
        if (board.columns.all { it.second.isEmpty() }) {
            if (hasLegalRequests && kind == null && project == null && !mine) return@Column
            EmptyState(Icons.Filled.Description, stringResource(if (mine) R.string.sub_none_needs_me else R.string.sub_none_here),
                stringResource(if (mine) R.string.sub_none_needs_me_sub else R.string.sub_try_filter), stringResource(R.string.show_all),
                { kind = null; mine = false; pickProject(null) }, Modifier.fillMaxSize())
            return@Column
        }
        val state = rememberLazyListState()
        val dark = androidx.compose.foundation.isSystemInDarkTheme()
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val colWidth = minOf(300.dp, maxWidth * 0.82f)
            LazyRow(state = state, contentPadding = PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
                flingBehavior = rememberSnapFlingBehavior(state, SnapPosition.Start), modifier = Modifier.fillMaxSize()) {
                items(board.columns.size, key = { board.columns[it].first.key }) { i ->
                    val (col, items) = board.columns[i]
                    val firstOfGroup = i == 0 || board.columns[i - 1].first.group != col.group
                    BoardColumn(col, items, colWidth, firstOfGroup, dark, onOpen)
                }
            }
        }
    }
}

@Composable
private fun FilterPill(text: String, on: Boolean, lead: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.clip(CircleShape).background(if (on) c.muted else c.card).border(1.dp, if (on) c.foreground.copy(alpha = 0.25f) else c.border, CircleShape)
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        lead?.invoke()
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (on) c.foreground else c.mutedFg, maxLines = 1)
    }
}

/** Grouping for the board: kept pure so it is tested on the JVM. */
object SubmissionBoard {
    data class ProjectOption(val id: String, val name: String, val count: Int)
    data class Board(
        val columns: List<Pair<SubmissionColumn, List<Submission>>>,
        val kinds: Set<String>,
        val projects: List<ProjectOption>,
        /** The project filter in force (a remembered one with nothing left in it is ignored). */
        val project: String?,
        val needCount: Int,
    )

    private fun keyOf(s: Submission) = s.column?.key ?: (s.procStatus?.trim()?.takeIf { it.isNotEmpty() } ?: "new")

    /**
     * Web MySubmissions: filter by kind, project and "needs my action"; columns = the server's status options of the
     * filtered requests' projects (empty ones too) plus any column a shown request sits in. An older server sends only
     * status names: "New" first, then those, then any status it did not list (nothing sent ever disappears).
     */
    fun board(d: Submissions, kind: String?, projectFilter: String?, mine: Boolean, newName: String): Board {
        val projects = d.submissions.filter { !it.projectId.isNullOrBlank() }.groupBy { it.projectId!! }
            .map { (id, l) -> ProjectOption(id, l.first().projectName?.takeIf { it.isNotBlank() } ?: "—", l.size) }.sortedBy { it.name.lowercase() }
        val project = projectFilter?.takeIf { p -> projects.any { it.id == p } }
        fun base(s: Submission) = (kind == null || s.kind == kind) && (project == null || s.projectId == project)
        val shown = d.submissions.filter { base(it) && (!mine || it.needsAction) }
        val cols: List<SubmissionColumn> = if (d.columns.isNotEmpty()) d.columns else {
            val names = d.statusColumns.filter { it.isNotBlank() }.distinct()
            val extra = d.submissions.mapNotNull { it.procStatus?.trim()?.takeIf(String::isNotEmpty) }.distinct().filter { it !in names }
            listOf(SubmissionColumn("new", newName, group = "todo")) + (names + extra).map { SubmissionColumn(it, it, group = "in_progress") }
        }
        val inScope = d.submissions.filter(::base).mapNotNull { it.projectId }.toSet()
        val visible = cols.filter { c -> c.projectIds?.any { it in inScope } ?: true || shown.any { keyOf(it) == c.key } }
        return Board(visible.map { c -> c to shown.filter { keyOf(it) == c.key } }, d.submissions.mapNotNull { it.kind }.toSet(), projects, project,
            d.submissions.count { base(it) && it.needsAction })
    }

    /** The older columns (status names only): kept for servers without `columns`. */
    fun columns(d: Submissions, newName: String): List<Pair<String, List<Submission>>> =
        board(d.copy(columns = emptyList()), null, null, false, newName).columns.map { it.first.name to it.second }

    /** Column tint, as iOS subColTone: done/approved green, in progress blue, rejected red, else grey. */
    enum class Tone { SUCCESS, BLUE, DANGER, MUTED }
    fun tone(name: String): Tone {
        val n = name.lowercase()
        return when {
            listOf("done", "selesai", "approve", "setuju", "paid").any { it in n } -> Tone.SUCCESS
            "progress" in n || "proses" in n -> Tone.BLUE
            listOf("tolak", "reject", "batal").any { it in n } -> Tone.DANGER
            else -> Tone.MUTED
        }
    }

    /** The column's palette key: its own colour, else by group (web GROUP_COLOR). */
    fun colorKey(c: SubmissionColumn): String =
        if (c.color != null) id.znetworks.nexus.feature.projects.StatusOptions.colorKey(c.color, null)
        else when (c.group) { "in_progress" -> "blue"; "complete" -> "green"; else -> "gray" }
}

@Composable
private fun BoardColumn(col: SubmissionColumn, items: List<Submission>, width: androidx.compose.ui.unit.Dp, firstOfGroup: Boolean, dark: Boolean, onOpen: (String) -> Unit) {
    val c = Nx.colors
    val tone = id.znetworks.nexus.feature.projects.StatusOptions.tone(SubmissionBoard.colorKey(col), dark)
    Column(Modifier.width(width).fillMaxHeight()) {
        Text(if (firstOfGroup) stringResource(when (col.group) { "in_progress" -> R.string.grp_progress; "complete" -> R.string.grp_complete; else -> R.string.grp_todo }) else " ",
            fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, modifier = Modifier.padding(start = 2.dp, bottom = 4.dp))
        Column(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(12.dp)).background(tone.lane)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.clip(RoundedCornerShape(6.dp)).background(tone.bg).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(6.dp).background(tone.dot, CircleShape)); Spacer(Modifier.width(6.dp))
                    Text(col.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = tone.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.width(8.dp))
                Text("${items.size}", fontSize = 12.sp, color = c.mutedFg)
            }
            // Each column scrolls on its own: swipe sideways between columns, down inside one.
            LazyColumn(contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(items, key = { it.id }) { s -> BoardCard(s) { onOpen(s.id) } }
                if (items.isEmpty()) item {
                    Box(Modifier.fillMaxWidth().padding(vertical = 22.dp), contentAlignment = Alignment.Center) {
                        Text(stringResource(R.string.sub_nothing_here), fontSize = 12.sp, color = c.mutedFg)
                    }
                }
            }
        }
    }
}

/** Web Card: title, the amount, category / date / comments / proof, project and handlers, "Needs your reply". */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun BoardCard(s: Submission, onClick: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(10.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).clickable(onClick = onClick).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(s.taskTitle ?: s.formName ?: stringResource(R.string.sub_fallback_title), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
            maxLines = 3, overflow = TextOverflow.Ellipsis)
        s.amount?.let { a -> Text(id.znetworks.nexus.feature.projects.CardProps.number(a.toString(), "currency-idr") ?: "", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground) }
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp),
            itemVerticalAlignment = Alignment.CenterVertically) {
            s.category?.takeIf { it.isNotBlank() }?.let { Text("🏷 $it", fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.muted).padding(horizontal = 6.dp, vertical = 2.dp)) }
            id.znetworks.nexus.feature.projects.dueDate(s.date)?.let { Text("📅 " + AppDateFormats.ofPattern("d MMM yyyy", java.util.Locale.getDefault()).format(it), fontSize = 11.sp, color = c.mutedFg) }
            if (s.commentCount > 0) Text("💬 ${s.commentCount}", fontSize = 11.sp, color = c.mutedFg)
            if (s.proofs.isNotEmpty()) Text("📎 " + stringResource(R.string.sub_proof), fontSize = 11.sp, color = c.success)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(s.projectName.orEmpty(), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (s.handlers.isNotEmpty()) id.znetworks.nexus.ui.components.AvatarStack(s.handlers.map { it.name to it.avatar }, size = 20.dp)
        }
        if (s.needsAction) Text("⚠ " + stringResource(R.string.sub_needs_reply), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF92400E),
            modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Color(0xFFFEF3C7)).padding(horizontal = 6.dp, vertical = 2.dp))
    }
}

/** "20 Sep, 19:14" in office time. */
private fun submittedText(iso: String?): String = iso?.let {
    runCatching { AppDateFormats.ofPattern("d MMM, HH:mm", java.util.Locale.getDefault())
        .format(java.time.Instant.parse(it).atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE)) }.getOrNull()
}.orEmpty()

private fun Modifier.dashedBorder(color: androidx.compose.ui.graphics.Color) = drawBehind {
    drawRoundRect(color, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx(),
        pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()))),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()))
}

@Composable
private fun StageChips(s: Submission) {
    val c = Nx.colors
    s.stage?.let { Pill(it, c.blue); Spacer(Modifier.width(6.dp)) }
    Pill(s.procStatus ?: stringResource(R.string.form_not_processed), if (s.procStatus == null) c.mutedFg else c.success)
}

@Composable
fun SubmissionDetailScreen(id: String, onBack: () -> Unit, onOpenTask: (String) -> Unit, onOpenFile: (String) -> Unit) {
    val api = formsApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var sub by remember { mutableStateOf<Submission?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) { try { sub = api.submission(id) } catch (e: ApiError) { error = e.describe(res) } }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(sub?.formName ?: "", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, maxLines = 1)
        }
        val s = sub
        when {
            s == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            s == null -> TabEmpty(Icons.Filled.Assignment, error!!)
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row { StageChips(s) }
                Text(listOfNotNull(s.projectName, chatTime(s.createdAt)).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                s.taskId?.let { tid -> TextButton(onClick = { onOpenTask(tid) }) { Text(s.taskTitle ?: stringResource(R.string.chat_open_task)) } }
                s.answers.forEach { a ->
                    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(12.dp)) {
                        Text(a.label ?: "—", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                        Text(valueText(a.value) ?: "—", fontSize = 14.sp, color = c.foreground)
                    }
                }
                if (s.proofs.isNotEmpty()) {
                    Text(stringResource(R.string.form_proofs), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                    s.proofs.forEach { p -> TextButton(onClick = { p.url?.let(onOpenFile) }) { Text(p.name ?: "file") } }
                }
            }
        }
    }
}

/**
 * The project's Forms tab (FORM-BUILDER): "New form" on top, then its forms; tap = edit in the builder, long
 * press = Fill in, Copy public link / Share link (public only), Publish / Unpublish.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ProjectFormsTab(projectId: String, onOpenForm: (String) -> Unit, onBuildForm: (String?) -> Unit = {}) {
    val api = formsApi()
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var forms by remember { mutableStateOf<List<BuilderForm>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(projectId, tick) { try { forms = api.builderForms(projectId); error = null } catch (e: ApiError) { error = e.describe(res) } }
    // Back from the builder: what was saved shows here.
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) { lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.RESUMED) { tick++ } }
    val l = forms
    when {
        l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        l == null -> TabEmpty(Icons.Filled.Assignment, error!!)
        l.isEmpty() -> id.znetworks.nexus.ui.components.EmptyState(Icons.Filled.Assignment, stringResource(R.string.fb_empty_title), stringResource(R.string.fb_empty_body),
            stringResource(R.string.fb_new), { onBuildForm(null) }, Modifier.fillMaxSize())
        else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.accentBg).clickable { onBuildForm(null) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Add, null, tint = c.violetText); Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.fb_new), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                }
                Text(stringResource(R.string.fb_tab_hint), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(top = 6.dp))
            }
            items(l, key = { it.id }) { f ->
                var menu by remember { mutableStateOf(false) }
                Box {
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp))
                        .combinedClickable(onClick = { onBuildForm(f.id) }, onLongClick = { menu = true }).padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(f.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                            id.znetworks.nexus.feature.projects.Pill(stringResource(if (f.isPublic) R.string.fb_chip_public else R.string.fb_chip_private), if (f.isPublic) c.success else c.mutedFg)
                        }
                        f.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = c.mutedFg, maxLines = 2) }
                        Text(androidx.compose.ui.res.pluralStringResource(R.plurals.fb_submissions_n, f.submissions, f.submissions) + " · " +
                            androidx.compose.ui.res.pluralStringResource(R.plurals.fb_fields_count, f.fields.size, f.fields.size), fontSize = 11.sp, color = c.mutedFg)
                    }
                    androidx.compose.material3.DropdownMenu(menu, { menu = false }) {
                        androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.fb_fill_in)) }, onClick = { menu = false; onOpenForm(f.slug ?: f.id) })
                        if (f.isPublic) {
                            androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.fb_copy_public_link)) }, onClick = {
                                menu = false
                                val cm = context.getSystemService(android.content.ClipboardManager::class.java)
                                cm?.setPrimaryClip(android.content.ClipData.newPlainText("form", f.link)); notice = res.getString(R.string.fb_link_copied)
                            })
                            androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(R.string.fb_share_link)) }, onClick = {
                                menu = false
                                runCatching { context.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND)
                                    .setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, f.link), null)) }
                            })
                        }
                        androidx.compose.material3.DropdownMenuItem(text = { Text(stringResource(if (f.isPublic) R.string.fb_unpublish else R.string.fb_publish)) }, onClick = {
                            menu = false
                            scope.launch {
                                // Only this key is sent: the rest of the form stays as it is.
                                try { api.updateForm(f.id, kotlinx.serialization.json.JsonObject(mapOf("isPublic" to kotlinx.serialization.json.JsonPrimitive(!f.isPublic))))
                                    notice = res.getString(if (f.isPublic) R.string.fb_unpublished else R.string.fb_published); tick++ }
                                catch (e: ApiError) { notice = res.getString(R.string.fb_update_failed) + ": " + ((e as? ApiError.Http)?.serverMessage ?: e.describe(res)) }
                            }
                        })
                    }
                }
            }
        }
    }
    notice?.let { androidx.compose.material3.AlertDialog(onDismissRequest = { notice = null }, text = { Text(it) },
        confirmButton = { androidx.compose.material3.TextButton(onClick = { notice = null }) { Text("OK") } }) }
}
