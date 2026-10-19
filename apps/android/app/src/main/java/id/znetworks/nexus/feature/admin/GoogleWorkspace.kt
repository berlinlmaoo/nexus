package id.znetworks.nexus.feature.admin

import id.znetworks.nexus.ui.components.NxTextField

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request

// Control Room › user › Google Workspace (BoD): link an existing company account, unlink, or create a
// mailbox (fills a paid seat; the temporary password is shown exactly once and never stored).

@Serializable data class GwLinkedTo(val id: String, val name: String = "")
@Serializable data class GwAccount(val email: String, val fullName: String = "", val suspended: Boolean = false, val isAdmin: Boolean = false,
                                   val domain: String = "", val linkedTo: GwLinkedTo? = null)
@Serializable data class GwAccounts(val configured: Boolean = false, val domains: List<String>? = null, val accounts: List<GwAccount> = emptyList(), val error: String? = null)
@Serializable data class GwCreatedAccount(val email: String, val fullName: String = "", val temporaryPassword: String)
@Serializable data class GwNotified(val inApp: Boolean = false, val email: Boolean = false, val emailTo: String? = null)
@Serializable data class GwCreated(val created: Boolean = false, val linked: Boolean = false, val account: GwCreatedAccount, val notified: GwNotified? = null, val error: String? = null)

object GoogleLogic {
    /** First guess from the NEXUS name; every box stays editable. Google requires a last name: "-" as the web. */
    fun guess(name: String): Triple<String, String, String> {
        val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val given = parts.firstOrNull().orEmpty()
        val family = if (parts.size > 1) parts.drop(1).joinToString(" ") else "-"
        val local = given.lowercase().filter { it.isLetterOrDigit() || it == '.' || it == '_' || it == '-' }
        return Triple(given, family, local)
    }
    /** Used by someone else: not pickable, and the owner is named (the server refuses it too). */
    fun takenByOther(a: GwAccount, userId: String) = a.linkedTo != null && a.linkedTo.id != userId
    fun search(all: List<GwAccount>, q: String): List<GwAccount> {
        val t = q.trim().lowercase()
        return if (t.isEmpty()) all else all.filter { t in it.email.lowercase() || t in it.fullName.lowercase() }
    }
    /** JSON null unlinks; omitted would change nothing. */
    fun linkBody(email: String?) = JsonObject(mapOf("googleWorkspaceEmail" to (email?.let { JsonPrimitive(it) } ?: JsonNull)))
}

class GoogleApi(private val api: ApiClient) {
    suspend fun accounts() = api.get("/api/admin/google-workspace/accounts", GwAccounts.serializer())
    suspend fun link(userId: String, email: String?) =
        api.send(Request.Builder().url(api.url("/api/admin/users/$userId")).patch(GoogleLogic.linkBody(email).toString().toJsonBody()).build(), JsonObject.serializer())
    /** 201 created+linked, 207 created but not linked (`error` says why). */
    suspend fun create(userId: String, local: String, domain: String, given: String, family: String) =
        api.send(Request.Builder().url(api.url("/api/admin/google-workspace/users")).post(buildJsonObject {
            put("userId", userId); put("localPart", local.trim()); put("domain", domain); put("givenName", given.trim()); put("familyName", family.trim())
        }.toString().toJsonBody()).build(), GwCreated.serializer())
}

/** Copies the temporary password flagged as sensitive, so Android 13+ hides it in the clipboard preview. */
private fun copySecret(context: Context, text: String) {
    val clip = ClipData.newPlainText("password", text)
    if (Build.VERSION.SDK_INT >= 33) clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
}

@Composable
fun GoogleLinkDialog(userId: String, name: String, current: String?, onDismiss: () -> Unit, onDone: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { GoogleApi(container.api) }
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<GwAccounts?>(null) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var making by remember { mutableStateOf(false) }
    var made by remember { mutableStateOf<GwCreated?>(null) }
    var given by remember { mutableStateOf("") }
    var family by remember { mutableStateOf("") }
    var local by remember { mutableStateOf("") }
    var domain by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        try { data = api.accounts() } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
        loading = false
    }
    fun link(email: String?) = scope.launch {
        busy = true; problem = null
        try { api.link(userId, email); onDone(); onDismiss() } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
        busy = false
    }
    // No way out while the password is on screen except "Copied": a reflex tap would lose the only copy.
    val locked = made != null
    Dialog(onDismissRequest = { if (!locked) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = !locked, dismissOnClickOutside = false)) {
        Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.foreground, modifier = Modifier.weight(1f).padding(start = 8.dp), maxLines = 1)
                if (busy && !locked) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                if (!locked) TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) }
            }
            HorizontalDivider(color = c.border)
            val d = data
            val m = made
            when {
                loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                d == null -> Text(problem.orEmpty(), color = c.danger, fontSize = 13.sp, modifier = Modifier.padding(24.dp))
                !d.configured -> Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(stringResource(R.string.gw_not_connected), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
                    Text(d.error ?: stringResource(R.string.gw_ask_bod), fontSize = 12.sp, color = c.mutedFg)
                }
                m != null -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(stringResource(R.string.gw_created, m.account.email), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.success)
                    Text(stringResource(R.string.gw_temp_pw), fontSize = 12.sp, color = c.mutedFg)
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.card).border(1.dp, c.border, RoundedCornerShape(10.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        SelectionContainer(Modifier.weight(1f)) { Text(m.account.temporaryPassword, fontFamily = FontFamily.Monospace, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = c.foreground) }
                        IconButton(onClick = { copySecret(context, m.account.temporaryPassword) }) { Icon(Icons.Filled.ContentCopy, stringResource(R.string.gw_copy), tint = c.violetText) }
                    }
                    Text(stringResource(R.string.gw_must_change), fontSize = 11.sp, color = c.mutedFg)
                    // An email failure must be seen NOW, while the password is still on screen.
                    if (m.notified?.email == true) Text(stringResource(R.string.gw_sent_to, m.notified.emailTo ?: "-"), fontSize = 11.sp, color = c.success)
                    else Text(stringResource(R.string.gw_email_failed), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.danger)
                    if (!m.linked) Text(m.error ?: stringResource(R.string.gw_not_linked), fontSize = 11.sp, color = c.warning)
                    Button(onClick = { made = null; making = false; onDone(); onDismiss() }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.gw_copied)) }
                }
                making -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.gw_name_in_google), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                    NxTextField(given, { given = it }, singleLine = true, label = { Text(stringResource(R.string.gw_first)) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done)
                    NxTextField(family, { family = it }, singleLine = true, label = { Text(stringResource(R.string.gw_last)) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done)
                    Text(stringResource(R.string.gw_address), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        NxTextField(local, { local = it.trim() }, singleLine = true, placeholder = { Text("nama.alamat") }, modifier = Modifier.weight(1f), keyboardOptions = AdminKeyboard.Done)
                        Text(" @ ", color = c.mutedFg)
                        var open by remember { mutableStateOf(false) }
                        Box {
                            Text(domain.ifEmpty { stringResource(R.string.gw_pick) }, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.violetText, modifier = Modifier.clickable { open = true }.padding(8.dp))
                            DropdownMenu(open, { open = false }) { d.domains.orEmpty().forEach { x -> DropdownMenuItem({ Text(x) }, { open = false; domain = x }) } }
                        }
                    }
                    Text(stringResource(R.string.gw_seat_note), fontSize = 10.sp, color = c.mutedFg)
                    problem?.let { Text(it, fontSize = 12.sp, color = c.danger) }
                    Button(onClick = {
                        scope.launch {
                            busy = true; problem = null
                            try { made = api.create(userId, local, domain, given, family) } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                            busy = false
                        }
                    }, enabled = !busy && local.isNotBlank() && domain.isNotEmpty() && given.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(if (busy) R.string.gw_creating else R.string.gw_create))
                    }
                    TextButton(onClick = { making = false; problem = null }) { Text(stringResource(R.string.cancel)) }
                }
                else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                    item {
                        Row(Modifier.fillMaxWidth().clickable(enabled = !busy) {
                            val (g, f, l) = GoogleLogic.guess(name); given = g; family = f; local = l; domain = d.domains?.firstOrNull().orEmpty(); problem = null; making = true
                        }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.AddCircle, null, tint = c.violetText); Spacer(Modifier.width(10.dp))
                            Column {
                                Text(stringResource(R.string.gw_create_mailbox), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                                Text(stringResource(R.string.gw_fills_seat), fontSize = 10.sp, color = c.mutedFg)
                            }
                        }
                        if (current != null) Row(Modifier.fillMaxWidth().clickable(enabled = !busy) { link(null) }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.LinkOff, null, tint = c.danger); Spacer(Modifier.width(10.dp))
                            Text(stringResource(R.string.gw_unlink, current), fontSize = 14.sp, color = c.danger)
                        }
                        problem?.let { Text(it, fontSize = 12.sp, color = c.danger, modifier = Modifier.padding(vertical = 6.dp)) }
                        NxTextField(query, { query = it }, singleLine = true, placeholder = { Text(stringResource(R.string.gw_search)) }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), keyboardOptions = AdminKeyboard.Done)
                        Text(stringResource(R.string.gw_accounts).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
                    }
                    items(GoogleLogic.search(d.accounts, query), key = { it.email }) { a ->
                        val taken = GoogleLogic.takenByOther(a, userId)
                        Row(Modifier.fillMaxWidth().clickable(enabled = !busy && !taken) { link(a.email) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(a.email, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (taken) c.mutedFg else c.foreground)
                                Text(listOfNotNull(a.fullName.ifEmpty { null }, if (a.suspended) stringResource(R.string.gw_suspended) else null,
                                    a.linkedTo?.takeIf { taken }?.let { stringResource(R.string.gw_used_by, it.name) }).joinToString(" · "), fontSize = 11.sp, color = c.mutedFg)
                            }
                            if (a.email == current) Icon(Icons.Filled.Check, null, tint = c.success)
                        }
                        HorizontalDivider(color = c.border)
                    }
                }
            }
        }
    }
}
