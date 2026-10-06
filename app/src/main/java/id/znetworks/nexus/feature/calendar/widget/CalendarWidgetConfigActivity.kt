package id.znetworks.nexus.feature.calendar.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.feature.calendar.GlanceScope
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.NexusTheme
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

/**
 * A calendar widget's one setting (plan 4.2, decision 8): whose tasks it shows — Me, My division,
 * Everyone (default Me). Opens when the widget is placed (Android 12+: optional) and from its
 * "Edit widget" afterwards. AppCompat, so the app's language applies as in MainActivity.
 */
class CalendarWidgetConfigActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        AppLanguage.apply(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val id = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Backing out of the first configuration removes the widget, as the launcher expects.
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        val container = (application as NexusApplication).container
        val initial = CalendarWidgetPrefs.scope(this, id)
        setContent {
            val theme by container.appearance.theme.collectAsStateWithLifecycle()
            NexusTheme(theme) {
                var scope by rememberSaveable { mutableStateOf(initial) }
                val c = Nx.colors
                Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(stringResource(R.string.wcal_cfg_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
                    Text(stringResource(R.string.wcal_cfg_hint), fontSize = 14.sp, color = c.mutedFg)
                    Spacer(Modifier.height(8.dp))
                    listOf(GlanceScope.ME to R.string.wcal_scope_me, GlanceScope.DIVISION to R.string.wcal_scope_division, GlanceScope.ALL to R.string.wcal_scope_all).forEach { (s, label) ->
                        Row(Modifier.fillMaxWidth().clickable { scope = s }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = scope == s, onClick = { scope = s })
                            Column {
                                Text(stringResource(label), fontSize = 16.sp, color = c.foreground)
                                if (s == GlanceScope.DIVISION) Text(stringResource(R.string.wcal_cfg_division_hint), fontSize = 12.sp, color = c.mutedFg)
                            }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    Button(onClick = { save(id, scope) }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(stringResource(R.string.wcal_cfg_save)) }
                }
            }
        }
    }

    private fun save(id: Int, scope: GlanceScope) {
        CalendarWidgetPrefs.setScope(this, id, scope)
        val container = (application as NexusApplication).container
        lifecycleScope.launch {
            runCatching { CalendarWidgets.updateAll(applicationContext) }
            if (container.sessionStore.current != null) container.refreshCalendarWidgets()
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
            finish()
        }
    }
}
