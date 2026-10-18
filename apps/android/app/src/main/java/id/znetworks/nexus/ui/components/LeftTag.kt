package id.znetworks.nexus.ui.components

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Someone who left the workspace (offboarding, owner 8 Oct; web LeftTag). */
object LeftAt {
    /**
     * `leftAt` ("YYYY-MM-DD" or ISO) is the last working day, stored as 00:00 UTC of the Jakarta date: its
     * first ten characters ARE that date, read without any zone (a zone could shift it a day).
     */
    fun date(leftAt: String?): LocalDate? =
        leftAt?.takeIf { Regex("^\\d{4}-\\d{2}-\\d{2}").containsMatchIn(it) }?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
}

/**
 * A small muted "Left · 10 Oct" / "Keluar · 10 Okt" pill; [compact] says only "Left" where a name
 * column is narrow (TalkBack still reads the last working day). Nothing when [leftAt] is null.
 */
@Composable
fun LeftTag(leftAt: String?, modifier: Modifier = Modifier, compact: Boolean = false) {
    val day = LeftAt.date(leftAt) ?: return
    val c = Nx.colors
    val short = AppDateFormats.ofPattern("d MMM", Locale.getDefault()).format(day)
    val long = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.getDefault()).format(day)
    val desc = stringResource(R.string.off_left_desc, long)
    Text(if (compact) stringResource(R.string.off_left) else stringResource(R.string.off_left_on, short),
        fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Clip,
        modifier = modifier.semantics { contentDescription = desc }.background(c.muted, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp))
}

/** "Left" with no date (task people carry `deactivatedAt`, not a last working day; web PersonLeftTag). */
@Composable
fun LeftPill(modifier: Modifier = Modifier) {
    val c = Nx.colors
    val desc = stringResource(R.string.off_task_left)
    Text(stringResource(R.string.off_left), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg, maxLines = 1,
        modifier = modifier.semantics { contentDescription = desc }.background(c.muted, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp))
}

