package id.znetworks.nexus.feature.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

object InviteResult {
    /** Only an explicit `emailSent:false` is a failure: older servers said nothing and did send. */
    fun emailFailed(r: JsonObject) = (r["emailSent"] as? JsonPrimitive)?.booleanOrNull == false
    fun email(r: JsonObject, typed: String) = runCatching { r["member"]?.jsonObject?.get("email")?.jsonPrimitive?.contentOrNull }.getOrNull() ?: typed.trim()
}

/** Tuning Room › Members (iOS WorkspaceMembersCard): invite, change role, remove; BoD and above. */
@Composable
fun WorkspaceMembersCard(onOpenProfile: (String) -> Unit) {
    val api = adminApi()
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var roster by remember { mutableStateOf<WsRoster?>(null) }
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("STAFF") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<Pair<String, Boolean>?>(null) } // text, emailFailed
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) { roster = runCatching { api.roster(includeRegistered = false) }.getOrNull() ?: roster }
    val r = roster
    val ws = r?.workspaceId
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.wm_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
        if (r == null || ws == null) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); return@Column }
        val roles = Roles.assignable(r.role)
        if (roles.isNotEmpty()) Column(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.3f), RoundedCornerShape(12.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(email, { email = it }, singleLine = true, placeholder = { Text(stringResource(R.string.wm_email)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                var open by remember { mutableStateOf(false) }
                Box {
                    Text(Roles.label(role), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.violetText,
                        modifier = Modifier.clip(CircleShape).background(c.violet.copy(alpha = 0.12f)).clickable { open = true }.padding(horizontal = 10.dp, vertical = 8.dp))
                    DropdownMenu(open, { open = false }) { roles.forEach { k -> DropdownMenuItem({ Text(Roles.label(k)) }, { open = false; role = k }) } }
                }
            }
            Button(onClick = {
                val typed = email
                scope.launch {
                    busy = true; err = null; notice = null
                    try {
                        val out = api.invite(typed, role, ws)
                        val who = InviteResult.email(out, typed)
                        notice = if (InviteResult.emailFailed(out)) res.getString(R.string.wm_added_no_email, who) to true else res.getString(R.string.wm_invited, who) to false
                        email = ""; tick++
                    } catch (e: ApiError) { err = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                    busy = false
                }
            }, enabled = !busy && email.contains('@'), modifier = Modifier.fillMaxWidth()) {
                if (busy) CircularProgressIndicator(Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp) else Text(stringResource(R.string.wm_invite))
            }
            notice?.let { (t, failed) -> Text(t, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (failed) c.danger else c.success) }
        }
        r.members.sortedBy { it.displayName.lowercase() }.forEachIndexed { i, m ->
            if (i > 0) HorizontalDivider(color = c.border)
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).clickable { onOpenProfile(m.userId) }, verticalAlignment = Alignment.CenterVertically) {
                    Avatar(m.name, m.avatar, 36.dp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(m.displayName, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1)
                        m.email?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1) }
                    }
                }
                var open by remember { mutableStateOf(false) }
                val editable = Roles.canEdit(r.role, m.role)
                Box {
                    Text(Roles.label(m.role), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.violetText,
                        modifier = Modifier.clip(CircleShape).background(c.violet.copy(alpha = 0.12f)).then(if (editable) Modifier.clickable { open = true } else Modifier).padding(horizontal = 9.dp, vertical = 5.dp))
                    DropdownMenu(open, { open = false }) {
                        roles.forEach { k -> DropdownMenuItem({ Text(Roles.label(k)) }, { open = false; scope.launch {
                            try { api.patchMember(m.id, ws, mapOf("role" to JsonPrimitive(k))) } catch (e: ApiError) { err = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }; tick++ } }) }
                        HorizontalDivider()
                        DropdownMenuItem({ Text(stringResource(R.string.wm_remove), color = c.danger) }, { open = false; scope.launch {
                            try { api.removeMember(m.id, ws) } catch (e: ApiError) { err = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }; tick++ } })
                    }
                }
            }
        }
        err?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.danger) }
    }
}
