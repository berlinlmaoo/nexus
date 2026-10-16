package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AddCircle
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.feature.agenda.roomLabel
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.ProjectMark
import id.znetworks.nexus.feature.projects.taskStatusLabel
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.delay
import java.net.URLEncoder

// The composer's @ picker and context chips, the "Review before writing" menu, and the proposal / result cards
// of an answer (web GideonPanel MentionPicker / ProposalCard / ResultCard; iOS GideonPanel + GideonPanelExtras).

private fun kindIcon(kind: String): ImageVector = if (kind == "task") Icons.Outlined.Checklist else Icons.Outlined.Description

@Composable
private fun kindLabel(kind: String) = stringResource(when (kind) { "project" -> R.string.gx_kind_project; "task" -> R.string.gx_kind_task; else -> R.string.gx_kind_doc })

/** Search results for the "@query" at the end of the draft: up to 4 projects, 4 docs and 6 tasks this account can see. */
@Composable
internal fun MentionPicker(query: String, api: ApiClient, onPick: (GRef) -> Unit) {
    val c = Nx.colors
    val untitled = stringResource(R.string.gx_untitled_doc)
    var hits by remember { mutableStateOf<List<GMentionHit>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val q = query.trim()
    LaunchedEffect(q) {
        if (q.isEmpty()) { hits = emptyList(); searching = false; return@LaunchedEffect }
        delay(GideonMention.DEBOUNCE_MS)
        searching = true
        try {
            hits = GideonMention.hits(api.get("/api/search?q=" + URLEncoder.encode(q, "UTF-8"), GMentionSearch.serializer()), q, untitled)
        } catch (_: ApiError) {
            hits = emptyList()
        } finally {
            searching = false
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(12.dp)).background(c.card)
        .border(1.dp, c.border, RoundedCornerShape(12.dp))) {
        val hint = when {
            q.isEmpty() -> stringResource(R.string.gx_mention_hint)
            hits.isEmpty() && searching -> stringResource(R.string.gx_mention_searching)
            hits.isEmpty() -> stringResource(R.string.gx_mention_none, q)
            else -> null
        }
        if (hint != null) Text(hint, fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(10.dp))
        else Column(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
            hits.forEach { h ->
                Row(Modifier.fillMaxWidth().clickable { onPick(h.ref) }.defaultMinSize(minHeight = 44.dp).padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) {
                        if (h.ref.kind == "project") ProjectMark(null, 16.dp, projectId = h.ref.id)
                        else Icon(kindIcon(h.ref.kind), null, tint = c.mutedFg, modifier = Modifier.size(16.dp))
                    }
                    Column(Modifier.weight(1f).padding(vertical = 4.dp)) {
                        Text(h.ref.title.orEmpty(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        h.sub?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                    Text(kindLabel(h.ref.kind), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                }
            }
        }
    }
}

/** The project GIDEON was opened about and the @ pages, each removable with its ×. */
@Composable
internal fun ContextChips(project: Pair<String, String>?, refs: List<GRef>, onDropProject: () -> Unit, onRemove: (GRef) -> Unit) {
    if (project == null && refs.isEmpty()) return
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        project?.let { (pid, name) -> ContextChip(name, { ProjectMark(null, 12.dp, projectId = pid) }, onDropProject) }
        refs.forEach { r ->
            ContextChip(r.title.orEmpty(), {
                if (r.kind == "project") ProjectMark(null, 12.dp, projectId = r.id) else Icon(kindIcon(r.kind), null, tint = Nx.colors.mutedFg, modifier = Modifier.size(13.dp))
            }) { onRemove(r) }
        }
    }
}

@Composable
private fun ContextChip(label: String, mark: @Composable () -> Unit, onRemove: () -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(50)
    Row(Modifier.clip(shape).background(c.muted).border(1.dp, c.border, shape).padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        mark()
        Spacer(Modifier.width(5.dp))
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 220.dp))
        IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) {
            Icon(Icons.Filled.Close, stringResource(R.string.gx_remove_context), tint = c.mutedFg, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
internal fun approvalName(m: GideonApprovalMode) = stringResource(when (m) {
    GideonApprovalMode.ALWAYS_ASK -> R.string.gx_mode_always; GideonApprovalMode.REVIEW -> R.string.gx_mode_review; GideonApprovalMode.DONT_ASK -> R.string.gx_mode_dont
})

@Composable
private fun approvalBlurb(m: GideonApprovalMode) = stringResource(when (m) {
    GideonApprovalMode.ALWAYS_ASK -> R.string.gx_mode_always_sub; GideonApprovalMode.REVIEW -> R.string.gx_mode_review_sub; GideonApprovalMode.DONT_ASK -> R.string.gx_mode_dont_sub
})

/** "Review before writing ▾" in the composer: which of GIDEON's writes wait for Apply. */
@Composable
internal fun ApprovalMenu(mode: GideonApprovalMode, onPick: (GideonApprovalMode) -> Unit) {
    val c = Nx.colors
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.clip(RoundedCornerShape(8.dp)).clickable { open = true }.defaultMinSize(minHeight = 40.dp).padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.VerifiedUser, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text(approvalName(mode), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1)
            Icon(Icons.Filled.ArrowDropDown, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(open, { open = false }) {
            Text(stringResource(R.string.gx_mode_header), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
            GideonApprovalMode.entries.forEach { m ->
                DropdownMenuItem(
                    text = { Column(Modifier.widthIn(max = 280.dp)) { Text(approvalName(m), fontWeight = FontWeight.SemiBold); Text(approvalBlurb(m), fontSize = 12.sp, color = c.mutedFg) } },
                    leadingIcon = { if (m == mode) Icon(Icons.Filled.Check, null) else Spacer(Modifier.size(24.dp)) },
                    onClick = { open = false; onPick(m) })
            }
        }
    }
}

/**
 * A change GIDEON proposes (Review before writing): what it is, the fields it changes, then Discard / Apply, each
 * asked first in a centred dialog. Once decided, the status line (and what Apply made).
 */
@Composable
internal fun ProposalCard(p: GProposal, deciding: Boolean, onDecide: (Boolean) -> Unit) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.warning.copy(alpha = 0.06f)).border(1.dp, c.warning.copy(alpha = 0.3f), shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.VerifiedUser, null, tint = c.warningFg, modifier = Modifier.size(14.dp).padding(top = 2.dp))
            Spacer(Modifier.width(6.dp))
            Text(p.summary?.takeIf { it.isNotBlank() } ?: stringResource(R.string.gx_change_default), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        }
        p.diff.forEach { row ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                val status = row.field == "Status"
                Text(row.field.orEmpty(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
                Spacer(Modifier.width(6.dp))
                row.fromText?.takeIf { it.isNotEmpty() }?.let {
                    Text(if (status) taskStatusLabel(it) else it, fontSize = 12.sp, color = c.mutedFg, textDecoration = TextDecoration.LineThrough,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    Spacer(Modifier.width(4.dp))
                }
                Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = c.mutedFg, modifier = Modifier.size(10.dp))
                Spacer(Modifier.width(4.dp))
                val to = row.toText
                Text(if (to == null) "—" else if (status) taskStatusLabel(to) else to, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            }
        }
        if (p.isPending) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                if (deciding) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                NxButton(stringResource(R.string.gx_discard), { onDecide(false) }, kind = NxButtonKind.BORDERED, enabled = !deciding, compact = true)
                NxButton(stringResource(R.string.gx_apply), { onDecide(true) }, kind = NxButtonKind.PRIMARY, icon = Icons.Filled.Check, enabled = !deciding, compact = true)
            }
        } else {
            val text = when (GideonReview.status(p)) {
                GideonReview.Status.APPLIED -> stringResource(R.string.gx_applied)
                GideonReview.Status.DISCARDED -> stringResource(R.string.gx_discarded)
                GideonReview.Status.APPLYING -> stringResource(R.string.gx_applying)
                GideonReview.Status.FAILED -> p.error?.takeIf { it.isNotBlank() } ?: stringResource(R.string.gx_apply_failed)
                GideonReview.Status.OTHER -> p.status.lowercase().replaceFirstChar { it.uppercase() }
            }
            Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = when (p.status) { "APPLIED" -> c.success; "FAILED" -> c.dangerText; else -> c.mutedFg })
            if (p.status == "APPLIED") p.card?.let { ResultCard(it) }
        }
    }
}

/** The centred "Apply this change?" / "Discard this change?" (house rule: every confirmation is a dialog). */
@Composable
internal fun DecisionDialog(p: GProposal, apply: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val c = Nx.colors
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text(stringResource(if (apply) R.string.gx_apply_q else R.string.gx_discard_q)) },
        text = p.summary?.takeIf { it.isNotBlank() }?.let { s -> { Text(s) } },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) {
                Text(stringResource(if (apply) R.string.gx_apply else R.string.gx_discard), color = if (apply) c.foreground else c.dangerText, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

/** Something GIDEON made or changed: a task / doc created, a task updated, a comment posted. */
@Composable
internal fun ResultCard(card: GCard) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    val verb = stringResource(when (card.action) { "created" -> R.string.gx_card_created; "commented" -> R.string.gx_card_commented; else -> R.string.gx_card_updated })
    Row(Modifier.fillMaxWidth().clip(shape).background(c.card).border(1.dp, c.border, shape).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (card.action == "created") Icons.Outlined.AddCircle else Icons.Outlined.Edit, null, tint = c.success, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(card.title?.takeIf { it.isNotBlank() } ?: stringResource(R.string.gx_kind_task), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(verb, card.projectName?.takeIf { it.isNotBlank() }).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * GIDEON's book_room card (owner, 16 Oct 2026; web GideonBookRoomCard, iOS GideonBookRoomCard). GIDEON never
 * guesses a room: every room is listed with its availability for that exact slot (read live), free ones
 * selectable, busy ones disabled with who holds them until when. A named room is preselected when it is free;
 * otherwise, with exactly one room free, that one is. With none free, the nearest free slots (same day, ±2 h) are
 * chips that move the card to that time. Apply stays disabled until a free room is chosen; the server checks the
 * room and slot again and, if taken meanwhile, keeps the card open with the reason.
 */
@Composable
internal fun BookRoomCard(
    p: GProposal,
    booking: GBooking,
    deciding: Boolean,
    loadRooms: suspend (String, String) -> GRoomAvailability?,
    onApply: (GBookingChoice) -> Unit,
    onDiscard: () -> Unit,
) {
    val c = Nx.colors
    val shape = RoundedCornerShape(12.dp)
    var startsAt by remember(p.id) { mutableStateOf(booking.startsAt.orEmpty()) }
    var endsAt by remember(p.id) { mutableStateOf(booking.endsAt.orEmpty()) }
    var room by remember(p.id) { mutableStateOf<String?>(null) }
    var touched by remember(p.id) { mutableStateOf(false) }
    var availability by remember(p.id) { mutableStateOf<GRoomAvailability?>(null) }
    var loadFailed by remember(p.id) { mutableStateOf(false) }
    LaunchedEffect(p.id, startsAt, endsAt, p.error) {
        if (!p.isPending) return@LaunchedEffect
        loadFailed = false
        val a = loadRooms(startsAt, endsAt)
        availability = a
        loadFailed = a == null
        if (a != null && !touched) {
            val free = a.rooms.filter { it.free }
            room = booking.room?.takeIf { r -> free.any { it.room == r } } ?: free.singleOrNull()?.room
        }
    }
    val rooms = availability?.rooms.orEmpty()
    val named = booking.room?.let { r -> rooms.firstOrNull { it.room == r } }
    val chosen = rooms.firstOrNull { it.room == room && it.free }

    Column(Modifier.fillMaxWidth().clip(shape).background(c.warning.copy(alpha = 0.06f)).border(1.dp, c.warning.copy(alpha = 0.3f), shape).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Icon(Icons.Outlined.VerifiedUser, null, tint = c.warningFg, modifier = Modifier.size(14.dp).padding(top = 2.dp))
            Spacer(Modifier.width(6.dp))
            Text(booking.title?.takeIf { it.isNotBlank() } ?: stringResource(R.string.gx_book_room), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Event, null, tint = c.mutedFg, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Text(BookRoomTime.slot(startsAt, endsAt), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.foreground)
        }
        if (p.isPending) {
            if (availability == null && !loadFailed) Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 2.dp); Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.gx_rooms_checking), fontSize = 12.sp, color = c.mutedFg)
            }
            if (loadFailed) Text(stringResource(R.string.gx_rooms_failed), fontSize = 12.sp, color = c.dangerText)
            if (named != null && !named.free) Text(stringResource(R.string.gx_room_named_busy, roomLabel(named.room)), fontSize = 12.sp, color = c.warningFg)
            rooms.forEach { r ->
                val selected = room == r.room && r.free
                val rowShape = RoundedCornerShape(10.dp)
                Row(Modifier.fillMaxWidth().clip(rowShape).background(if (selected) c.violetText.copy(alpha = 0.06f) else c.card)
                    .border(1.dp, if (selected) c.violetText else c.border, rowShape)
                    .clickable(enabled = r.free && !deciding) { touched = true; room = r.room }
                    .padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (selected) Icons.Outlined.RadioButtonChecked else Icons.Outlined.RadioButtonUnchecked, null,
                        tint = if (selected) c.violetText else c.mutedFg, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        val seats = r.capacity?.let { " · " + stringResource(R.string.gx_room_seats, it) }.orEmpty()
                        Text(roomLabel(r.room) + seats, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (r.free) c.foreground else c.mutedFg)
                        r.busy?.let { b ->
                            Text(stringResource(R.string.gx_room_booked_by, b.by ?: stringResource(R.string.gx_someone), BookRoomTime.clock(b.endsAt)),
                                fontSize = 12.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            val slots = availability?.freeSlots.orEmpty()
            if (availability != null && rooms.none { it.free }) {
                Text(stringResource(R.string.gx_room_none_free), fontSize = 12.sp, color = c.mutedFg)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    slots.forEach { f ->
                        Text("${BookRoomTime.clock(f.startsAt)}–${BookRoomTime.clock(f.endsAt)}", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.foreground,
                            modifier = Modifier.clip(RoundedCornerShape(50)).border(1.dp, c.border, RoundedCornerShape(50))
                                .clickable { room = null; touched = false; startsAt = f.startsAt; endsAt = f.endsAt }
                                .padding(horizontal = 10.dp, vertical = 4.dp))
                    }
                }
            }
            p.error?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.dangerText) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                if (deciding) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                NxButton(stringResource(R.string.gx_discard), { onDiscard() }, kind = NxButtonKind.BORDERED, enabled = !deciding, compact = true)
                NxButton(stringResource(R.string.gx_apply), { chosen?.let { onApply(GBookingChoice(it.room, startsAt, endsAt)) } },
                    kind = NxButtonKind.PRIMARY, icon = Icons.Filled.Check, enabled = !deciding && chosen != null, compact = true)
            }
        } else {
            if (p.status == "APPLIED") booking.room?.let { Text(roomLabel(it), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground) }
            val text = when (GideonReview.status(p)) {
                GideonReview.Status.APPLIED -> stringResource(R.string.gx_room_booked)
                GideonReview.Status.DISCARDED -> stringResource(R.string.gx_discarded)
                GideonReview.Status.APPLYING -> stringResource(R.string.gx_applying)
                GideonReview.Status.FAILED -> p.error?.takeIf { it.isNotBlank() } ?: stringResource(R.string.gx_apply_failed)
                GideonReview.Status.OTHER -> p.status.lowercase().replaceFirstChar { it.uppercase() }
            }
            Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = when (p.status) { "APPLIED" -> c.success; "FAILED" -> c.dangerText; else -> c.mutedFg })
        }
    }
}

/** A booking's times in WIB ("14:00"), and the slot line in the app's language ("Mon 19 Oct · 14:00–15:00"). */
internal object BookRoomTime {
    private val wib = java.time.ZoneId.of("Asia/Jakarta")
    private fun at(iso: String?) = iso?.let { runCatching { java.time.Instant.parse(it).atZone(wib) }.getOrNull() }

    fun clock(iso: String?): String = at(iso)?.let { java.time.format.DateTimeFormatter.ofPattern("HH:mm").format(it) }.orEmpty()

    fun slot(startsAt: String, endsAt: String): String {
        val s = at(startsAt) ?: return ""
        val day = java.time.format.DateTimeFormatter.ofPattern("EEE d MMM", AppLanguage.locale()).format(s)
        return "$day · ${clock(startsAt)}–${clock(endsAt)}"
    }
}
