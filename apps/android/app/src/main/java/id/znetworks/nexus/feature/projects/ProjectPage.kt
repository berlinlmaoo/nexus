package id.znetworks.nexus.feature.projects

import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ViewList
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.GridOn
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.TableChart
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.alpha
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.HeaderIconButton
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// region Header

/** "Can view" / "Can comment" etc. */
@Composable
fun accessLabel(l: AccessLevel): String = stringResource(when (l) {
    AccessLevel.FULL -> R.string.acc_full; AccessLevel.EDIT -> R.string.acc_edit
    AccessLevel.COMMENT -> R.string.acc_comment; AccessLevel.VIEW -> R.string.acc_view
})

/**
 * The project page header (web PageHeader compact on a phone): icon + title + read-only chip, member faces
 * (two + "+N"), then Ask GIDEON, Project settings and the near-black Add task, icon-sized.
 */
@Composable
fun ProjectPageHeader(
    detail: ProjectDetail?, onBack: () -> Unit, onMembers: () -> Unit, onGideon: () -> Unit, onSettings: () -> Unit,
    onAdd: (() -> Unit)?,
    addInTabs: Boolean = false,
) {
    val c = Nx.colors
    val access = ProjectAccess.of(detail)
    Column(Modifier.fillMaxWidth().background(c.background)) {
        // Phone header (owner, 14 Oct 2026: "kegedean di HP"): back, mark, the name, faces, GIDEON and settings like the
        // web phone; "Add task" sits at the end of the tab row (ProjectTabRow), so the name keeps its room.
        Row(Modifier.fillMaxWidth().padding(start = 0.dp, end = 12.dp, top = 4.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = c.foreground, modifier = Modifier.size(22.dp))
            }
            detail?.let { ProjectMark(it.icon, 22.dp, projectId = it.id) }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(detail?.name.orEmpty(), fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, color = c.foreground,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                access.readOnlyChip?.let { l ->
                    val hint = stringResource(R.string.acc_hint)
                    Text(accessLabel(l), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                        modifier = Modifier.padding(top = 2.dp).clip(CircleShape).background(c.muted).padding(horizontal = 8.dp, vertical = 2.dp)
                            .semantics { contentDescription = hint })
                }
            }
            if (detail != null) {
                MemberFaces(detail.members, onMembers)
                Spacer(Modifier.width(6.dp))
                HeaderIconButton(Icons.Outlined.AutoAwesome, stringResource(R.string.pp_ask_gideon), onGideon, size = 36.dp, painter = id.znetworks.nexus.ui.components.gideonPainter())
                Spacer(Modifier.width(6.dp))
                HeaderIconButton(Icons.Outlined.Settings, stringResource(R.string.pp_settings), onSettings, size = 36.dp)
                // Without tabs (no access, still loading) "Add task" has no row to sit in: it stays here.
                if (onAdd != null && !addInTabs) {
                    Spacer(Modifier.width(6.dp))
                    HeaderIconButton(Icons.Filled.Add, stringResource(R.string.pp_add_task), onAdd, primary = true, size = 36.dp)
                }
            }
        }
    }
}

/** Two overlapping faces and a "+N" bubble (web phone), opening the members list. */
@Composable
private fun MemberFaces(members: List<ProjectMemberRef>, onClick: () -> Unit) {
    val c = Nx.colors
    if (members.isEmpty()) return
    val label = stringResource(R.string.pp_members_title, members.size)
    Row(Modifier.clip(CircleShape).clickable(role = Role.Button, onClickLabel = label, onClick = onClick).padding(2.dp), verticalAlignment = Alignment.CenterVertically) {
        members.take(2).forEachIndexed { i, m ->
            Box(Modifier.offset(x = (-6 * i).dp)) { Avatar(m.user?.name, m.user?.avatar, size = 24.dp, ring = true) }
        }
        if (members.size > 2) {
            Box(Modifier.offset(x = (-12).dp).size(24.dp).background(c.muted, CircleShape).border(1.dp, c.background, CircleShape), contentAlignment = Alignment.Center) {
                Text("+${members.size - 2}", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
            }
        }
    }
}

/** "Project members · n": face, name, Project Owner / level. Changes happen in Project settings. */
@Composable
fun MembersDialog(members: List<ProjectMemberRef>, canAdd: Boolean, onAdd: () -> Unit, onDismiss: () -> Unit) {
    val c = Nx.colors
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.pp_members_title, members.size)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                members.forEach { m ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Avatar(m.user?.name, m.user?.avatar, size = 28.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(m.user?.name ?: m.user?.email ?: "—", fontSize = 15.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val lvl = AccessLevel.ofMember(m.role, m.accessLevel)
                        Text(if (m.role.equals("LEAD", true)) stringResource(R.string.pp_owner) else accessLabel(lvl), fontSize = 13.sp, color = c.mutedFg)
                    }
                }
            }
        },
        confirmButton = { if (canAdd) TextButton(onClick = onAdd) { Text(stringResource(R.string.pp_add_people)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("OK") } })
}

// endregion

// region Tabs

/** One entry of the project's tab row. */
sealed class PageTabItem {
    data object Overview : PageTabItem()
    data class View(val view: ProjectView) : PageTabItem()
    data class Module(val tab: ProjectTab) : PageTabItem()
}

fun layoutTab(layout: String): ProjectTab = when (layout) {
    "list" -> ProjectTab.LIST; "table" -> ProjectTab.TABLE; "calendar" -> ProjectTab.CALENDAR; "timeline" -> ProjectTab.TIMELINE; else -> ProjectTab.BOARD
}

private fun layoutIcon(layout: String): ImageVector = when (layout) {
    "list" -> Icons.AutoMirrored.Outlined.ViewList; "table" -> Icons.Outlined.TableChart; "calendar" -> Icons.Outlined.CalendarMonth
    "timeline" -> Icons.Outlined.Timeline; else -> Icons.Outlined.ViewKanban
}

private fun moduleIcon(t: ProjectTab): ImageVector = when (t) {
    ProjectTab.OUTLET_CALENDAR -> Icons.Outlined.CalendarMonth
    ProjectTab.OUTLET_BOARD -> Icons.Outlined.ViewKanban
    ProjectTab.OUTLET_FORM -> Icons.Outlined.Assignment
    ProjectTab.SHEET -> Icons.Outlined.GridOn; ProjectTab.PAGES -> Icons.Outlined.Description; ProjectTab.FORMS -> Icons.Outlined.Assignment
    ProjectTab.CHAT -> Icons.Outlined.ChatBubbleOutline; ProjectTab.AUTOMATIONS -> Icons.Outlined.Bolt; else -> Icons.Outlined.Dashboard
}

/** A view's tab name: its own, else "By category" for the Kategori board, else the layout's word. */
@Composable
fun viewLabel(v: ProjectView): String = ViewsLogic.name(v) ?: when {
    v.builtin == "category" -> stringResource(R.string.view_category)
    v.builtin != null || v.isFallback -> stringResource(layoutTab(ViewsLogic.layoutOf(v)).label)
    else -> stringResource(R.string.view_untitled)
}

/**
 * The web's one scrollable row: Overview → the views in order → "+" (Add view) → a hairline → Spreadsheet,
 * Pages, Forms, Chat, Automations. A long-press on a view opens its menu; a personal view carries a lock.
 */
@Composable
fun ProjectTabRow(items: List<PageTabItem>, selected: PageTabItem?, canAddView: Boolean, onSelect: (PageTabItem) -> Unit, onViewMenu: (ProjectView) -> Unit, onAddView: () -> Unit,
                  onAdd: (() -> Unit)? = null, onDetails: (() -> Unit)? = null) {
    val c = Nx.colors
    // The open tab is scrolled into view (it sat clipped under "Add task" on List / Table / Calendar / Timeline).
    val scroll = rememberScrollState()
    var selectedX by remember { mutableStateOf<Int?>(null) }
    val density = androidx.compose.ui.platform.LocalDensity.current
    LaunchedEffect(selected, selectedX) { selectedX?.let { scroll.animateScrollTo((it - with(density) { 48.dp.roundToPx() }).coerceAtLeast(0)) } }
    Row(Modifier.fillMaxWidth().padding(end = if (onAdd != null) 12.dp else 0.dp), verticalAlignment = Alignment.CenterVertically) {
    Row(Modifier.weight(1f).horizontalScroll(scroll).padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        var dividerDrawn = false
        items.forEach { item ->
            if (item is PageTabItem.Module && !dividerDrawn) {
                if (canAddView) TabChip(Icons.Filled.Add, null, on = false, onClick = onAddView, description = stringResource(R.string.view_add))
                Box(Modifier.padding(horizontal = 4.dp).width(1.dp).height(18.dp).background(c.border))
                dividerDrawn = true
            }
            val on = item == selected
            Box(if (on) Modifier.onGloballyPositioned { selectedX = it.positionInParent().x.toInt() } else Modifier) {
            when (item) {
                PageTabItem.Overview -> TabChip(Icons.Outlined.Dashboard, stringResource(R.string.ptab_overview), on, { onSelect(item) })
                is PageTabItem.View -> TabChip(layoutIcon(ViewsLogic.layoutOf(item.view)), viewLabel(item.view), on, { onSelect(item) },
                    onLong = { onViewMenu(item.view) }, locked = !item.view.shared)
                // Module tabs that are not open show their icon only (web).
                is PageTabItem.Module -> TabChip(moduleIcon(item.tab), if (on) stringResource(item.tab.label) else null, on, { onSelect(item) },
                    description = stringResource(item.tab.label))
            }
            }
        }
        if (!dividerDrawn && canAddView) TabChip(Icons.Filled.Add, null, on = false, onClick = onAddView, description = stringResource(R.string.view_add))
    }
    // "Add task" at the end of the tabs, always in reach (web phone).
    if (onAdd != null) {
        Spacer(Modifier.width(6.dp))
        var menu by remember { mutableStateOf(false) }
        Box {
            Row(Modifier.clip(RoundedCornerShape(8.dp)).background(c.onyx), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.r21_new), color = c.background, fontSize = 13.sp,
                    modifier = Modifier.clickable(onClick = onAdd).padding(horizontal = 10.dp, vertical = 10.dp))
                androidx.compose.material3.IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.KeyboardArrowDown, stringResource(R.string.more), tint = c.background, modifier = Modifier.size(16.dp))
                }
            }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.pp_new_task)) }, onClick = { menu = false; onAdd() })
                if (onDetails != null) DropdownMenuItem(text = { Text(stringResource(R.string.r21_new_details)) }, onClick = { menu = false; onDetails() })
            }
        }
    }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun TabChip(icon: ImageVector, label: String?, on: Boolean, onClick: () -> Unit, onLong: (() -> Unit)? = null, locked: Boolean = false, description: String? = null) {
    val c = Nx.colors
    val lockText = stringResource(R.string.view_only_you)
    Row(Modifier.clip(RoundedCornerShape(8.dp)).background(if (on) c.muted else Color.Transparent)
        .combinedClickable(role = Role.Tab, onClick = onClick, onLongClick = onLong)
        .semantics { if (description != null) contentDescription = description }
        .defaultMinSize(minHeight = 36.dp, minWidth = 36.dp).padding(horizontal = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Icon(icon, null, tint = if (on) c.foreground else c.mutedFg, modifier = Modifier.size(15.dp))
        if (label != null) {
            Spacer(Modifier.width(6.dp))
            Text(label, fontFamily = TextFont, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = if (on) c.foreground else c.mutedFg, maxLines = 1)
        }
        if (locked) {
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Filled.Lock, lockText, tint = c.mutedFg, modifier = Modifier.size(11.dp))
        }
    }
}

// endregion

// region Groups (Board, List, Table)

/** The coloured pill of a status / select group (palette), or plain bold text for a legacy section. */
@Composable
fun GroupPill(g: TaskGroup, label: String, calc: String?) {
    val c = Nx.colors
    val tone = g.colorKey?.let { StatusOptions.tone(it, isSystemInDarkTheme() || c.background.luminance() < 0.3f) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (tone != null) {
            Row(Modifier.clip(RoundedCornerShape(6.dp)).background(tone.bg).padding(horizontal = 8.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).background(tone.dot, CircleShape))
                Spacer(Modifier.width(6.dp))
                Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = tone.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        } else Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (calc != null) {
            Spacer(Modifier.width(8.dp))
            Text(calc, fontSize = 12.sp, color = tone?.dot ?: c.mutedFg)
        }
    }
}

private fun Color.luminance(): Float = 0.2126f * red + 0.7152f * green + 0.0722f * blue

/** A group's words: priorities by name, the empty group as "No value" / "No assignee", else its own label. */
@Composable
fun groupLabel(g: TaskGroup, groupBy: String?): String = when {
    g.key == ViewsLogic.NONE -> stringResource(if (groupBy == "assignee") R.string.grp_no_assignee else R.string.grp_no_value)
    groupBy == "priority" -> priorityLabel(g.key)
    else -> g.label
}

@Composable
fun statusGroupLabel(g: StatusOptions.Group): String = stringResource(when (g) {
    StatusOptions.Group.TODO -> R.string.grp_todo; StatusOptions.Group.IN_PROGRESS -> R.string.grp_progress; StatusOptions.Group.COMPLETE -> R.string.grp_complete
})

/** What a group's inline "New task" does: a section takes the task, a select option gets its value, people groups take none. */
fun groupCreate(g: TaskGroup, groupBy: String?, vm: ProjectDetailViewModel): ((String) -> Unit)? = when {
    g.laneId != null -> { title -> vm.create(g.laneId, title) }
    groupBy?.startsWith("cf:") == true && g.key != ViewsLogic.NONE -> { title -> vm.createInGroup(groupBy.removePrefix("cf:"), g.key, title) }
    else -> null
}

/**
 * The board: tasks linked in from other projects first (read-only, dashed, "Linked"; web linkedLanes), then one
 * column per group, the pill header with its count, "+ New task" at the top.
 */
@Composable
fun BoardView(groups: List<TaskGroup>, cfg: ViewConfig, lanes: List<Lane>, access: ProjectAccess, vm: ProjectDetailViewModel, selected: Set<String>,
              props: PropCtx, linked: List<BoardLogic.LinkedLane>, onOpenTask: (String) -> Unit, onDuplicateDate: (List<String>) -> Unit) {
    val c = Nx.colors
    val dark = c.background.luminance() < 0.3f
    val state = rememberLazyListState()
    val inline = vm.state.collectAsStateWithLifecycle().value.inlineGroup
    LaunchedEffect(inline) { if (inline != null) groups.indexOfFirst { it.key == inline }.takeIf { it >= 0 }?.let { state.scrollToItem(it + linked.size) } }
    LazyRow(state = state, contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        items(linked.size, key = { "linked-" + linked[it].sourceId }) { i -> LinkedColumn(linked[i], props, access, vm, onOpenTask) }
        items(groups.size, key = { groups[it].key }) { i ->
            val g = groups[i]
            // The status group's name above the first column of each group only (iOS).
            BoardColumn(g, cfg, lanes, access, vm, selected, props, onOpenTask, onDuplicateDate, dark, firstOfGroup = i == 0 || groups[i - 1].statusGroup != g.statusGroup)
        }
        if (access.canManage && cfg.groupBy == "section" && StatusOptions.inUse(lanes)) item(key = "+status") { AddStatusColumn(vm) }
    }
}

/** A read-only lane of tasks another project linked in: dashed outline, its project's name, "Linked", the count. */
@Composable
private fun LinkedColumn(l: BoardLogic.LinkedLane, props: PropCtx, access: ProjectAccess, vm: ProjectDetailViewModel, onOpenTask: (String) -> Unit) {
    val c = Nx.colors
    val outline = c.border
    Column(Modifier.width(284.dp).fillMaxHeight().drawBehind {
        drawRoundRect(outline, style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()))
    }.padding(8.dp)) {
        // Lines up with the status-group label above the other columns.
        Text(" ", fontSize = 11.sp, modifier = Modifier.padding(start = 4.dp, bottom = 4.dp))
        Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp).heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
            // Up to two lines: the source project's full name, as iOS (run 9 cut it to "SPECIAL BU…" on one line).
            Text(l.name ?: stringResource(R.string.cp_another_project), fontSize = 14.sp, lineHeight = 17.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.cp_linked), fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(c.muted).padding(horizontal = 6.dp))
            Spacer(Modifier.weight(1f))
            Text("${l.tasks.size}", fontSize = 12.sp, color = c.mutedFg)
        }
        Spacer(Modifier.height(6.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f, fill = false)) {
            items(l.tasks, key = { it.id }) { t ->
                BoardCard(t, props, onClick = { onOpenTask(t.id) }, onToggleDone = if (access.canEdit) ({ vm.toggleDone(t) }) else null)
            }
        }
    }
}

@Composable
private fun BoardColumn(g: TaskGroup, cfg: ViewConfig, lanes: List<Lane>, access: ProjectAccess, vm: ProjectDetailViewModel, selected: Set<String>, props: PropCtx,
                        onOpenTask: (String) -> Unit, onDuplicateDate: (List<String>) -> Unit, dark: Boolean, firstOfGroup: Boolean) {
    val c = Nx.colors
    val inline = vm.state.collectAsStateWithLifecycle().value.inlineGroup
    run {
            val tone = g.colorKey?.let { StatusOptions.tone(it, dark) }
            Column(Modifier.width(284.dp).fillMaxHeight().clip(RoundedCornerShape(12.dp)).background(tone?.lane ?: c.muted.copy(alpha = 0.5f)).padding(8.dp)) {
                // The status group's name above the first column of each group (iOS).
                if (g.statusGroup != null) Text(if (firstOfGroup) statusGroupLabel(g.statusGroup) else " ", fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(start = 4.dp, bottom = 4.dp))
                Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { GroupPill(g, groupLabel(g, cfg.groupBy), ViewsLogic.calc(g, cfg.calc)) }
                    if (g.laneId != null && access.canManage) SectionStatusButton(g.laneId, lanes, vm)
                }
                Spacer(Modifier.height(6.dp))
                val create = if (access.canEdit) groupCreate(g, cfg.groupBy, vm) else null
                if (create != null) { InlineNewTask(create, request = inline == g.key, consumed = vm::inlineConsumed); Spacer(Modifier.height(6.dp)) }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f, fill = false)) {
                    items(g.tasks, key = { it.id }) { t -> MovableTask(t, lanes, onOpenTask, vm, selected, access, onDuplicateDate, props) }
                }
            }
    }
}

/**
 * A status column's ••• menu (web board, Full access): Rename…, Colour, Move left / right within its group,
 * Status type, Delete status… (its tasks move to another column).
 */
@Composable
private fun SectionStatusButton(laneId: String, lanes: List<Lane>, vm: ProjectDetailViewModel) {
    val c = Nx.colors
    val context = LocalContext.current
    val lane = lanes.firstOrNull { it.id == laneId } ?: return
    var menu by remember { mutableStateOf<String?>(null) }
    var dialog by remember { mutableStateOf<String?>(null) }
    Box {
        androidx.compose.material3.IconButton(onClick = { menu = "root" }, modifier = Modifier.size(32.dp)) {
            Icon(Icons.Filled.MoreHoriz, stringResource(R.string.col_options), tint = c.mutedFg, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(menu != null, { menu = null }) {
            if (menu == "colour") StatusOptions.KEYS.forEach { k ->
                DropdownMenuItem(text = { Text(colorName(k)) }, leadingIcon = { Box(Modifier.size(12.dp).background(StatusOptions.tone(k, false).dot, CircleShape)) },
                    onClick = { menu = null; vm.colorSection(lane.id, k) })
            } else {
                DropdownMenuItem(text = { Text(stringResource(R.string.col_rename)) }, onClick = { menu = null; dialog = "rename" })
                DropdownMenuItem(text = { Text(stringResource(R.string.col_colour)) }, onClick = { menu = "colour" }, trailingIcon = { Icon(Icons.Filled.KeyboardArrowRight, null) })
                val across = stringResource(R.string.col_across)
                DropdownMenuItem(text = { Text(stringResource(R.string.col_left)) }, onClick = { menu = null
                    if (!vm.moveSection(lane.id, -1)) android.widget.Toast.makeText(context, across, android.widget.Toast.LENGTH_SHORT).show() })
                DropdownMenuItem(text = { Text(stringResource(R.string.col_right)) }, onClick = { menu = null
                    if (!vm.moveSection(lane.id, 1)) android.widget.Toast.makeText(context, across, android.widget.Toast.LENGTH_SHORT).show() })
                DropdownMenuItem(text = { Text(stringResource(R.string.col_status_type)) }, onClick = { menu = null; dialog = "type" })
                if (lanes.size > 1) {
                    HorizontalDivider(color = c.border)
                    DropdownMenuItem(text = { Text(stringResource(R.string.col_delete), color = c.dangerText) }, onClick = { menu = null; dialog = "delete" })
                }
            }
        }
    }
    when (dialog) {
        "rename" -> TextPromptDialog(stringResource(R.string.col_rename_title), lane.name, stringResource(R.string.filter_save), onDismiss = { dialog = null }) { n -> dialog = null; vm.renameSection(lane.id, n) }
        "type" -> SectionStatusDialog(lane.name, lane.taskStatus, onDismiss = { dialog = null }) { dialog = null; if (it != lane.taskStatus) vm.setSectionStatus(lane.id, it) }
        "delete" -> {
            val others = StatusOptions.ordered(lanes).filter { it.id != lane.id }
            var moveTo by remember { mutableStateOf(others.firstOrNull()?.id) }
            AlertDialog(onDismissRequest = { dialog = null }, title = { Text(stringResource(R.string.col_delete).trimEnd('…') + " “${lane.name}”") },
                text = {
                    Column {
                        Text(stringResource(R.string.col_moves_to), fontSize = 13.sp, color = c.mutedFg)
                        others.forEach { o ->
                            Row(Modifier.fillMaxWidth().clickable { moveTo = o.id }, verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(moveTo == o.id, { moveTo = o.id }); Text(o.name)
                            }
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { dialog = null; vm.deleteSection(lane.id, moveTo) }) { Text(stringResource(R.string.bulk_delete), color = c.dangerText) } },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text(stringResource(R.string.cancel)) } })
        }
    }
}

/** "+ Status" after the last column (Full access): pick its group, then its name. */
@Composable
fun AddStatusColumn(vm: ProjectDetailViewModel) {
    val c = Nx.colors
    var group by remember { mutableStateOf<StatusOptions.Group?>(null) }
    var menu by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.width(160.dp).clip(RoundedCornerShape(12.dp)).clickable { menu = true }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Add, null, tint = c.mutedFg, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.col_add_short), fontSize = 14.sp, color = c.mutedFg)
        }
        DropdownMenu(menu, { menu = false }) {
            StatusOptions.Group.entries.forEach { g -> DropdownMenuItem(text = { Text(statusGroupLabel(g)) }, onClick = { menu = false; group = g }) }
        }
    }
    group?.let { g ->
        TextPromptDialog(stringResource(R.string.col_new_in, statusGroupLabel(g)), "", stringResource(R.string.add), onDismiss = { group = null }) { n -> group = null; vm.addSection(g, n) }
    }
}

@Composable
fun colorName(k: String): String = stringResource(when (k) {
    "brown" -> R.string.color_brown; "orange" -> R.string.color_orange; "yellow" -> R.string.color_yellow; "green" -> R.string.color_green
    "blue" -> R.string.color_blue; "purple" -> R.string.color_purple; "pink" -> R.string.color_pink; "red" -> R.string.color_red; else -> R.string.color_gray
})

/**
 * The List: one collapsible group per value (chevron + pill + done/total), rows with a done circle, the title
 * (struck through when done) and its properties wrapped under it. Collapsed groups are kept per view.
 */
@Composable
fun ListView(viewId: String, groups: List<TaskGroup>, cfg: ViewConfig, lanes: List<Lane>, access: ProjectAccess, vm: ProjectDetailViewModel,
             selected: Set<String>, props: PropCtx, onOpenTask: (String) -> Unit, onDuplicateDate: (List<String>) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("view_collapsed", android.content.Context.MODE_PRIVATE) }
    var collapsed by remember(viewId) { mutableStateOf(prefs.getStringSet(viewId, emptySet()).orEmpty().toSet()) }
    val inline = vm.state.collectAsStateWithLifecycle().value.inlineGroup
    val state = rememberLazyListState()
    LaunchedEffect(inline) { if (inline != null) { collapsed = collapsed - inline; state.scrollToItem(0) } }
    fun toggle(k: String) { collapsed = if (k in collapsed) collapsed - k else collapsed + k; prefs.edit().putStringSet(viewId, collapsed).apply() }
    LazyColumn(state = state, contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp), modifier = Modifier.fillMaxSize()) {
        groups.forEach { g ->
            val open = g.key !in collapsed
            item(key = "h-" + g.key) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { toggle(g.key) }.defaultMinSize(minHeight = 44.dp).padding(horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (open) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowRight, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    GroupPill(g, groupLabel(g, cfg.groupBy), ViewsLogic.calc(g, cfg.calc))
                }
            }
            if (open) {
                val create = if (access.canEdit) groupCreate(g, cfg.groupBy, vm) else null
                if (create != null) item(key = "n-" + g.key) { Box(Modifier.padding(start = 26.dp, bottom = 4.dp)) { InlineNewTask(create, flat = true, request = inline == g.key, consumed = vm::inlineConsumed) } }
                items(g.tasks, key = { g.key + "/" + it.id }) { t -> ListRow(t, lanes, vm, selected, access, props, onOpenTask, onDuplicateDate) }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun ListRow(t: BoardTask, lanes: List<Lane>, vm: ProjectDetailViewModel, selected: Set<String>, access: ProjectAccess, props: PropCtx,
                    onOpenTask: (String) -> Unit, onDuplicateDate: (List<String>) -> Unit) {
    val c = Nx.colors
    val selecting = selected.isNotEmpty()
    var menu by remember { mutableStateOf(false) }
    Box {
        // iOS ListTaskRow (compact): the done circle, the title (two lines at most), then the view's properties in one
        // wrapping line — fields, due, priority, status, people (run 5: rows were 3–4 lines of chips).
        Row(Modifier.fillMaxWidth().background(if (t.id in selected) c.accentBg else Color.Transparent)
            .combinedClickable(onClick = { if (selecting) vm.toggleSelect(t.id) else onOpenTask(t.id) },
                onLongClick = { if (selecting) vm.toggleSelect(t.id) else menu = true })
            .padding(start = if (t.isSubtask) 30.dp else 8.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.Top) {
            Icon(if (t.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, stringResource(R.string.task_toggle_done),
                tint = if (t.isDone) c.success else c.mutedFg.copy(alpha = 0.55f),
                modifier = Modifier.padding(top = 1.dp).size(20.dp).clip(CircleShape).clickable(enabled = access.canEdit && !selecting) { vm.toggleDone(t) })
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text((if (t.isSubtask) "↳ " else "") + t.title.ifBlank { "—" }, fontSize = 15.sp, color = if (t.isDone) c.mutedFg else c.foreground,
                        textDecoration = if (t.isDone) TextDecoration.LineThrough else null, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (t.questXp > 0) { Spacer(Modifier.width(6.dp)); Text("+${t.questXp} XP", fontSize = 11.sp, color = c.violetText) }
                }
                PropLine(props.items(t))
            }
        }
        HorizontalDivider(Modifier.align(Alignment.BottomStart).padding(start = 36.dp), color = c.border.copy(alpha = 0.7f))
        TaskMenu(menu, { menu = false }, t, lanes, vm, access, onDuplicateDate)
    }
}

/** The long-press menu of a card or row: select, duplicate, move to a section (Can edit). */
@Composable
fun TaskMenu(open: Boolean, onDismiss: () -> Unit, t: BoardTask, lanes: List<Lane>, vm: ProjectDetailViewModel, access: ProjectAccess, onDuplicateDate: (List<String>) -> Unit) {
    DropdownMenu(open, onDismiss) {
        if (!access.canEdit) {
            DropdownMenuItem(text = { Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }, onClick = onDismiss, enabled = false)
            return@DropdownMenu
        }
        TaskBulkMenuItems(onSelect = { onDismiss(); vm.toggleSelect(t.id) }, onDuplicate = { onDismiss(); vm.duplicate(listOf(t.id), null) },
            onDuplicateDate = { onDismiss(); onDuplicateDate(listOf(t.id)) })
        if (lanes.size > 1) Text(stringResource(R.string.board_move_to), fontSize = 12.sp, color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
        StatusOptions.ordered(lanes).filter { it.id != t.taskListId }.forEach { l ->
            DropdownMenuItem(text = { Text(l.name) }, onClick = { onDismiss(); vm.moveTo(listOf(t.id), l.id) })
        }
        if (access.canDelete) {
            HorizontalDivider(color = Nx.colors.border)
            DropdownMenuItem(text = { Text(stringResource(R.string.bulk_delete), color = Nx.colors.dangerText) }, onClick = { onDismiss(); vm.delete(listOf(t.id)) })
        }
    }
}

/** A card with its menu; while selecting, a tap (or long-press) toggles it. */
@Composable
fun MovableTask(t: BoardTask, lanes: List<Lane>, onOpenTask: (String) -> Unit, vm: ProjectDetailViewModel, selected: Set<String>, access: ProjectAccess,
                onDuplicateDate: (List<String>) -> Unit, props: PropCtx) {
    var menu by remember { mutableStateOf(false) }
    val selecting = selected.isNotEmpty()
    Box {
        BoardCard(t, props, onClick = { if (selecting) vm.toggleSelect(t.id) else onOpenTask(t.id) },
            onToggleDone = if (selecting || !access.canEdit) null else ({ vm.toggleDone(t) }),
            onLongClick = { if (selecting) vm.toggleSelect(t.id) else menu = true }, selected = if (selecting) t.id in selected else null)
        TaskMenu(menu, { menu = false }, t, lanes, vm, access, onDuplicateDate)
    }
}

/**
 * A board card like the web's (owner, 14 Oct 2026): "From {project}" on a linked task, the subtask's parent, the done
 * circle beside the title, then the view's properties in one wrapping line under the title (web TaskCard + PropLine).
 * A done card is dimmed.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun BoardCard(t: BoardTask, props: PropCtx, onClick: () -> Unit, onToggleDone: (() -> Unit)? = null, onLongClick: (() -> Unit)? = null, selected: Boolean? = null) {
    val c = Nx.colors
    val shape = RoundedCornerShape(10.dp)
    val linkedFrom = t.projectId?.takeIf { props.projectId != null && it != props.projectId }?.let { t.taskList?.project?.name ?: stringResource(R.string.cp_another_project) }
    Column(Modifier.fillMaxWidth().alpha(if (t.isDone && selected != true) 0.6f else 1f).clip(shape).background(if (selected == true) c.accentBg else c.card)
        .border(if (selected == true) 2.dp else 1.dp, if (selected == true) c.violet else c.border, shape)
        .combinedClickable(onClick = onClick, onLongClick = onLongClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (linkedFrom != null) Text(stringResource(R.string.cp_from, linkedFrom), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (t.isSubtask) Text("↳ " + (t.parentTitle ?: stringResource(R.string.td_subtasks)), fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.Top) {
            if (selected != null) {
                Icon(if (selected) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank, null, Modifier.size(20.dp), tint = if (selected) c.violet else c.mutedFg)
                Spacer(Modifier.width(8.dp))
            }
            val circle = if (t.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked
            val tint = if (t.isDone) c.success else c.mutedFg.copy(alpha = 0.6f)
            Box(Modifier.padding(top = 1.dp).size(20.dp).clip(CircleShape).then(if (onToggleDone != null) Modifier.clickable(onClick = onToggleDone) else Modifier),
                contentAlignment = Alignment.Center) {
                Icon(circle, stringResource(R.string.task_toggle_done), Modifier.size(18.dp), tint = tint)
            }
            Spacer(Modifier.width(8.dp))
            Text(t.title.ifBlank { "—" }, fontSize = 15.sp, fontWeight = FontWeight.Medium, lineHeight = 20.sp, color = if (t.isDone) c.mutedFg else c.foreground,
                textDecoration = if (t.isDone) TextDecoration.LineThrough else null, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            if (t.questXp > 0) { Spacer(Modifier.width(6.dp)); Pill("+${t.questXp} XP", c.violetText) }
        }
        PropLine(props.items(t), Modifier.padding(start = 28.dp))
    }
}

/**
 * "+ New task" at the top of a group: Enter saves and keeps the box open for the next title; typing never
 * waits (each title is sent on its own); a tap on ✕ closes it.
 */
@Composable
fun InlineNewTask(onAdd: (String) -> Unit, flat: Boolean = false, request: Boolean = false, consumed: () -> Unit = {}) {
    val c = Nx.colors
    var composing by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    LaunchedEffect(request) { if (request) { composing = true; consumed() } }
    if (!composing) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { composing = true }.defaultMinSize(minHeight = 40.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Add, null, Modifier.size(16.dp), tint = c.mutedFg); Spacer(Modifier.size(6.dp))
            Text(stringResource(R.string.pp_new_task), fontSize = 14.sp, color = c.mutedFg)
        }
    } else {
        val focus = remember { androidx.compose.ui.focus.FocusRequester() }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
        Row(Modifier.fillMaxWidth().background(if (flat) Color.Transparent else c.card, RoundedCornerShape(10.dp)).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(title, { title = it }, placeholder = { Text(stringResource(R.string.pp_new_task)) }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (title.isNotBlank()) { onAdd(title.trim()); title = "" } else composing = false }),
                modifier = Modifier.weight(1f).focusRequester(focus))
            androidx.compose.material3.IconButton(onClick = { if (title.isNotBlank()) onAdd(title.trim()); title = ""; composing = false }) {
                Icon(if (title.isNotBlank()) Icons.Filled.Check else Icons.Filled.Close, stringResource(if (title.isNotBlank()) R.string.add else R.string.cancel), tint = c.mutedFg)
            }
        }
    }
}

// endregion

// region Table

private const val PAGE = 40

/**
 * The Table (task grid): Name, then the view's properties in its order (web default: Assignee, Due date, Priority,
 * Status, Tags), drawn like the cards (PropValue); rows grouped like the List, 40 per group then "Show more". Status,
 * assignee, priority and due date are edited in place (Can edit). The group header stays at the left edge while the
 * grid scrolls sideways (web sticky header).
 */
@Composable
fun TableView(groups: List<TaskGroup>, cfg: ViewConfig, lanes: List<Lane>, props: PropCtx, members: List<ProjectMemberRef>, access: ProjectAccess,
              vm: ProjectDetailViewModel, selected: Set<String>, onOpenTask: (String) -> Unit, onPickDue: (BoardTask) -> Unit) {
    val c = Nx.colors
    val h = rememberScrollState()
    val nameW = 200.dp; val colW = 132.dp
    val usesStatus = StatusOptions.inUse(lanes)
    val cols = props.keys
    val totalW = nameW + colW * cols.size
    val shown = remember(groups) { mutableStateOf(mapOf<String, Int>()) }
    @Composable
    fun headerCell(text: String, w: Dp) = Box(Modifier.width(w).height(36.dp).padding(horizontal = 10.dp), contentAlignment = Alignment.CenterStart) {
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    val stick = Modifier.offset { androidx.compose.ui.unit.IntOffset(h.value, 0) }
    Column(Modifier.fillMaxSize().horizontalScroll(h)) {
        LazyColumn(Modifier.weight(1f).width(totalW), contentPadding = PaddingValues(bottom = 96.dp)) {
            groups.forEach { g ->
                item(key = "h-" + g.key) {
                    Box(stick.padding(start = 10.dp, top = 12.dp, bottom = 6.dp)) { GroupPill(g, groupLabel(g, cfg.groupBy), "${g.tasks.size}") }
                    Row(Modifier.background(c.background)) {
                        headerCell(stringResource(R.string.pp_col_name), nameW)
                        cols.forEach { headerCell(propLabel(it, props.fields, usesStatus), colW) }
                    }
                    HorizontalDivider(Modifier.width(totalW), color = c.border)
                }
                val limit = shown.value[g.key] ?: PAGE
                items(g.tasks.take(limit), key = { g.key + "/" + it.id }) { t ->
                    TableRow(t, lanes, cols, props, members, usesStatus, access, vm, t.id in selected, selected.isNotEmpty(), nameW, colW, onOpenTask, onPickDue)
                }
                if (g.tasks.size > limit) item(key = "m-" + g.key) {
                    TextButton(onClick = { shown.value = shown.value + (g.key to limit + 25) }, modifier = stick) {
                        Text(stringResource(R.string.pp_show_more, minOf(25, g.tasks.size - limit)))
                    }
                }
                val create = if (access.canEdit) groupCreate(g, cfg.groupBy, vm) else null
                if (create != null) item(key = "n-" + g.key) { Box(stick.width(nameW + colW).padding(start = 6.dp)) { InlineNewTask(create, flat = true) } }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun TableRow(t: BoardTask, lanes: List<Lane>, cols: List<String>, props: PropCtx, members: List<ProjectMemberRef>, usesStatus: Boolean, access: ProjectAccess,
                     vm: ProjectDetailViewModel, isSelected: Boolean, selecting: Boolean, nameW: Dp, colW: Dp, onOpenTask: (String) -> Unit, onPickDue: (BoardTask) -> Unit) {
    val c = Nx.colors
    val edit = access.canEdit && !selecting
    Row(Modifier.background(if (isSelected) c.accentBg else Color.Transparent)
        .combinedClickable(onClick = { if (selecting) vm.toggleSelect(t.id) else onOpenTask(t.id) }, onLongClick = { if (access.canEdit) vm.toggleSelect(t.id) }),
        verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.width(nameW).height(44.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (t.isDone) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = if (t.isDone) c.success else c.mutedFg.copy(alpha = 0.5f), modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(6.dp))
            Text((if (t.isSubtask) "↳ " else "") + t.title, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = if (t.isDone) c.mutedFg else c.foreground, textDecoration = if (t.isDone) TextDecoration.LineThrough else null)
        }
        cols.forEach { key ->
            val value = CardProps.item(t, key, props.fields, lanes, props.people, props.today)
            var menu by remember { mutableStateOf(false) }
            val onEdit: (() -> Unit)? = when (key) {
                "section", "status", "priority" -> ({ menu = true })
                "assignee" -> if (members.isNotEmpty()) ({ menu = true }) else null
                "due" -> ({ onPickDue(t) })
                else -> null
            }
            Cell(colW, edit && onEdit != null, onEdit ?: {}) {
                when {
                    value == null -> Text("—", fontSize = 13.sp, color = c.mutedFg)
                    // Assignee: the faces and first names (one line).
                    value is CardProps.Item.People -> Row(verticalAlignment = Alignment.CenterVertically) {
                        id.znetworks.nexus.ui.components.AvatarStack(value.people, size = 20.dp)
                        Spacer(Modifier.width(4.dp))
                        Text(value.people.mapNotNull { it.first?.substringBefore(' ') }.joinToString(", "), fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = c.foreground)
                    }
                    else -> PropValue(value)
                }
                when (key) {
                    "section", "status" -> DropdownMenu(menu, { menu = false }) {
                        StatusOptions.ordered(lanes).forEach { l -> DropdownMenuItem(text = { Text(l.name) }, onClick = { menu = false; if (l.id != t.taskListId) vm.setStatusOption(t.id, l.id) }) }
                    }
                    "priority" -> DropdownMenu(menu, { menu = false }) {
                        TaskEnums.PRIORITIES.forEach { p -> DropdownMenuItem(text = { Text(priorityLabel(p)) }, onClick = { menu = false; vm.setTaskPriority(t.id, p) }) }
                    }
                    "assignee" -> DropdownMenu(menu, { menu = false }) {
                        members.forEach { m ->
                            val on = t.assignees.any { (it.user?.id ?: it.userId) == m.uid }
                            DropdownMenuItem(text = { Text(m.user?.name ?: m.uid) }, leadingIcon = { if (on) Icon(Icons.Filled.Check, null) },
                                onClick = { menu = false; vm.toggleAssignee(t, m.uid) })
                        }
                    }
                }
            }
        }
    }
    HorizontalDivider(Modifier.width(nameW + colW * cols.size), color = c.border.copy(alpha = 0.6f))
}

@Composable
private fun Cell(w: Dp, editable: Boolean, onEdit: () -> Unit, content: @Composable () -> Unit) {
    Box(Modifier.width(w).height(44.dp).then(if (editable) Modifier.clickable(onClick = onEdit) else Modifier).padding(horizontal = 10.dp),
        contentAlignment = Alignment.CenterStart) { content() }
}

// endregion

// region Selection + Undo

/**
 * "{n} selected · Edit ▾ · Duplicate · 📅 · Delete · ✕", floating at the bottom while selecting (web task-bulk.tsx).
 * Edit holds Status, Priority, Assign to and Due date.
 */
@Composable
fun ProjectSelectionBar(count: Int, busy: Boolean, lanes: List<Lane>, members: List<ProjectMemberRef>, canDelete: Boolean,
                        onMove: (String) -> Unit, onPriority: (String) -> Unit, onAssign: (String) -> Unit, onDue: () -> Unit, onClearDue: () -> Unit,
                        onDuplicate: () -> Unit, onDuplicateDate: () -> Unit, onDelete: () -> Unit, onSelectAll: () -> Unit, onClear: () -> Unit,
                        modifier: Modifier = Modifier) {
    val c = Nx.colors
    var menu by remember { mutableStateOf<String?>(null) }
    Row(modifier.shadow(8.dp, RoundedCornerShape(14.dp)).clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp))
        .horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(pluralStringResource(R.plurals.bulk_selected, count, count), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.padding(horizontal = 4.dp))
        Box {
            NxButton(stringResource(R.string.bulk_edit), { menu = "root" }, compact = true, enabled = !busy, icon = Icons.Filled.KeyboardArrowDown)
            DropdownMenu(menu != null, { menu = null }) {
                when (menu) {
                    "root" -> {
                        DropdownMenuItem(text = { Text(stringResource(R.string.bulk_status)) }, onClick = { menu = "status" }, trailingIcon = { Icon(Icons.Filled.KeyboardArrowRight, null) })
                        DropdownMenuItem(text = { Text(stringResource(R.string.bulk_priority)) }, onClick = { menu = "priority" }, trailingIcon = { Icon(Icons.Filled.KeyboardArrowRight, null) })
                        if (members.isNotEmpty()) DropdownMenuItem(text = { Text(stringResource(R.string.bulk_assign)) }, onClick = { menu = "assign" }, trailingIcon = { Icon(Icons.Filled.KeyboardArrowRight, null) })
                        DropdownMenuItem(text = { Text(stringResource(R.string.bulk_due)) }, onClick = { menu = null; onDue() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.bulk_due_clear)) }, onClick = { menu = null; onClearDue() })
                    }
                    "status" -> StatusOptions.ordered(lanes).forEach { l -> DropdownMenuItem(text = { Text(l.name) }, onClick = { menu = null; onMove(l.id) }) }
                    "priority" -> TaskEnums.PRIORITIES.forEach { p -> DropdownMenuItem(text = { Text(priorityLabel(p)) }, onClick = { menu = null; onPriority(p) }) }
                    "assign" -> members.forEach { m -> DropdownMenuItem(text = { Text(m.user?.name ?: m.uid) }, leadingIcon = { Avatar(m.user?.name, m.user?.avatar, size = 22.dp) },
                        onClick = { menu = null; onAssign(m.uid) }) }
                }
            }
        }
        NxButton(stringResource(R.string.bulk_duplicate), onDuplicate, compact = true, enabled = !busy)
        HeaderIconButton(Icons.Outlined.CalendarMonth, stringResource(R.string.bulk_duplicate_date), onDuplicateDate, enabled = !busy)
        if (canDelete) NxButton(stringResource(R.string.bulk_delete), onDelete, compact = true, enabled = !busy, kind = NxButtonKind.GHOST)
        NxButton(stringResource(R.string.bulk_select_all), onSelectAll, compact = true, kind = NxButtonKind.GHOST)
        HeaderIconButton(Icons.Filled.Close, stringResource(R.string.cancel), onClear)
    }
}

/** The last action and "Undo" for 10 s (web task-undo); a second tap does nothing. */
@Composable
fun UndoBar(entry: UndoEntry, onUndo: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val c = Nx.colors
    LaunchedEffect(entry.id) { delay(10_000); onDismiss() }
    Row(modifier.shadow(8.dp, RoundedCornerShape(12.dp)).clip(RoundedCornerShape(12.dp)).background(c.onyx).padding(start = 14.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(entry.label, fontSize = 14.sp, color = c.background, modifier = Modifier.weight(1f, fill = false), maxLines = 1, overflow = TextOverflow.Ellipsis)
        TextButton(onClick = onUndo) { Text(stringResource(R.string.undo), color = c.background, fontWeight = FontWeight.SemiBold) }
        androidx.compose.material3.IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = c.background.copy(alpha = 0.7f), modifier = Modifier.size(18.dp)) }
    }
}

/** "Delete n tasks?" — centred, with the undo promise. */
@Composable
fun DeleteTasksDialog(count: Int, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(pluralStringResource(R.plurals.bulk_delete_title, count, count)) },
        text = { Text(stringResource(R.string.bulk_delete_sub)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.bulk_delete), color = Nx.colors.dangerText) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

// endregion

// region View dialogs

/** "+" Add view: layout (Table by default, as the web), name, who sees it. */
@Composable
fun NewViewDialog(canShare: Boolean, onDismiss: () -> Unit, onCreate: (name: String?, layout: String, shared: Boolean) -> Unit) {
    val c = Nx.colors
    var layout by rememberSaveable { mutableStateOf("table") }
    var name by rememberSaveable { mutableStateOf("") }
    var shared by rememberSaveable { mutableStateOf(false) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.view_new)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.view_layout), fontSize = 13.sp, color = c.mutedFg)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ViewsLogic.LAYOUTS.forEach { l -> TabChip(layoutIcon(l), stringResource(layoutTab(l).label), on = layout == l, onClick = { layout = l }) }
                }
                OutlinedTextField(name, { name = it }, singleLine = true, label = { Text(stringResource(R.string.view_name)) },
                    placeholder = { Text(stringResource(layoutTab(layout).label)) }, modifier = Modifier.fillMaxWidth())
                Text(stringResource(R.string.view_who), fontSize = 13.sp, color = c.mutedFg)
                Row(Modifier.fillMaxWidth().clickable { shared = false }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(!shared, { shared = false }); Text(stringResource(R.string.view_only_me))
                }
                Row(Modifier.fillMaxWidth().clickable(enabled = canShare) { shared = true }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(shared, { shared = true }, enabled = canShare); Text(stringResource(R.string.view_everyone), color = if (canShare) c.foreground else c.mutedFg)
                }
                if (!canShare) Text(stringResource(R.string.view_viewers_hint), fontSize = 12.sp, color = c.mutedFg)
            }
        },
        confirmButton = { TextButton(onClick = { onCreate(name.ifBlank { null }, layout, shared && canShare) }) { Text(stringResource(R.string.view_create)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/** A view's menu (long-press its tab): Rename · Filter and sort… · Duplicate · Hide (built-in) / Delete (custom). */
@Composable
fun ViewMenuDialog(v: ProjectView, canEdit: Boolean, canDelete: Boolean, onDismiss: () -> Unit, onRename: () -> Unit, onFilter: () -> Unit,
                   onDuplicate: () -> Unit, onHide: (() -> Unit)?, onDelete: () -> Unit) {
    val c = Nx.colors
    AlertDialog(onDismissRequest = onDismiss, title = { Text(viewLabel(v)) },
        text = {
            Column {
                @Composable fun row(text: String, color: Color = c.foreground, onClick: () -> Unit) =
                    Text(text, fontSize = 15.sp, color = color, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { onDismiss(); onClick() }.padding(vertical = 12.dp))
                row(stringResource(R.string.view_filter), onClick = onFilter)
                if (canEdit) row(stringResource(R.string.view_rename), onClick = onRename)
                if (canEdit) row(stringResource(R.string.view_duplicate), onClick = onDuplicate)
                if (canEdit && onHide != null) row(stringResource(R.string.view_hide), onClick = onHide)
                if (canDelete) row(stringResource(R.string.view_delete), c.dangerText, onDelete)
            }
        },
        confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun TextPromptDialog(title: String, initial: String, confirm: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(onClick = { onConfirm(text.trim()) }, enabled = text.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun ConfirmDeleteViewDialog(name: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.view_delete)) },
        text = { Text(stringResource(R.string.view_delete_confirm, name)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(R.string.bulk_delete), color = Nx.colors.dangerText) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/**
 * Filter, sort and group in one sheet (iOS): Status, Priority, Assignee (Me / people), Due date and the select
 * fields; sort by manual order, due, priority, title, start; group by status, priority, assignee or a select field.
 * [canSave] false: applied on this screen only (the footnote says so); a web-made advanced filter is kept.
 */
@Composable
fun ViewFilterDialog(cfg: ViewConfig, lanes: List<Lane>, members: List<ProjectMemberRef>, fields: List<CustomFieldDef>, canSave: Boolean,
                     onDismiss: () -> Unit, onApply: (ViewConfig) -> Unit) {
    val c = Nx.colors
    var rules by remember { mutableStateOf(cfg.rules) }
    var sort by remember { mutableStateOf(cfg.sort.firstOrNull()) }
    var groupBy by remember { mutableStateOf(cfg.groupBy) }
    fun valuesOf(prop: String) = rules.firstOrNull { it.prop == prop && it.op == "any_of" }?.values.orEmpty()
    fun setValues(prop: String, vs: List<String>) {
        rules = rules.filterNot { it.prop == prop } + if (vs.isEmpty()) emptyList() else listOf(ViewRule("$prop-any", prop, "any_of", vs))
    }
    fun toggle(prop: String, v: String) { val cur = valuesOf(prop); setValues(prop, if (v in cur) cur - v else cur + v) }
    val dueOp = rules.firstOrNull { it.prop == "due" }?.op
    val selects = fields.filter { it.kind == "SELECT" || it.kind == "MULTI_SELECT" || it.kind == "STATUS" }
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.view_filter)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (cfg.advanced != null) Text(stringResource(R.string.filter_advanced), fontSize = 12.sp, color = c.warningFg,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(c.warningBg).padding(8.dp))
                Text(stringResource(R.string.filter_where), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                ChipGroup(stringResource(R.string.filter_status), StatusOptions.ordered(lanes).map { it.id to it.name }, valuesOf("section")) { toggle("section", it) }
                ChipGroup(stringResource(R.string.filter_priority), TaskEnums.PRIORITIES.map { it to priorityLabelPlain(it) }, valuesOf("priority")) { toggle("priority", it) }
                ChipGroup(stringResource(R.string.filter_assignee), listOf(ViewsLogic.ME to stringResource(R.string.filter_me)) +
                    members.map { it.uid to (it.user?.name ?: it.uid) }, valuesOf("assignee")) { toggle("assignee", it) }
                val dueOptions = listOf(null to stringResource(R.string.filter_any), "overdue" to stringResource(R.string.filter_overdue),
                    "today" to stringResource(R.string.filter_today), "this_week" to stringResource(R.string.filter_this_week), "empty" to stringResource(R.string.filter_no_date))
                ChipGroup(stringResource(R.string.filter_due), dueOptions.map { (it.first ?: "") to it.second }, listOf(dueOp ?: "")) { op ->
                    rules = rules.filterNot { it.prop == "due" } + if (op.isEmpty()) emptyList() else listOf(ViewRule("due-$op", "due", op, emptyList()))
                }
                selects.forEach { f -> ChipGroup(f.name, f.choices.map { it to it }, valuesOf("cf:${f.id}")) { toggle("cf:${f.id}", it) } }
                HorizontalDivider(color = c.border)
                Text(stringResource(R.string.filter_sort), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                val sorts = listOf("" to stringResource(R.string.filter_manual), "due" to stringResource(R.string.filter_due), "priority" to stringResource(R.string.filter_priority),
                    "title" to stringResource(R.string.pp_col_name), "start" to stringResource(R.string.td_start_date))
                ChipGroup(null, sorts, listOf(sort?.prop ?: "")) { p -> sort = if (p.isEmpty()) null else ViewSort(p, sort?.desc ?: false) }
                if (sort != null) Row(Modifier.clickable { sort = sort?.copy(desc = !(sort?.desc ?: false)) }, verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.Checkbox(sort?.desc == true, { d -> sort = sort?.copy(desc = d) }); Text(stringResource(R.string.filter_desc))
                }
                HorizontalDivider(color = c.border)
                Text(stringResource(R.string.filter_group), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                val groups = listOf("section" to stringResource(R.string.filter_status), "priority" to stringResource(R.string.filter_priority),
                    "assignee" to stringResource(R.string.filter_assignee)) + fields.filter { it.kind == "SELECT" || it.kind == "STATUS" }.map { "cf:${it.id}" to it.name }
                ChipGroup(null, groups, listOfNotNull(groupBy)) { groupBy = it }
                if (!canSave) Text(stringResource(R.string.filter_only_screen), fontSize = 12.sp, color = c.mutedFg)
            }
        },
        confirmButton = {
            TextButton(onClick = { onApply(cfg.copy(rules = rules, sort = listOfNotNull(sort), groupBy = groupBy)) }) {
                Text(stringResource(if (canSave) R.string.filter_save else R.string.filter_apply))
            }
        },
        dismissButton = {
            Row {
                if (rules.isNotEmpty()) TextButton(onClick = { rules = emptyList() }) { Text(stringResource(R.string.filter_clear)) }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
            }
        })
}

@Composable
private fun priorityLabelPlain(p: String) = priorityLabel(p)

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun ChipGroup(title: String?, options: List<Pair<String, String>>, picked: List<String>, onToggle: (String) -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (title != null) Text(title, fontSize = 12.sp, color = c.mutedFg)
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { (k, label) ->
                val on = k in picked
                Text(label, fontSize = 13.sp, color = if (on) c.background else c.foreground, maxLines = 1,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (on) c.onyx else c.card).border(1.dp, if (on) c.onyx else c.border, RoundedCornerShape(8.dp))
                        .clickable { onToggle(k) }.padding(horizontal = 10.dp, vertical = 7.dp))
            }
        }
    }
}

// endregion

/** A due date picked for one task (table cell) or for the selection. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun DuePickerDialog(initial: LocalDate?, onDismiss: () -> Unit, onPick: (LocalDate?) -> Unit) {
    val st = androidx.compose.material3.rememberDatePickerState(initialSelectedDateMillis = (initial ?: LocalDate.now()).atStartOfDay().toInstant(java.time.ZoneOffset.UTC).toEpochMilli())
    androidx.compose.material3.DatePickerDialog(onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onPick(st.selectedDateMillis?.let { java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneOffset.UTC).toLocalDate() }) }) { Text("OK") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } }) { androidx.compose.material3.DatePicker(st) }
}

