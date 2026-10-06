package id.znetworks.nexus.feature.calendar.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.RowScope
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.calendar.CalendarGlance
import id.znetworks.nexus.feature.calendar.CalendarGlance.Bar
import id.znetworks.nexus.feature.calendar.CalendarGlance.Freshness
import id.znetworks.nexus.feature.calendar.CalendarGlance.Overdue
import id.znetworks.nexus.feature.calendar.CalendarGlance.Quadrant
import id.znetworks.nexus.feature.calendar.GlanceScope
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle as JTextStyle
import java.util.Locale

// Calendar widgets (phase 4, plan 4.2; decisions 7, 8, 9): Month (resizable), Month + Coming up, This
// Week and the four Eisenhower lists — one widget per list, since those lists live in widgets alone.
// Each has its own scope (Me / My division / Everyone). Everything is drawn by CalendarGlance from the
// saved snapshot of that scope, so the picture moves at WIB midnight without the app.

enum class CalWidgetKind { MONTH, MONTH_UPCOMING, WEEK, DO, PLAN, ACT, LATER;
    val quadrant: Quadrant? get() = when (this) { DO -> Quadrant.DO; PLAN -> Quadrant.PLAN; ACT -> Quadrant.ACT; LATER -> Quadrant.LATER; else -> null }
}

private val RED = Color(0xFFDC2626)
private val WIB: ZoneId = ZoneId.of("Asia/Jakarta")

/** The quadrant's own colour (red / indigo / amber / grey). */
private fun quadrantColor(q: Quadrant) = when (q) { Quadrant.DO -> RED; Quadrant.PLAN -> Color(0xFF4F46E5); Quadrant.ACT -> Color(0xFFD97706); Quadrant.LATER -> Color(0xFF6B7280) }
private fun quadrantTitle(q: Quadrant) = when (q) { Quadrant.DO -> R.string.wcal_q_do; Quadrant.PLAN -> R.string.wcal_q_plan; Quadrant.ACT -> R.string.wcal_q_act; Quadrant.LATER -> R.string.wcal_q_later }
private fun tint(hex: String): Color = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color(0xFF64748B))

object CalendarWidgets {
    private val kinds = listOf(CalMonthWidget::class.java, CalMonthUpcomingWidget::class.java, CalWeekWidget::class.java,
        CalDoWidget::class.java, CalPlanWidget::class.java, CalActWidget::class.java, CalLaterWidget::class.java)

    /** Debug screenshots only (UiPreviewActivity): draw this instead of the saved snapshot. Never set in release. */
    @Volatile var previewOverride: ((GlanceScope) -> SavedGlance?)? = null

    suspend fun updateAll(context: Context) {
        CalMonthWidget().updateAll(context); CalMonthUpcomingWidget().updateAll(context); CalWeekWidget().updateAll(context)
        CalDoWidget().updateAll(context); CalPlanWidget().updateAll(context); CalActWidget().updateAll(context); CalLaterWidget().updateAll(context)
    }

    suspend fun anyPlaced(context: Context): Boolean {
        val m = GlanceAppWidgetManager(context)
        return kinds.any { runCatching { m.getGlanceIds(it).isNotEmpty() }.getOrDefault(false) }
    }

    /** The app's language (AppLanguage), not the phone's: widgets draw outside any activity. */
    fun locale(context: Context): Locale =
        if (context.getSharedPreferences("nexus.language", Context.MODE_PRIVATE).getString("tag", "en") == "in") Locale.forLanguageTag("in-ID") else Locale.ENGLISH

    fun localized(context: Context): Context =
        context.createConfigurationContext(Configuration(context.resources.configuration).apply { setLocale(locale(context)) })
}

/** Per widget instance: the scope picked in CalendarWidgetConfigActivity (default Me). */
object CalendarWidgetPrefs {
    private fun prefs(c: Context) = c.getSharedPreferences("nexus.calendar.widgets", Context.MODE_PRIVATE)
    fun scope(c: Context, appWidgetId: Int): GlanceScope =
        GlanceScope.entries.firstOrNull { it.wire == prefs(c).getString("scope.$appWidgetId", null) } ?: GlanceScope.ME
    fun setScope(c: Context, appWidgetId: Int, scope: GlanceScope) = prefs(c).edit().putString("scope.$appWidgetId", scope.wire).commit()
    fun remove(c: Context, ids: IntArray) = prefs(c).edit().apply { ids.forEach { remove("scope.$it") } }.apply()
}

/** What one widget draws: a sentence (signed out, off, nothing yet, no calendar), or a snapshot at a moment. */
private sealed interface WidgetData {
    data class Message(val text: String) : WidgetData
    data class Ready(val saved: SavedGlance, val nowMs: Long, val stale: Boolean) : WidgetData
}

private fun dataFor(context: Context, lc: Context, scope: GlanceScope): WidgetData {
    val now = System.currentTimeMillis()
    val preview = CalendarWidgets.previewOverride
    val saved = if (preview != null) preview(scope) else {
        val c = (context.applicationContext as NexusApplication).container
        if (c.sessionStore.current == null) return WidgetData.Message(lc.getString(R.string.wcal_signed_out))
        if (!c.remoteConfig.current.calendarWidgets) return WidgetData.Message(lc.getString(R.string.wcal_open_nexus))
        c.calendarSnapshots.load(scope)
    }
    return when (CalendarGlance.freshness(saved?.snapshot, saved?.savedAt ?: 0, now)) {
        Freshness.EMPTY -> WidgetData.Message(lc.getString(R.string.wcal_stale))
        Freshness.NONE, Freshness.OFF -> WidgetData.Message(lc.getString(R.string.wcal_no_calendar))
        Freshness.STALE -> WidgetData.Ready(saved!!, now, stale = true)
        Freshness.FRESH -> WidgetData.Ready(saved!!, now, stale = false)
    }
}

abstract class CalendarWidget(private val kind: CalWidgetKind) : GlanceAppWidget() {
    // Exact: the month changes what it draws with every size (dots → bars → titles), lists fit their rows.
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val appWidgetId = runCatching { GlanceAppWidgetManager(context).getAppWidgetId(id) }.getOrDefault(AppWidgetManager.INVALID_APPWIDGET_ID)
        val lc = CalendarWidgets.localized(context)
        val data = dataFor(context, lc, CalendarWidgetPrefs.scope(context, appWidgetId))
        provideContent { GlanceTheme { Root(lc, kind, data) } }
    }
}

class CalMonthWidget : CalendarWidget(CalWidgetKind.MONTH)
class CalMonthUpcomingWidget : CalendarWidget(CalWidgetKind.MONTH_UPCOMING)
class CalWeekWidget : CalendarWidget(CalWidgetKind.WEEK)
class CalDoWidget : CalendarWidget(CalWidgetKind.DO)
class CalPlanWidget : CalendarWidget(CalWidgetKind.PLAN)
class CalActWidget : CalendarWidget(CalWidgetKind.ACT)
class CalLaterWidget : CalendarWidget(CalWidgetKind.LATER)

/** Placing a widget fetches at once (the hourly worker skips phones without one) and books the next redraw. */
abstract class CalendarWidgetReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        val c = (context.applicationContext as NexusApplication).container
        if (c.sessionStore.current != null) { c.refreshCalendarWidgets(); CalendarWidgetWork.schedulePeriodic(context) }
        CalendarWidgetWork.scheduleRedraw(context)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        super.onDeleted(context, appWidgetIds)
        CalendarWidgetPrefs.remove(context, appWidgetIds)
    }
}

class CalMonthWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalMonthWidget() }
class CalMonthUpcomingWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalMonthUpcomingWidget() }
class CalWeekWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalWeekWidget() }
class CalDoWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalDoWidget() }
class CalPlanWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalPlanWidget() }
class CalActWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalActWidget() }
class CalLaterWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalLaterWidget() }

// ── Links ──

private fun open(lc: Context, link: String): Action = actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(lc.packageName))
private fun dayAction(lc: Context, day: String) = open(lc, "nexus://calendar?date=$day")

/** A task opens the way the Calendar opens it (editable → task, else read-only); masked → its day only. */
private fun taskAction(lc: Context, b: Bar): Action = when {
    b.masked || b.id == null -> if (b.day != null) dayAction(lc, b.day) else open(lc, "nexus://calendar")
    b.day != null -> open(lc, "nexus://calendar?date=${b.day}&task=${Uri.encode(b.id)}")
    else -> open(lc, "nexus://calendar?task=${Uri.encode(b.id)}")
}

// ── Text ──

private fun locale(lc: Context): Locale = lc.resources.configuration.locales[0]
private fun indonesian(lc: Context) = locale(lc).language in setOf("in", "id")
private fun clock(lc: Context, hm: String) = if (indonesian(lc)) hm.replace(':', '.') else hm
private fun shortDay(lc: Context, day: String) = DateTimeFormatter.ofPattern("EEE d", locale(lc)).format(LocalDate.parse(day))
private fun title(lc: Context, b: Bar) = if (b.masked || b.title == null) lc.getString(R.string.cal_internal) else b.title

/** "Hari ini 19.00", "Besok", "Kam 8", "Tanpa tenggat". */
private fun dueText(lc: Context, b: Bar, today: String): String {
    val day = b.day ?: return lc.getString(R.string.wcal_no_due)
    val t = b.time?.let { clock(lc, it) }
    return when (day) {
        today -> if (t != null) lc.getString(R.string.wcal_today_at, t) else lc.getString(R.string.wcal_today)
        CalendarGlance.addDays(today, 1) -> if (t != null) lc.getString(R.string.wcal_tomorrow_at, t) else lc.getString(R.string.wcal_tomorrow)
        else -> shortDay(lc, day) + (t?.let { " · $it" } ?: "")
    }
}

private fun scopeLabel(lc: Context, wire: String?) = lc.getString(when (wire) { "division" -> R.string.wcal_scope_division; "all" -> R.string.wcal_scope_all; else -> R.string.wcal_scope_me })

// ── Drawing ──

@Composable private fun fg() = GlanceTheme.colors.onSurface
@Composable private fun muted() = GlanceTheme.colors.onSurfaceVariant
private fun cp(c: Color) = ColorProvider(c)

@Composable
private fun Root(lc: Context, kind: CalWidgetKind, data: WidgetData) {
    val base = GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).cornerRadius(16.dp).padding(10.dp)
    when (data) {
        is WidgetData.Message -> Column(base.clickable(open(lc, "nexus://calendar")), verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally) {
            kind.quadrant?.let { Text(lc.getString(quadrantTitle(it)), maxLines = 1, style = TextStyle(color = cp(quadrantColor(it)), fontSize = 12.sp, fontWeight = FontWeight.Bold)); Spacer(GlanceModifier.height(6.dp)) }
            Text("NEXUS", style = TextStyle(color = fg(), fontSize = 13.sp, fontWeight = FontWeight.Bold))
            Spacer(GlanceModifier.height(4.dp))
            Text(data.text, maxLines = 3, style = TextStyle(color = muted(), fontSize = 12.sp, textAlign = TextAlign.Center))
        }
        is WidgetData.Ready -> Column(base) {
            Box(GlanceModifier.fillMaxWidth().defaultWeight()) {
                when (kind) {
                    CalWidgetKind.MONTH -> MonthWidget(lc, data)
                    CalWidgetKind.MONTH_UPCOMING -> MonthUpcomingWidget(lc, data)
                    CalWidgetKind.WEEK -> WeekWidget(lc, data)
                    else -> QuadrantWidget(lc, data, kind.quadrant!!)
                }
            }
            Footer(lc, data)
        }
    }
}

/** "Saya · Diperbarui 14.05", or "Buka NEXUS untuk memperbarui" once stale. */
@Composable
private fun Footer(lc: Context, d: WidgetData.Ready) {
    val time = Instant.ofEpochMilli(d.saved.savedAt).atZone(WIB).let { clock(lc, "%02d:%02d".format(it.hour, it.minute)) }
    val text = scopeLabel(lc, d.saved.snapshot.scope) + " · " + if (d.stale) lc.getString(R.string.wcal_stale) else lc.getString(R.string.wcal_updated, time)
    Text(text, maxLines = 1, modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp).clickable(open(lc, "nexus://calendar")),
        style = TextStyle(color = if (d.stale) cp(RED) else muted(), fontSize = 9.sp))
}

private enum class Detail { DOTS, BARS, TITLES }

@Composable
private fun MonthWidget(lc: Context, d: WidgetData.Ready) {
    val size = LocalSize.current
    // 3×3 → dots, 4×4 → bars, 5×5 → bars + titles (plan 4.2).
    val detail = when {
        size.width < 250.dp || size.height < 250.dp -> Detail.DOTS
        size.width < 320.dp || size.height < 340.dp -> Detail.BARS
        else -> Detail.TITLES
    }
    val m = CalendarGlance.monthView(d.saved.snapshot, d.nowMs, 2)
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth().clickable(dayAction(lc, m.today)), verticalAlignment = Alignment.CenterVertically) {
            Text(monthTitle(lc, m.today), maxLines = 1, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = fg(), fontSize = 14.sp, fontWeight = FontWeight.Bold))
            Text(lc.getString(R.string.wcal_year, m.year.day, m.year.percent), maxLines = 1, style = TextStyle(color = muted(), fontSize = 10.sp))
        }
        Spacer(GlanceModifier.height(4.dp))
        MonthGrid(lc, m, detail, compact = false, modifier = GlanceModifier.fillMaxWidth().defaultWeight())
    }
}

private fun monthTitle(lc: Context, today: String) =
    DateTimeFormatter.ofPattern("MMMM yyyy", locale(lc)).format(LocalDate.parse(today)).replaceFirstChar { it.titlecase(locale(lc)) }

@Composable
private fun MonthGrid(lc: Context, m: CalendarGlance.MonthView, detail: Detail, compact: Boolean, modifier: GlanceModifier) {
    Column(modifier) {
        Row(GlanceModifier.fillMaxWidth()) {
            (0 until 7).forEach { k ->
                val name = LocalDate.parse(m.cells[k].bars.day).dayOfWeek.getDisplayName(JTextStyle.NARROW, locale(lc))
                Text(name, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = if (k == 6) cp(RED) else muted(), fontSize = if (compact) 8.sp else 9.sp, textAlign = TextAlign.Center))
            }
        }
        (0 until 6).forEach { w ->
            Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                (0 until 7).forEach { k -> DayCell(lc, m.cells[w * 7 + k], detail, compact) }
            }
        }
    }
}

@Composable
private fun RowScope.DayCell(lc: Context, cell: CalendarGlance.MonthCell, detail: Detail, compact: Boolean) {
    val b = cell.bars
    val red = b.sunday || b.holiday != null
    val numberColor = when {
        b.today -> GlanceTheme.colors.onPrimary
        red -> cp(if (cell.inMonth) RED else RED.copy(alpha = 0.4f))
        !cell.inMonth -> cp(Color(0xFF9CA3AF).copy(alpha = 0.6f))
        else -> fg()
    }
    val circle = if (compact) 14.dp else 18.dp
    Column(GlanceModifier.defaultWeight().fillMaxHeight().padding(horizontal = 1.dp).clickable(dayAction(lc, b.day)), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(GlanceModifier.size(circle).cornerRadius(circle / 2).background(if (b.today) GlanceTheme.colors.primary else cp(Color.Transparent)), contentAlignment = Alignment.Center) {
                Text(b.day.takeLast(2).trimStart('0'), style = TextStyle(color = numberColor, fontSize = if (compact) 8.sp else 10.sp, fontWeight = if (b.today) FontWeight.Bold else FontWeight.Medium))
            }
            if (b.overdue && detail != Detail.DOTS) Box(GlanceModifier.size(4.dp).cornerRadius(2.dp).background(cp(RED))) {}
        }
        val faded = if (cell.inMonth) 1f else 0.4f
        when (detail) {
            Detail.DOTS -> Row(GlanceModifier.padding(top = 1.dp)) {
                if (b.overdue) Dot(RED.copy(alpha = faded))
                b.bars.take(if (b.overdue) 2 else 3).forEach { Dot(tint(it.color).copy(alpha = if (it.dim) 0.35f * faded else faded)) }
            }
            Detail.BARS -> Column(GlanceModifier.fillMaxWidth().padding(top = 2.dp)) {
                b.bars.forEach { bar ->
                    Box(GlanceModifier.fillMaxWidth().height(4.dp).cornerRadius(2.dp).background(cp(tint(bar.color).copy(alpha = if (bar.dim) 0.3f * faded else faded)))) {}
                    Spacer(GlanceModifier.height(2.dp))
                }
                if (b.more > 0) Text("+${b.more}", style = TextStyle(color = muted(), fontSize = 7.sp))
            }
            Detail.TITLES -> Column(GlanceModifier.fillMaxWidth().padding(top = 1.dp)) {
                b.bars.forEach { bar -> Chip(lc, bar, faded) }
                if (b.more > 0) Text("+${b.more}", style = TextStyle(color = muted(), fontSize = 7.sp))
            }
        }
    }
}

@Composable
private fun Dot(c: Color) {
    Box(GlanceModifier.size(4.dp).cornerRadius(2.dp).background(cp(c))) {}
    Spacer(GlanceModifier.width(1.dp))
}

/** A bar with its title: dim = faded, ✓ only when ticked done (never a calendar-only project), overdue = red. */
@Composable
private fun Chip(lc: Context, bar: Bar, faded: Float, fontSize: Float = 7f, lines: Int = 1) {
    val c = tint(bar.color)
    val text = (if (bar.done) "✓ " else "") + title(lc, bar)
    Row(GlanceModifier.fillMaxWidth().padding(bottom = 1.dp).cornerRadius(2.dp).background(cp(c.copy(alpha = if (bar.dim) 0.10f * faded else 0.22f * faded))),
        verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.width(2.dp).height((fontSize * 1.5f * lines).dp).background(cp(if (bar.overdue == Overdue.RECENT) RED else c.copy(alpha = if (bar.dim) 0.4f else 1f)))) {}
        Text(text, maxLines = lines, modifier = GlanceModifier.padding(start = 2.dp),
            style = TextStyle(color = if (bar.dim) muted() else fg(), fontSize = fontSize.sp))
    }
}

@Composable
private fun MonthUpcomingWidget(lc: Context, d: WidgetData.Ready) {
    val m = CalendarGlance.monthView(d.saved.snapshot, d.nowMs, 3)
    val up = CalendarGlance.upcoming(d.saved.snapshot, d.nowMs, 4)
    Row(GlanceModifier.fillMaxSize()) {
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            Text(monthTitle(lc, m.today), maxLines = 1, modifier = GlanceModifier.clickable(dayAction(lc, m.today)), style = TextStyle(color = fg(), fontSize = 11.sp, fontWeight = FontWeight.Bold))
            MonthGrid(lc, m, Detail.DOTS, compact = true, modifier = GlanceModifier.fillMaxWidth().defaultWeight())
        }
        Spacer(GlanceModifier.width(10.dp))
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            Text(lc.getString(R.string.wcal_coming_up), maxLines = 1, style = TextStyle(color = fg(), fontSize = 11.sp, fontWeight = FontWeight.Bold))
            Spacer(GlanceModifier.height(4.dp))
            if (up.rows.isEmpty()) Text(lc.getString(R.string.wcal_nothing_up), style = TextStyle(color = muted(), fontSize = 11.sp))
            up.rows.forEach { b -> ListRow(lc, b, CalendarGlance.wibClock(d.nowMs).day, showProject = false, compact = true) }
            if (up.more > 0) Text(lc.resources.getQuantityString(R.plurals.cal_more_n, up.more, up.more), style = TextStyle(color = muted(), fontSize = 9.sp))
        }
    }
}

/** One task in a list: colour, title, due (+ project), red when overdue. */
@Composable
private fun ListRow(lc: Context, b: Bar, today: String, showProject: Boolean, compact: Boolean) {
    val c = tint(b.color)
    Row(GlanceModifier.fillMaxWidth().padding(bottom = if (compact) 3.dp else 5.dp).clickable(taskAction(lc, b)), verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.width(3.dp).height(if (compact) 22.dp else 28.dp).cornerRadius(2.dp).background(cp(if (b.overdue == Overdue.RECENT) RED else c))) {}
        Spacer(GlanceModifier.width(6.dp))
        Column(GlanceModifier.defaultWeight()) {
            Text(title(lc, b), maxLines = 1, style = TextStyle(color = fg(), fontSize = if (compact) 10.sp else 12.sp, fontWeight = FontWeight.Medium))
            // A masked row never names its project (decision 1).
            val sub = listOfNotNull(dueText(lc, b, today), b.project?.takeIf { showProject && !b.masked }).joinToString(" · ")
            Text(sub, maxLines = 1, style = TextStyle(color = if (b.overdue == Overdue.RECENT) cp(RED) else muted(), fontSize = if (compact) 9.sp else 10.sp))
        }
    }
}

@Composable
private fun WeekWidget(lc: Context, d: WidgetData.Ready) {
    val week = CalendarGlance.weekView(d.saved.snapshot, d.nowMs, 3)
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(lc.getString(R.string.wcal_week_name), maxLines = 1, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = fg(), fontSize = 12.sp, fontWeight = FontWeight.Bold))
            val f = DateTimeFormatter.ofPattern("d MMM", locale(lc))
            Text(f.format(LocalDate.parse(week.first().day)) + " – " + f.format(LocalDate.parse(week.last().day)), maxLines = 1, style = TextStyle(color = muted(), fontSize = 10.sp))
        }
        Spacer(GlanceModifier.height(4.dp))
        Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
            week.forEach { day ->
                Column(GlanceModifier.defaultWeight().fillMaxHeight().padding(horizontal = 1.dp).cornerRadius(6.dp)
                    .background(if (day.today) GlanceTheme.colors.secondaryContainer else cp(Color.Transparent)).clickable(dayAction(lc, day.day)),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    val red = day.sunday || day.holiday != null
                    Text(LocalDate.parse(day.day).dayOfWeek.getDisplayName(JTextStyle.SHORT, locale(lc)), maxLines = 1,
                        style = TextStyle(color = if (red) cp(RED) else muted(), fontSize = 8.sp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(day.day.takeLast(2).trimStart('0'), style = TextStyle(color = if (red) cp(RED) else fg(), fontSize = 12.sp, fontWeight = FontWeight.Bold))
                        if (day.overdue) Box(GlanceModifier.size(4.dp).cornerRadius(2.dp).background(cp(RED))) {}
                    }
                    day.bars.forEach { Chip(lc, it, 1f, fontSize = 7f, lines = 2) }
                    if (day.more > 0) Text("+${day.more}", style = TextStyle(color = muted(), fontSize = 7.sp))
                }
            }
        }
    }
}

@Composable
private fun QuadrantWidget(lc: Context, d: WidgetData.Ready, q: Quadrant) {
    val size = LocalSize.current
    val list = CalendarGlance.quadrants(d.saved.snapshot, d.nowMs).first { it.quadrant == q }
    val today = CalendarGlance.wibClock(d.nowMs).day
    // 2×2 shows 2, 4×2 about 3, taller ones up to 8 (rows of ~38 dp under a ~30 dp header).
    val fit = ((size.height.value - 58) / 38).toInt().coerceIn(1, 8)
    val wide = size.width >= 220.dp
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(GlanceModifier.size(8.dp).cornerRadius(4.dp).background(cp(quadrantColor(q)))) {}
            Spacer(GlanceModifier.width(6.dp))
            Text(lc.getString(quadrantTitle(q)), maxLines = 1, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = cp(quadrantColor(q)), fontSize = 12.sp, fontWeight = FontWeight.Bold))
            Text(list.count.toString(), style = TextStyle(color = cp(quadrantColor(q)), fontSize = 16.sp, fontWeight = FontWeight.Bold))
        }
        if (list.rows.isEmpty()) Text(lc.getString(R.string.wcal_q_empty), style = TextStyle(color = muted(), fontSize = 12.sp))
        list.rows.take(fit).forEach { ListRow(lc, it, today, showProject = wide, compact = false) }
        if (list.count > fit) Text(lc.resources.getQuantityString(R.plurals.cal_more_n, list.count - fit, list.count - fit), style = TextStyle(color = muted(), fontSize = 10.sp))
    }
}
