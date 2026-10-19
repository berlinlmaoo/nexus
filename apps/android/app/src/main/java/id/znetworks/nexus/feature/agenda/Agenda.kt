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
import androidx.compose.material.icons.filled.Add
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

// Room booking (new / edit / delete like the web, 14 Oct 2026) and the team calendar (read-only).

@Serializable data class Booker(val id: String? = null, val name: String? = null)
@Serializable data class Booking(val id: String, val room: String = "", val title: String = "", val description: String? = null,
                                 val startsAt: String = "", val endsAt: String = "", val createdBy: Booker? = null)
@Serializable data class Bookings(val bookings: List<Booking> = emptyList(), val roomsAvailable: Boolean = true)

object AgendaLogic {
    private val zone = OfficeTime.ZONE
    fun zoned(iso: String): ZonedDateTime? = runCatching { Instant.parse(iso).atZone(zone) }.getOrNull()
    fun hhmm(iso: String) = zoned(iso)?.let { DateTimeFormatter.ofPattern("HH:mm").format(it) }.orEmpty()

    /** Grouped by office day; upcoming ascending, history newest day first. */
    fun byDay(b: List<Booking>, past: Boolean): List<Pair<LocalDate, List<Booking>>> =
        b.mapNotNull { x -> zoned(x.startsAt)?.toLocalDate()?.let { it to x } }.groupBy({ it.first }, { it.second })
            .toList().sortedBy { it.first }.let { if (past) it.reversed() else it }.map { (d, l) -> d to l.sortedBy { it.startsAt } }

    /** The month on screen (WIB): its first instant and the last second of its last day, as the web asks. */
    fun monthRange(month: java.time.YearMonth): Pair<Instant, Instant> {
        val start = month.atDay(1).atStartOfDay(zone).toInstant()
        val next = month.plusMonths(1).atDay(1).atStartOfDay(zone).toInstant()
        return start to next.minusSeconds(1)
    }

    /** The person who booked it, or a Manager and above (the server's canManageBooking; iOS canEdit). */
    fun canEdit(b: Booking, meId: String?, canAdminister: Boolean) = (meId != null && b.createdBy?.id == meId) || canAdminister
}

class AgendaApi(private val api: ApiClient) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    suspend fun bookingPage(from: Instant, to: Instant) = api.get("/api/room-bookings?rangeStart=${enc(from.toString())}&rangeEnd=${enc(to.toString())}", Bookings.serializer())
    suspend fun bookings(from: Instant, to: Instant) = bookingPage(from, to).bookings
    // This API has no single-booking GET. Resolve links once through its authorized ranged listing.
    suspend fun findBooking(id: String) = bookingPage(Instant.EPOCH, Instant.parse("2100-01-01T00:00:00Z")).let { page -> page.bookings.firstOrNull { page.roomsAvailable && it.id == id } }

    private fun body(room: String, title: String, from: Instant, to: Instant, notes: String?) = kotlinx.serialization.json.buildJsonObject {
        put("room", kotlinx.serialization.json.JsonPrimitive(room)); put("title", kotlinx.serialization.json.JsonPrimitive(title))
        put("startsAt", kotlinx.serialization.json.JsonPrimitive(from.toString())); put("endsAt", kotlinx.serialization.json.JsonPrimitive(to.toString()))
        put("description", notes?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
    }.toString().let { with(ApiClient) { it.toJsonBody() } }

    /** POST /api/room-bookings (web createRoomBooking); 409 = the room is taken (`conflict.title`). */
    suspend fun create(room: String, title: String, from: Instant, to: Instant, notes: String?) =
        api.send(okhttp3.Request.Builder().url(api.url("/api/room-bookings")).post(body(room, title, from, to, notes)).build(), kotlinx.serialization.json.JsonObject.serializer())

    suspend fun update(id: String, room: String, title: String, from: Instant, to: Instant, notes: String?) =
        api.send(okhttp3.Request.Builder().url(api.url("/api/room-bookings/${enc(id)}")).patch(body(room, title, from, to, notes)).build(), kotlinx.serialization.json.JsonObject.serializer())

    /** Only the person who booked it or a manager (403 otherwise). */
    suspend fun delete(id: String) =
        api.send(okhttp3.Request.Builder().url(api.url("/api/room-bookings/${enc(id)}")).delete().build(), kotlinx.serialization.json.JsonObject.serializer())
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
private fun AgendaRow(time: String, title: String, chip: String?, sub: String?, onClick: (() -> Unit)? = null) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(14.dp))
        .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(12.dp),
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
fun RoomBookingScreen(bookingId: String? = null, onBack: () -> Unit) {
    val api = agendaApi()
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val company = id.znetworks.nexus.ui.components.rememberIsCompany()
    var available by remember { mutableStateOf<Boolean?>(null) }
    val meId = container.sessionStore.current?.userId
    var canAdminister by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { container.viewer.load(); canAdminister = container.viewer.canAdminister } }
    // iOS RoomBookingView / web: one month at a time (WIB), every booking of it by day, ‹ Today › to move.
    var monthKey by rememberSaveable { mutableStateOf(java.time.YearMonth.from(OfficeTime.today()).toString()) }
    var showPast by rememberSaveable(monthKey) { mutableStateOf(false) }
    val month = java.time.YearMonth.parse(monthKey)
    val thisMonth = java.time.YearMonth.from(OfficeTime.today())
    var list by remember { mutableStateOf<List<Booking>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    // The composer: Pair(true, null) = a new booking, Pair(true, b) = editing b.
    var composing by remember { mutableStateOf<Pair<Boolean, Booking?>>(false to null) }
    var wantedBooking by rememberSaveable(bookingId) { mutableStateOf(bookingId) }
    var openedBooking by remember { mutableStateOf<Booking?>(null) }
    LaunchedEffect(wantedBooking) {
        val id = wantedBooking ?: return@LaunchedEffect
        val found = runCatching { api.findBooking(id) }.getOrNull()
        if (wantedBooking != id) return@LaunchedEffect
        if (found == null) wantedBooking = null
        else { openedBooking = found; AgendaLogic.zoned(found.startsAt)?.let { monthKey = YearMonth.from(it).toString() }; showPast = AgendaLogic.zoned(found.endsAt)?.toInstant()?.isBefore(Instant.now()) == true }
    }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(monthKey, reload) {
        list = null
        val (from, to) = AgendaLogic.monthRange(month)
        try { val page = api.bookingPage(from, to); list = if (page.roomsAvailable) page.bookings else emptyList(); available = page.roomsAvailable; error = null } catch (e: ApiError) { error = e.describe(res) }
    }
    Column(Modifier.fillMaxSize().background(c.background)) {
        // "New booking" as the header's primary action (web; the phones were read-only).
        id.znetworks.nexus.ui.components.PageHeader(stringResource(R.string.home_q_rooms), subtitle = stringResource(R.string.sub_rooms), onBack = onBack,
            actions = { if (company == true && available != false) id.znetworks.nexus.ui.components.HeaderIconButton(Icons.Filled.Add, stringResource(R.string.rb_new), { composing = true to null }, primary = true) })
        if (available == false || company == false) {
            id.znetworks.nexus.ui.components.EmptyState(Icons.Filled.MeetingRoom, stringResource(R.string.qa_rooms_company_title), stringResource(R.string.qa_rooms_company_body), stringResource(R.string.back), onBack, Modifier.fillMaxSize())
            return@Column
        }
        // The month row: "October 2026", then ‹ Today ›.
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(DateTimeFormatter.ofPattern("LLLL yyyy", Locale.getDefault()).format(month).replaceFirstChar { it.titlecase(Locale.getDefault()) },
                fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
            IconButton(onClick = { monthKey = month.minusMonths(1).toString() }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.rb_prev_month), tint = c.mutedFg) }
            id.znetworks.nexus.ui.components.NxButton(stringResource(R.string.cal_today), { monthKey = thisMonth.toString() }, compact = true, enabled = month != thisMonth)
            IconButton(onClick = { monthKey = month.plusMonths(1).toString() }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.rb_next_month), tint = c.mutedFg) }
        }
        val l = list
        when {
            l == null && error == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            l == null -> TabEmpty(Icons.Filled.MeetingRoom, error!!)
            l.isEmpty() -> id.znetworks.nexus.ui.components.EmptyState(Icons.Filled.CalendarMonth,
                stringResource(R.string.rb_nothing_in, DateTimeFormatter.ofPattern("LLLL", Locale.getDefault()).format(month).replaceFirstChar { it.titlecase(Locale.getDefault()) }),
                stringResource(R.string.rb_empty_sub), stringResource(R.string.rb_new), { composing = true to null }, Modifier.fillMaxSize())
            else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val earlier = l.filter { runCatching { Instant.parse(it.endsAt).isBefore(Instant.now()) }.getOrDefault(false) }
                val upcoming = l.filterNot { it in earlier }
                if (earlier.isNotEmpty()) item {
                    id.znetworks.nexus.ui.components.NxButton(androidx.compose.ui.res.pluralStringResource(if (showPast) R.plurals.rb_hide_earlier else R.plurals.rb_show_earlier, earlier.size, earlier.size), { showPast = !showPast })
                }
                if (upcoming.isEmpty() && !showPast) item {
                    id.znetworks.nexus.ui.components.EmptyState(Icons.Filled.CalendarMonth,
                        stringResource(R.string.rb_no_more_in, DateTimeFormatter.ofPattern("LLLL", Locale.getDefault()).format(month)),
                        stringResource(R.string.rb_empty_sub), stringResource(R.string.rb_new), { composing = true to null })
                }
                AgendaLogic.byDay(if (showPast) l else upcoming, past = false).forEach { (day, items) ->
                    item(key = "d$day") {
                        Text(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.getDefault()).format(day).replaceFirstChar(Char::titlecase),
                            fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg, modifier = Modifier.padding(top = 8.dp))
                    }
                    items.forEach { b ->
                        item(key = b.id) {
                            val editable = AgendaLogic.canEdit(b, meId, canAdminister)
                            AgendaRow("${AgendaLogic.hhmm(b.startsAt)}–${AgendaLogic.hhmm(b.endsAt)}", b.title, roomLabel(b.room),
                                b.createdBy?.name?.takeIf { it.isNotBlank() }?.let { stringResource(R.string.rb_by, it) },
                                onClick = if (editable) ({ composing = true to b }) else null)
                        }
                    }
                }
            }
        }
    }
    if (composing.first && company == true && available != false) BookingComposer(composing.second, api, onDismiss = { composing = false to null }, onSaved = { composing = false to null; reload++ })
    openedBooking?.takeIf { company == true && available != false }?.let { booking ->
        val close = { openedBooking = null; wantedBooking = null }
        if (AgendaLogic.canEdit(booking, meId, canAdminister)) BookingComposer(booking, api, onDismiss = close, onSaved = { close(); reload++ })
        else androidx.compose.material3.AlertDialog(onDismissRequest = close, title = { Text(booking.title) }, text = { Column {
            Text(roomLabel(booking.room)); Text(AgendaLogic.zoned(booking.startsAt)?.format(DateTimeFormatter.ofPattern("EEE d MMM HH:mm", Locale.getDefault())).orEmpty() + "–" + AgendaLogic.hhmm(booking.endsAt))
            booking.description?.let { Text(it) }
        } }, confirmButton = { TextButton(onClick = close) { Text(stringResource(R.string.au_close)) } })
    }
}
