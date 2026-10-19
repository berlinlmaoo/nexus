package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx

object GideonPending {
    fun startsExpanded(fresh: Boolean, count: Int) = fresh && count <= 2
}
@Composable internal fun proposalSummary(p: GProposal) = p.summaryFor(if (LocalConfiguration.current.locales[0].language in listOf("id", "in")) "id" else "en")
@Composable internal fun ProposalNoChange(p: GProposal) {
    if (p.noChange) Text(stringResource(R.string.qa_gideon_no_change), color = Nx.colors.warningFg, fontSize = 12.sp)
}
@Composable internal fun PendingApprovals(s: GideonChat.State, pending: List<GProposal>, fresh: Boolean,
    loadRooms: suspend (String, String, String?) -> GRoomAvailability?, onDecide: (GDecision) -> Unit) {
    if (pending.isEmpty()) return
    var expanded by rememberSaveable(s.chatId, fresh) { mutableStateOf(GideonPending.startsExpanded(fresh, pending.size)) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        TextButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
            Text(androidx.compose.ui.res.pluralStringResource(R.plurals.qa_gideon_waiting_count, pending.size, pending.size), Modifier.weight(1f), color = Nx.colors.mutedFg, fontSize = 13.sp)
            Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = Nx.colors.mutedFg)
        }
        if (expanded) pending.forEach { p -> key(p.id) {
            when {
                p.action == "book_room" && p.booking != null -> BookRoomCard(p, p.booking, p.id in s.deciding, { a, b -> loadRooms(a, b, null) }, { onDecide(GDecision(p, true, it)) }, { onDecide(GDecision(p, false)) })
                p.action in listOf("move_room_booking", "cancel_room_booking") && p.bookingChange != null -> BookingChangeCard(p, p.bookingChange, p.id in s.deciding, loadRooms, { onDecide(GDecision(p, true, it)) }, { onDecide(GDecision(p, false)) })
                p.action == "create_task" && p.taskTarget != null && p.isPending -> CreateTaskCard(p, p.id in s.deciding, onDecide)
                p.action == "delete_task" || p.extra != null -> ActionCard(p, p.id in s.deciding, onDecide)
                else -> ProposalCard(p, p.id in s.deciding) { onDecide(GDecision(p, it)) }
            }
        } }
    }
}
