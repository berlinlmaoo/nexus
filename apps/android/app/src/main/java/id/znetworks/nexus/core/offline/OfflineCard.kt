package id.znetworks.nexus.core.offline

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.feature.tasks.sizeText
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx

/** More › Offline copy: when it was saved, how much room it takes, update now, files on mobile data. */
@Composable
fun OfflineCard() {
    val sync = (LocalContext.current.applicationContext as NexusApplication).container.offline
    val s by sync.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    var cellular by remember { mutableStateOf(sync.mediaOverCellular) }
    LaunchedEffect(Unit) { sync.refreshUsage() }
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.off_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
        Text(stringResource(R.string.off_sub), fontSize = 12.sp, color = c.mutedFg)
        Text(stringResource(R.string.off_data, s.lastData?.let { chatTime(java.time.Instant.ofEpochMilli(it).toString()) } ?: "—"), fontSize = 12.sp, color = c.foreground)
        Text(stringResource(R.string.off_files, s.lastMedia?.let { chatTime(java.time.Instant.ofEpochMilli(it).toString()) } ?: "—", sizeText(s.bytes).ifBlank { "0 B" }), fontSize = 12.sp, color = c.foreground)
        s.progress?.let { LinearProgressIndicator(progress = { it }, modifier = Modifier.fillMaxWidth()) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.off_cellular), fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
            Switch(cellular, { cellular = it; sync.mediaOverCellular = it })
        }
        TextButton(onClick = { sync.syncAll() }, enabled = s.running == null) { Text(stringResource(if (s.running != null) R.string.off_updating else R.string.off_update)) }
    }
}
