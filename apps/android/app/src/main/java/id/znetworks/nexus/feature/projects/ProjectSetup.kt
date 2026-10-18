package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.theme.Nx

// New project setup + multi-add members (owner, 11 Oct; PROJECT-SETUP-MEMBERS, server eecca18).

/**
 * What New project sends besides name/folder/type: null = key left out. [template] (DEV-REDESIGN §1) is built
 * in [lang], with its starter pages and tasks when [starter].
 */
data class ProjectSetup(
    val hiddenTabs: List<String>? = null, val memberIds: List<String>? = null,
    val template: ProjectTemplate? = null, val lang: String = "id", val starter: Boolean = true,
    /** The level the picked members get (13 Oct); sent only with members. */
    val memberLevel: AccessLevel = AccessLevel.EDIT,
)

object ProjectSetupLogic {
    /** The tabs a new Task Project can start without: the ones Project settings › Tabs offers (web-only "table" left out). */
    val TABS: List<ProjectTab> get() = ProjectTab.entries.filter { ProjectTabsLogic.key(it) != null }

    /** A new Task Project starts with Automations off (SPRINTS-OVERVIEW §2, 11 Oct). */
    val DEFAULT_HIDDEN = setOf("automations")

    /**
     * `hiddenTabs` for POST /api/projects, in tab-bar order — always sent for a Task Project, an empty list too, so
     * switching Automations back on is not undone by the server's own default (which applies when the key is missing).
     */
    fun hiddenToSend(hidden: Set<String>): List<String> = ProjectTabsLogic.KEYS.filter { it in hidden }

    /** `memberIds`: the creator is the LEAD already (the server drops them too); null when nobody is picked. */
    fun membersToSend(picked: Set<String>, meId: String?): List<String>? = picked.filter { it != meId }.sorted().takeIf { it.isNotEmpty() }

    fun id(m: RosterMember): String? = m.userId ?: m.id

    /** Search by name or e-mail; sorted by name. */
    fun filter(candidates: List<RosterMember>, q: String): List<RosterMember> =
        candidates.sortedBy { (it.name ?: it.email).orEmpty().lowercase() }
            .filter { m -> q.isBlank() || listOfNotNull(m.name, m.email).any { it.contains(q.trim(), ignoreCase = true) } }
}

/** Task Project only: which tabs it starts with — preview cards ([TabPreviewCards]), all on but Automations by default, Board or List stays on. */
@Composable
fun StartingTabs(hidden: Set<String>, enabled: Boolean, onChange: (Set<String>) -> Unit) {
    val c = Nx.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.setup_tabs), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        Text(stringResource(R.string.setup_tabs_sub), fontSize = 11.sp, color = c.mutedFg)
        TabPreviewCards(hidden, enabled, onChange)
    }
}

/** Picked people as chips (× takes one out) and the button that opens the picker. */
@Composable
fun StartingMembers(picked: Set<String>, roster: List<RosterMember>, enabled: Boolean, onEdit: () -> Unit, onRemove: (String) -> Unit) {
    val c = Nx.colors
    val byId = roster.associateBy { ProjectSetupLogic.id(it) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.setup_members), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
            TextButton(onClick = onEdit, enabled = enabled) {
                Icon(Icons.Filled.PersonAdd, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
                Text(stringResource(if (picked.isEmpty()) R.string.setup_add_members else R.string.setup_edit_members))
            }
        }
        if (picked.isEmpty()) Text(stringResource(R.string.setup_members_sub), fontSize = 11.sp, color = c.mutedFg)
        else Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            picked.sortedBy { (byId[it]?.name ?: byId[it]?.email).orEmpty().lowercase() }.forEach { uid ->
                val m = byId[uid]
                PersonChip(m?.name ?: m?.email ?: "—", m?.avatar, enabled, uid) { onRemove(uid) }
            }
        }
    }
}

@Composable
private fun PersonChip(name: String, avatar: String?, enabled: Boolean, userId: String, onRemove: () -> Unit) {
    InputChip(selected = false, onClick = onRemove, enabled = enabled, label = { Text(name, fontSize = 12.sp, maxLines = 1) },
        avatar = { Avatar(name, avatar, 20.dp, userId = userId) },
        trailingIcon = { Icon(Icons.Filled.Close, stringResource(R.string.setup_remove_person, name), Modifier.size(14.dp)) })
}

/**
 * Full-screen people picker (search, checkbox rows with avatars, the picked ones as chips on top, one confirm
 * button): Add people in Project settings and the members of a new project share it.
 */
@Composable
fun PeoplePickerDialog(
    candidates: List<RosterMember>, initial: Set<String>, title: String, confirmText: (Int) -> String,
    emptyTitle: String, emptyHint: String, busy: Boolean = false, error: String? = null, allowNone: Boolean = false,
    onDismiss: () -> Unit, onConfirm: (Set<String>) -> Unit,
) {
    val c = Nx.colors
    var q by rememberSaveable { mutableStateOf("") }
    var picked by remember { mutableStateOf(initial) }
    val results = ProjectSetupLogic.filter(candidates, q)
    val byId = candidates.associateBy { ProjectSetupLogic.id(it) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                TextButton(onClick = { onConfirm(picked) }, enabled = (allowNone || picked.isNotEmpty()) && !busy) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Text(confirmText(picked.size), fontWeight = FontWeight.Bold)
                }
            }
            OutlinedTextField(q, { q = it }, singleLine = true, leadingIcon = { Icon(Icons.Filled.Search, null) },
                placeholder = { Text(stringResource(R.string.ps_search_name_email)) }, shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(focus))
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (picked.isEmpty()) stringResource(R.string.ps_pick_people) else stringResource(R.string.ps_n_selected, picked.size),
                    fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                if (picked.isNotEmpty()) TextButton(onClick = { picked = emptySet() }) { Text(stringResource(R.string.ps_clear)) }
            }
            if (picked.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                picked.forEach { uid -> val m = byId[uid]; PersonChip(m?.name ?: m?.email ?: "—", m?.avatar, !busy, uid) { picked = picked - uid } }
            }
            error?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
            when {
                candidates.isEmpty() -> PickerNote(emptyTitle, emptyHint)
                results.isEmpty() -> PickerNote(stringResource(R.string.ps_no_match), stringResource(R.string.ps_no_match_hint))
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                    items(results, key = { it.userId ?: it.id ?: it.email.orEmpty() }) { m ->
                        val uid = ProjectSetupLogic.id(m) ?: return@items
                        val on = uid in picked
                        Row(Modifier.fillMaxWidth().clickable { picked = if (on) picked - uid else picked + uid }.padding(horizontal = 16.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.name ?: m.email, m.avatar, 32.dp, userId = m.userId ?: m.id); Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(m.name ?: m.email ?: "—", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                                m.email?.takeIf { it != m.name }?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1) }
                            }
                            m.role?.takeIf { it.isNotBlank() }?.let { r ->
                                Text(r.lowercase().replaceFirstChar(Char::titlecase).replace('_', ' '), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                                    modifier = Modifier.background(c.muted, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                                Spacer(Modifier.width(8.dp))
                            }
                            Checkbox(on, { picked = if (on) picked - uid else picked + uid })
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerNote(title: String, hint: String) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, textAlign = TextAlign.Center)
        Text(hint, fontSize = 13.sp, color = c.mutedFg, textAlign = TextAlign.Center)
    }
}
