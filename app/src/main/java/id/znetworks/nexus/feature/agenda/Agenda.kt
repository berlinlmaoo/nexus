package id.znetworks.nexus.feature.agenda

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.projects.Pill
import id.znetworks.nexus.feature.projects.TabEmpty
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.net.URLEncoder
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

// Room booking and the team calendar: read-only on the phones (API.md §2.4).

@Serializable data class Booker(val name: String? = null)
@Serializable data class Booking(val id: String, val room: String = "", val title: String = "", val description: String? = null,
                                 val startsAt: String = "", val endsAt: String = "", val createdBy: Booker? = null)
@Serializable data class Bookings(val bookings: List<Booking> = emptyList())

object AgendaLogic {
    private val zone = OfficeTime.ZONE
    fun zoned(iso: String): ZonedDateTime? = runCatching { Instant.parse(iso).atZone(zone) }.getOrNull()
    fun hhmm(iso: String) = zoned(iso)?.let { DateTimeFormatter.ofPattern("HH:mm").format(it) }.orEmpty()

    /** Grouped by office day; upcoming ascending, history newest day first. */
    fun byDay(b: List<Booking>, past: Boolean): List<Pair<LocalDate, List<Booking>>> =
        b.mapNotNull { x -> zoned(x.startsAt)?.toLocalDate()?.let { it to x } }.groupBy({ it.first }, { it.second })
            .toList().sortedBy { it.first }.let { if (past) it.reversed() else it }.map { (d, l) -> d to l.sortedBy { it.startsAt } }

    /** Several teams' calendars, merged and de-duplicated by id. */
}

class AgendaApi(private val api: ApiClient) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    suspend fun bookings(from: Instant, to: Instant) = api.get("/api/room-bookings?rangeStart=${enc(from.toString())}&rangeEnd=${enc(to.toString())}", Bookings.serializer()).bookings
}

@Composable
private fun agendaApi(): AgendaApi {
    val c = (LocalContext.current.applicationContext as NexusApplication).container
    return remember { AgendaApi(c.api) }
}

@Composable
private fun Header(title: String, onBack: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
        Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Nx.colors.foreground, modifier = Modifier.weight(1f))
        trailing()
    }
}

@Composable
private fun AgendaRow(time: String, title: String, chip: String?, sub: String?) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(14.dp)).border(1.dp, c.border, RoundedCornerShape(14.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(time, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.violetText, modifier = Modifier.width(92.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            sub?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 11.sp, color = c.mutedFg) }
        }
        chip?.takeIf { it.isNotBlank() }?.let { Pill(it, c.blue) }
    }
}

@Composable
fun RoomBookingScreen(onBack: () -> Unit) {
    val api = agendaApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var past by rememberSaveable { mutableStateOf(false) }
    var list by remember { mutableStateOf<List<Booking>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(past) {
        list = null
        val now = Instant.now()
        try { list = if (past) api.bookings(now.minusSeconds(30L * 86400), now) else api.bookings(now, now.plusSeconds(14L * 86400)); error = null }
        catch (e: ApiError) { error = e.describe(res) }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Header(stringResource(R.string.home_q_rooms), onBack)
        Text(stringResource(R.string.ag_rooms_sub), fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(horizontal = 16.dp))
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!past, { past = false }, { Text(stringResource(R.string.ag_upcoming)) })
            FilterChip(past, { past = true }, { Text(stringResource(R.string.ag_history)) })
        }
        val l = list
        when {
            l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            l == null -> TabEmpty(Icons.Filled.MeetingRoom, error!!)
            l.isEmpty() -> TabEmpty(Icons.Filled.MeetingRoom, stringResource(if (past) R.string.ag_no_bookings_past else R.string.ag_no_bookings_next))
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AgendaLogic.byDay(l, past).forEach { (day, items) ->
                    item(key = "d$day") {
                        Text(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault()).format(day).replaceFirstChar(Char::titlecase),
                            fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(top = 8.dp))
                    }
                    items.forEach { b -> item(key = b.id) { AgendaRow("${AgendaLogic.hhmm(b.startsAt)}–${AgendaLogic.hhmm(b.endsAt)}", b.title, b.room, b.createdBy?.name) } }
                }
            }
        }
    }
}
