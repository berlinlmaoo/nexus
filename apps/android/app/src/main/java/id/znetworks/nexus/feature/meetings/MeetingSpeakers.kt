package id.znetworks.nexus.feature.meetings

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.gideon.GPicker
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.*
import id.znetworks.nexus.core.net.NexusJson

private val voiceDots = listOf(0xFF8B5CF6, 0xFF0EA5E9, 0xFF10B981, 0xFFF59E0B, 0xFFF43F5E, 0xFF14B8A6, 0xFFD946EF, 0xFF65A30D, 0xFFF97316, 0xFF6366F1)
private val voiceLight = listOf(0xFF6D28D9, 0xFF0369A1, 0xFF047857, 0xFFB45309, 0xFFBE123C, 0xFF0F766E, 0xFFA21CAF, 0xFF4D7C0F, 0xFFC2410C, 0xFF4338CA)
private val voiceDark = listOf(0xFFC4B5FD, 0xFF7DD3FC, 0xFF6EE7B7, 0xFFFCD34D, 0xFFFDA4AF, 0xFF5EEAD4, 0xFFF0ABFC, 0xFFBEF264, 0xFFFDBA74, 0xFFA5B4FC)

@Composable internal fun voiceColor(label: String): Color = Color((if (Nx.colors.background.luminance() < .5f) voiceDark else voiceLight)[MeetingRules.voiceIndex(label)])
@Composable internal fun voiceLabel(label: String): String = if (Regex("Speaker \\d+").matches(label)) stringResource(R.string.meet_speaker_number, label.removePrefix("Speaker ")) else label

@Composable internal fun MeetingSpeakers(meeting: Meeting, busy: Boolean, onChange: (JsonObject) -> Unit, onSeek: (Double) -> Unit) {
    val c = Nx.colors
    val voices = MeetingRules.voices(meeting)
    val map = meeting.speakers ?: meeting.speakersMap.orEmpty()
    val editable = meeting.can.edit && meeting.status !in setOf("APPLYING", "APPLIED") && !busy
    fun name(label: String, value: String, userId: String? = null) {
        val next = MeetingRules.nameVoice(map, label, value, userId)
        onChange(JsonObject(next.mapValues { (_, v) -> NexusJson.encodeToJsonElement(MeetingSpeaker.serializer(), v) }))
    }
    MeetingSection(stringResource(R.string.meet_speakers)) {
        Text(pluralStringResource(R.plurals.meet_voices, voices.size, voices.size), color = c.mutedFg, fontSize = 12.sp)
        Text(stringResource(if (meeting.status in setOf("APPLIED", "APPLYING")) R.string.qa_meeting_speakers_locked else R.string.meet_speakers_hint), color = c.mutedFg, fontSize = 12.sp)
        Column(Modifier.fillMaxWidth().background(c.muted.copy(alpha = .45f), RoundedCornerShape(12.dp))) {
            voices.forEachIndexed { index, label ->
                val speaker = map[label]
                val segments = meeting.transcript.filter { it.speaker == label }
                val seconds = segments.sumOf { (it.end - it.start).coerceAtLeast(0.0) }
                val first = segments.firstOrNull()
                if (index > 0) HorizontalDivider(color = c.border)
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.size(10.dp).background(Color(voiceDots[MeetingRules.voiceIndex(label)]), CircleShape))
                        Text(voiceLabel(label), color = c.mutedFg, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                    if (editable) {
                        NxTextField(speaker?.name.orEmpty(), { name(label, it) }, placeholder = { Text(stringResource(R.string.meet_who)) },
                            label = { Text(stringResource(R.string.meet_voice_name, voiceLabel(label))) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        GPicker(stringResource(R.string.meet_attendees), null, meeting.projectMembers.map { it.id to it.name }) { id ->
                            meeting.projectMembers.firstOrNull { it.id == id }?.let { name(label, it.name, it.id) }
                        }
                    } else Text(speaker?.name?.takeIf { it.isNotBlank() } ?: stringResource(R.string.meet_not_named), color = c.foreground, fontWeight = FontWeight.Medium)
                    if (speaker != null) Text(stringResource(if (speaker.auto == true) R.string.meet_from_introductions else R.string.meet_set_by_hand),
                        color = if (speaker.auto == true) c.violetText else c.mutedFg,
                        modifier = Modifier.background(if (speaker.auto == true) c.accentBg else c.muted, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp), fontSize = 11.sp)
                    Text(stringResource(R.string.meet_voice_lines, segments.size.toString(), MeetingRules.timestamp(seconds)), color = c.mutedFg, fontSize = 12.sp)
                    first?.let { line ->
                        TextButton(onClick = { onSeek(line.start) }, enabled = meeting.audio.available) { Text(stringResource(R.string.meet_listen, MeetingRules.timestamp(line.start))) }
                        Text("“${line.text}”", color = c.mutedFg, fontSize = 12.sp, fontStyle = FontStyle.Italic)
                    }
                }
            }
        }
    }
}
