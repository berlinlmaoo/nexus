package id.znetworks.nexus.feature.attendance.requests

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.theme.Nx
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/**
 * Several dates in one calendar (iOS MultiDatePicker), for annual leave (Berlin 29 Sep, iOS 22c4ecb):
 * a tap toggles a day; Monday first, as the office's week.
 */
@Composable
fun MultiDatePicker(selected: Set<LocalDate>, onToggle: (LocalDate) -> Unit, modifier: Modifier = Modifier) {
    val c = Nx.colors
    val today = OfficeTime.today()
    var monthKey by rememberSaveable { mutableStateOf((selected.minOrNull() ?: today).let { YearMonth.from(it) }.toString()) }
    val month = YearMonth.parse(monthKey)
    val locale = Locale.getDefault()
    Column(modifier.fillMaxWidth().background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(month.format(DateTimeFormatter.ofPattern("LLLL yyyy", locale)).replaceFirstChar { it.titlecase(locale) },
                fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f).padding(start = 8.dp))
            IconButton(onClick = { monthKey = month.minusMonths(1).toString() }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous), tint = c.violetText) }
            IconButton(onClick = { monthKey = month.plusMonths(1).toString() }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next), tint = c.violetText) }
        }
        Row {
            DayOfWeek.entries.forEach { d ->
                Text(d.getDisplayName(TextStyle.NARROW, locale), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg,
                    textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            }
        }
        MultiDateLogic.grid(month).forEach { week ->
            Row {
                week.forEach { day ->
                    Box(Modifier.weight(1f).aspectRatio(1f).padding(2.dp), contentAlignment = Alignment.Center) {
                        if (day != null) {
                            val on = day in selected
                            Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(CircleShape)
                                .background(if (on) c.violet else Color.Transparent)
                                .then(if (day == today && !on) Modifier.border(1.dp, c.violetText, CircleShape) else Modifier)
                                .clickable { onToggle(day) }, contentAlignment = Alignment.Center) {
                                Text("${day.dayOfMonth}", fontSize = 14.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                                    color = if (on) Color.White else c.foreground)
                            }
                        }
                    }
                }
            }
        }
    }
}

object MultiDateLogic {
    /** The month as weeks of 7 (Monday first), padded with nulls. */
    fun grid(month: YearMonth): List<List<LocalDate?>> {
        val lead = month.atDay(1).dayOfWeek.value - 1
        val cells = List(lead) { null } + (1..month.lengthOfMonth()).map { month.atDay(it) }
        return cells.chunked(7).map { it + List(7 - it.size) { null } }
    }

    /**
     * A tap: removes a picked day, or adds one while under the days left. Returns the new set and
     * whether the tap was refused for going past [left] ("Only N days left.").
     */
    fun toggle(dates: Set<LocalDate>, day: LocalDate, left: Int?): Pair<Set<LocalDate>, Boolean> = when {
        day in dates -> (dates - day) to false
        left != null && dates.size >= left -> dates to true
        else -> (dates + day) to false
    }

    /** Consecutive days → one (start, end) run each, oldest first: one request per run. */
    fun blocks(dates: Set<LocalDate>): List<Pair<LocalDate, LocalDate>> {
        val out = mutableListOf<Pair<LocalDate, LocalDate>>()
        dates.sorted().forEach { d ->
            val last = out.lastOrNull()
            if (last != null && last.second.plusDays(1) == d) out[out.lastIndex] = last.first to d else out += d to d
        }
        return out
    }
}
