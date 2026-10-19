package id.znetworks.nexus.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Power
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable data class NotificationPrefs(val automation: Boolean? = null)
@Serializable data class NotificationPrefsResponse(val preferences: NotificationPrefs? = null)

/** GET / PATCH /api/notifications/preferences: only the automation switch is a phone setting (iOS AutomationNotificationsCard). */
class NotificationPrefsApi(private val api: ApiClient) {
    suspend fun get(): NotificationPrefs = api.get("/api/notifications/preferences", NotificationPrefsResponse.serializer()).preferences ?: NotificationPrefs()
    suspend fun setAutomation(on: Boolean) {
        api.send(okhttp3.Request.Builder().url(api.url("/api/notifications/preferences"))
            .patch(buildJsonObject { put("automation", on) }.toString().toJsonBody()).build(), JsonObject.serializer())
    }
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(16.dp)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
}

/**
 * Settings › Notifications (web NotificationsSection, iOS AutomationNotificationsCard): pushes from project automations
 * on or off; off, they still land in the inbox. Email / Slack / desktop are web settings and stay there.
 */
@Composable
fun NotificationsSettingsCard() {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val api = remember { NotificationPrefsApi(container.api) }
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf<Boolean?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) {
        loadFailed = false
        // Not set yet = on (web defaultOn).
        try { on = api.get().automation ?: true } catch (_: ApiError) { loadFailed = true }
    }
    SettingsCard {
        Text(stringResource(R.string.st_tab_notifications), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = c.foreground)
        when {
            loadFailed -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.st_notif_load_failed), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                NxButton(stringResource(R.string.try_again), { tick++ }, compact = true)
            }
            on == null -> Text(stringResource(R.string.st_notif_loading), fontSize = 13.sp, color = c.mutedFg)
            else -> Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Bolt, null, tint = c.foreground, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.st_notif_automation), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                    Text(stringResource(R.string.st_notif_automation_sub), fontSize = 13.sp, color = c.mutedFg)
                }
                Spacer(Modifier.width(8.dp))
                Switch(on == true, { v ->
                    val before = on
                    on = v; saving = true; failed = false
                    scope.launch {
                        try { api.setAutomation(v) } catch (_: ApiError) { on = before; failed = true }
                        saving = false
                    }
                }, enabled = !saving)
            }
        }
        if (failed) Text(stringResource(R.string.st_notif_failed), fontSize = 12.sp, color = c.dangerText)
    }
}

/**
 * Settings › Claude (MCP) (iOS ClaudeMCPCard): what it is, the server URL Claude connects to (this server, DEV or
 * production; copy), and the web page where the token is made and shown once.
 */
@Composable
fun ClaudeMcpCard() {
    val c = Nx.colors
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val url = remember { container.api.url("/api/mcp").toString() }
    var copied by remember { mutableStateOf(false) }
    SettingsCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Power, null, tint = c.foreground, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.st_tab_mcp), fontSize = 16.sp, fontWeight = FontWeight.Bold, color = c.foreground)
        }
        Text(stringResource(R.string.st_mcp_body), fontSize = 13.sp, color = c.mutedFg)
        Text(stringResource(R.string.st_mcp_url), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.mutedFg)
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.background).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(start = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text(url, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            IconButton(onClick = {
                val cm = context.getSystemService(android.content.ClipboardManager::class.java)
                cm?.setPrimaryClip(android.content.ClipData.newPlainText("MCP", url)); copied = true
            }) { Icon(if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy, stringResource(if (copied) R.string.st_copied else R.string.st_copy), tint = c.mutedFg) }
        }
        McpTokensCard()
        NxButton(stringResource(R.string.open_on_web), { id.znetworks.nexus.ui.shell.openWeb(context, "/settings?section=mcp") }, compact = true,
            icon = Icons.AutoMirrored.Filled.OpenInNew)
    }
}
