package id.znetworks.nexus.feature.whatsnew

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.ViewKanban
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx

/** One card: something you will do differently tomorrow (iOS headline tier); without [body], a one-line "also" (iOS `.also`). */
data class WhatsNewEntry(val icon: ImageVector, val title: Int, val body: Int? = null)

/**
 * "What's new", once per version after it is installed (iOS WhatsNew). Keyed by versionName; a
 * version without entries shows nothing, so a build without notes is silent rather than broken.
 */
object WhatsNew {
    fun entries(version: String): List<WhatsNewEntry> = when (version) {
        "0.1.6" -> v016
        else -> emptyList()
    }

    /** 0.1.6: the first Android release. */
    private val v016 = listOf(
        WhatsNewEntry(Icons.Filled.TouchApp, R.string.wn016_button_t, R.string.wn016_button_b),
        WhatsNewEntry(Icons.Filled.LocationOn, R.string.wn016_trail_t, R.string.wn016_trail_b),
        WhatsNewEntry(Icons.Filled.CloudOff, R.string.wn016_offline_t, R.string.wn016_offline_b),
        WhatsNewEntry(Icons.Filled.ViewKanban, R.string.wn016_projects_t, R.string.wn016_projects_b),
        WhatsNewEntry(Icons.Filled.Key, R.string.wn016_account_t, R.string.wn016_account_b),
        WhatsNewEntry(Icons.Filled.SystemUpdate, R.string.wn016_update_t, R.string.wn016_update_b),
        WhatsNewEntry(Icons.Filled.CalendarMonth, R.string.wn_leave_multi),
    )

    private const val PREFS = "nexus.whatsnew"
    private const val KEY = "seen"

    /** Due when this version has entries and has not been shown on this phone. */
    fun due(context: Context, version: String): Boolean =
        entries(version).isNotEmpty() && context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) != version

    fun seen(context: Context, version: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, version).apply()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhatsNewSheet(version: String, onClose: () -> Unit) {
    val c = Nx.colors
    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = c.background) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 16.dp).navigationBarsPadding()) {
            Text(stringResource(R.string.wn_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = c.foreground)
            Text(stringResource(R.string.wn_version, version), fontSize = 13.sp, color = c.mutedFg)
            Spacer(Modifier.size(16.dp))
            Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                WhatsNew.entries(version).forEach { e ->
                    Row(verticalAlignment = Alignment.Top) {
                        Box(Modifier.size(40.dp).background(c.violet.copy(alpha = 0.14f), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                            Icon(e.icon, null, tint = c.violetText)
                        }
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(stringResource(e.title), fontWeight = if (e.body != null) FontWeight.Bold else FontWeight.SemiBold,
                                fontSize = if (e.body != null) 15.sp else 14.sp, color = c.foreground)
                            e.body?.let { Text(stringResource(it), fontSize = 13.sp, color = c.mutedFg) }
                        }
                    }
                }
            }
            Spacer(Modifier.size(20.dp))
            Button(onClick = onClose, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.violet, contentColor = Color.White)) {
                Text(stringResource(R.string.wn_ok), fontWeight = FontWeight.Bold)
            }
        }
    }
}
