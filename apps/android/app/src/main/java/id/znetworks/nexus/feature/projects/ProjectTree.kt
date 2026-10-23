package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.DragIndicator
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx
import kotlin.math.roundToInt

/**
 * One drag on the Projects screen (FOLDERS-DND, 10 Oct 2026). It starts from a row's handle, so a long-press
 * stays the menu; drop targets are folder rows and the "No folder" strip, found by their place on screen.
 */
class TreeDrag {
    sealed interface Item { val name: String }
    data class ProjectItem(val project: Project) : Item { override val name get() = project.name }
    data class FolderItem(val folder: ProjectFolder) : Item { override val name get() = folder.name }

    var item by mutableStateOf<Item?>(null); private set
    var pos by mutableStateOf(Offset.Zero); private set
    /** Target key → bounds in root: "<scope>/f:<folderId>" or [ROOT]. */
    val targets = mutableStateMapOf<String, Rect>()
    var onDrop: (Item, String?) -> Unit = { _, _ -> }

    /** The key under the finger, while dragging. */
    val hovered: String? get() = if (item == null) null else targets.entries.firstOrNull { it.value.contains(pos) }?.key

    fun start(i: Item, at: Offset) { item = i; pos = at }
    fun move(by: Offset) { pos += by }
    fun cancel() { item = null }
    fun end() {
        val i = item ?: return
        val key = hovered
        item = null
        if (key != null) onDrop(i, folderOf(key))
    }

    companion object {
        const val ROOT = "root"
        fun key(scope: String, folderId: String) = "$scope/f:$folderId"
        /** null = take out of its folder / to the top level. */
        fun folderOf(key: String): String? = if (key == ROOT) null else key.substringAfter("/f:")
    }
}

/** Everything a row of the tree can do, so it passes down the levels as one value. */
class TreeActions(
    val tree: FolderTree,
    val s: ProjectsState,
    val drag: TreeDrag,
    val pinnedProjects: Set<String>,
    val openProject: (String) -> Unit,
    val openFolderView: (String) -> Unit,
    val openSettings: (String) -> Unit,
    val newProjectIn: (ProjectFolder) -> Unit,
    val newSubfolder: (ProjectFolder) -> Unit,
    val edit: (ProjectFolder) -> Unit,
    val delete: (ProjectFolder) -> Unit,
    val pickFolderPlace: (ProjectFolder) -> Unit,
    val pickProjectPlace: (Project) -> Unit,
    val removeFromFolder: (Project) -> Unit,
    val toggleFolderPin: (String) -> Unit,
    val toggleProjectPin: (Project) -> Unit,
    val toggleOpen: (String) -> Unit,
) {
    /** May the dragged item land on [key]? */
    fun accepts(key: String): Boolean {
        val target = TreeDrag.folderOf(key)
        return when (val i = drag.item) {
            is TreeDrag.ProjectItem -> tree.canMoveProject(i.project, target)
            is TreeDrag.FolderItem -> tree.canMoveFolder(i.folder.id, target)
            null -> false
        }
    }
}

/** Registers [key] as a drop target while this is on screen. */
private fun Modifier.dropTarget(drag: TreeDrag, key: String) = onGloballyPositioned { drag.targets[key] = it.boundsInRoot() }

@Composable
private fun ForgetOnLeave(drag: TreeDrag, key: String) = DisposableEffect(key) { onDispose { drag.targets.remove(key) } }

/** The grip that starts a drag (managers only); the row's long-press stays its menu. */
@Composable
internal fun DragHandle(drag: TreeDrag, item: TreeDrag.Item) {
    val c = Nx.colors
    val current by rememberUpdatedState(item)
    var origin by remember { mutableStateOf(Offset.Zero) }
    Box(
        Modifier.size(48.dp).onGloballyPositioned { origin = it.positionInRoot() }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { drag.start(current, origin + it) },
                    onDrag = { change, by -> change.consume(); drag.move(by) },
                    onDragEnd = { drag.end() },
                    onDragCancel = { drag.cancel() },
                )
            },
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Filled.DragIndicator, stringResource(R.string.tree_drag), tint = c.mutedFg, modifier = Modifier.size(20.dp)) }
}

/** What follows the finger: the name of what is being moved. */
@Composable
internal fun DragGhost(drag: TreeDrag, origin: Offset) {
    val c = Nx.colors
    val i = drag.item ?: return
    Row(
        Modifier.offset { IntOffset((drag.pos.x - origin.x + 12).roundToInt(), (drag.pos.y - origin.y - 20).roundToInt()) }
            .widthIn(max = 240.dp).clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.violet, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (i is TreeDrag.FolderItem) "📁" else "▦", fontSize = 13.sp, color = c.violetText)
        Spacer(Modifier.size(6.dp))
        Text(i.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A folder row and, when open, what is in it. [scope] keeps a pinned copy's drop target apart from the tree's. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun FolderNode(f: ProjectFolder, depth: Int, scope: String, a: TreeActions) {
    val c = Nx.colors
    val s = a.s
    // Staff don't see folders with no project anywhere under them (the web hides them too).
    if (!s.canManage && !a.tree.hasProjects(f.id)) return
    val open = f.id !in s.collapsed
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val key = TreeDrag.key(scope, f.id)
    ForgetOnLeave(a.drag, key)
    val lit = a.drag.hovered == key && a.accepts(key)
    val pinned = f.id in s.pinnedFolders
    Column(Modifier.padding(start = (depth * 12).dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box {
            FolderNamePriorityRow(f.name, LocalTextStyle.current.copy(fontWeight = FontWeight.Medium, color = c.foreground),
                modifier = Modifier.fillMaxWidth().dropTarget(a.drag, key).clip(RoundedCornerShape(14.dp))
                    .background(if (lit) c.accentBg else c.card)
                    .border(if (lit) 2.dp else 1.dp, if (lit) c.violet else c.border, RoundedCornerShape(14.dp))
                    // The whole row opens / closes the folder; long-press is its menu (FOLDERS-DND).
                    .combinedClickable(onClickLabel = stringResource(if (open) R.string.folder_collapse else R.string.folder_expand),
                        onLongClick = { menu = true }) { a.toggleOpen(f.id) }
                    .padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                leading = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (open) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                        Spacer(Modifier.size(6.dp))
                        IconTile(f.icon, "📁", size = 30)
                        Spacer(Modifier.size(10.dp))
                    }
                },
                controls = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // The count only while closed: open, what is inside shows itself.
                        if (!open) Text("${a.tree.count(f.id)}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg,
                            modifier = Modifier.background(c.muted, CircleShape).padding(horizontal = 8.dp, vertical = 2.dp))
                        // Every task due across this folder's projects. Its own action, set apart from the row (owner, 10 Oct).
                        Spacer(Modifier.size(10.dp))
                        IconButton(onClick = { a.openFolderView(f.id) }, modifier = Modifier.size(48.dp)) {
                            Box(Modifier.size(30.dp).clip(CircleShape).background(c.violet.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                                Icon(Icons.Filled.CalendarMonth, stringResource(R.string.fc_open), tint = c.violetText, modifier = Modifier.size(18.dp))
                            }
                        }
                        if (s.canManage) DragHandle(a.drag, TreeDrag.FolderItem(f))
                        IconButton(onClick = { menu = true }, modifier = Modifier.size(48.dp)) { Icon(Icons.Filled.MoreHoriz, stringResource(R.string.more), tint = c.mutedFg) }
                    }
                },
            )
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.fm_open_view)) }, onClick = { menu = false; a.openFolderView(f.id) })
                DropdownMenuItem(text = { Text(stringResource(R.string.fm_new_project)) }, onClick = { menu = false; a.newProjectIn(f) })
                if (s.canManage && a.tree.canHaveSubfolder(f.id))
                    DropdownMenuItem(text = { Text(stringResource(R.string.fm_new_sub)) }, onClick = { menu = false; a.newSubfolder(f) })
                if (s.canManage) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.fm_edit)) }, onClick = { menu = false; a.edit(f) })
                    DropdownMenuItem(text = { Text(stringResource(R.string.fm_move)) }, onClick = { menu = false; a.pickFolderPlace(f) })
                }
                DropdownMenuItem(text = { Text(stringResource(if (pinned) R.string.fm_unpin else R.string.fm_pin)) }, onClick = { menu = false; a.toggleFolderPin(f.id) })
                if (s.canManage) {
                    HorizontalDivider()
                    DropdownMenuItem(text = { Text(stringResource(R.string.fm_delete), color = c.danger) }, onClick = { menu = false; confirmDelete = true })
                }
            }
        }
        if (open) {
            a.tree.children(f.id).forEach { FolderNode(it, depth + 1, scope, a) }
            a.tree.projectsIn(f.id).forEach { ProjectRow(it, a) }
            if (s.canManage && a.tree.children(f.id).isEmpty() && a.tree.projectsIn(f.id).isEmpty())
                Text(stringResource(R.string.tree_empty_drag), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(start = 8.dp))
        }
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text(stringResource(R.string.folder_delete_q, f.name)) },
        text = { Text(stringResource(R.string.folder_delete_body)) },
        confirmButton = { TextButton(onClick = { confirmDelete = false; a.delete(f) }) { Text(stringResource(R.string.folder_delete), color = c.danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
    )
}

/** A project card: tap opens, long-press is the menu, the grip drags it (managers). */
@Composable
internal fun ProjectRow(p: Project, a: TreeActions) {
    val c = Nx.colors
    var menu by remember { mutableStateOf(false) }
    val pinned = p.id in a.pinnedProjects
    val inFolder = p.folderId != null && a.s.folders.any { it.id == p.folderId }
    Box {
        ProjectCard(p, a.s.tallies?.get(p.id), a.s.tallies != null, onClick = { a.openProject(p.id) }, onLongClick = { menu = true },
            trailing = if (a.s.canManage) ({ DragHandle(a.drag, TreeDrag.ProjectItem(p)) }) else null)
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.pm_open)) }, onClick = { menu = false; a.openProject(p.id) })
            DropdownMenuItem(text = { Text(stringResource(if (pinned) R.string.fm_unpin else R.string.fm_pin)) }, onClick = { menu = false; a.toggleProjectPin(p) })
            if (a.s.canManage) {
                DropdownMenuItem(text = { Text(stringResource(R.string.pm_move)) }, onClick = { menu = false; a.pickProjectPlace(p) })
                if (inFolder) DropdownMenuItem(text = { Text(stringResource(R.string.pm_remove)) }, onClick = { menu = false; a.removeFromFolder(p) })
            }
            DropdownMenuItem(text = { Text(stringResource(R.string.pm_settings)) }, onClick = { menu = false; a.openSettings(p.id) })
        }
    }
}

/** "No folder": the projects without one, and (for managers) the strip a project or folder is dropped on to come out. */
@Composable
internal fun NoFolderStrip(a: TreeActions) {
    val c = Nx.colors
    val key = TreeDrag.ROOT
    ForgetOnLeave(a.drag, key)
    val lit = a.drag.hovered == key && a.accepts(key)
    val dragging = a.drag.item != null
    Row(
        Modifier.fillMaxWidth().dropTarget(a.drag, key).clip(RoundedCornerShape(14.dp))
            .background(if (lit) c.accentBg else c.muted.copy(alpha = 0.4f))
            .drawBehind {
                drawRoundRect(if (lit || dragging) c.violet else c.border, cornerRadius = androidx.compose.ui.geometry.CornerRadius(14.dp.toPx()),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(if (lit) 2.dp.toPx() else 1.dp.toPx(),
                        pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 5.dp.toPx()))))
            }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { Text(stringResource(R.string.tree_drop_out), fontSize = 12.sp, color = if (lit) c.violetText else c.mutedFg) }
}

/** "Move to…": the top level / no folder, then every place the rules allow, by path. A centred dialog. */
@Composable
internal fun MovePlaceDialog(title: String, current: String?, topLabel: String, showTop: Boolean, places: List<ProjectFolder>, tree: FolderTree,
                             onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    val c = Nx.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                if (showTop) item { PlaceRow(topLabel, false) { onPick(null) } }
                items(places, key = { it.id }) { f -> PlaceRow(tree.path(f.id), f.id == current) { onPick(f.id) } }
                if (!showTop && places.isEmpty()) item { Text(stringResource(R.string.tree_rule), fontSize = 13.sp, color = c.mutedFg) }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun PlaceRow(label: String, current: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(enabled = !current, onClick = onClick).padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("📁", fontSize = 14.sp); Spacer(Modifier.size(8.dp))
        Text(label, fontSize = 14.sp, color = if (current) c.mutedFg else c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

