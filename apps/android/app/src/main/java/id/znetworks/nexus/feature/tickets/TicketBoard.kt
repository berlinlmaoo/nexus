package id.znetworks.nexus.feature.tickets

import android.content.ClipData
import android.view.View
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.draganddrop.dragAndDropSource
import androidx.compose.foundation.draganddrop.dragAndDropTarget
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draganddrop.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.ui.components.*
import id.znetworks.nexus.ui.theme.Nx

@Composable
internal fun TicketBoard(s: TicketsState, meId: String?, move: (Ticket, String) -> Unit, open: (String) -> Unit) {
    val reviewer = s.list?.viewerIsBod == true
    var category by rememberSaveable { mutableStateOf("ALL") }
    var menu by remember { mutableStateOf(false) }
    val all = TicketRules.ordered(s.list?.complaints.orEmpty()).filter { TicketBoardRules.visible(it, reviewer, meId) }
    val shown = all.filter { category == "ALL" || it.category == category }
    val currentMove by rememberUpdatedState(move)
    val currentTickets by rememberUpdatedState(all)
    val moving by rememberUpdatedState(s.moving)
    val context = LocalContext.current
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.padding(horizontal = 12.dp)) {
            TextButton(onClick = { menu = true }) { Text(if (category == "ALL") stringResource(R.string.ui_ticket_all_categories) else ticketCategoryLabel(category)); Icon(Icons.Filled.ExpandMore, null) }
            DropdownMenu(menu, { menu = false }) {
                (listOf("ALL") + TicketRules.CATEGORIES).forEach { key ->
                    DropdownMenuItem(text = { Text(if (key == "ALL") stringResource(R.string.ui_ticket_all_categories) else ticketCategoryLabel(key)) }, onClick = { category = key; menu = false })
                }
            }
        }
        BoardColumns {
            items(TicketBoardRules.columns, key = { it }) { column ->
                var hovering by remember { mutableStateOf(false) }
                val target = remember(column, reviewer) { object : DragAndDropTarget {
                    override fun onEntered(event: DragAndDropEvent) { hovering = true }
                    override fun onExited(event: DragAndDropEvent) { hovering = false }
                    override fun onEnded(event: DragAndDropEvent) { hovering = false }
                    override fun onDrop(event: DragAndDropEvent): Boolean {
                        hovering = false
                        val data = event.toAndroidDragEvent().clipData ?: return false
                        if (data.description.label != "nexus-ticket") return false
                        val ticket = currentTickets.firstOrNull { it.id == data.getItemAt(0).text?.toString() } ?: return false
                        if (column == "AWAITING_DECISION") {
                            UiNotice.show(context.getString(R.string.ui_ticket_system_status))
                            return false
                        }
                        if (ticket.id in moving || TicketBoardRules.destination(ticket, column, reviewer) == null) return false
                        currentMove(ticket, column)
                        return true
                    }
                } }
                val drop = if (reviewer) Modifier.dragAndDropTarget(
                    shouldStartDragAndDrop = { it.toAndroidDragEvent().clipDescription?.label == "nexus-ticket" }, target = target) else Modifier
                BoardLane(modifier = drop.then(if (hovering) Modifier.border(2.dp, Nx.colors.violetText, RoundedCornerShape(12.dp)) else Modifier)) {
                    val tickets = shown.filter { TicketBoardRules.column(it.status) == column }
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(when (column) { "OPEN" -> R.string.ui_ticket_new; "AWAITING_DECISION" -> R.string.tk_awaiting; "IN_REVIEW" -> R.string.tk_in_review; else -> R.string.ui_ticket_done }), fontWeight = FontWeight.SemiBold, color = Nx.colors.foreground, modifier = Modifier.weight(1f))
                        Text(tickets.size.toString(), color = Nx.colors.mutedFg, fontSize = 12.sp)
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f)) {
                        if (tickets.isEmpty()) item { Text(stringResource(R.string.tk_empty_filter), color = Nx.colors.mutedFg, fontSize = 12.sp, modifier = Modifier.padding(8.dp)) }
                        items(tickets, key = { it.id }) { t ->
                            val drag = if (reviewer && t.canManage && t.id !in s.moving) Modifier.dragAndDropSource(transferData = { DragAndDropTransferData(ClipData.newPlainText("nexus-ticket", t.id), View.DRAG_FLAG_GLOBAL) }) else Modifier
                            TicketBoardCard(t, t.id in s.moving, drag) { open(t.id) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TicketBoardCard(t: Ticket, moving: Boolean, modifier: Modifier, open: () -> Unit) {
    val c = Nx.colors
    Column(modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable(enabled = !moving, onClick = open).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(t.subject.ifBlank { stringResource(R.string.tk_no_subject) }, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Pill(ticketCategoryLabel(t.category), c.mutedFg)
            if (t.closed) Pill(stringResource(R.string.tk_closed), c.mutedFg)
        }
        Text(t.reporter?.name ?: stringResource(R.string.tk_someone), color = c.mutedFg, fontSize = 12.sp)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(chatTime(t.lastMessageAt ?: t.createdAt), color = c.mutedFg, fontSize = 11.sp, modifier = Modifier.weight(1f))
            if (t.gideonReplied) { val label = stringResource(R.string.ui_ticket_gideon_replied); Box(Modifier.semantics { contentDescription = label }) { GideonMark(14.dp, c.violetText) } }
            Text("💬 ${(t.messageCount - 1).coerceAtLeast(0)}", color = c.mutedFg, fontSize = 12.sp)
            if (moving) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        }
    }
}
