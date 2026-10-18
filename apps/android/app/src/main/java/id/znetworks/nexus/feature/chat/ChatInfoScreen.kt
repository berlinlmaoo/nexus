package id.znetworks.nexus.feature.chat

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PermMedia
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.tasks.sizeText
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.realtime.LiveRefresh
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.projects.RosterMember
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.LeftPill
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

/**
 * A chat's info, like WhatsApp's (owner, 8 Oct; SYSTEM-MESSAGES part 2, iOS ChatInfoView): who is in it,
 * its media, search, mute, and — in a GROUP — editing, adding, removing and leaving. Opened from the
 * thread's header. An older server without /info shows what the conversation list knows.
 */
@Composable
fun ChatInfoScreen(id: String, onBack: () -> Unit, onOpenChat: (String) -> Unit, onOpenProfile: (String) -> Unit, onOpenProject: (String) -> Unit,
                   onOpenMedia: () -> Unit, onOpenSearch: () -> Unit, onLeft: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { ChatApi(container.api) }
    val meId = container.sessionStore.current?.userId
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<ChatInfo?>(null) }
    var legacy by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var roster by remember { mutableStateOf<List<RosterMember>?>(null) }
    var muteMenu by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf<ChatInfoMember?>(null) }
    var confirmRemove by remember { mutableStateOf<ChatInfoMember?>(null) }
    var confirmExit by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    /** Exit was just refused with LAST_MEMBER: show the only-member state even if the list said otherwise. */
    var lastMember by remember { mutableStateOf(false) }
    /** The server has no DELETE yet (405 / no route): the row goes, a note says why. */
    var deleteUnsupported by remember { mutableStateOf(false) }

    suspend fun load() {
        try { info = api.info(id); legacy = false; loadError = null }
        catch (e: ApiError) {
            if (ChatInfoLogic.missingRoute(e)) {
                legacy = true
                val conv = runCatching { api.conversations().value.conversations.firstOrNull { it.id == id } }.getOrNull()
                if (conv != null) info = ChatInfoLogic.legacy(conv, meId) else if (info == null) loadError = res.getString(R.string.ci_err_info)
            } else if (info == null) loadError = res.getString(ChatInfoLogic.errorRes(e, R.string.ci_err_info))
        }
    }
    /** Something changed here: reload, and tell the thread and the list so the new log line shows at once. */
    suspend fun changed() { container.chatEvents.tryEmit(id); load() }
    fun act(generic: Int, block: suspend () -> Unit) = scope.launch {
        busy = true; notice = null
        try { block() } catch (e: ApiError) { notice = res.getString(ChatInfoLogic.errorRes(e, generic)) }
        busy = false
    }
    LaunchedEffect(id) { load() }
    LiveRefresh(id, liveMs = null, fallbackMs = null, matches = { it.name == RealtimeEvents.CONVERSATION_UPDATED && it.conversationId == id }) { load() }

    val x = info
    val conv = x?.conversation
    val isGroup = conv?.type == "GROUP"
    val isDm = conv?.type == "DM"
    val other = x?.members?.firstOrNull { !it.isMe }
    val title = when { isDm -> other?.name; else -> conv?.name } ?: ""

    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(if (isDm) R.string.ci_contact_info else R.string.ci_group_info), fontFamily = DisplayFont, fontWeight = FontWeight.Bold,
                fontSize = 17.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (busy) CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp)
            if (conv?.canEdit == true) IconButton(onClick = { editing = true }) { Icon(Icons.Filled.Edit, stringResource(R.string.ci_edit)) }
        }
        when {
            x == null && loadError == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            x == null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { Text(loadError!!, color = c.mutedFg, textAlign = TextAlign.Center) }
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                val cv = x.conversation
                // Header: the picture (DM: the person), name, kind and member count, description.
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (isDm) Avatar(other?.name, other?.avatar, 88.dp)
                    else Box(Modifier.size(88.dp).background(c.violet.copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) {
                        Icon(if (cv.type == "PROJECT") Icons.Filled.ViewKanban else Icons.Filled.Groups, null, tint = c.violetText, modifier = Modifier.size(40.dp))
                    }
                    Spacer(Modifier.size(4.dp))
                    Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground, textAlign = TextAlign.Center)
                    if (!isDm) Text(pluralStringResource(if (cv.type == "PROJECT") R.plurals.ci_project_members else R.plurals.ci_group_members, cv.memberCount, cv.memberCount),
                        fontSize = 13.sp, color = c.mutedFg)
                    if (!cv.description.isNullOrBlank()) Text(cv.description, fontSize = 14.sp, color = c.foreground, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                    else if (cv.canEdit && !legacy) TextButton(onClick = { editing = true }) { Text(stringResource(R.string.ci_add_desc), color = c.violetText) }
                }
                // Actions: Add (Manager+ in a group), Search, Mute.
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (isGroup && cv.canManageMembers) ActionTile(Icons.Filled.PersonAdd, stringResource(R.string.chat_add_people), Modifier.weight(1f)) {
                        adding = true; scope.launch { roster = runCatching { ProjectsApi(container.api).roster().members }.getOrDefault(emptyList()) }
                    }
                    if (!legacy) ActionTile(Icons.Filled.Search, stringResource(R.string.ci_search), Modifier.weight(1f), onClick = onOpenSearch)
                    Box(Modifier.weight(1f)) {
                        val muted = cv.mutedUntil != null
                        ActionTile(if (muted) Icons.Filled.NotificationsOff else Icons.Filled.Notifications,
                            stringResource(if (muted) R.string.chat_muted else R.string.ci_mute), Modifier.fillMaxWidth()) { muteMenu = true }
                        DropdownMenu(muteMenu, { muteMenu = false }) {
                            fun setMute(m: ChatThreadViewModel.Mute) { muteMenu = false; act(R.string.ci_err_save) { api.mute(id, ChatMute.until(m)); container.badges.refresh(); changed() } }
                            if (muted) DropdownMenuItem(text = { Text(stringResource(R.string.chat_unmute)) }, onClick = { setMute(ChatThreadViewModel.Mute.OFF) })
                            else listOf(ChatThreadViewModel.Mute.HOURS_8 to R.string.chat_mute_8h, ChatThreadViewModel.Mute.WEEK to R.string.chat_mute_week,
                                ChatThreadViewModel.Mute.ALWAYS to R.string.chat_mute_always).forEach { (m, l) -> DropdownMenuItem(text = { Text(stringResource(l)) }, onClick = { setMute(m) }) }
                        }
                    }
                }
                ChatMute.untilText(cv.mutedUntil)?.let { Text(stringResource(R.string.ci_muted_until, it), fontSize = 12.sp, color = c.mutedFg) }
                notice?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText) }
                // Media, links and docs.
                if (!legacy) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp))
                    .clickable(onClick = onOpenMedia).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.PermMedia, null, tint = c.violetText); Spacer(Modifier.width(10.dp))
                    Text(stringResource(R.string.ci_media), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                    Text("${x.counts.total}", fontSize = 13.sp, color = c.mutedFg); Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = c.mutedFg)
                }
                if (legacy) Text(stringResource(R.string.ci_legacy), fontSize = 12.sp, color = c.mutedFg)
                // A project room's people follow the project.
                if (cv.type == "PROJECT") Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.ci_follow_project), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    Text(stringResource(R.string.ci_follow_project_sub), fontSize = 12.sp, color = c.mutedFg)
                    cv.projectId?.let { pid -> TextButton(onClick = { onOpenProject(pid) }) { Text(stringResource(R.string.au_open_project), color = c.violetText) } }
                }
                // Members (not in a DM).
                if (!isDm) {
                    Text(pluralStringResource(R.plurals.ci_members, x.members.size, x.members.size), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp))) {
                        ChatInfoLogic.ordered(x.members).forEachIndexed { i, m ->
                            if (i > 0) HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 60.dp))
                            Row(Modifier.fillMaxWidth().clickable(enabled = !m.isMe) { picked = m }.heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Avatar(m.name, m.avatar, 36.dp); Spacer(Modifier.width(12.dp))
                                Text(if (m.isMe) stringResource(R.string.chat_you) else m.name ?: "—", fontSize = 14.sp, color = c.foreground,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                if (m.deactivatedAt != null) LeftPill(Modifier.padding(start = 6.dp))
                                if (m.isAdmin) Text(stringResource(R.string.ci_admin), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.success,
                                    modifier = Modifier.padding(start = 6.dp).background(c.success.copy(alpha = 0.12f), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                            }
                        }
                    }
                }
                // Leave (a GROUP only; a project room follows the project, a DM has nothing to leave). Alone in it:
                // no Exit, a muted line instead (DELETE-GROUP).
                val alone = isGroup && (lastMember || ChatInfoLogic.onlyMember(x))
                if (isGroup && !alone) DangerRow(Icons.AutoMirrored.Filled.ExitToApp, stringResource(R.string.ci_exit), !busy) { confirmExit = true }
                if (alone) Text(stringResource(R.string.dg_alone), fontSize = 12.sp, color = c.mutedFg)
                if (isGroup && cv.canDelete && !deleteUnsupported) DangerRow(Icons.Filled.Delete, stringResource(R.string.dg_delete), !busy) { confirmDelete = true }
                if (deleteUnsupported) Text(stringResource(R.string.dg_unsupported), fontSize = 12.sp, color = c.mutedFg)
            }
        }
    }

    val cv = x?.conversation
    if (editing && cv != null) EditDetailsDialog(cv, legacy, onDismiss = { editing = false }) { name, description ->
        editing = false
        act(R.string.ci_err_save) {
            if (legacy) { if (name != null) api.rename(id, name) }
            else api.updateDetails(id, name, description)
            changed()
        }
    }
    if (adding && cv != null) AddPeopleDialog(Conversation(id, cv.type, cv.name, cv.projectId, members = x.members.map { ChatMember(userId = it.userId, user = ChatUser(it.userId, it.name)) }),
        roster, meId, onDismiss = { adding = false }) { ids -> adding = false; act(R.string.ci_err_members) { api.addMembers(id, ids); changed() } }
    picked?.let { m ->
        AlertDialog(onDismissRequest = { picked = null }, title = { Text(m.name ?: "—") },
            text = {
                Column {
                    TextButton(onClick = { picked = null; act(R.string.ci_err_dm) { onOpenChat(api.create("DM", listOf(m.userId), null).id) } }) { Text(stringResource(R.string.ci_message)) }
                    TextButton(onClick = { picked = null; onOpenProfile(m.userId) }) { Text(stringResource(R.string.ci_view_profile)) }
                    if (x != null && ChatInfoLogic.canRemove(x, m)) TextButton(onClick = { picked = null; confirmRemove = m }) { Text(stringResource(R.string.ci_remove), color = c.dangerText) }
                }
            }, confirmButton = {}, dismissButton = { TextButton(onClick = { picked = null }) { Text(stringResource(R.string.cancel)) } })
    }
    confirmRemove?.let { m ->
        AlertDialog(onDismissRequest = { confirmRemove = null }, title = { Text(stringResource(R.string.ci_remove_q, m.name ?: "—", cv?.name ?: "")) },
            text = { Text(stringResource(R.string.ci_remove_body)) },
            confirmButton = { TextButton(onClick = { confirmRemove = null; act(R.string.ci_err_members) { api.removeMember(id, m.userId); changed() } }) { Text(stringResource(R.string.ci_remove), color = c.dangerText) } },
            dismissButton = { TextButton(onClick = { confirmRemove = null }) { Text(stringResource(R.string.cancel)) } })
    }
    if (confirmExit) AlertDialog(onDismissRequest = { confirmExit = false }, title = { Text(stringResource(R.string.ci_exit_q, cv?.name ?: "")) },
        text = { Text(stringResource(R.string.ci_exit_body)) },
        confirmButton = { TextButton(onClick = {
            confirmExit = false
            scope.launch {
                busy = true; notice = null
                try { api.removeMember(id, meId ?: return@launch); container.chatEvents.tryEmit(null); container.badges.refresh(); onLeft() }
                catch (e: ApiError) {
                    // The last one in: not an error, the screen switches to "delete it instead".
                    if (ChatInfoLogic.lastMember(e)) lastMember = true else notice = res.getString(ChatInfoLogic.errorRes(e, R.string.ci_err_leave))
                }
                busy = false
            }
        }) { Text(stringResource(R.string.ci_exit), color = c.dangerText) } },
        dismissButton = { TextButton(onClick = { confirmExit = false }) { Text(stringResource(R.string.cancel)) } })
    // A centred dialog, not a bottom sheet (DELETE-GROUP).
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text(stringResource(R.string.dg_delete_q, cv?.name ?: "")) },
        text = { Text(stringResource(R.string.dg_delete_body)) },
        confirmButton = { TextButton(onClick = {
            confirmDelete = false
            scope.launch {
                busy = true; notice = null
                val outcome = try { api.deleteGroup(id); ChatInfoLogic.DeleteOutcome.GONE } catch (e: ApiError) { ChatInfoLogic.deleteOutcome(e) }
                busy = false
                when (outcome) {
                    // Gone (or already gone): back past the thread to the list, exactly like Exit.
                    ChatInfoLogic.DeleteOutcome.GONE -> { container.chatEvents.tryEmit(null); container.badges.refresh(); onLeft() }
                    ChatInfoLogic.DeleteOutcome.NOT_ALLOWED -> { notice = res.getString(R.string.dg_err_manager); load() }
                    ChatInfoLogic.DeleteOutcome.NOT_A_GROUP -> notice = res.getString(R.string.dg_err_not_group)
                    ChatInfoLogic.DeleteOutcome.UNSUPPORTED -> deleteUnsupported = true
                    ChatInfoLogic.DeleteOutcome.FAILED -> notice = res.getString(R.string.dg_err_failed)
                }
            }
        }) { Text(stringResource(R.string.dg_delete), color = c.dangerText, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } })
}

@Composable
private fun DangerRow(icon: ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp))
        .clickable(enabled = enabled, onClick = onClick).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = c.dangerText); Spacer(Modifier.width(10.dp))
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
    }
}

@Composable
private fun ActionTile(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    val c = Nx.colors
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp)).clickable(onClick = onClick)
        .heightIn(min = 64.dp).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Icon(icon, null, tint = c.violetText)
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Name (≤ 80) and description (≤ 500, empty clears it); an older server takes only the name. */
@Composable
private fun EditDetailsDialog(cv: ChatInfoConversation, legacy: Boolean, onDismiss: () -> Unit, onSave: (name: String?, description: String?) -> Unit) {
    var name by rememberSaveable { mutableStateOf(cv.name.orEmpty()) }
    var description by rememberSaveable { mutableStateOf(cv.description.orEmpty()) }
    val nameOk = name.trim().isNotEmpty() && name.trim().length <= ChatInfoLogic.NAME_MAX
    val descOk = description.trim().length <= ChatInfoLogic.DESCRIPTION_MAX
    AlertDialog(onDismissRequest = onDismiss, title = { Text(stringResource(R.string.ci_edit)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, singleLine = true, label = { Text(stringResource(R.string.ci_name)) }, isError = !nameOk,
                    supportingText = { if (name.trim().length > ChatInfoLogic.NAME_MAX) Text(stringResource(R.string.ci_err_name_len)) }, modifier = Modifier.fillMaxWidth())
                if (!legacy) OutlinedTextField(description, { description = it }, minLines = 2, maxLines = 5, label = { Text(stringResource(R.string.ci_description)) }, isError = !descOk,
                    supportingText = { Text(if (descOk) "${description.trim().length}/${ChatInfoLogic.DESCRIPTION_MAX}" else stringResource(R.string.ci_err_desc_len)) },
                    modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = { TextButton(onClick = {
            val newName = name.trim().takeIf { it != cv.name.orEmpty().trim() }
            onSave(newName, description.trim())
        }, enabled = nameOk && descOk) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/** Media, links and docs: three tabs, paged by the server's cursor. */
@Composable
fun ChatMediaScreen(id: String, onBack: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { ChatApi(container.api) }
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf(0) }
    val type = listOf("photos", "links", "docs")[tab]
    var items by remember(type) { mutableStateOf<List<ChatMediaItem>?>(null) }
    var cursor by remember(type) { mutableStateOf<String?>(null) }
    var error by remember(type) { mutableStateOf<String?>(null) }
    var more by remember(type) { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<String?>(null) }
    fun page(reset: Boolean) = scope.launch {
        more = true
        try { val p = api.media(id, type, if (reset) null else cursor); items = (if (reset) emptyList() else items.orEmpty()) + p.items; cursor = p.nextCursor; error = null }
        catch (e: ApiError) { if (items == null) error = res.getString(if (ChatInfoLogic.missingRoute(e)) R.string.ci_legacy else R.string.ci_err_media) }
        more = false
    }
    LaunchedEffect(type) { page(true) }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.ci_media), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.foreground)
        }
        PrimaryTabRow(selectedTabIndex = tab, containerColor = c.background) {
            listOf(R.string.ci_photos, R.string.ci_links, R.string.ci_docs).forEachIndexed { i, l -> Tab(tab == i, { tab = i }, text = { Text(stringResource(l)) }) }
        }
        val list = items
        val (emptyTitle, emptySub) = when (type) { "photos" -> R.string.ci_no_photos to R.string.ci_no_photos_sub; "links" -> R.string.ci_no_links to R.string.ci_no_links_sub; else -> R.string.ci_no_docs to R.string.ci_no_docs_sub }
        when {
            list == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            list == null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) { Text(error!!, color = c.mutedFg, textAlign = TextAlign.Center) }
            list.isEmpty() -> Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text(stringResource(emptyTitle), fontWeight = FontWeight.Bold, color = c.foreground)
                Text(stringResource(emptySub), fontSize = 13.sp, color = c.mutedFg, textAlign = TextAlign.Center)
            }
            type == "photos" -> LazyVerticalGrid(GridCells.Adaptive(110.dp), Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(list, key = { (it.messageId ?: "") + it.url }) { m ->
                    ChatPhoto(m.url, Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(6.dp)), ContentScale.Crop, maxPx = 400) { viewing = m.url }
                }
                if (cursor != null) item { TextButton(onClick = { page(false) }, enabled = !more) { Text(stringResource(R.string.ci_load_more)) } }
            }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(list, key = { (it.messageId ?: "") + it.url }) { m ->
                    Row(Modifier.fillMaxWidth().clickable {
                        val url = m.url ?: return@clickable
                        if (type == "links") runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                        else scope.launch { runCatching { FileOpener.open(context, container.api, url, m.name ?: m.title ?: url.substringAfterLast('/'), m.attachmentType) } }
                    }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (type == "links") Icons.Filled.Link else Icons.Filled.Description, null, tint = c.violetText); Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(m.name ?: m.title ?: m.url?.substringAfterLast('/') ?: "—", fontSize = 14.sp, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (m.size != null) Text(sizeText(m.size), fontSize = 11.sp, color = c.mutedFg)
                            Text(listOfNotNull(m.sender?.name, chatTime(m.createdAt).takeIf { it.isNotEmpty() }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                        }
                    }
                    HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 52.dp))
                }
                if (cursor != null) item { TextButton(onClick = { page(false) }, enabled = !more, modifier = Modifier.padding(8.dp)) { Text(stringResource(R.string.ci_load_more)) } }
            }
        }
    }
    viewing?.let { url ->
        androidx.compose.ui.window.Dialog(onDismissRequest = { viewing = null }, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black).clickable { viewing = null }, contentAlignment = Alignment.Center) {
                ChatPhoto(url, Modifier.fillMaxWidth(), ContentScale.Fit, maxPx = 2048)
            }
        }
    }
}

/** Search this chat (≥ 2 characters, ≤ 100); a result opens the thread on that message (around=). */
@Composable
fun ChatSearchScreen(id: String, onBack: () -> Unit, onOpenMessage: (String) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val api = remember { ChatApi((context.applicationContext as NexusApplication).container.api) }
    val scope = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<ChatSearchHit>?>(null) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val query = q.trim()
    fun run(reset: Boolean) = scope.launch {
        loading = true
        try { val p = api.search(id, query, if (reset) null else cursor); hits = (if (reset) emptyList() else hits.orEmpty()) + p.results; cursor = p.nextCursor; error = null }
        catch (e: ApiError) { error = res.getString(if (ChatInfoLogic.missingRoute(e)) R.string.ci_legacy else R.string.ci_err_search) }
        loading = false
    }
    LaunchedEffect(query) {
        if (query.length < ChatInfoLogic.QUERY_MIN || query.length > ChatInfoLogic.QUERY_MAX) { hits = null; return@LaunchedEffect }
        kotlinx.coroutines.delay(350); run(true)
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text(stringResource(R.string.ci_search_hint)) }, leadingIcon = { Icon(Icons.Filled.Search, null) },
                isError = query.length > ChatInfoLogic.QUERY_MAX, shape = RoundedCornerShape(12.dp), modifier = Modifier.weight(1f).padding(end = 8.dp))
        }
        if (query.length > ChatInfoLogic.QUERY_MAX) Text(stringResource(R.string.ci_err_q_len), fontSize = 12.sp, color = c.dangerText, modifier = Modifier.padding(horizontal = 16.dp))
        error?.let { Text(it, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(16.dp)) }
        if (loading && hits == null) Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        val list = hits
        if (list != null && list.isEmpty() && error == null) Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.ci_no_results), fontWeight = FontWeight.Bold, color = c.foreground)
            Text(stringResource(R.string.ci_no_results_sub, query), fontSize = 13.sp, color = c.mutedFg, textAlign = TextAlign.Center)
        }
        if (!list.isNullOrEmpty()) LazyColumn(Modifier.fillMaxSize()) {
            items(list, key = { it.messageId }) { h ->
                Column(Modifier.fillMaxWidth().clickable { onOpenMessage(h.messageId) }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Row { Text(h.sender?.name ?: "—", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f)); Text(chatTime(h.createdAt), fontSize = 11.sp, color = c.mutedFg) }
                    Text(h.snippet.orEmpty(), fontSize = 13.sp, color = c.mutedFg, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                HorizontalDivider(color = c.border.copy(alpha = 0.5f), modifier = Modifier.padding(start = 16.dp))
            }
            if (cursor != null) item { TextButton(onClick = { run(false) }, enabled = !loading, modifier = Modifier.padding(8.dp)) { Text(stringResource(R.string.ci_load_more)) } }
        }
    }
}
