package id.znetworks.nexus.feature.legal

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.ConfirmDialog
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.PageHeader
import id.znetworks.nexus.ui.components.PendingConfirm
import id.znetworks.nexus.ui.components.CompactSearchField
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Who has Legal (owner, 14 Oct 2026; web LegalMembers, iOS LegalMembersView): the owner always; BoD members he invites
// may invite staff; invited staff may not invite. Removing someone keeps their row (and who invited them) for the
// record, behind "Show removed people".

@Composable
fun LegalMembersPane(nav: LegalNav) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<LgMembers?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showFormer by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<PendingConfirm?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    LaunchedEffect(tick) {
        loading = true
        try { data = api.members(); error = null } catch (e: ApiError) { if (data == null) error = legalMessage(ctx, e) else LegalToasts.failure(ctx, e) }
        loading = false
    }
    // Back from the Invite screen: the new people show.
    OnResume { tick++ }
    val power = data?.invitePower ?: "NONE"
    val active = data?.members.orEmpty().filter { it.active }
    val former = data?.members.orEmpty().filterNot { it.active }
    PullToRefreshBox(loading && data != null, { tick++ }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                LgSectionHeader(stringResource(R.string.lg_members_title), stringResource(when (power) {
                    "ANY" -> R.string.lg_power_any
                    "STAFF" -> R.string.lg_power_staff
                    else -> R.string.lg_power_none
                })) {
                    if (LegalLogic.canInvite(power)) NxButton(stringResource(R.string.lg_invite), nav.invite, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.PersonAdd, compact = true)
                }
            }
            val d = data
            when {
                d == null && error == null -> item { LgLoadingRow() }
                d == null -> item { EmptyState(Icons.Filled.People, stringResource(R.string.lg_members_failed), error!!, stringResource(R.string.try_again), { tick++ }) }
                else -> {
                    item {
                        LgListCard(active) { m ->
                            MemberRow(m) {
                                confirm = PendingConfirm(ctx.getString(R.string.lg_remove_q, m.shownName), ctx.getString(R.string.lg_remove_body), ctx.getString(R.string.lg_remove)) {
                                    scope.launch {
                                        try { api.revoke(m.userId); LegalToasts.success(ctx.getString(R.string.lg_access_removed)); tick++ }
                                        catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                                    }
                                }
                            }
                        }
                    }
                    if (former.isNotEmpty()) {
                        item {
                            Text(if (showFormer) stringResource(R.string.lg_hide_removed) else stringResource(R.string.lg_show_removed, former.size), fontSize = 13.sp,
                                fontWeight = FontWeight.Medium, color = c.mutedFg, modifier = Modifier.clickable { showFormer = !showFormer }.padding(vertical = 8.dp))
                        }
                        if (showFormer) item { LgListCard(former) { m -> MemberRow(m, null) } }
                    }
                }
            }
        }
    }
    ConfirmDialog(confirm) { confirm = null }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MemberRow(m: LgMember, onRevoke: (() -> Unit)?) {
    val c = Nx.colors
    val line = when {
        m.isRoot -> stringResource(R.string.lg_always_has)
        m.revokedAt != null -> stringResource(R.string.lg_removed_by, m.revokedBy?.name ?: "—", lgDate(m.revokedAt))
        m.active -> stringResource(R.string.lg_invited_by, m.invitedBy?.name ?: "—", lgDate(m.invitedAt))
        else -> stringResource(R.string.lg_left_company)
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(m.shownName, m.avatar, size = 34.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(3.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                Text(m.shownName, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (m.isRoot) LgChip(stringResource(R.string.lg_owner), lgTone("accent"))
                lgRole(m.orgRole)?.let { Text(it, fontSize = 12.sp, color = c.mutedFg, maxLines = 1) }
                if (!m.isRoot && m.active && m.invitePower == "STAFF") LgChip(stringResource(R.string.lg_can_invite_staff), lgTone("info"))
            }
            Text(line, fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (onRevoke != null && m.canRevoke) NxButton(stringResource(R.string.lg_remove), onRevoke, kind = NxButtonKind.GHOST, icon = Icons.Filled.PersonRemove, compact = true)
    }
}

/** The company role in words (One Above All, BoD, Manager, Staff); null when absent. */
@Composable
fun lgRole(r: String?): String? = when (r) {
    null, "" -> null
    "ONE_ABOVE_ALL" -> "One Above All"
    "BOD" -> "BoD"
    "MANAGER" -> "Manager"
    "STAFF" -> "Staff"
    else -> r
}

/** Invite to Legal: searches only the people the viewer may invite. */
@Composable
fun LegalInviteScreen(onBack: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var q by remember { mutableStateOf("") }
    var candidates by remember { mutableStateOf<List<LgCandidate>?>(null) }
    var error by remember { mutableStateOf<Throwable?>(null) }
    var inviting by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(q, tick) {
        if (q.isNotEmpty()) delay(250)
        try { candidates = api.candidates(q); error = null } catch (e: ApiError) { error = e }
    }
    LgPage {
        Column(Modifier.fillMaxSize()) {
            PageHeader(stringResource(R.string.lg_invite_title), subtitle = stringResource(R.string.lg_invite_sub), onBack = onBack)
            CompactSearchField(q, { q = it }, stringResource(R.string.lg_search_people), Modifier.fillMaxWidth().padding(16.dp))
            val l = candidates
            when {
                error != null && l == null -> LgLoadError(error!!, stringResource(R.string.lg_members_failed), { tick++ }, onBack, Modifier.fillMaxSize())
                l == null -> Box(Modifier.padding(horizontal = 16.dp)) { LgLoadingRow() }
                l.isEmpty() -> EmptyState(Icons.Filled.People, stringResource(R.string.lg_nobody_to_invite),
                    stringResource(if (q.isBlank()) R.string.lg_nobody_to_invite_body else R.string.lg_try_other_name), stringResource(R.string.back), onBack, Modifier.fillMaxSize())
                else -> LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    items(l, key = { it.userId }) { cand ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            val name = cand.name.ifBlank { cand.email }
                            Avatar(name, cand.avatar, size = 30.dp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(listOfNotNull(lgRole(cand.orgRole), cand.email).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            NxButton(stringResource(R.string.lg_invite), {
                                inviting = cand.userId
                                scope.launch {
                                    try {
                                        api.invite(cand.userId)
                                        LegalToasts.success(ctx.getString(R.string.lg_invited))
                                        candidates = candidates?.filter { it.userId != cand.userId }
                                    } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                                    inviting = null
                                }
                            }, compact = true, enabled = inviting == null)
                        }
                    }
                }
            }
        }
    }
}
