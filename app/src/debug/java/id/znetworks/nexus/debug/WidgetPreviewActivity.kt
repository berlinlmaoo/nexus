package id.znetworks.nexus.debug

import android.app.Activity
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.util.TypedValue
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.calendar.CalGlance
import id.znetworks.nexus.feature.calendar.GlanceScope
import id.znetworks.nexus.feature.calendar.widget.CalActWidgetReceiver
import id.znetworks.nexus.feature.calendar.widget.CalDoWidgetReceiver
import id.znetworks.nexus.feature.calendar.widget.CalLaterWidgetReceiver
import id.znetworks.nexus.feature.calendar.widget.CalMonthUpcomingWidgetReceiver
import id.znetworks.nexus.feature.calendar.widget.CalMonthWidgetReceiver
import id.znetworks.nexus.feature.calendar.widget.CalPlanWidgetReceiver
import id.znetworks.nexus.feature.calendar.widget.CalWeekWidgetReceiver
import id.znetworks.nexus.feature.calendar.widget.CalendarWidgetPrefs
import id.znetworks.nexus.feature.calendar.widget.CalendarWidgets
import id.znetworks.nexus.feature.calendar.widget.SavedGlance
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

/**
 * Debug only: hosts the real calendar widgets (AppWidgetHost) at launcher sizes, fed by the web's glance
 * fixtures, so every size can be screenshot with nobody signed in. Needs
 * `adb shell appwidget grantbind --package id.znetworks.nexus` once.
 *
 * `am start -n id.znetworks.nexus/.debug.WidgetPreviewActivity --es set a|b|c|d --es lang en|in`
 * Scopes: Me → me.json, Everyone → all.json, My division → none.json (the "not on" sentence).
 */
class WidgetPreviewActivity : Activity() {
    private lateinit var host: AppWidgetHost

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        getSharedPreferences("nexus.language", Context.MODE_PRIVATE).edit().putString("tag", intent.getStringExtra("lang") ?: "en").commit()
        fun load(name: String) = NexusJson.decodeFromString(CalGlance.serializer(), assets.open("calendar/glance/$name.json").bufferedReader().readText())
        val saved = System.currentTimeMillis() - 15 * 60_000
        val me = load("me"); val all = load("all"); val none = load("none")
        CalendarWidgets.previewOverride = { scope ->
            when (scope) { GlanceScope.ME -> SavedGlance(saved, "u", me); GlanceScope.ALL -> SavedGlance(saved, "u", all); GlanceScope.DIVISION -> SavedGlance(saved, "u", none) }
        }
        // A fresh host each run: the ids of the last one are dropped.
        host = AppWidgetHost(this, 4711).also { it.deleteHost() }
        host.startListening()
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(36), dp(12), dp(12)); setBackgroundColor(Color.rgb(120, 132, 150)) }
        setContentView(column)
        // (provider, width dp, height dp, scope, caption)
        val m = CalMonthWidgetReceiver::class.java; val mu = CalMonthUpcomingWidgetReceiver::class.java; val w = CalWeekWidgetReceiver::class.java
        val set = when (intent.getStringExtra("set") ?: "a") {
            "a" -> listOf(Triple(m, 200 to 200, GlanceScope.ME), Triple(mu, 380 to 180, GlanceScope.ME), Triple(w, 380 to 180, GlanceScope.ME))
            "b" -> listOf(Triple(m, 300 to 300, GlanceScope.ME), Triple(CalDoWidgetReceiver::class.java, 185 to 185, GlanceScope.ME), Triple(CalPlanWidgetReceiver::class.java, 185 to 185, GlanceScope.ME))
            "c" -> listOf(Triple(m, 380 to 440, GlanceScope.ALL), Triple(CalActWidgetReceiver::class.java, 185 to 185, GlanceScope.ME), Triple(CalLaterWidgetReceiver::class.java, 185 to 185, GlanceScope.DIVISION))
            else -> listOf(Triple(CalDoWidgetReceiver::class.java, 380 to 260, GlanceScope.ALL), Triple(CalLaterWidgetReceiver::class.java, 380 to 260, GlanceScope.ME), Triple(w, 380 to 180, GlanceScope.ALL))
        }
        var row: LinearLayout? = null
        set.forEach { (cls, size, scope) ->
            val (wd, ht) = size
            val mgr = AppWidgetManager.getInstance(this)
            val id = host.allocateAppWidgetId()
            CalendarWidgetPrefs.setScope(this, id, scope)
            val options = Bundle().apply {
                putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, wd); putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, wd)
                putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, ht); putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, ht)
                if (Build.VERSION.SDK_INT >= 31) putParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES, arrayListOf(SizeF(wd.toFloat(), ht.toFloat())))
            }
            if (!mgr.bindAppWidgetIdIfAllowed(id, ComponentName(this, cls), options)) {
                column.addView(TextView(this).apply { text = "bind refused: run appwidget grantbind" }); return@forEach
            }
            val view = host.createView(applicationContext, id, mgr.getAppWidgetInfo(id))
            val cell = FrameLayout(this).apply { addView(view, FrameLayout.LayoutParams(dp(wd), dp(ht))); setPadding(0, 0, dp(8), dp(8)) }
            // Two small ones share a row; anything wider gets its own.
            if (wd < 200) {
                val r = row ?: LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }.also { column.addView(it); row = it }
                r.addView(cell); if (r.childCount == 2) row = null
            } else { row = null; column.addView(cell) }
        }
        MainScope().launch { CalendarWidgets.updateAll(applicationContext) }
    }

    override fun onDestroy() { host.stopListening(); super.onDestroy() }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
