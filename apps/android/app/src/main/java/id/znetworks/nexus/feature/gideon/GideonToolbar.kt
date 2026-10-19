package id.znetworks.nexus.feature.gideon
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx

@Composable internal fun GideonToolbar(title: String, tier: GideonTier, tiers: GTiers, close: () -> Unit, history: () -> Unit,
    newChat: () -> Unit, selectTier: (GideonTier) -> Unit, busy: Boolean, more: @Composable () -> Unit) {
    val c = Nx.colors
    Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = close) { Icon(Icons.Filled.Close, stringResource(R.string.close), tint = c.foreground) }
            IconButton(onClick = history, enabled = !busy) { Icon(Icons.Outlined.History, stringResource(R.string.gx_chats), tint = c.foreground) }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                GideonTierPicker(tier, tiers, selectTier)
                Text(title, color = c.mutedFg, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = newChat, enabled = !busy) { Icon(Icons.Outlined.EditNote, stringResource(R.string.gx_new_chat), tint = c.foreground) }
            more()
        }
        HorizontalDivider(color = c.border)
    }
}
@Composable private fun GideonTierPicker(tier: GideonTier, tiers: GTiers, selectTier: (GideonTier) -> Unit) {
    val c = Nx.colors
    var tierMenu by remember { mutableStateOf(false) }
                    Box {
                TextButton(onClick = { tierMenu = true }) { Text(tier.label + " ⌄", fontSize = 15.sp, color = c.foreground) }
                DropdownMenu(tierMenu, { tierMenu = false }, shape = RoundedCornerShape(16.dp), containerColor = c.card, border = androidx.compose.foundation.BorderStroke(1.dp, c.border)) {
                    GideonTier.entries.forEach { t ->
                        DropdownMenuItem(modifier = Modifier.heightIn(min = 72.dp), enabled = tiers.available(t), text = { Column {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(t.label, fontWeight = FontWeight.SemiBold)
                                if (t == GideonTier.LUNA || t == GideonTier.EXPERIMENTAL) Text(stringResource(if (t == GideonTier.LUNA) R.string.g19_default else R.string.g19_experimental), fontSize = 10.sp,
                                    color = if (t == GideonTier.EXPERIMENTAL) c.warningFg else c.mutedFg,
                                    modifier = Modifier.background(if (t == GideonTier.EXPERIMENTAL) c.warning.copy(alpha = 0.12f) else c.muted, RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 2.dp))
                            }
                            if (!tiers.available(t)) {
                                Text(stringResource(R.string.g19_unavailable), fontSize = 12.sp, color = c.mutedFg)
                                Text(stringResource(when (tiers.tiers[t.key]?.reason) { "transcribing" -> R.string.g19_transcribing; "loading" -> R.string.g19_loading; else -> R.string.g19_down }), fontSize = 11.sp, color = c.mutedFg)
                            }
                        } },
                            leadingIcon = { if (t == tier) Icon(Icons.Filled.Check, null) else Spacer(Modifier.size(24.dp)) }, onClick = { tierMenu = false; selectTier(t) })
                    }
                }
            }


}
