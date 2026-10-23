package id.znetworks.nexus.feature.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import id.znetworks.nexus.R
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.core.time.OfficeTime
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle as JTextStyle
import java.util.Locale

// The home-screen widget (PRD Phase 5, as the iOS AttendanceWidget): where you stand today, a clock
// that counts by itself, and the last seven days as dots. Tapping opens Attendance.

private val VIOLET = Color(0xFF7B68EE)
private val AMBER = Color(0xFFFBBF24)
private val GREEN = Color(0xFF34D399)
private val ROSE = Color(0xFFEF5466)

/** The server's tone, as the iOS widget colours it. */
fun toneColor(tone: String): Color = when (tone) {
    "P", "I" -> GREEN
    "L" -> AMBER
    "C" -> Color(0xFFFACC33)
    "S" -> Color(0xFFF78C33)
    "D" -> VIOLET
    "A" -> ROSE
    else -> Color(0x40888888)
}

class AttendanceWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, MEDIUM))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val container = (context.applicationContext as NexusApplication).container
        provideContent {
            val session by container.sessionStore.session.collectAsState()
            val revision by container.presence.revision.collectAsState()
            key(session, revision) { Content(if (session == null) null else container.presence.load()) }
        }
    }

    companion object {
        val SMALL = DpSize(110.dp, 110.dp)
        val MEDIUM = DpSize(250.dp, 110.dp)
        suspend fun updateAll(context: Context) = runCatching {
            (context.applicationContext as NexusApplication).container.presence.invalidate()
            AttendanceWidget().updateAll(context)
        }
    }
}

class AttendanceWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AttendanceWidget()
}

private val hhmm = DateTimeFormatter.ofPattern("HH:mm")
private fun clockOf(ms: Long) = Instant.ofEpochMilli(ms).atZone(OfficeTime.ZONE).format(hhmm)

@Composable
private fun Content(s: AttendanceSnapshot?) {
    val context = LocalContext.current
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("nexus://attendance")).setPackage(context.packageName)
    val medium = LocalSize.current.width >= AttendanceWidget.MEDIUM.width
    // The launcher's own corner radius on Android 12+, like the calendar widgets (Calendar audit 2 #27).
    val corner = if (android.os.Build.VERSION.SDK_INT >= 31) GlanceModifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else GlanceModifier.cornerRadius(20.dp)
    Box(GlanceModifier.fillMaxSize().appWidgetBackground().background(ColorProvider(Color(0xFF1B1B22))).then(corner).padding(12.dp).clickable(actionStartActivity(open))) {
        if (medium) Row(GlanceModifier.fillMaxSize()) {
            Small(s, GlanceModifier.defaultWeight().fillMaxHeight())
            Spacer(GlanceModifier.width(12.dp))
            Right(s, GlanceModifier.defaultWeight().fillMaxHeight())
        } else Small(s, GlanceModifier.fillMaxSize())
    }
}

@Composable
private fun Small(s: AttendanceSnapshot?, modifier: GlanceModifier) {
    val context = LocalContext.current
    val today = OfficeTime.today().toString()
    val state = s?.state(today) ?: AttendanceSnapshot.State.Stale
    val pending = s?.isPending == true && state !is AttendanceSnapshot.State.Stale
    val tint = when {
        pending -> AMBER
        state is AttendanceSnapshot.State.Working -> VIOLET
        state is AttendanceSnapshot.State.Done -> GREEN
        else -> Color(0xFF9CA3AF)
    }
    val headline = when {
        pending -> context.getString(R.string.wg_sending)
        state is AttendanceSnapshot.State.Working -> s?.place ?: context.getString(R.string.wg_working)
        state is AttendanceSnapshot.State.Done -> context.getString(R.string.wg_done)
        state is AttendanceSnapshot.State.NotCheckedIn -> context.getString(R.string.wg_not_in)
        else -> "NEXUS"
    }
    val detail = when {
        pending -> context.resources.getQuantityString(R.plurals.wg_to_send, s!!.pendingCount, s.pendingCount)
        state is AttendanceSnapshot.State.Working -> s?.expectedOutMillis?.let { context.getString(R.string.wg_until, clockOf(it)) } ?: context.getString(R.string.wg_checked_in)
        state is AttendanceSnapshot.State.Done -> context.getString(R.string.wg_checked_out)
        state is AttendanceSnapshot.State.NotCheckedIn -> context.getString(R.string.wg_tap_to_check_in)
        // Never yesterday's answer presented as today's.
        else -> context.getString(R.string.wg_open_to_refresh)
    }
    Column(modifier) {
        Text(headline, maxLines = 1, style = TextStyle(color = ColorProvider(tint), fontSize = 12.sp, fontWeight = FontWeight.Bold))
        Spacer(GlanceModifier.defaultWeight())
        when (state) {
            // Counts up by itself: no widget update, no battery.
            is AttendanceSnapshot.State.Working -> AndroidRemoteViews(RemoteViews(context.packageName, R.layout.widget_chronometer).apply {
                setChronometer(R.id.widget_chronometer, SystemClock.elapsedRealtime() - (System.currentTimeMillis() - state.sinceMillis), null, true)
            })
            is AttendanceSnapshot.State.Done -> Big(clockOf(state.atMillis))
            else -> Big("--:--")
        }
        Text(detail, maxLines = 2, style = TextStyle(color = ColorProvider(Color(0xFFA1A1AA)), fontSize = 11.sp))
    }
}

@Composable
private fun Big(text: String) = Text(text, maxLines = 1, style = TextStyle(color = ColorProvider(Color.White), fontSize = 28.sp, fontWeight = FontWeight.Bold))

@Composable
private fun Right(s: AttendanceSnapshot?, modifier: GlanceModifier) {
    val context = LocalContext.current
    val today = OfficeTime.today().toString()
    Column(modifier) {
        if (s != null && s.dateKey == today) {
            s.checkInAtMillis?.let { Line(context.getString(R.string.wg_in_at, clockOf(it)), GREEN) }
            when {
                s.checkOutAtMillis != null -> Line(context.getString(R.string.wg_out_at, clockOf(s.checkOutAtMillis)), GREEN)
                s.expectedOutMillis != null && (s.checkInAtMillis != null || s.queuedSinceMillis != null) ->
                    if (s.expectedOutMillis > System.currentTimeMillis()) Line(context.getString(R.string.wg_until, clockOf(s.expectedOutMillis)), VIOLET)
                    else Line(context.getString(R.string.wg_past_check_out, clockOf(s.expectedOutMillis)), AMBER)
                s.checkInAtMillis == null && s.queuedSinceMillis == null -> Line(context.getString(R.string.wg_not_in), Color(0xFF9CA3AF))
            }
        } else Line(context.getString(R.string.wg_open_to_refresh), Color(0xFF9CA3AF))
        Spacer(GlanceModifier.defaultWeight())
        if (s != null && s.recent.isNotEmpty()) Row {
            s.recent.forEach { d ->
                Column(GlanceModifier.padding(end = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(GlanceModifier.size(10.dp).cornerRadius(5.dp).background(ColorProvider(toneColor(d.tone)))) {}
                    Spacer(GlanceModifier.height(2.dp))
                    Text(weekdayLetter(d.dateKey), style = TextStyle(color = ColorProvider(Color(0xFFA1A1AA)), fontSize = 8.sp))
                }
            }
        }
    }
}

@Composable
private fun Line(text: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = GlanceModifier.padding(bottom = 4.dp)) {
        Box(GlanceModifier.size(6.dp).cornerRadius(3.dp).background(ColorProvider(color))) {}
        Spacer(GlanceModifier.width(6.dp))
        Text(text, maxLines = 1, style = TextStyle(color = ColorProvider(Color.White), fontSize = 12.sp, fontWeight = FontWeight.Medium))
    }
}

private fun weekdayLetter(key: String): String =
    runCatching { LocalDate.parse(key).dayOfWeek.getDisplayName(JTextStyle.NARROW, Locale.getDefault()) }.getOrDefault("")
