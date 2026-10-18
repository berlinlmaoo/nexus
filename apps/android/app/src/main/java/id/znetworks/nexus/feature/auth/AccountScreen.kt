package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.core.i18n.AppDateFormats

import androidx.compose.material.icons.outlined.Power
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.filled.DevicesOther
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.TabletAndroid
import id.znetworks.nexus.ui.components.PageTab
import id.znetworks.nexus.ui.components.PageTabs
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.PageHeader
import android.app.Application
import android.content.Context
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.core.offline.OfflineCard
import id.znetworks.nexus.feature.update.startUpdate
import id.znetworks.nexus.ui.theme.AppTheme
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.admin.WorkspaceMembersCard
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class AccountState(
    val email: String = "",
    val passkeys: List<Passkey>? = null,
    /** The new address a code went to (email change step 2). */
    val pendingEmail: String? = null,
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
    /** Settings › Security › Active sessions: null = not read yet. */
    val sessions: List<UserSession>? = null,
    val sessionsFailed: Boolean = false,
    /** A session being signed out ("others" for all but this one). */
    val signingOut: String? = null,
    /** Inline line under the password fields: true = updated, false = refused. */
    val passwordOk: Boolean? = null,
)

class AccountViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val account = AccountApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(AccountState(email = c.sessionStore.current?.userEmail.orEmpty()))
    val state = _state.asStateFlow()

    init { loadPasskeys(); loadSessions() }

    fun loadSessions() = viewModelScope.launch {
        try { val l = account.sessions(); _state.update { it.copy(sessions = l.sortedByDescending { s -> s.current }, sessionsFailed = false) } }
        catch (e: ApiError) { _state.update { it.copy(sessionsFailed = true) } }
    }

    /** One device out (the web's row button), or every other one; this device stays signed in. */
    fun signOutSession(id: String?) {
        if (_state.value.signingOut != null) return
        _state.update { it.copy(signingOut = id ?: "others") }
        viewModelScope.launch {
            try {
                if (id == null) account.revokeOtherSessions() else account.revokeSession(id)
                _state.update { st -> st.copy(sessions = st.sessions?.filter { if (id == null) it.current else it.id != id }) }
            } catch (e: ApiError) { _state.update { it.copy(error = res.getString(R.string.st_sign_out_failed)) } }
            _state.update { it.copy(signingOut = null) }
            loadSessions()
        }
    }

    private fun loadPasskeys() = viewModelScope.launch {
        runCatching { account.passkeys() }.getOrNull()?.let { l -> _state.update { it.copy(passkeys = l) } }
    }

    fun dismiss() = _state.update { it.copy(error = null, info = null) }

    private fun act(block: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null, info = null) }
        viewModelScope.launch {
            try { block() }
            catch (e: PasskeyCancelled) { /* closed the sheet */ }
            catch (e: ApiError) {
                val left = AccountApi.attemptsRemaining((e as? ApiError.Http)?.body)
                val msg = e.describe(res)
                _state.update { it.copy(error = if (left != null) res.getString(R.string.code_attempts_left, msg, left) else msg) }
            }
            catch (e: Exception) { _state.update { it.copy(error = res.getString(R.string.passkey_add_failed)) } }
            _state.update { it.copy(busy = false) }
        }
    }

    fun requestEmail(newEmail: String, currentPassword: String, onSent: () -> Unit = {}) = act {
        val sent = account.changeEmailRequest(newEmail, currentPassword)
        onSent()
        _state.update { it.copy(pendingEmail = sent.email) }
    }

    fun verifyEmail(code: String) = act {
        val email = account.changeEmailVerify(_state.value.pendingEmail ?: return@act, code)
        c.auth.updateEmail(email)
        _state.update { it.copy(email = email, pendingEmail = null, info = res.getString(R.string.acct_email_changed)) }
    }

    fun cancelEmail() = _state.update { it.copy(pendingEmail = null) }

    fun changePassword(current: String, new: String, onDone: () -> Unit) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, passwordOk = null) }
        viewModelScope.launch {
            try { account.changePassword(current, new); _state.update { it.copy(passwordOk = true) }; onDone() }
            catch (e: ApiError) { _state.update { it.copy(passwordOk = false) } }
            _state.update { it.copy(busy = false) }
        }
    }

    fun addPasskey(activity: Context) = act {
        account.addPasskey(activity, "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        _state.update { it.copy(info = res.getString(R.string.passkey_added)) }
        loadPasskeys()
    }

    fun revoke(p: Passkey) = act { account.revokePasskey(p.id); loadPasskeys() }
}

/** Settings' sections (web settings.tsx), as underline tabs on the phone. */
internal enum class SettingsTab(val label: Int, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    // Web / iOS order and icons (14 Oct 2026): Notifications and Claude (MCP) were missing.
    PROFILE(R.string.st_tab_profile, Icons.Outlined.Person), MEMBERS(R.string.st_tab_members, Icons.Outlined.Group),
    NOTIFICATIONS(R.string.st_tab_notifications, Icons.Outlined.Notifications), SECURITY(R.string.st_tab_security, Icons.Outlined.Lock),
    APPEARANCE(R.string.st_tab_appearance, Icons.Outlined.Palette), MCP(R.string.st_tab_mcp, Icons.Outlined.Power),
}

@Composable
fun AccountScreen(onBack: () -> Unit, onOpenProfile: (String) -> Unit = {}, onLogout: () -> Unit = {}, onDeleteAccount: () -> Unit = {}, vm: AccountViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    var tab by rememberSaveable { mutableStateOf(SettingsTab.PROFILE) }
    Column(Modifier.fillMaxSize().background(c.background)) {
        PageHeader(stringResource(R.string.nav_settings), subtitle = stringResource(R.string.sub_settings), onBack = onBack,
            tabs = { PageTabs(SettingsTab.entries.map { PageTab(it, stringResource(it.label), icon = it.icon) }, tab, { tab = it }) }) {
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            UpdateRow()
            when (tab) {
                SettingsTab.PROFILE -> {
                    id.znetworks.nexus.feature.presence.SetStatusEntry()
                    id.znetworks.nexus.feature.gideon.GideonMemoryEntry()
                    ProfileCard { EmailBlock(s, vm, inline = true) }
                    // The web and iOS show the Password card under Profile too (Security keeps it, with passkeys and sessions).
                    PasswordBlock(s, vm)
                    // Logout, then Delete set apart below it, so the permanent action is never where a thumb lands by habit (iOS).
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(12.dp))
                        .clickable(onClick = onLogout).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.AutoMirrored.Filled.Logout, null, tint = c.dangerText, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.nav_log_out), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
                    }
                    Row(Modifier.padding(top = 10.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(c.card).border(1.dp, c.danger.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
                        .clickable(onClick = onDeleteAccount).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Delete, null, tint = c.dangerText, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.delete_account), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText, modifier = Modifier.weight(1f))
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next), tint = c.mutedFg, modifier = Modifier.size(18.dp))
                    }
                }
                SettingsTab.SECURITY -> {
                    PasswordBlock(s, vm)
                    PasskeysBlock(s, vm)
                    SessionsBlock(s, vm)
                }
                SettingsTab.APPEARANCE -> {
                    AppearanceCard()
                    LanguageCard()
                    ServerCard()
                    OfflineCard()
                }
                SettingsTab.MEMBERS -> WorkspaceMembersCard(onOpenProfile)
                SettingsTab.NOTIFICATIONS -> NotificationsSettingsCard()
                SettingsTab.MCP -> ClaudeMcpCard()
            }
            val identity = (context.applicationContext as NexusApplication).container.identity
            // The live connection (ANDROID-REALTIME): connected / reconnecting / off.
            val rt by (context.applicationContext as NexusApplication).container.realtime.state.collectAsStateWithLifecycle()
            Text(stringResource(R.string.rt_line, stringResource(when (rt) {
                id.znetworks.nexus.core.realtime.Realtime.State.CONNECTED -> R.string.rt_connected
                id.znetworks.nexus.core.realtime.Realtime.State.CONNECTING, id.znetworks.nexus.core.realtime.Realtime.State.RECONNECTING -> R.string.rt_reconnecting
                id.znetworks.nexus.core.realtime.Realtime.State.OFF -> R.string.rt_off
            })), fontSize = 11.sp, color = c.mutedFg.copy(alpha = 0.7f), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Text("${stringResource(R.string.set_footer)} · ${identity.versionName} (${identity.versionCode})", fontSize = 11.sp, color = c.mutedFg.copy(alpha = 0.7f),
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
    }
    (s.error ?: s.info)?.let { AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
}

/** Sign-in email: a code to the new address (current password first), then the code. */
@Composable
private fun EmailBlock(s: AccountState, vm: AccountViewModel, inline: Boolean = false) {
    val c = Nx.colors
    SettingsBlock(stringResource(R.string.acct_email), framed = !inline) {
        var newEmail by rememberSaveable { mutableStateOf("") }
        var code by rememberSaveable { mutableStateOf("") }
        var changing by rememberSaveable { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().background(c.muted, RoundedCornerShape(12.dp)).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(s.email, fontSize = 14.sp, color = c.foreground, modifier = Modifier.weight(1f))
            TextButton(onClick = { changing = !changing }) { Text(stringResource(if (changing) R.string.cancel else R.string.audit_change)) }
        }
        if (changing || s.pendingEmail != null) {
        val pending = s.pendingEmail
        if (pending == null) {
            OutlinedTextField(newEmail, { newEmail = it }, singleLine = true, label = { Text(stringResource(R.string.acct_new_email)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
            // Never saved into the restorable state: a password only lives while the field does.
            var currentPassword by remember { mutableStateOf("") }
            OutlinedTextField(currentPassword, { currentPassword = it }, singleLine = true, label = { Text(stringResource(R.string.st_current_password)) },
                supportingText = { Text(stringResource(R.string.acct_email_password_help)) },
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            NxButton(stringResource(R.string.signup_send_code), { vm.requestEmail(newEmail, currentPassword) { currentPassword = "" } },
                enabled = newEmail.contains('@') && currentPassword.isNotEmpty() && !s.busy)
        } else {
            Text(stringResource(R.string.code_sub, pending), fontSize = 13.sp, color = c.mutedFg)
            OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, singleLine = true, label = { Text(stringResource(R.string.code_label)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NxButton(stringResource(R.string.cancel), vm::cancelEmail, kind = NxButtonKind.GHOST)
                Spacer(Modifier.weight(1f))
                NxButton(stringResource(R.string.acct_confirm), { vm.verifyEmail(code) }, kind = NxButtonKind.PRIMARY, enabled = code.length == 6 && !s.busy)
            }
        }
        }
    }
}

/** Password (web PasswordSection): current + new, "Password updated." / the refusal inline. */
@Composable
private fun PasswordBlock(s: AccountState, vm: AccountViewModel) {
    val c = Nx.colors
    SettingsBlock(stringResource(R.string.st_password)) {
        // Never in the restorable state.
        var current by remember { mutableStateOf("") }
        var new by remember { mutableStateOf("") }
        OutlinedTextField(current, { current = it }, singleLine = true, label = { Text(stringResource(R.string.st_current_password)) },
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(new, { new = it }, singleLine = true, label = { Text(stringResource(R.string.st_new_password)) },
            supportingText = { Text(stringResource(R.string.password_min_ph)) },
            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
        when (s.passwordOk) {
            true -> Text(stringResource(R.string.st_password_updated), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.success)
            false -> Text(stringResource(R.string.st_password_failed), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.dangerText)
            null -> Unit
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            NxButton(stringResource(R.string.st_change_password), { vm.changePassword(current, new) { current = ""; new = "" } }, kind = NxButtonKind.PRIMARY,
                enabled = current.isNotEmpty() && new.length >= 8 && !s.busy)
        }
    }
}

@Composable
private fun PasskeysBlock(s: AccountState, vm: AccountViewModel) {
    val c = Nx.colors
    val context = LocalContext.current
    SettingsBlock(stringResource(R.string.acct_passkeys), stringResource(R.string.acct_passkeys_sub)) {
        val list = s.passkeys
        if (list == null) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        else if (list.isEmpty()) Text(stringResource(R.string.acct_no_passkeys), fontSize = 13.sp, color = c.mutedFg)
        list?.forEach { p ->
            var confirm by remember { mutableStateOf(false) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Key, null, tint = c.mutedFg, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(p.label ?: stringResource(R.string.acct_passkey), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = c.foreground)
                    Text(listOfNotNull(dateOf(p.createdAt)?.let { stringResource(R.string.acct_added_on, it) },
                        dateOf(p.lastUsedAt)?.let { stringResource(R.string.acct_last_used, it) }).joinToString(" · "), fontSize = 12.sp, color = c.mutedFg)
                }
                IconButton(onClick = { confirm = true }) { Icon(Icons.Filled.Delete, stringResource(R.string.delete), tint = c.mutedFg) }
            }
            if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(stringResource(R.string.acct_remove_passkey_q)) },
                text = { Text(stringResource(R.string.acct_remove_passkey_body)) },
                confirmButton = { TextButton(onClick = { confirm = false; vm.revoke(p) }) { Text(stringResource(R.string.delete), color = c.dangerText) } },
                dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } })
        }
        NxButton(stringResource(R.string.acct_add_passkey), { context.findActivity()?.let(vm::addPasskey) }, icon = Icons.Filled.Key, enabled = !s.busy)
    }
}

/**
 * Security › Active sessions (web ActiveSessions.tsx, iOS): every device signed in, this one first with its badge;
 * the others can be signed out one by one or all at once, each behind a centred confirm.
 */
@Composable
private fun SessionsBlock(s: AccountState, vm: AccountViewModel) {
    val c = Nx.colors
    var confirmOne by remember { mutableStateOf<Pair<String, String>?>(null) }
    var confirmOthers by remember { mutableStateOf(false) }
    SettingsBlock(stringResource(R.string.st_sessions), stringResource(R.string.st_sessions_sub)) {
        val rows = s.sessions
        when {
            rows == null && s.sessionsFailed -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.st_sessions_failed), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
                NxButton(stringResource(R.string.st_try_again), { vm.loadSessions() }, compact = true)
            }
            rows == null -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            rows.isEmpty() -> Text(stringResource(R.string.st_sessions_none), fontSize = 13.sp, color = c.mutedFg)
            else -> Column(Modifier.fillMaxWidth().border(1.dp, c.border, RoundedCornerShape(10.dp))) {
                rows.forEachIndexed { i, r ->
                    if (i > 0) androidx.compose.material3.HorizontalDivider(color = c.border)
                    val device = DeviceLabel.describe(r.userAgent, r.client)
                    val name = deviceName(device)
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)).background(if (r.current) c.accentBg else c.muted), contentAlignment = Alignment.Center) {
                            Icon(when (device.kind) {
                                DeviceLabel.Kind.PHONE -> Icons.Filled.PhoneAndroid; DeviceLabel.Kind.TABLET -> Icons.Filled.TabletAndroid
                                DeviceLabel.Kind.DESKTOP -> Icons.Filled.Computer; DeviceLabel.Kind.UNKNOWN -> Icons.Filled.DevicesOther
                            }, null, tint = if (r.current) c.accentFg else c.mutedFg, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1,
                                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                if (r.current) {
                                    Spacer(Modifier.width(6.dp))
                                    Text(stringResource(R.string.st_this_device), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.success,
                                        modifier = Modifier.clip(RoundedCornerShape(50)).background(c.success.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 2.dp))
                                }
                            }
                            Text(sessionMeta(r), fontSize = 12.sp, color = c.mutedFg, maxLines = 2)
                        }
                        if (!r.current) {
                            Spacer(Modifier.width(6.dp))
                            if (s.signingOut == r.id) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            else NxButton(stringResource(R.string.st_sign_out), { confirmOne = r.id to name }, compact = true, enabled = s.signingOut == null)
                        }
                    }
                }
            }
        }
        if (rows.orEmpty().any { !it.current }) NxButton(stringResource(R.string.st_sessions_others), { confirmOthers = true },
            icon = Icons.AutoMirrored.Filled.Logout, enabled = s.signingOut == null)
    }
    confirmOne?.let { (id, name) ->
        AlertDialog(onDismissRequest = { confirmOne = null }, text = { Text(stringResource(R.string.st_sign_out_q, name)) },
            confirmButton = { TextButton(onClick = { confirmOne = null; vm.signOutSession(id) }) { Text(stringResource(R.string.st_sign_out), color = c.dangerText) } },
            dismissButton = { TextButton(onClick = { confirmOne = null }) { Text(stringResource(R.string.cancel)) } })
    }
    if (confirmOthers) AlertDialog(onDismissRequest = { confirmOthers = false }, text = { Text(stringResource(R.string.st_sessions_others_q)) },
        confirmButton = { TextButton(onClick = { confirmOthers = false; vm.signOutSession(null) }) { Text(stringResource(R.string.st_sign_out), color = c.dangerText) } },
        dismissButton = { TextButton(onClick = { confirmOthers = false }) { Text(stringResource(R.string.cancel)) } })
}

/** "NEXUS app for Android 0.1.6 (13)", "Chrome on Windows", "Unknown device". */
@Composable
private fun deviceName(d: DeviceLabel): String = when (d) {
    is DeviceLabel.App -> {
        val app = stringResource(if (d.platform == "ios") R.string.st_app_ios else R.string.st_app_android)
        when {
            d.version != null && d.build != null -> "$app ${d.version} (${d.build})"
            d.version != null -> "$app ${d.version}"
            d.build != null -> "$app (${stringResource(R.string.st_build, d.build)})"
            else -> app
        }
    }
    is DeviceLabel.Browser -> if (d.browser != null && d.os != null) stringResource(R.string.st_browser_on, d.browser, d.os) else d.browser ?: d.os ?: stringResource(R.string.st_unknown_device)
    DeviceLabel.Unknown -> stringResource(R.string.st_unknown_device)
}

/** "103.x.x.x · Active 3 hours ago · Signed in 2 Oct". */
@Composable
private fun sessionMeta(r: UserSession): String {
    val now = System.currentTimeMillis()
    val last = r.lastActiveAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    val active = if (r.current || last == null) null else if (SessionTime.activeNow(last, now)) stringResource(R.string.st_active_now)
        else stringResource(R.string.st_active_ago, android.text.format.DateUtils.getRelativeTimeSpanString(last, now, android.text.format.DateUtils.MINUTE_IN_MILLIS).toString())
    val started = r.createdAt?.let { iso -> runCatching {
        val d = Instant.parse(iso).atZone(ZoneId.of("Asia/Jakarta"))
        DateTimeFormatter.ofPattern(if (d.year == java.time.LocalDate.now().year) "d MMM" else "d MMM yyyy", Locale.getDefault()).format(d)
    }.getOrNull() } ?: "—"
    return listOfNotNull(r.ipAddress?.takeIf { it.isNotBlank() }, active, stringResource(R.string.st_signed_in_on, started)).joinToString(" · ")
}

private fun dateOf(iso: String?): String? = iso?.let {
    runCatching { AppDateFormats.ofPattern("d MMM yyyy", Locale.getDefault()).format(Instant.parse(it).atZone(ZoneId.of("Asia/Jakarta"))) }.getOrNull()
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
        content()
    }
}

/** Tuning Room's one mention of an optional update; a deadline outranks a mere "newer version" (iOS, audit R11). */
@Composable
private fun UpdateRow() {
    val c = Nx.colors
    val context = LocalContext.current
    val gate by (context.applicationContext as NexusApplication).container.versionGate.state.collectAsStateWithLifecycle()
    val grace = gate.grace
    val text = when {
        grace != null -> stringResource(R.string.update_grace_body, AppDateFormats.ofPattern("d MMM, HH:mm", Locale.getDefault())
            .format(grace.deadline.atZone(id.znetworks.nexus.core.time.OfficeTime.ZONE)))
        gate.available != null -> stringResource(R.string.update_available, gate.available!!)
        else -> return
    }
    val tint = if (grace != null) c.warning else c.violetText
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(tint.copy(alpha = 0.1f)).border(1.dp, tint.copy(alpha = 0.3f), RoundedCornerShape(18.dp))
        .padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.SystemUpdate, null, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(text, fontSize = 13.sp, color = c.foreground, modifier = Modifier.weight(1f))
        TextButton(onClick = { startUpdate(context, gate.storeUrl) }) { Text(stringResource(R.string.update_action), fontWeight = FontWeight.Bold) }
    }
}

/** iOS AppearanceCard: three buttons, the chosen one filled. */
@Composable
private fun AppearanceCard() {
    val c = Nx.colors
    val appearance = (LocalContext.current.applicationContext as NexusApplication).container.appearance
    val theme by appearance.theme.collectAsStateWithLifecycle()
    SettingsCard(stringResource(R.string.st_theme)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppTheme.entries.forEach { t ->
                val on = theme == t
                Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(if (on) c.onyx else c.muted.copy(alpha = 0.5f))
                    .clickable { appearance.set(t) }.padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val fg = if (on) c.background else c.mutedFg
                    Icon(when (t) { AppTheme.SYSTEM -> Icons.Filled.PhoneAndroid; AppTheme.LIGHT -> Icons.Filled.LightMode; AppTheme.DARK -> Icons.Filled.DarkMode }, null, tint = fg, modifier = Modifier.size(20.dp))
                    Text(stringResource(themeLabel(t)), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 1)
                }
            }
        }
    }
}

private fun themeLabel(t: AppTheme) = when (t) {
    AppTheme.SYSTEM -> R.string.theme_system
    AppTheme.LIGHT -> R.string.theme_light
    AppTheme.DARK -> R.string.theme_dark
}

/** iOS LanguageCard: flag rows with a check; applies at once, no restart. */
@Composable
private fun LanguageCard() {
    val c = Nx.colors
    val context = LocalContext.current
    val current = if (id.znetworks.nexus.core.config.ConfigBody.lang(LocalConfiguration.current.locales[0]) == "id") AppLanguage.INDONESIAN else AppLanguage.ENGLISH
    SettingsCard(stringResource(R.string.st_language), stringResource(R.string.set_language_hint)) {
        listOf(Triple(AppLanguage.ENGLISH, "🇬🇧", "English"), Triple(AppLanguage.INDONESIAN, "🇮🇩", "Bahasa Indonesia")).forEach { (tag, flag, label) ->
            val on = current == tag
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (on) c.violet.copy(alpha = 0.1f) else Color.Transparent)
                .clickable { if (!on) AppLanguage.choose(context, tag) }.padding(horizontal = 11.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(flag, fontSize = 20.sp)
                Spacer(Modifier.width(10.dp))
                Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
                Icon(if (on) Icons.Filled.CheckCircle else Icons.Outlined.Circle, null, tint = if (on) c.violetText else c.mutedFg.copy(alpha = 0.4f), modifier = Modifier.size(20.dp))
            }
        }
    }
}

/** Settings › Server (DEV-REDESIGN.md): Production or the redesign's DEV server; a switch signs out. */
@Composable
private fun ServerCard() {
    val c = Nx.colors
    var switchTo by remember { mutableStateOf<id.znetworks.nexus.core.net.ServerEnv?>(null) }
    val current = id.znetworks.nexus.core.net.NexusConfig.env
    SettingsCard(stringResource(R.string.server_caps).lowercase().replaceFirstChar(Char::titlecase), stringResource(R.string.server_hint)) {
        id.znetworks.nexus.core.net.ServerEnv.entries.forEach { env ->
            val on = current == env
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (on) c.violet.copy(alpha = 0.1f) else Color.Transparent)
                .clickable { if (!on) switchTo = env }.padding(horizontal = 11.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(id.znetworks.nexus.ui.components.serverLabel(env)), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                if (env == id.znetworks.nexus.core.net.ServerEnv.DEV) { Spacer(Modifier.width(8.dp)); id.znetworks.nexus.ui.components.DevBadge() }
                Spacer(Modifier.weight(1f))
                Icon(if (on) Icons.Filled.CheckCircle else Icons.Outlined.Circle, null, tint = if (on) c.violetText else c.mutedFg.copy(alpha = 0.4f), modifier = Modifier.size(20.dp))
            }
        }
    }
    switchTo?.let { id.znetworks.nexus.ui.components.ServerSwitchDialog(it) { switchTo = null } }
}

/** A settings card in the web's look: plain title, optional muted line (was iOS's violet caps label). */
@Composable
private fun SettingsCard(label: String, hint: String? = null, content: @Composable () -> Unit) = SettingsBlock(label, hint, content = content)
