package id.znetworks.nexus.feature.admin

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.RemoteImage
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

// Control Room › Fake GPS (Berlin, 28 Sep 2026; server f7f5f1c, iOS AdminSuspectViews c977091):
// attendance the server flagged for its location, per 28→27 period. Only PROOF (the phone reported a
// mock location, or an impossible jump: level FAKE) may be judged "Not valid", which turns the day into
// TK and tells the person; weak signals (level CHECK) can only be cleared. BoD / OAA; the server re-checks.

@Serializable data class SuspectSide(
    val at: String? = null, val lat: Double? = null, val lng: Double? = null, val accuracyM: Double? = null,
    val simulated: Boolean? = null, val photoUrl: String? = null, val address: String? = null, val offline: Boolean? = null,
    /** "FAKE" | "CHECK" | null */
    val level: String? = null, val signals: List<String> = emptyList(),
)
@Serializable data class SuspectPerson(val id: String, val name: String? = null, val image: String? = null)
@Serializable data class SuspectActor(val id: String? = null, val name: String? = null)
@Serializable data class SuspectReview(val verdict: String, val note: String? = null, val reviewedAt: String? = null, val reviewedBy: SuspectActor? = null)
@Serializable data class SuspectItem(
    val recordId: String, val date: String,
    /** "open" | "valid" | "invalid" */
    val state: String, val level: String? = null, val user: SuspectPerson, val place: String? = null,
    val checkIn: SuspectSide? = null, val checkOut: SuspectSide? = null, val review: SuspectReview? = null,
) { val isFake get() = level == "FAKE" }
@Serializable data class SuspectCounts(val fakeOpen: Int = 0, val checkOpen: Int = 0, val valid: Int = 0, val invalid: Int = 0)
@Serializable data class SuspectList(val periodKey: String, val periodLabel: String? = null, val currentPeriodKey: String? = null,
                                     val counts: SuspectCounts = SuspectCounts(), val items: List<SuspectItem> = emptyList())

object SuspectLogic {
    const val NOTE_MIN = 3
    const val NOTE_MAX = 300

    /** 0 Fake GPS (open, FAKE) · 1 Worth a look (open, CHECK) · 2 Reviewed. */
    fun filter(items: List<SuspectItem>, tab: Int) = items.filter {
        when (tab) {
            0 -> it.state == "open" && it.isFake
            1 -> it.state == "open" && it.level == "CHECK"
            else -> it.state != "open"
        }
    }
    /** "Not valid" needs proof (FAKE) and a note the person will read; the server says 422 NOT_PROOF otherwise. */
    fun canInvalidate(item: SuspectItem, note: String) = item.isFake && item.state == "open" && note.trim().length >= NOTE_MIN

    fun shift(periodKey: String, by: Int): String = YearMonth.parse(periodKey).plusMonths(by.toLong()).toString()

    /** The server's English signal → a string id + the speed it carries, so it reads in the app's language. */
    enum class Signal { SIMULATED, IMPOSSIBLE, FAST, SAME, OTHER }
    fun signal(text: String): Pair<Signal, String?> {
        val speed = Regex("""\d+ km/h""").find(text)?.value
        return when {
            text.startsWith("The phone reported a simulated location") -> Signal.SIMULATED to null
            text.startsWith("Impossible travel") -> Signal.IMPOSSIBLE to speed
            text.startsWith("Fast travel") -> Signal.FAST to speed
            text.startsWith("Same coordinates") -> Signal.SAME to null
            else -> Signal.OTHER to null
        }
    }
    fun shortAddress(a: String?) = a?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.take(2)?.joinToString(", ")?.takeIf { it.isNotEmpty() }
}

class SuspectsApi(private val api: ApiClient) {
    suspend fun list(periodKey: String?) = api.get("/api/attendance/suspects" + (periodKey?.let { "?periodKey=${java.net.URLEncoder.encode(it, "UTF-8")}" } ?: ""), SuspectList.serializer())
    /** The id as one encoded path segment (audit R7, as iOS). */
    fun reviewUrl(recordId: String) = api.url("/api/attendance/suspects").newBuilder().addPathSegment(recordId).addPathSegment("review").build()
    suspend fun review(recordId: String, verdict: String, note: String) =
        api.send(Request.Builder().url(reviewUrl(recordId))
            .post(buildJsonObject { put("verdict", verdict); put("note", note.trim()) }.toString().toJsonBody()).build(), JsonObject.serializer())
}

private val clock = DateTimeFormatter.ofPattern("HH:mm")
private fun hhmm(iso: String?) = iso?.let { runCatching { clock.format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrNull() } ?: "--:--"
private fun dayLabel(key: String) = runCatching { LocalDate.parse(key.take(10)).format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())) }.getOrDefault(key)

@Composable
fun FakeGpsTab() {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { SuspectsApi(container.api) }
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<SuspectList?>(null) }
    var loading by remember { mutableStateOf(true) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var period by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableIntStateOf(0) }
    var notes by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf<SuspectItem?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(period, tick) {
        loading = true
        try { val l = api.list(period); list = l; if (period == null) period = l.periodKey; loadError = null }
        catch (e: ApiError) { loadError = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
        loading = false
    }
    fun review(item: SuspectItem, verdict: String) = scope.launch {
        busy = item.recordId
        val note = notes[item.recordId].orEmpty()
        try {
            api.review(item.recordId, verdict, note)
            problem = null
            notice = if (verdict == "INVALID") res.getString(R.string.fg_now_tk, item.user.name ?: "—", dayLabel(item.date)) else res.getString(R.string.fg_marked_fine)
            notes = notes - item.recordId
            tick++
        } catch (e: ApiError) { notice = null; problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
        busy = null
    }

    val l = list
    if (l == null) {
        if (loading) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else EmptyState(Icons.Filled.Refresh, stringResource(R.string.fg_load_failed), loadError.orEmpty(), stringResource(R.string.try_again), { tick++ }, Modifier.fillMaxSize())
        return
    }
    val items = SuspectLogic.filter(l.items, tab)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        AdminCard {
            Text(stringResource(R.string.fg_intro), fontSize = 12.sp, color = c.mutedFg)
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { period?.let { period = SuspectLogic.shift(it, -1) } }, enabled = period != null) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous)) }
                Text(l.periodLabel ?: l.periodKey, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                IconButton(onClick = { period?.let { period = SuspectLogic.shift(it, 1) } }, enabled = period != null && period != l.currentPeriodKey) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(Triple(0, R.string.fg_fake, l.counts.fakeOpen), Triple(1, R.string.fg_check, l.counts.checkOpen), Triple(2, R.string.fg_reviewed, l.counts.valid + l.counts.invalid)).forEach { (i, label, n) ->
                    val on = tab == i
                    Text("${stringResource(label)} $n", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else c.mutedFg,
                        modifier = Modifier.clip(CircleShape).background(if (on) c.violet else c.muted.copy(alpha = 0.6f)).clickable { tab = i }.padding(horizontal = 12.dp, vertical = 6.dp))
                }
            }
        }
        notice?.let { Text("✓ $it", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.success) }
        problem?.let { Text(it, fontSize = 13.sp, color = c.danger) }
        if (items.isEmpty()) {
            val (t, sub) = when (tab) { 0 -> R.string.fg_empty_fake to R.string.fg_empty_fake_sub; 1 -> R.string.fg_empty_check to R.string.fg_empty_check_sub; else -> R.string.fg_empty_reviewed to R.string.fg_empty_reviewed_sub }
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Filled.VerifiedUser, null, tint = c.success, modifier = Modifier.size(32.dp))
                Text(stringResource(t), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.foreground)
                Text(stringResource(sub), fontSize = 12.sp, color = c.mutedFg, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
        items.forEach { item ->
            AdminCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(item.user.name ?: "—", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Text(listOfNotNull(dayLabel(item.date), item.place).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg, maxLines = 1)
                    }
                    val (badge, tint) = when (item.state) {
                        "invalid" -> stringResource(R.string.fg_invalid_tk) to c.danger
                        "valid" -> stringResource(R.string.fg_fine) to c.success
                        else -> if (item.isFake) stringResource(R.string.fg_fake) to c.danger else stringResource(R.string.fg_check) to c.warning
                    }
                    Text(badge, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = tint,
                        modifier = Modifier.background(tint.copy(alpha = 0.14f), CircleShape).padding(horizontal = 8.dp, vertical = 4.dp))
                }
                item.checkIn?.let { Side(stringResource(R.string.fg_check_in), it) }
                item.checkOut?.let { Side(stringResource(R.string.fg_check_out), it) }
                item.review?.let { r ->
                    Text("${stringResource(if (r.verdict == "INVALID") R.string.fg_not_valid else R.string.fg_fine)} · ${r.reviewedBy?.name ?: "BoD"}" +
                        (r.note?.let { " — “$it”" } ?: ""), fontSize = 12.sp, color = c.mutedFg)
                }
                if (item.state == "open") {
                    OutlinedTextField(notes[item.recordId].orEmpty(), { notes = notes + (item.recordId to it.take(SuspectLogic.NOTE_MAX)) },
                        placeholder = { Text(stringResource(if (item.isFake) R.string.fg_note_required else R.string.fg_note_optional)) }, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { review(item, "VALID") }, enabled = busy == null, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.fg_its_fine)) }
                        if (item.isFake) OutlinedButton(onClick = {
                            if (!SuspectLogic.canInvalidate(item, notes[item.recordId].orEmpty())) problem = res.getString(R.string.fg_note_first)
                            else { problem = null; confirming = item }
                        }, enabled = busy == null, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.fg_not_valid_more), color = c.danger, fontWeight = FontWeight.Bold) }
                    }
                }
            }
        }
    }
    // ONE confirmation, with what happens said.
    confirming?.let { item ->
        AlertDialog(onDismissRequest = { confirming = null }, title = { Text(stringResource(R.string.fg_confirm_title)) },
            text = { Text(stringResource(R.string.fg_confirm_body, item.user.name ?: "—", dayLabel(item.date))) },
            confirmButton = { TextButton(onClick = { confirming = null; review(item, "INVALID") }) { Text(stringResource(R.string.fg_confirm_do), color = c.danger) } },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text(stringResource(R.string.cancel)) } })
    }
}

@Composable
private fun Side(label: String, s: SuspectSide) {
    val c = Nx.colors
    val context = LocalContext.current
    val tint = when (s.level) { "FAKE" -> c.danger; "CHECK" -> c.warning; else -> c.mutedFg }
    Row(Modifier.fillMaxWidth().background(tint.copy(alpha = 0.08f), RoundedCornerShape(14.dp)).padding(10.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.width(54.dp).size(54.dp, 68.dp).clip(RoundedCornerShape(10.dp)).background(c.muted.copy(alpha = 0.5f)), contentAlignment = Alignment.Center) {
            RemoteImage(s.photoUrl, Modifier.fillMaxSize()) { Icon(Icons.Filled.PhotoCamera, null, tint = c.mutedFg.copy(alpha = 0.5f)) }
        }
        Spacer(Modifier.width(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("$label ${hhmm(s.at)}" + if (s.offline == true) " · offline" else "", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            if (s.signals.isEmpty()) Text(stringResource(R.string.fg_no_signal), fontSize = 12.sp, color = c.mutedFg)
            s.signals.forEach { t ->
                val (kind, speed) = SuspectLogic.signal(t)
                val text = when (kind) {
                    SuspectLogic.Signal.SIMULATED -> stringResource(R.string.fg_sig_simulated)
                    SuspectLogic.Signal.IMPOSSIBLE -> stringResource(R.string.fg_sig_impossible, speed ?: "?")
                    SuspectLogic.Signal.FAST -> stringResource(R.string.fg_sig_fast, speed ?: "?")
                    SuspectLogic.Signal.SAME -> stringResource(R.string.fg_sig_same)
                    SuspectLogic.Signal.OTHER -> t
                }
                Text("• $text", fontSize = 12.sp, fontWeight = if (s.level == "FAKE") FontWeight.SemiBold else FontWeight.Normal, color = if (s.level == "FAKE") c.danger else c.warning)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                SuspectLogic.shortAddress(s.address)?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, modifier = Modifier.weight(1f, fill = false)) }
                s.accuracyM?.takeIf { it > 0 }?.let { Text("±${Math.round(it)} m", fontSize = 11.sp, color = c.mutedFg) }
                if (s.lat != null && s.lng != null) Text(stringResource(R.string.fg_map), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.violetText,
                    modifier = Modifier.clickable {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://maps.google.com/?q=${s.lat},${s.lng}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    })
            }
        }
    }
}
