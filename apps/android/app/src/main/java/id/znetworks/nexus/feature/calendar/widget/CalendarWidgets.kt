package id.znetworks.nexus.feature.calendar.widget

import id.znetworks.nexus.core.i18n.AppDateFormats

import id.znetworks.nexus.ui.theme.NightHues
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
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
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.ImageProvider
import androidx.glance.Image
import androidx.glance.ColorFilter
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProviders
import androidx.glance.color.colorProviders
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
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
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
import id.znetworks.nexus.feature.calendar.CalendarDiskCache
import id.znetworks.nexus.ui.theme.NxDark
import id.znetworks.nexus.ui.theme.NxLight
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import androidx.glance.color.ColorProvider as DayNight

// Calendar widgets (phase 4, plan 4.2; decisions 7, 8, 9): Month (resizable), Month + Coming up, This
// Week and the four Eisenhower lists — one widget per list, since those lists live in widgets alone.
// Each has its own scope (Mine / My division / Everyone). Everything is drawn by CalendarGlance from the
// saved snapshot of that scope, so the picture moves at WIB midnight without the app. Audit "impeccable"
// (6 Oct): day/night colours that pass contrast, NEXUS colours below Android 12, text ≥ 10 sp with spoken
// descriptions, links that keep the scope, "+N" that leads somewhere, size limits the layout can hold.

enum class CalWidgetKind { MONTH, MONTH_UPCOMING, WEEK, DO, PLAN, ACT, LATER;
    val quadrant: Quadrant? get() = when (this) { DO -> Quadrant.DO; PLAN -> Quadrant.PLAN; ACT -> Quadrant.ACT; LATER -> Quadrant.LATER; else -> null }
}

private val WIB: ZoneId = ZoneId.of("Asia/Jakarta")

// Hues for bars and dots; text uses the day/night pair beside each, ≥ 4.5:1 on the widget surface (audit #17).
private val RED = Color(0xFFDC2626)
private val RED_TEXT = DayNight(day = Color(0xFFB91C1C), night = Color(0xFFF87171))
private fun quadrantHue(q: Quadrant) = when (q) { Quadrant.DO -> RED; Quadrant.PLAN -> Color(0xFF4F46E5); Quadrant.ACT -> Color(0xFFD97706); Quadrant.LATER -> Color(0xFF6B7280) }
private fun quadrantText(q: Quadrant) = when (q) {
    Quadrant.DO -> RED_TEXT
    Quadrant.PLAN -> DayNight(day = Color(0xFF4338CA), night = Color(0xFFA5B4FC))
    Quadrant.ACT -> DayNight(day = Color(0xFF92400E), night = Color(0xFFFB923C))
    Quadrant.LATER -> DayNight(day = Color(0xFF4B5563), night = Color(0xFF9CA3AF))
}
private fun quadrantTitle(q: Quadrant) = when (q) { Quadrant.DO -> R.string.wcal_q_do; Quadrant.PLAN -> R.string.wcal_q_plan; Quadrant.ACT -> R.string.wcal_q_act; Quadrant.LATER -> R.string.wcal_q_later }
/** owner: the names stay; "Mendesak" and "Suatu hari" carry a short note of what is in them. */
private fun quadrantNote(q: Quadrant) = when (q) { Quadrant.ACT -> R.string.wcal_q_act_note; Quadrant.LATER -> R.string.wcal_q_later_note; else -> null }
private fun quadrantEmpty(q: Quadrant) = when (q) { Quadrant.DO -> R.string.wcal_q_do_empty; Quadrant.PLAN -> R.string.wcal_q_plan_empty; Quadrant.ACT -> R.string.wcal_q_act_empty; Quadrant.LATER -> R.string.wcal_q_later_empty }
/**
 * Widget text grows with the system font size up to 1.3×; a widget's cells and rows have a fixed size, so
 * beyond that its grids stop being readable — larger text belongs to the app (audit 2 #6).
 */
@Volatile private var fontFactor = 1f
private fun fs(sp: Float) = (sp * fontFactor).sp
/** The font scale the widget text is actually drawn at (system scale, capped): row heights grow with it. */
@Volatile private var fontScaleUsed = 1f
/** The system font scale: a Glance `sp` is drawn at sp × this. */
@Volatile private var systemFontScale = 1f
/** Height of one line of text drawn at [sp] (before the cap), with the TextView's own padding. */
private fun lineDp(sp: Float) = sp * fontScaleUsed * 1.35f
/** The strip under a day number in the dots grids: fixed, so its dots and checks are never clipped (audit 3 #1). */
private val MARK_STRIP = 7.dp

/**
 * The dots grids (3×3 month, mini month): each row gets an exact height from the widget's size and the font
 * scale, the mark strip keeps its 7 dp, and the day number takes what is left — shrinking at large font
 * sizes instead of pushing the marks out (audit 3 #1). Returns the row height and the number's font size.
 */
private fun dotsRows(gridHeightDp: Float): Pair<Dp, TextUnit> {
    // An estimate on the safe side: it only sizes the number; the rows themselves are laid out by weight.
    val row = (gridHeightDp / 6f - 2f).coerceAtLeast(12f)
    val numberDp = minOf(10f * fontScaleUsed, (row - MARK_STRIP.value - 2f) / 1.45f).coerceAtLeast(6f)
    return row.dp to (numberDp / systemFontScale).sp
}
private const val WIDGET_MAX_FONT_SCALE = 1.3f

/** Night colours for the task colours (WidgetHues), from the Calendar's cached structure of the person signed in. */
@Volatile private var darkOf: Map<String, String> = emptyMap()
/** A task colour as a day/night pair with the same alpha in both (audit 2 #10). */
private fun hue(hex: String, alpha: Float = 1f) = DayNight(day = NightHues.day(hex).copy(alpha = alpha), night = NightHues.night(hex, darkOf).copy(alpha = alpha))

/**
 * NEXUS colours for Android 8–11, where there is no Material You (audit #26), built from the app's own
 * tokens so a palette change reaches the widgets too (audit 2 #23). Android 12+ keeps the wallpaper colours.
 */
private val NexusWidgetColors: ColorProviders by lazy {
    val l = NxLight; val d = NxDark
    fun p(day: Color, night: Color) = DayNight(day = day, night = night)
    colorProviders(
        primary = p(l.navy, d.navy), onPrimary = p(l.onNavy, d.onNavy),
        primaryContainer = p(l.accentBg, d.accentBg), onPrimaryContainer = p(l.accentFg, d.accentFg),
        secondary = p(l.violetText, d.violetText), onSecondary = p(Color.White, d.background),
        secondaryContainer = p(l.muted, d.muted), onSecondaryContainer = p(l.foreground, d.foreground),
        tertiary = p(l.blue, d.blue), onTertiary = p(Color.White, d.background),
        tertiaryContainer = p(l.accentBg, d.accentBg), onTertiaryContainer = p(l.accentFg, d.accentFg),
        error = p(l.dangerText, d.dangerText), errorContainer = p(l.warningBg, d.warningBg),
        onError = p(l.onDanger, d.onDanger), onErrorContainer = p(l.warningFg, d.warningFg),
        background = p(l.background, d.background), onBackground = p(l.foreground, d.foreground),
        surface = p(l.card, d.card), onSurface = p(l.foreground, d.foreground),
        surfaceVariant = p(l.muted, d.muted), onSurfaceVariant = p(l.mutedFg, d.mutedFg),
        outline = p(l.boundary, d.boundary), inverseOnSurface = p(l.card, d.card),
        inverseSurface = p(l.onyx, d.onyx), inversePrimary = p(d.navy, l.navy),
        widgetBackground = p(l.card, d.card),
    )
}

object CalendarWidgets {
    private val kinds = listOf(CalMonthWidget::class.java, CalMonthUpcomingWidget::class.java, CalWeekWidget::class.java,
        CalDoWidget::class.java, CalPlanWidget::class.java, CalActWidget::class.java, CalLaterWidget::class.java)

    /** Debug screenshots only (WidgetPreviewActivity): draw this instead of the saved snapshot. Never set in release. */
    @Volatile var previewOverride: ((GlanceScope) -> SavedGlance?)? = null

    suspend fun updateAll(context: Context) {
        // A running Glance session reuses provideContent, so publish changes to its observed inputs.
        (context.applicationContext as NexusApplication).container.calendarSnapshots.invalidate()
        CalMonthWidget().updateAll(context); CalMonthUpcomingWidget().updateAll(context); CalWeekWidget().updateAll(context)
        CalDoWidget().updateAll(context); CalPlanWidget().updateAll(context); CalActWidget().updateAll(context); CalLaterWidget().updateAll(context)
    }

    suspend fun anyPlaced(context: Context): Boolean {
        val m = GlanceAppWidgetManager(context)
        return kinds.any { runCatching { m.getGlanceIds(it).isNotEmpty() }.getOrDefault(false) }
    }

    /** The scopes the placed widgets show: only those are fetched and kept (audit #20). */
    suspend fun placedScopes(context: Context): Set<GlanceScope> {
        val m = GlanceAppWidgetManager(context)
        return kinds.flatMap { k -> runCatching { m.getGlanceIds(k) }.getOrDefault(emptyList()) }
            .mapNotNull { runCatching { m.getAppWidgetId(it) }.getOrNull() }
            .map { CalendarWidgetPrefs.scope(context, it) }.toSet()
    }

    /** The app's language (AppLanguage), not the phone's: widgets draw outside any activity. */
    fun locale(context: Context): Locale =
        if (context.getSharedPreferences("nexus.language", Context.MODE_PRIVATE).getString("tag", "en") == "in") Locale.forLanguageTag("in-ID") else Locale.ENGLISH

    fun localized(context: Context): Context =
        context.createConfigurationContext(Configuration(context.resources.configuration).apply { setLocale(locale(context)) })
}

/** Per widget instance: the scope picked in CalendarWidgetConfigActivity (default Mine). */
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
        val container = (context.applicationContext as NexusApplication).container
        val scale = context.resources.configuration.fontScale.coerceAtLeast(1f)
        fontFactor = minOf(scale, WIDGET_MAX_FONT_SCALE) / scale
        fontScaleUsed = minOf(scale, WIDGET_MAX_FONT_SCALE)
        systemFontScale = scale
        // The Bagan's dark colours, as the app shows them (audit 2 #10).
        val uid = (context.applicationContext as NexusApplication).container.sessionStore.current?.userId
        if (uid != null) runCatching {
            CalendarDiskCache(java.io.File(context.cacheDir, "calendar")).structure(uid)?.value?.units
        }.getOrNull()?.let { units -> darkOf = NightHues.darkMap(units.map { it.color to it.colorDark }) }
        provideContent {
            // update/updateAll do not restart a live provideGlance invocation. Auth and snapshot
            // invalidations must be read in composition; never close over a previous person's Ready.
            val session by container.sessionStore.session.collectAsState()
            val revision by container.calendarSnapshots.revision.collectAsState()
            key(session, revision) {
                val lc = CalendarWidgets.localized(context)
                val data = dataFor(context, lc, CalendarWidgetPrefs.scope(context, appWidgetId))
                if (Build.VERSION.SDK_INT >= 31) GlanceTheme { Root(lc, kind, data) }
                else GlanceTheme(colors = NexusWidgetColors) { Root(lc, kind, data) }
            }
        }
    }
}

class CalMonthWidget : CalendarWidget(CalWidgetKind.MONTH)
class CalMonthUpcomingWidget : CalendarWidget(CalWidgetKind.MONTH_UPCOMING)
class CalWeekWidget : CalendarWidget(CalWidgetKind.WEEK)
class CalDoWidget : CalendarWidget(CalWidgetKind.DO)
class CalPlanWidget : CalendarWidget(CalWidgetKind.PLAN)
class CalActWidget : CalendarWidget(CalWidgetKind.ACT)
class CalLaterWidget : CalendarWidget(CalWidgetKind.LATER)

/** Placing a widget fetches its scope at once and books the next redraw. */
abstract class CalendarWidgetReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        val c = (context.applicationContext as NexusApplication).container
        if (c.sessionStore.current != null) { c.refreshCalendarWidgets(); CalendarWidgetWork.schedulePeriodic(context) }
        c.appScope.launch { CalendarWidgetWork.scheduleRedraw(context) }
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        super.onDeleted(context, appWidgetIds)
        CalendarWidgetPrefs.remove(context, appWidgetIds)
        // A scope no widget shows any more is dropped, and with no widget left the alarms stop.
        val c = (context.applicationContext as NexusApplication).container
        c.refreshCalendarWidgets()
        c.appScope.launch { CalendarWidgetWork.scheduleRedraw(context) }
    }
}

class CalMonthWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalMonthWidget() }
class CalMonthUpcomingWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalMonthUpcomingWidget() }
class CalWeekWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalWeekWidget() }
class CalDoWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalDoWidget() }
class CalPlanWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalPlanWidget() }
class CalActWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalActWidget() }
class CalLaterWidgetReceiver : CalendarWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = CalLaterWidget() }

// ── Links: every one carries the widget's scope, so the Calendar opens on the same tasks (audit #33) ──

/** How many list rows a widget shows (pure, tested): the "+N" row is reserved only when some rows don't fit (audit 3 #5). */
object WidgetFit {
    /** Rows of [rowDp] in [heightDp] under [headerDp]; when [count] does not all fit, room for a [moreDp] "+N" row first. */
    fun rows(heightDp: Float, headerDp: Float, rowDp: Float, moreDp: Float, count: Int): Int {
        val all = ((heightDp - headerDp) / rowDp).toInt()
        if (count <= all) return count.coerceAtLeast(0)
        return ((heightDp - headerDp - moreDp) / rowDp).toInt().coerceAtLeast(1)
    }
    /** Lines a bold title of [chars] characters at [spDrawn] takes in [widthDp] (≈ 0.58 em a character), at most [max]. */
    fun titleLines(chars: Int, spDrawn: Float, widthDp: Float, max: Int = 2): Int =
        kotlin.math.ceil(chars * spDrawn * 0.58f / widthDp.coerceAtLeast(1f)).toInt().coerceIn(1, max)
}

/** List rows and the "+N" row are at least 44–48 dp tall: real targets (audit 3 #8). */
private fun rowDp(compact: Boolean) = 44f * fontScaleUsed.coerceAtLeast(1f)
private const val MORE_DP = 48f

/** "+N more" as a full-width 48 dp row. */
@Composable
private fun MoreRow(text: String, action: Action, sizeSp: Float) {
    Row(GlanceModifier.fillMaxWidth().height(MORE_DP.dp).clickable(action), verticalAlignment = Alignment.CenterVertically) {
        Text(text, maxLines = 1, style = TextStyle(color = GlanceTheme.colors.primary, fontSize = fs(sizeSp), fontWeight = FontWeight.Medium))
    }
}

/** The deep links a widget opens (pure: tested in CalendarWidgetLinksTest). */
object CalendarWidgetLinks {
    fun calendar(scope: String?) = "nexus://calendar?scope=${scope ?: "me"}"
    fun day(day: String, scope: String?) = "nexus://calendar?date=$day&scope=${scope ?: "me"}"
    /** A task opens the way the Calendar opens it (editable → task, else read-only); masked → its day only. */
    fun task(b: Bar, scope: String?): String = when {
        b.masked || b.id == null -> if (b.day != null) day(b.day, scope) else calendar(scope)
        b.day != null -> "nexus://calendar?date=${b.day}&task=${java.net.URLEncoder.encode(b.id, "UTF-8")}&scope=${scope ?: "me"}"
        else -> "nexus://calendar?task=${java.net.URLEncoder.encode(b.id, "UTF-8")}&scope=${scope ?: "me"}"
    }
    /** The whole list behind a quadrant widget's "+N" (audit #40). */
    fun quadrant(q: Quadrant, scope: String?) = "nexus://calendar?view=quadrant&q=${q.wire}&scope=${scope ?: "me"}"
}

private fun open(lc: Context, link: String): Action = actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(lc.packageName))

// ── Text ──

private fun locale(lc: Context): Locale = lc.resources.configuration.locales[0]
private fun indonesian(lc: Context) = locale(lc).language in setOf("in", "id")
private fun clock(lc: Context, hm: String) = if (indonesian(lc)) hm.replace(':', '.') else hm
private fun shortDay(lc: Context, day: String) = DateTimeFormatter.ofPattern("EEE d", locale(lc)).format(LocalDate.parse(day))
private fun longDay(lc: Context, day: String) = DateTimeFormatter.ofPattern("EEEE d MMMM", locale(lc)).format(LocalDate.parse(day))
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

/** "Tue 6 October, 3 tasks, 1 overdue, today" for a day cell (audit #14). */
private fun dayDescription(lc: Context, b: CalendarGlance.DayBars): String = listOfNotNull(
    longDay(lc, b.day),
    if (b.today) lc.getString(R.string.wcal_today) else null,
    if (b.count == 0) lc.getString(R.string.cal_no_tasks) else lc.resources.getQuantityString(R.plurals.cal_tasks_n, b.count, b.count),
    if (b.overdue) lc.getString(R.string.cal_overdue) else null,
    b.holiday,
).joinToString(", ")

/** "Revisi deck, overdue, Wed 30 · 15.00, PATS x Brand" for a list row. */
private fun rowDescription(lc: Context, b: Bar, today: String) = listOfNotNull(
    title(lc, b),
    when { b.done -> lc.getString(R.string.cal_status_done); b.overdue == Overdue.RECENT -> lc.getString(R.string.cal_overdue); else -> null },
    dueText(lc, b, today),
    b.project?.takeIf { !b.masked },
).joinToString(", ")

// ── Drawing ──

/**
 * The widget's background element: the launcher's own corner radius and the app-launch transition on
 * Android 12+; a rounded drawable below (cornerRadius only clips from 12) (audit 2 #27).
 */
@Composable
internal fun widgetRoot(): GlanceModifier =
    if (Build.VERSION.SDK_INT >= 31) GlanceModifier.fillMaxSize().appWidgetBackground().background(GlanceTheme.colors.widgetBackground)
        .cornerRadius(android.R.dimen.system_app_widget_background_radius)
    else GlanceModifier.fillMaxSize().appWidgetBackground().background(ImageProvider(R.drawable.cal_widget_bg))

@Composable private fun fg() = GlanceTheme.colors.onSurface
@Composable private fun muted() = GlanceTheme.colors.onSurfaceVariant
private fun cp(c: Color) = ColorProvider(c)

@Composable
private fun Root(lc: Context, kind: CalWidgetKind, data: WidgetData) {
    val base = widgetRoot().padding(10.dp)
    when (data) {
        is WidgetData.Message -> Column(base.clickable(open(lc, CalendarWidgetLinks.calendar(null))), verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally) {
            kind.quadrant?.let { Text(lc.getString(quadrantTitle(it)), maxLines = 1, style = TextStyle(color = quadrantText(it), fontSize = fs(13f), fontWeight = FontWeight.Bold)); Spacer(GlanceModifier.height(6.dp)) }
            Text("NEXUS", style = TextStyle(color = fg(), fontSize = fs(13f), fontWeight = FontWeight.Bold))
            Spacer(GlanceModifier.height(4.dp))
            Text(data.text, maxLines = 3, style = TextStyle(color = muted(), fontSize = fs(12f), textAlign = TextAlign.Center))
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

/** "Saya · Diperbarui 14.05", or "Buka NEXUS untuk memperbarui" once stale. Opens the Calendar on this scope. */
@Composable
private fun Footer(lc: Context, d: WidgetData.Ready) {
    val time = Instant.ofEpochMilli(d.saved.savedAt).atZone(WIB).let { clock(lc, "%02d:%02d".format(it.hour, it.minute)) }
    val text = scopeLabel(lc, d.saved.snapshot.scope) + " · " + if (d.stale) lc.getString(R.string.wcal_stale) else lc.getString(R.string.wcal_updated, time)
    // Not a link: a 10 sp line is no target (audit 2 #5); the header and the cells open the Calendar.
    Text(text, maxLines = 1, modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp),
        style = TextStyle(color = if (d.stale) RED_TEXT else muted(), fontSize = fs(10f)))
}

private enum class Detail { DOTS, BARS, TITLES }

@Composable
private fun MonthWidget(lc: Context, d: WidgetData.Ready) {
    val size = LocalSize.current
    // 3×3 → dots, 4×4 → bars, 5×5 → bars + titles (plan 4.2); titles only where 10 sp still fits (audit #14).
    val detail = when {
        size.width < 250.dp || size.height < 250.dp -> Detail.DOTS
        size.width < 340.dp || size.height < 380.dp -> Detail.BARS
        else -> Detail.TITLES
    }
    val scope = d.saved.snapshot.scope
    val m = CalendarGlance.monthView(d.saved.snapshot, d.nowMs, 2)
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth().clickable(open(lc, CalendarWidgetLinks.day(m.today, scope))), verticalAlignment = Alignment.CenterVertically) {
            Text(monthTitle(lc, m.today), maxLines = 1, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = fg(), fontSize = fs(14f), fontWeight = FontWeight.Bold))
            if (detail != Detail.DOTS) Text(lc.getString(R.string.wcal_year, m.year.day, m.year.percent), maxLines = 1, style = TextStyle(color = muted(), fontSize = fs(10f)))
        }
        Spacer(GlanceModifier.height(4.dp))
        // Dots: cells of ~23 dp are no targets (audit 2 #5): the whole grid is one, opening today in the Calendar.
        val grid = GlanceModifier.fillMaxWidth().defaultWeight()
        // padding 20, title + spacer, footer, weekday row.
        val rows = if (detail == Detail.DOTS) dotsRows(size.height.value - 20 - (lineDp(14f) + 4) - (lineDp(10f) + 4) - lineDp(10f)) else null
        MonthGrid(lc, m, detail, compact = detail == Detail.DOTS, scope = scope,
            modifier = if (detail == Detail.DOTS) grid.clickable(open(lc, CalendarWidgetLinks.day(m.today, scope))) else grid, cellTargets = detail != Detail.DOTS, rows = rows)
    }
}

private fun monthTitle(lc: Context, today: String) =
    DateTimeFormatter.ofPattern("MMMM yyyy", locale(lc)).format(LocalDate.parse(today)).replaceFirstChar { it.titlecase(locale(lc)) }

@Composable
private fun MonthGrid(lc: Context, m: CalendarGlance.MonthView, detail: Detail, compact: Boolean, scope: String?, modifier: GlanceModifier, cellTargets: Boolean,
                      rows: Pair<Dp, TextUnit>? = null) {
    // "Sn Sl Rb Km Jm Sb Mg": two letters, so Senin, Selasa and Sabtu are told apart (audit #41).
    val names = lc.resources.getStringArray(R.array.wcal_weekdays)
    Column(modifier) {
        Row(GlanceModifier.fillMaxWidth()) {
            (0 until 7).forEach { k ->
                Text(names[k], maxLines = 1, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = if (k == 6) RED_TEXT else muted(), fontSize = fs(10f), textAlign = TextAlign.Center))
            }
        }
        (0 until 6).forEach { w ->
            // Rows share the grid by weight (always exactly the room there is); in a dots row the mark strip is
            // fixed and the number takes the rest, so the marks are the last thing to go (audit 3 #1).
            Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                (0 until 7).forEach { k -> DayCell(lc, m.cells[w * 7 + k], detail, compact, scope, cellTargets, rows?.second) }
            }
        }
    }
}

@Composable
private fun RowScope.DayCell(lc: Context, cell: CalendarGlance.MonthCell, detail: Detail, compact: Boolean, scope: String?, target: Boolean, numberSize: TextUnit? = null) {
    val b = cell.bars
    val red = b.sunday || b.holiday != null
    val numberColor = when {
        b.today -> GlanceTheme.colors.onPrimary
        red -> RED_TEXT
        !cell.inMonth -> muted()
        else -> fg()
    }
    val faded = if (cell.inMonth) 1f else 0.4f
    val cellMod = GlanceModifier.defaultWeight().fillMaxHeight().padding(horizontal = 1.dp).semantics { contentDescription = dayDescription(lc, b) }
    Column(if (target) cellMod.clickable(open(lc, CalendarWidgetLinks.day(b.day, scope))) else cellMod, horizontalAlignment = Alignment.CenterHorizontally) {
        Row(if (detail == Detail.DOTS) GlanceModifier.defaultWeight() else GlanceModifier, verticalAlignment = Alignment.CenterVertically) {
            // One line, no fixed box: at large font sizes the number grows instead of wrapping; the disc only behind today (audit 2 #6).
            val number = b.day.takeLast(2).trimStart('0')
            val style = TextStyle(color = numberColor, fontSize = numberSize ?: fs(10f), fontWeight = if (b.today) FontWeight.Bold else FontWeight.Medium)
            if (b.today) Box(GlanceModifier.cornerRadius(if (compact) 7.dp else 9.dp).background(GlanceTheme.colors.primary).padding(horizontal = 3.dp, vertical = if (compact) 0.dp else 1.dp)) {
                Text(number, maxLines = 1, style = style)
            } else Text(number, maxLines = 1, style = style)
            if (b.overdue && detail != Detail.DOTS) Box(GlanceModifier.size(4.dp).cornerRadius(2.dp).background(cp(RED))) {}
            // Bars mode has no room under the bars: "+N" sits beside the number.
            if (detail != Detail.DOTS && b.more > 0) Text("+${b.more}", style = TextStyle(color = muted(), fontSize = fs(10f)))
        }
        when (detail) {
            Detail.DOTS -> Row(GlanceModifier.height(MARK_STRIP), verticalAlignment = Alignment.CenterVertically) {
                if (b.overdue) Dot(cp(RED.copy(alpha = faded)))
                // Rule 10.31: a full dot = to do; done or status-less = a small check in its colour.
                b.bars.take(if (b.overdue) 2 else 3).forEach { Dot(hue(it.color, faded), done = it.dim) }
            }
            Detail.BARS -> Column(GlanceModifier.fillMaxWidth().padding(top = 2.dp)) {
                b.bars.forEach { bar ->
                    Box(GlanceModifier.fillMaxWidth().height(4.dp).cornerRadius(2.dp).background(hue(bar.color, if (bar.dim) 0.3f * faded else faded))) {}
                    Spacer(GlanceModifier.height(2.dp))
                }
            }
            Detail.TITLES -> Column(GlanceModifier.fillMaxWidth().padding(top = 1.dp)) {
                b.bars.forEach { bar -> Chip(lc, bar, faded) }
            }
        }
    }
}

@Composable
private fun Dot(c: ColorProvider, done: Boolean = false) {
    if (done) Image(ImageProvider(R.drawable.ic_cal_check), null, GlanceModifier.size(7.dp), colorFilter = ColorFilter.tint(c))
    else Box(GlanceModifier.size(4.dp).cornerRadius(2.dp).background(c)) {}
    Spacer(GlanceModifier.width(1.dp))
}

/** A bar with its title: dim = faded, ✓ only when ticked done (never a calendar-only project), overdue = red. */
@Composable
private fun Chip(lc: Context, bar: Bar, faded: Float, lines: Int = 1) {
    val text = (if (bar.done) "✓ " else "") + title(lc, bar)
    Row(GlanceModifier.fillMaxWidth().padding(bottom = 1.dp).cornerRadius(2.dp).background(hue(bar.color, if (bar.dim) 0.10f * faded else 0.22f * faded)),
        verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.width(2.dp).height((14 * lines).dp).background(if (bar.overdue == Overdue.RECENT) cp(RED) else hue(bar.color, if (bar.dim) 0.4f else 1f))) {}
        Text(text, maxLines = lines, modifier = GlanceModifier.padding(start = 2.dp),
            style = TextStyle(color = if (bar.dim) muted() else fg(), fontSize = fs(10f)))
    }
}

@Composable
private fun MonthUpcomingWidget(lc: Context, d: WidgetData.Ready) {
    val scope = d.saved.snapshot.scope
    val m = CalendarGlance.monthView(d.saved.snapshot, d.nowMs, 3)
    // As many 44 dp rows as fit under the title (padding, footer, title), up to 4; "+N" only if needed.
    val total = CalendarGlance.upcoming(d.saved.snapshot, d.nowMs, 4).let { it.rows.size + it.more }
    val fit = WidgetFit.rows(LocalSize.current.height.value - 20, (lineDp(10f) + 4) + (lineDp(12f) + 4), rowDp(true), MORE_DP, total).coerceIn(1, 4)
    val up = CalendarGlance.upcoming(d.saved.snapshot, d.nowMs, fit)
    val today = CalendarGlance.wibClock(d.nowMs).day
    Row(GlanceModifier.fillMaxSize()) {
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            Text(monthTitle(lc, m.today), maxLines = 1, modifier = GlanceModifier.clickable(open(lc, CalendarWidgetLinks.day(m.today, scope))), style = TextStyle(color = fg(), fontSize = fs(12f), fontWeight = FontWeight.Bold))
            // The mini month is one target (its cells are far below 48 dp, audit 2 #5): today in the Calendar.
            // padding 20, footer, title, weekday row.
            val rows = dotsRows(LocalSize.current.height.value - 20 - (lineDp(10f) + 4) - lineDp(12f) - lineDp(10f))
            MonthGrid(lc, m, Detail.DOTS, compact = true, scope = scope, cellTargets = false, rows = rows,
                modifier = GlanceModifier.fillMaxWidth().defaultWeight().clickable(open(lc, CalendarWidgetLinks.day(m.today, scope))))
        }
        Spacer(GlanceModifier.width(10.dp))
        Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
            Text(lc.getString(R.string.wcal_coming_up), maxLines = 1, style = TextStyle(color = fg(), fontSize = fs(12f), fontWeight = FontWeight.Bold))
            Spacer(GlanceModifier.height(4.dp))
            if (up.rows.isEmpty()) Text(lc.getString(R.string.wcal_nothing_up, scopeLabel(lc, scope)), style = TextStyle(color = muted(), fontSize = fs(12f)))
            up.rows.forEach { b -> ListRow(lc, b, today, scope, showProject = false, compact = true) }
            if (up.more > 0) MoreRow(lc.resources.getQuantityString(R.plurals.cal_more_n, up.more, up.more), open(lc, CalendarWidgetLinks.day(today, scope)), 12f)
        }
    }
}

/** One task in a list: colour, title, due (+ project), red when overdue; spoken as one sentence. */
@Composable
private fun ListRow(lc: Context, b: Bar, today: String, scope: String?, showProject: Boolean, compact: Boolean) {
    Row(GlanceModifier.fillMaxWidth().height(rowDp(compact).dp).clickable(open(lc, CalendarWidgetLinks.task(b, scope)))
        .semantics { contentDescription = rowDescription(lc, b, today) }, verticalAlignment = Alignment.CenterVertically) {
        Box(GlanceModifier.width(3.dp).height(if (compact) 26.dp else 30.dp).cornerRadius(2.dp).background(if (b.overdue == Overdue.RECENT) cp(RED) else hue(b.color))) {}
        Spacer(GlanceModifier.width(6.dp))
        Column(GlanceModifier.defaultWeight()) {
            Text(title(lc, b), maxLines = 1, style = TextStyle(color = fg(), fontSize = if (compact) fs(11f) else fs(13f), fontWeight = FontWeight.Medium))
            // A masked row never names its project (decision 1).
            val sub = listOfNotNull(dueText(lc, b, today), b.project?.takeIf { showProject && !b.masked }).joinToString(" · ")
            Text(sub, maxLines = 1, style = TextStyle(color = if (b.overdue == Overdue.RECENT) RED_TEXT else muted(), fontSize = if (compact) fs(10f) else fs(11f)))
        }
    }
}

@Composable
private fun WeekWidget(lc: Context, d: WidgetData.Ready) {
    val scope = d.saved.snapshot.scope
    // Up to 3 two-line chips a day, as many as the height holds (~30 dp each under ~92 dp of header,
    // padding, footer and a "+N" line); the rest is counted in "+N".
    val fit = ((LocalSize.current.height.value - 106 * fontScaleUsed) / (30 * fontScaleUsed)).toInt().coerceIn(1, 3)
    val week = CalendarGlance.weekView(d.saved.snapshot, d.nowMs, fit)
    val names = lc.resources.getStringArray(R.array.wcal_weekdays)
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(lc.getString(R.string.wcal_week_name), maxLines = 1, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = fg(), fontSize = fs(13f), fontWeight = FontWeight.Bold))
            val f = AppDateFormats.ofPattern("d MMM", locale(lc))
            Text(f.format(LocalDate.parse(week.first().day)) + " – " + f.format(LocalDate.parse(week.last().day)), maxLines = 1, style = TextStyle(color = muted(), fontSize = fs(10f)))
        }
        Spacer(GlanceModifier.height(4.dp))
        Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
            week.forEachIndexed { k, day ->
                Column(GlanceModifier.defaultWeight().fillMaxHeight().padding(horizontal = 1.dp).cornerRadius(6.dp)
                    .background(if (day.today) GlanceTheme.colors.secondaryContainer else cp(Color.Transparent)).clickable(open(lc, CalendarWidgetLinks.day(day.day, scope)))
                    .semantics { contentDescription = dayDescription(lc, day) },
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    val red = day.sunday || day.holiday != null
                    Text(names[k], maxLines = 1, style = TextStyle(color = if (red) RED_TEXT else muted(), fontSize = fs(10f)))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(day.day.takeLast(2).trimStart('0'), style = TextStyle(color = if (red) RED_TEXT else fg(), fontSize = fs(12f), fontWeight = FontWeight.Bold))
                        if (day.overdue) Box(GlanceModifier.size(4.dp).cornerRadius(2.dp).background(cp(RED))) {}
                    }
                    day.bars.forEach { Chip(lc, it, 1f, lines = 2) }
                    if (day.more > 0) Text("+${day.more}", style = TextStyle(color = muted(), fontSize = fs(10f)))
                }
            }
        }
    }
}

@Composable
private fun QuadrantWidget(lc: Context, d: WidgetData.Ready, q: Quadrant) {
    val size = LocalSize.current
    val scope = d.saved.snapshot.scope
    val list = CalendarGlance.quadrants(d.saved.snapshot, d.nowMs).first { it.quadrant == q }
    val today = CalendarGlance.wibClock(d.nowMs).day
    val note = quadrantNote(q)
    // The title may take two lines ("Penting dan mendesak" at 2×2): counted, so "+N" is never pushed out (audit 3 #5).
    val title = lc.getString(quadrantTitle(q))
    val lines = WidgetFit.titleLines(title.length, 13f * fontScaleUsed, size.width.value - 20 - 14 - 28 * fontScaleUsed)
    val header = lines * lineDp(13f) + (if (note != null) lineDp(10f) else 0f) + 6
    val fit = WidgetFit.rows(size.height.value - 20, header + (lineDp(10f) + 4), rowDp(false), MORE_DP, list.count).coerceIn(1, 8)
    val wide = size.width >= 220.dp
    val all = open(lc, CalendarWidgetLinks.quadrant(q, scope))
    Column(GlanceModifier.fillMaxSize()) {
        // The header opens the whole list in the app (audit #40).
        Column(GlanceModifier.fillMaxWidth().padding(bottom = 6.dp).clickable(all)) {
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(GlanceModifier.size(8.dp).cornerRadius(4.dp).background(cp(quadrantHue(q)))) {}
                Spacer(GlanceModifier.width(6.dp))
                // Two lines: "Penting dan mendesak" fits at 2×2 in Indonesian too (audit 2 #28).
                Text(title, maxLines = 2, modifier = GlanceModifier.defaultWeight(), style = TextStyle(color = quadrantText(q), fontSize = fs(13f), fontWeight = FontWeight.Bold))
                Text(list.count.toString(), style = TextStyle(color = quadrantText(q), fontSize = fs(16f), fontWeight = FontWeight.Bold))
            }
            if (note != null) Text(lc.getString(note), maxLines = 1, style = TextStyle(color = muted(), fontSize = fs(10f)))
        }
        // Empty is an outcome, with the scope it is about (audit #44).
        if (list.rows.isEmpty()) Text(lc.getString(quadrantEmpty(q), scopeLabel(lc, scope)), maxLines = 3, style = TextStyle(color = muted(), fontSize = fs(12f)))
        list.rows.take(fit).forEach { ListRow(lc, it, today, scope, showProject = wide, compact = false) }
        if (list.count > fit) MoreRow(lc.resources.getQuantityString(R.plurals.cal_more_n, list.count - fit, list.count - fit), all, 12f)
    }
}
