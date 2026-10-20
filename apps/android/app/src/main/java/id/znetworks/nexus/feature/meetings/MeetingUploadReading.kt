package id.znetworks.nexus.feature.meetings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx
import java.text.NumberFormat

@Composable internal fun MeetingUploadReading(progress: MeetingUploadProgress) {
    val locale = LocalConfiguration.current.locales[0]
    val number = NumberFormat.getNumberInstance(locale).apply { minimumFractionDigits = 1; maximumFractionDigits = 1 }
    fun bytes(value: Long): String = when {
        value >= 1_048_576 -> number.format(value / 1_048_576.0) + " MB"
        value >= 1024 -> number.format(value / 1024.0) + " KB"
        else -> "$value B"
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LinearProgressIndicator(progress = { progress.fraction }, modifier = Modifier.fillMaxWidth())
        Text(stringResource(R.string.rev_meeting_bytes, bytes(progress.received), bytes(progress.total), progress.percent), color = Nx.colors.mutedFg, fontSize = 12.sp)
    }
}
