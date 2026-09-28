package id.znetworks.nexus.feature.auth

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.compose.foundation.background
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
)

class AccountViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val account = AccountApi(c.api)
    private val res get() = getApplication<Application>().resources
    private val _state = MutableStateFlow(AccountState(email = c.sessionStore.current?.userEmail.orEmpty()))
    val state = _state.asStateFlow()

    init { loadPasskeys() }

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

    fun requestEmail(newEmail: String) = act {
        val sent = account.changeEmailRequest(newEmail)
        _state.update { it.copy(pendingEmail = sent.email) }
    }

    fun verifyEmail(code: String) = act {
        val email = account.changeEmailVerify(_state.value.pendingEmail ?: return@act, code)
        c.auth.updateEmail(email)
        _state.update { it.copy(email = email, pendingEmail = null, info = res.getString(R.string.acct_email_changed)) }
    }

    fun cancelEmail() = _state.update { it.copy(pendingEmail = null) }

    fun changePassword(current: String, new: String, onDone: () -> Unit) = act {
        account.changePassword(current, new)
        _state.update { it.copy(info = res.getString(R.string.acct_password_changed)) }
        onDone()
    }

    fun addPasskey(activity: Context) = act {
        account.addPasskey(activity, "${Build.MANUFACTURER} ${Build.MODEL}".trim())
        _state.update { it.copy(info = res.getString(R.string.passkey_added)) }
        loadPasskeys()
    }

    fun revoke(p: Passkey) = act { account.revokePasskey(p.id); loadPasskeys() }
}

@Composable
fun AccountScreen(onBack: () -> Unit, onOpenProfile: (String) -> Unit = {}, vm: AccountViewModel = viewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val c = Nx.colors
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().background(c.background)) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.acct_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground, modifier = Modifier.weight(1f))
            if (s.busy) CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), strokeWidth = 2.dp)
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Section(stringResource(R.string.acct_email)) {
                var newEmail by rememberSaveable { mutableStateOf("") }
                var code by rememberSaveable { mutableStateOf("") }
                Text(s.email, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                val pending = s.pendingEmail
                if (pending == null) {
                    OutlinedTextField(newEmail, { newEmail = it }, singleLine = true, label = { Text(stringResource(R.string.acct_new_email)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                    OutlinedButton(onClick = { vm.requestEmail(newEmail) }, enabled = newEmail.contains('@') && !s.busy, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.signup_send_code))
                    }
                } else {
                    Text(stringResource(R.string.code_sub, pending), fontSize = 12.sp, color = c.mutedFg)
                    OutlinedTextField(code, { code = it.filter(Char::isDigit).take(6) }, singleLine = true, label = { Text(stringResource(R.string.code_label)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth())
                    Row {
                        TextButton(onClick = vm::cancelEmail) { Text(stringResource(R.string.cancel)) }
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { vm.verifyEmail(code) }, enabled = code.length == 6 && !s.busy) { Text(stringResource(R.string.acct_confirm), fontWeight = FontWeight.Bold) }
                    }
                }
            }
            WorkspaceMembersCard(onOpenProfile)
            Section(stringResource(R.string.acct_password)) {
                var current by rememberSaveable { mutableStateOf("") }
                var new by rememberSaveable { mutableStateOf("") }
                OutlinedTextField(current, { current = it }, singleLine = true, label = { Text(stringResource(R.string.acct_current_password)) },
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(new, { new = it }, singleLine = true, label = { Text(stringResource(R.string.reset_new_password)) },
                    supportingText = { Text(stringResource(R.string.password_min_ph)) },
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = { vm.changePassword(current, new) { current = ""; new = "" } },
                    enabled = current.isNotEmpty() && new.length >= 8 && !s.busy, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.acct_change_password)) }
            }
            Section(stringResource(R.string.acct_passkeys)) {
                Text(stringResource(R.string.acct_passkeys_sub), fontSize = 12.sp, color = c.mutedFg)
                val list = s.passkeys
                if (list == null) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else if (list.isEmpty()) Text(stringResource(R.string.acct_no_passkeys), fontSize = 13.sp, color = c.mutedFg)
                list?.forEach { p ->
                    var confirm by remember { mutableStateOf(false) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Key, null, tint = c.violetText, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(p.label ?: stringResource(R.string.acct_passkey), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            Text(listOfNotNull(dateOf(p.createdAt)?.let { stringResource(R.string.acct_added_on, it) },
                                dateOf(p.lastUsedAt)?.let { stringResource(R.string.acct_last_used, it) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                        }
                        IconButton(onClick = { confirm = true }) { Icon(Icons.Filled.Delete, stringResource(R.string.delete), tint = c.mutedFg) }
                    }
                    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(stringResource(R.string.acct_remove_passkey_q)) },
                        text = { Text(stringResource(R.string.acct_remove_passkey_body)) },
                        confirmButton = { TextButton(onClick = { confirm = false; vm.revoke(p) }) { Text(stringResource(R.string.delete), color = c.danger) } },
                        dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } })
                }
                OutlinedButton(onClick = { context.findActivity()?.let(vm::addPasskey) }, enabled = !s.busy, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Key, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.acct_add_passkey))
                }
            }
        }
    }
    (s.error ?: s.info)?.let { AlertDialog(onDismissRequest = vm::dismiss, text = { Text(it) }, confirmButton = { TextButton(onClick = vm::dismiss) { Text("OK") } }) }
}

private fun dateOf(iso: String?): String? = iso?.let {
    runCatching { DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()).format(Instant.parse(it).atZone(ZoneId.of("Asia/Jakarta"))) }.getOrNull()
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
