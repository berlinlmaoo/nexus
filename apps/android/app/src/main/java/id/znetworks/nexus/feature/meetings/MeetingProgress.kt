package id.znetworks.nexus.feature.meetings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.theme.Nx

internal fun meetingProgressStep(status: String): Int = when (status) {
    "UPLOADING" -> 0
    "READY", "APPLYING", "APPLIED" -> 2
    else -> 1
}

/** Upload, queued work and ready minutes keep the same layout and left edge. */
@Composable internal fun MeetingProgress(meeting: Meeting, upload: MeetingUploadProgress, busy: Boolean,
    onOpen: () -> Unit, onDone: () -> Unit, onCancel: () -> Unit) {
    val c = Nx.colors
    val active = meetingProgressStep(meeting.status)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(meeting.title, fontWeight = FontWeight.SemiBold, color = c.foreground)
        listOf(R.string.rev_meeting_upload, R.string.rev_meeting_transcribe, R.string.rev_meeting_ready_step).forEachIndexed { index, title ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Box(Modifier.size(28.dp).background(if (index == active) c.accentFg else c.muted, CircleShape), contentAlignment = Alignment.Center) {
                    Text(if (index < active) "✓" else (index + 1).toString(), color = if (index == active) c.background else c.mutedFg, fontSize = 13.sp)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(title), color = if (index == active) c.accentFg else c.mutedFg, fontWeight = if (index == active) FontWeight.SemiBold else FontWeight.Normal)
                    if (index == active) when {
                        meeting.status == "FAILED" -> Text(stringResource(meetingProblem(meeting.errorCode)), color = c.dangerText)
                        index == 0 -> MeetingUploadReading(upload)
                        index == 2 -> Text(stringResource(R.string.rev_meeting_ready), color = c.mutedFg, fontSize = 13.sp)
                        meeting.status == "QUEUED" || meeting.queue?.waiting == true -> Text(
                            if ((meeting.queue?.position ?: 0) > 1) stringResource(R.string.meet_position, meeting.queue!!.position.toString()) else stringResource(R.string.meet_next), color = c.mutedFg, fontSize = 13.sp)
                        meeting.status == "SUMMARIZING" -> Text(stringResource(R.string.meet_summarizing), color = c.mutedFg, fontSize = 13.sp)
                        else -> {
                            val minutes = MeetingRules.estimateMinutes(meeting.queue?.etaSec ?: (85 + (meeting.durationSec ?: 0.0) * 2.8 / 60))
                            Text(stringResource(R.string.rev_meeting_transcribing, minutes), color = c.mutedFg, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
        Text(stringResource(R.string.rev_meeting_notify), color = c.mutedFg, fontSize = 13.sp)
        NxButton(stringResource(R.string.meet_open), onOpen, kind = NxButtonKind.PRIMARY, modifier = Modifier.fillMaxWidth())
        NxButton(stringResource(R.string.rev_meeting_done), onDone, modifier = Modifier.fillMaxWidth())
        if (meeting.status == "UPLOADING") TextButton(onClick = onCancel, enabled = !busy) {
            Text(stringResource(R.string.rev_meeting_cancel_upload), color = c.dangerText)
        }
    }
}
