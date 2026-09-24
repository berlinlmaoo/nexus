package id.znetworks.nexus.ui.shell

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.os.LocaleListCompat
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusConfig
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.core.version.VersionGate
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.update.openUpdate

private enum class Tab(val label: Int, val icon: ImageVector, val webPath: String) {
    HOME(R.string.tab_home, Icons.Filled.Home, "/dashboard"),
    TASKS(R.string.tab_tasks, Icons.Filled.Checklist, "/my-tasks"),
    INBOX(R.string.tab_inbox, Icons.Filled.Inbox, "/inbox"),
    PROJECTS(R.string.tab_projects, Icons.Filled.Folder, "/projects"),
    MORE(R.string.tab_more, Icons.Filled.Menu, ""),
}

/**
 * Phone shell: Home · Tasks · Inbox · Projects · More, as on iOS. Screens not built yet say so and
 * open the web page instead (PRD §5 Phase 1: a link to an unbuilt screen opens the web).
 */
@Composable
fun SignedInShell(session: Session, gateState: VersionGate.State, onSignOut: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    val context = LocalContext.current
    Scaffold(
        containerColor = Nx.colors.background,
        bottomBar = {
            NavigationBar(containerColor = Nx.colors.card) {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = t == tab, onClick = { tab = t },
                        icon = { Icon(t.icon, contentDescription = null) },
                        label = { Text(stringResource(t.label)) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                Tab.MORE -> MoreScreen(session, gateState, onSignOut)
                else -> EmptyState(
                    icon = tab.icon,
                    title = stringResource(R.string.not_on_android_title),
                    message = stringResource(R.string.not_on_android_message),
                    actionLabel = stringResource(R.string.open_on_web),
                    onAction = { openWeb(context, tab.webPath) },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun MoreScreen(session: Session, gateState: VersionGate.State, onSignOut: () -> Unit) {
    val c = Nx.colors
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var pickLanguage by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(session.userName.ifBlank { session.userEmail }, fontFamily = DisplayFont, fontWeight = FontWeight.Bold,
            fontSize = 22.sp, color = c.foreground)
        Text(session.userEmail, color = c.mutedFg)
        Spacer(Modifier.height(20.dp))
        val itemColors = ListItemDefaults.colors(containerColor = c.card)
        val shape = Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp))
        val context = LocalContext.current
        gateState.available?.let { version ->
            // Soft "update available": Tuning Room only, never a nag (REQ-ATT-41).
            ListItem(
                headlineContent = { Text(stringResource(R.string.update_available, version)) },
                leadingContent = { Icon(Icons.Filled.SystemUpdate, null, tint = c.violetText) },
                colors = itemColors, modifier = shape,
                trailingContent = { TextButton(onClick = { openUpdate(context, gateState.storeUrl) }) { Text(stringResource(R.string.update_action)) } },
            )
            Spacer(Modifier.height(12.dp))
        }
        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_language)) },
            supportingContent = { Text(stringResource(R.string.settings_language_current)) },
            leadingContent = { Icon(Icons.Filled.Translate, null) },
            colors = itemColors, modifier = shape.then(Modifier.padding(0.dp)),
            trailingContent = { TextButton(onClick = { pickLanguage = true }) { Text(stringResource(R.string.change)) } },
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.logout), color = c.danger) },
            leadingContent = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = c.danger) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { confirmLogout = true }) { Text(stringResource(R.string.logout), color = c.danger) } },
        )
    }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(stringResource(R.string.logout_confirm_title)) },
            text = { Text(stringResource(R.string.logout_confirm_message)) },
            confirmButton = { TextButton(onClick = { confirmLogout = false; onSignOut() }) { Text(stringResource(R.string.logout), color = c.danger) } },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (pickLanguage) {
        AlertDialog(
            onDismissRequest = { pickLanguage = false },
            title = { Text(stringResource(R.string.settings_language)) },
            text = {
                Column {
                    // Applies immediately, no restart; also shows up in Android 13+'s per-app language setting.
                    TextButton(onClick = { pickLanguage = false; setLanguage("en") }) { Text("English") }
                    TextButton(onClick = { pickLanguage = false; setLanguage("in") }) { Text("Bahasa Indonesia") }
                }
            },
            confirmButton = { TextButton(onClick = { pickLanguage = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

private fun setLanguage(tag: String) = AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))

private fun openWeb(context: Context, path: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(NexusConfig.PUBLIC_BASE + path))) }
}
