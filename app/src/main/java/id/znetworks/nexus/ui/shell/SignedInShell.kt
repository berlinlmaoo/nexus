package id.znetworks.nexus.ui.shell

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.os.LocaleListCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusConfig
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.core.version.VersionGate
import id.znetworks.nexus.feature.attendance.AttendanceScreen
import id.znetworks.nexus.feature.attendance.trail.TrailConsentHost
import id.znetworks.nexus.feature.inbox.AnnouncementDialog
import id.znetworks.nexus.feature.inbox.InboxScreen
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.AppTheme
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.feature.update.startUpdate
import kotlinx.coroutines.launch

private enum class Tab(val label: Int, val icon: ImageVector, val webPath: String) {
    HOME(R.string.tab_home, Icons.Filled.Home, "/attendance"),
    TASKS(R.string.tab_tasks, Icons.Filled.Checklist, "/my-tasks"),
    INBOX(R.string.tab_inbox, Icons.Filled.Inbox, "/inbox"),
    PROJECTS(R.string.tab_projects, Icons.Filled.Folder, "/projects"),
    MORE(R.string.tab_more, Icons.Filled.Menu, ""),
}

/**
 * Phone shell: Home · Tasks · Inbox · Projects · More, as on iOS. Screens not built yet say so and
 * open the web page instead (PRD §5 Phase 1).
 */
@Composable
fun SignedInShell(session: Session, gateState: VersionGate.State, onSignOut: () -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val pending by container.router.pending.collectAsStateWithLifecycle()

    // Android 13+: without this, the refused-tap notice and push never show. Asked once.
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        container.announcements.refresh()
    }

    // Links: switch to the owning tab; that screen claims the focus. Web, external and
    // announcement targets are handled here and claimed at once.
    LaunchedEffect(pending) {
        when (val t = pending) {
            is Target.Attendance -> tab = Tab.HOME
            Target.Inbox -> { tab = Tab.INBOX; container.router.consumed(t) }
            Target.Settings -> { tab = Tab.MORE; container.router.consumed(t) }
            is Target.Announcement -> { container.router.consumed(t); container.announcements.showOne(t.id) }
            is Target.Web -> { container.router.consumed(t); openWeb(context, t.path) }
            is Target.External -> { container.router.consumed(t); openUrl(context, t.url) }
            null -> Unit
        }
    }

    // The location disclosure can come due from any screen (a queued check-in landing, a refresh).
    TrailConsentHost(container.workTrail)
    AnnouncementDialog(container.announcements)

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
                // Attendance is the core: it is the Home tab until the full dashboard lands (Phase 2).
                Tab.HOME -> AttendanceScreen()
                Tab.INBOX -> InboxScreen()
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
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val theme by container.appearance.theme.collectAsStateWithLifecycle()
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var pickLanguage by rememberSaveable { mutableStateOf(false) }
    var pickTheme by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val itemColors = ListItemDefaults.colors(containerColor = c.card)
    val shape = Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp))

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(session.userName.ifBlank { session.userEmail }, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = c.foreground)
        Text(session.userEmail, color = c.mutedFg)
        Spacer(Modifier.height(20.dp))
        gateState.available?.let { version ->
            // Soft "update available": Tuning Room only, never a nag (REQ-ATT-41).
            ListItem(
                headlineContent = { Text(stringResource(R.string.update_available, version)) },
                leadingContent = { Icon(Icons.Filled.SystemUpdate, null, tint = c.violetText) },
                colors = itemColors, modifier = shape,
                trailingContent = { TextButton(onClick = { startUpdate(context, gateState.storeUrl) }) { Text(stringResource(R.string.update_action)) } },
            )
            Spacer(Modifier.height(12.dp))
        }
        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_language)) },
            supportingContent = { Text(stringResource(R.string.settings_language_current)) },
            leadingContent = { Icon(Icons.Filled.Translate, null) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { pickLanguage = true }) { Text(stringResource(R.string.change)) } },
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.settings_appearance)) },
            supportingContent = { Text(stringResource(themeLabel(theme))) },
            leadingContent = { Icon(Icons.Filled.DarkMode, null) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { pickTheme = true }) { Text(stringResource(R.string.change)) } },
        )
        Spacer(Modifier.height(12.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.logout), color = c.danger) },
            leadingContent = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = c.danger) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { confirmLogout = true }) { Text(stringResource(R.string.logout), color = c.danger) } },
        )
        Spacer(Modifier.height(24.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.delete_account), color = c.danger) },
            supportingContent = { Text(stringResource(R.string.delete_account_sub)) },
            leadingContent = { Icon(Icons.Filled.DeleteForever, null, tint = c.danger) },
            colors = itemColors, modifier = shape,
            trailingContent = { TextButton(onClick = { deleting = true }) { Text(stringResource(R.string.delete), color = c.danger) } },
        )
        Spacer(Modifier.height(12.dp))
        Text("NEXUS ${container.identity.versionName} (${container.identity.versionCode})", fontSize = 11.sp, color = c.mutedFg)
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
                    // Applies immediately, no restart; also shows in Android 13+'s per-app language setting.
                    TextButton(onClick = { pickLanguage = false; setLanguage("en") }) { Text("English") }
                    TextButton(onClick = { pickLanguage = false; setLanguage("in") }) { Text("Bahasa Indonesia") }
                }
            },
            confirmButton = { TextButton(onClick = { pickLanguage = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (pickTheme) {
        AlertDialog(
            onDismissRequest = { pickTheme = false },
            title = { Text(stringResource(R.string.settings_appearance)) },
            text = {
                Column {
                    AppTheme.entries.forEach { t ->
                        TextButton(onClick = { pickTheme = false; container.appearance.set(t) }) { Text(stringResource(themeLabel(t))) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { pickTheme = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    // deleteAccount() already runs the full logout; the root then shows the login screen.
    if (deleting) DeleteAccountDialog(onDone = { deleting = false }, onCancel = { deleting = false })
}

private fun themeLabel(t: AppTheme) = when (t) {
    AppTheme.SYSTEM -> R.string.theme_system
    AppTheme.LIGHT -> R.string.theme_light
    AppTheme.DARK -> R.string.theme_dark
}

/**
 * Deactivates and anonymises (history stays as "Deleted account"). The person types DELETE first,
 * as on iOS. Owner decision: deletion lives in the app.
 */
@Composable
private fun DeleteAccountDialog(onDone: () -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val container = (context.applicationContext as NexusApplication).container
    val scope = rememberCoroutineScope()
    var typed by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onCancel() },
        title = { Text(stringResource(R.string.delete_account)) },
        text = {
            Column {
                Text(stringResource(R.string.delete_account_body))
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(typed, { typed = it }, singleLine = true, placeholder = { Text("DELETE") })
                error?.let { Text(it, color = Nx.colors.danger, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(enabled = typed.trim() == "DELETE" && !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        container.auth.deleteAccount()
                        onDone()
                    } catch (e: ApiError) {
                        // 409 names the workspace this person is the last owner of: said verbatim.
                        error = e.describe(context.resources)
                        busy = false
                    }
                }
            }) { if (busy) CircularProgressIndicator() else Text(stringResource(R.string.delete), color = Nx.colors.danger) }
        },
        dismissButton = { TextButton(onClick = onCancel, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}

private fun setLanguage(tag: String) = AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))

fun openWeb(context: Context, path: String) = openUrl(context, NexusConfig.PUBLIC_BASE + path)

private fun openUrl(context: Context, url: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}
