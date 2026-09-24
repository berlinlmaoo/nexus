package id.znetworks.nexus.ui.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusConfig
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.core.version.VersionGate
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Where "Download update" goes. NEXUS for Android is sideloaded (no Play listing yet), so this is
 * the server's `android.storeUrl`, which the server points at the APK download page. A Play URL
 * would be a dead end, so it is replaced by the web download page until the app is on Play.
 */
fun updateUrl(storeUrl: String?): String =
    storeUrl?.takeIf { it.isNotBlank() && !it.contains("play.google.com") } ?: "${NexusConfig.PUBLIC_BASE}/download/android"

fun openUpdate(context: Context, storeUrl: String?) {
    runCatching {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(updateUrl(storeUrl))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/**
 * Full-screen lock (REQ-ATT-41/42). Nothing else in the app is reachable behind it. [heldMessage]
 * is the line about attendance taps held for the update (REQ-ATT-43), when there are any.
 */
@Composable
fun UpdateRequiredScreen(
    state: VersionGate.State,
    onCheckAgain: () -> Unit,
    heldMessage: String? = null,
) {
    val c = Nx.colors
    val context = LocalContext.current
    Box(Modifier.fillMaxSize().background(c.background).systemBarsPadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(Modifier.size(72.dp).background(c.accentBg, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.SystemUpdate, null, tint = c.accentFg, modifier = Modifier.size(34.dp))
            }
            Spacer(Modifier.height(20.dp))
            Text(stringResource(R.string.update_required_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold,
                fontSize = 22.sp, color = c.foreground, textAlign = TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.update_required_body), fontFamily = TextFont, fontSize = 15.sp, color = c.mutedFg,
                textAlign = TextAlign.Center, lineHeight = 21.sp)
            state.required?.minSupported?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.update_required_min, it), fontFamily = TextFont, fontSize = 13.sp, color = c.mutedFg)
            }
            heldMessage?.let {
                Spacer(Modifier.height(16.dp))
                Text(it, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = c.warning,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().background(c.warning.copy(alpha = 0.12f), RoundedCornerShape(14.dp))
                        .padding(12.dp))
            }
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { openUpdate(context, state.required?.storeUrl ?: state.storeUrl) },
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = c.violet, contentColor = Color.White),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(stringResource(R.string.update_download), fontFamily = DisplayFont, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(10.dp))
            OutlinedButton(
                onClick = onCheckAgain, enabled = !state.checking,
                shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (state.checking) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text(stringResource(R.string.update_check_again), fontFamily = DisplayFont, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

/** Once per office day: "Update NEXUS by <date>" while this build is still allowed. */
@Composable
fun GraceNoticeDialog(grace: VersionGate.Grace, storeUrl: String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val date = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(grace.deadline.atZone(OfficeTime.ZONE))
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.update_soon_title)) },
        text = { Text(stringResource(R.string.update_grace_body, date)) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); openUpdate(context, storeUrl) }) { Text(stringResource(R.string.update_download)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.later)) } },
    )
}
