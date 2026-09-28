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
@Serializable data class CalEvent(val id: String, val title: String = "", val startsAt: String = "", val endsAt: String? = null,
                                  val isAllDay: Boolean? = null, val location: String? = null)
@Serializable data class CalEvents(val events: List<CalEvent> = emptyList())
@Serializable data class TeamLite(val id: String, val name: String = "")

object AgendaLogic {
    private val zone = OfficeTime.ZONE
    fun zoned(iso: String): ZonedDateTime? = runCatching { Instant.parse(iso).atZone(zone) }.getOrNull()
    fun hhmm(iso: String) = zoned(iso)?.let { DateTimeFormatter.ofPattern("HH:mm").format(it) }.orEmpty()

    /** Grouped by office day; upcoming ascending, history newest day first. */
    fun byDay(b: List<Booking>, past: Boolean): List<Pair<LocalDate, List<Booking>>> =
        b.mapNotNull { x -> zoned(x.startsAt)?.toLocalDate()?.let { it to x } }.groupBy({ it.first }, { it.second })
            .toList().sortedBy { it.first }.let { if (past) it.reversed() else it }.map { (d, l) -> d to l.sortedBy { it.startsAt } }

    /** Several teams' calendars, merged and de-duplicated by id. */
    fun merge(lists: List<List<CalEvent>>) = lists.flatten().associateBy { it.id }.values.sortedBy { it.startsAt }
}

class AgendaApi(private val api: ApiClient) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    suspend fun bookings(from: Instant, to: Instant) = api.get("/api/room-bookings?rangeStart=${enc(from.toString())}&rangeEnd=${enc(to.toString())}", Bookings.serializer()).bookings
    suspend fun teams() = api.get("/api/teams", ListSerializer(TeamLite.serializer()))
    suspend fun calendar(teamId: String, from: Instant, to: Instant) =
        api.get("/api/master-calendar?teamId=${enc(teamId)}&rangeStart=${enc(from.toString())}&rangeEnd=${enc(to.toString())}", CalEvents.serializer()).events
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

@Composable
fun TeamCalendarScreen(onBack: () -> Unit) {
    val api = agendaApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    var teams by remember { mutableStateOf<List<TeamLite>>(emptyList()) }
    var teamId by rememberSaveable { mutableStateOf<String?>(null) }
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var selected by rememberSaveable { mutableStateOf<Int?>(null) }
    var events by remember { mutableStateOf<List<CalEvent>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    val month = YearMonth.from(OfficeTime.today()).plusMonths(offset.toLong())
    LaunchedEffect(Unit) { teams = runCatching { api.teams() }.getOrDefault(emptyList()); if (teams.size == 1) teamId = teams[0].id }
    LaunchedEffect(teams, teamId, offset) {
        if (teams.isEmpty()) { events = emptyList(); return@LaunchedEffect }
        val from = month.atDay(1).atStartOfDay(OfficeTime.ZONE).toInstant()
        val to = month.plusMonths(1).atDay(1).atStartOfDay(OfficeTime.ZONE).toInstant()
        // teamId is required by the server: "all teams" is one call per team, merged.
        try { events = AgendaLogic.merge((teamId?.let { listOf(it) } ?: teams.map { it.id }).map { api.calendar(it, from, to) }); error = null }
        catch (e: ApiError) { error = e.describe(res) }
    }
    val byDay = remember(events, month) {
        events.orEmpty().mapNotNull { e -> AgendaLogic.zoned(e.startsAt)?.toLocalDate()?.takeIf { YearMonth.from(it) == month }?.let { it.dayOfMonth to e } }.groupBy({ it.first }, { it.second })
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        Header(stringResource(R.string.home_q_calendar), onBack) {
            if (teams.size > 1) Box {
                TextButton(onClick = { menu = true }) { Text(teams.firstOrNull { it.id == teamId }?.name ?: stringResource(R.string.ag_all_teams), maxLines = 1) }
                DropdownMenu(menu, { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.ag_all_teams)) }, onClick = { menu = false; teamId = null })
                    teams.forEach { t -> DropdownMenuItem(text = { Text(t.name) }, onClick = { menu = false; teamId = t.id }) }
                }
            }
        }
        if (events == null && error == null) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return@Column }
        if (error != null) { TabEmpty(Icons.Filled.CalendarMonth, error!!); return@Column }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { offset--; selected = null }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, null) }
                Text(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault()).format(month).replaceFirstChar(Char::titlecase), fontFamily = DisplayFont,
                    fontWeight = FontWeight.Bold, fontSize = 16.sp, color = c.foreground, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                IconButton(onClick = { offset++; selected = null }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null) }
            }
            Row { DayOfWeek.entries.forEach { d -> Text(d.getDisplayName(TextStyle.SHORT, Locale.getDefault()), fontSize = 10.sp, color = c.mutedFg, modifier = Modifier.weight(1f), textAlign = TextAlign.Center) } }
            val cells = List(month.atDay(1).dayOfWeek.value - 1) { null } + (1..month.lengthOfMonth()).toList()
            cells.chunked(7).forEach { week ->
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    (0 until 7).forEach { i ->
                        val day = week.getOrNull(i)
                        Box(Modifier.weight(1f).height(44.dp)) {
                            if (day != null) {
                                val on = selected == day; val has = byDay[day].orEmpty().isNotEmpty()
                                Column(Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp)).background(if (on) c.violet else if (has) c.violet.copy(alpha = 0.08f) else Color.Transparent)
                                    .clickable { selected = day }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                    Text("$day", fontSize = 13.sp, color = if (on) Color.White else c.foreground, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
                                    Box(Modifier.size(5.dp).background(if (!has) Color.Transparent else if (on) Color.White else c.violet, CircleShape))
                                }
                            }
                        }
                    }
                }
            }
            val sel = selected
            if (sel == null) Text(stringResource(R.string.ag_pick_date), fontSize = 12.sp, color = c.mutedFg)
            else {
                Text(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault()).format(month.atDay(sel)), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                val items = byDay[sel].orEmpty()
                if (items.isEmpty()) Text(stringResource(R.string.ag_no_events), fontSize = 12.sp, color = c.mutedFg)
                items.forEach { e -> AgendaRow(if (e.isAllDay == true) stringResource(R.string.ag_all_day) else AgendaLogic.hhmm(e.startsAt), e.title, null, e.location) }
            }
            Spacer(Modifier.size(16.dp))
        }
    }
}
