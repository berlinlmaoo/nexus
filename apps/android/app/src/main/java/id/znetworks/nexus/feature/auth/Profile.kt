package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.feature.presence.PresenceLine

import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import id.znetworks.nexus.ui.theme.TextFont
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.components.NxButton
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.attendance.requests.AttachmentReader
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable data class ProfileUser(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null, val googleWorkspaceEmail: String? = null,
                                    val phoneNumber: String? = null)
@Serializable data class ProfileResponse(val user: ProfileUser)

/** Avatars: re-encoded to JPEG with the long edge capped at 1024 px, well under the server's 5 MB. */
object AvatarUpload {
    const val MAX_EDGE = 1024
    fun part(jpeg: ByteArray) = MultipartBody.Builder().setType(MultipartBody.FORM)
        .addFormDataPart("file", "avatar.jpg", jpeg.toRequestBody("image/jpeg".toMediaType())).build()
}

class ProfileApi(private val api: ApiClient) {
    suspend fun profile() = api.get("/api/user/profile", ProfileResponse.serializer()).user
    /** The in-app language for notifications and pushes (server User.uiLanguage, 13 Oct 2026). */
    suspend fun sendUiLanguage(code: String) = api.send(Request.Builder().url(api.url("/api/user/profile")).patch(buildJsonObject { put("uiLanguage", code) }.toString().toJsonBody()).build(), JsonObject.serializer())
    /** Name and phone together, as the web's Save (`phoneNumber: phone.trim() || null`). */
    suspend fun updateProfile(name: String, phone: String?) = api.send(Request.Builder().url(api.url("/api/user/profile")).patch(buildJsonObject {
        put("name", name.trim()); put("phoneNumber", phone?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
    }.toString().toJsonBody()).build(), JsonObject.serializer())
    suspend fun rename(name: String) = api.send(Request.Builder().url(api.url("/api/user/profile")).patch(buildJsonObject { put("name", name.trim()) }.toString().toJsonBody()).build(), JsonObject.serializer())
    /** `user.avatar` comes back with a `?t=` cache-buster, so the new picture shows at once. */
    suspend fun uploadAvatar(jpeg: ByteArray) = api.send(Request.Builder().url(api.url("/api/upload/avatar")).post(AvatarUpload.part(jpeg)).build(), ProfileResponse.serializer()).user.avatar
    suspend fun removeAvatar() = api.send(Request.Builder().url(api.url("/api/upload/avatar")).delete().build(), JsonObject.serializer())
    /** Somebody else's photo, by a BoD, through their workspace membership. */
    suspend fun uploadMemberAvatar(memberId: String, jpeg: ByteArray) =
        api.send(Request.Builder().url(api.url("/api/workspaces/members/$memberId/avatar")).post(AvatarUpload.part(jpeg)).build(), JsonObject.serializer())
}

/** Picks a photo and hands back the avatar-ready JPEG, or null when it could not be read. */
@Composable
fun rememberAvatarPicker(onPicked: (ByteArray?) -> Unit): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { scope.launch { onPicked(withContext(Dispatchers.IO) { AttachmentReader.uprightJpeg(context, it, AvatarUpload.MAX_EDGE) }) } }
    }
    return { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}

/**
 * Settings › Profile (web ProfileSection): photo (change / remove), full name, phone number, the company Google
 * address (read-only), one Save for name and phone.
 */
@Composable
fun ProfileCard(emailContent: @Composable () -> Unit = {}) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { ProfileApi(container.api) }
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<ProfileUser?>(null) }
    var name by remember { mutableStateOf(container.sessionStore.current?.userName.orEmpty()) }
    var phone by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var photoBusy by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var phoneBad by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { api.profile() }.getOrNull()?.let { user = it; name = it.name ?: name; phone = PhoneRules.display(it.phoneNumber) } }
    val pick = rememberAvatarPicker { jpeg ->
        if (jpeg == null) { problem = res.getString(R.string.chat_photo_unreadable); return@rememberAvatarPicker }
        scope.launch {
            photoBusy = true; problem = null
            try { val url = api.uploadAvatar(jpeg); user = user?.copy(avatar = url) } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
            photoBusy = false
        }
    }
    SettingsBlock(stringResource(R.string.st_tab_profile), stringResource(R.string.st_profile_sub)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(name, user?.avatar, 72.dp, userId = user?.id); Spacer(Modifier.width(14.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    NxButton(stringResource(R.string.pf_change_photo), pick, compact = true, enabled = !photoBusy)
                    if (!user?.avatar.isNullOrEmpty()) NxButton(stringResource(R.string.pf_remove_photo), {
                        scope.launch {
                            photoBusy = true; problem = null
                            try { api.removeAvatar(); user = user?.copy(avatar = null) } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                            photoBusy = false
                        }
                    }, compact = true, kind = NxButtonKind.GHOST, enabled = !photoBusy)
                    if (photoBusy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                }
                Text(stringResource(R.string.st_photo_hint), fontSize = 12.sp, color = c.mutedFg)
            }
        }
        PresenceLine(user?.id, chip = true)
        ProfileEntry(stringResource(R.string.st_full_name), name, { name = it; saved = false })
        emailContent()
        // Read-only: a BoD links it from Control Room; the person only needs to know which address it is.
        Text("Google Workspace", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.mutedFg)
        val g = user?.googleWorkspaceEmail
        Text(g ?: stringResource(R.string.pf_no_google), fontSize = if (g == null) 13.sp else 15.sp, color = if (g == null) c.mutedFg else c.foreground, maxLines = 1, modifier = Modifier.fillMaxWidth().background(c.muted, RoundedCornerShape(12.dp)).padding(12.dp))
        ProfileEntry(stringResource(R.string.st_phone), phone, { phone = it; saved = false; phoneBad = false }, KeyboardOptions(keyboardType = KeyboardType.Phone))
        Text(stringResource(if (phoneBad) R.string.st_phone_invalid else R.string.st_phone_hint), fontSize = 12.sp, color = if (phoneBad) c.dangerText else c.mutedFg)
        problem?.let { Text(it, fontSize = 13.sp, color = c.dangerText) }
        if (saved) Text(stringResource(R.string.st_profile_saved), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.success)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            NxButton(stringResource(R.string.st_save), onClick = {
                when (val p = PhoneRules.check(phone)) {
                    PhoneRules.Result.Invalid -> phoneBad = true
                    is PhoneRules.Result.Ok -> scope.launch {
                        busy = true; problem = null
                        try {
                            api.updateProfile(name, p.value)
                            container.sessionStore.current?.let { container.sessionStore.save(it.copy(userName = name.trim())) }
                            saved = true
                        } catch (e: ApiError) { problem = res.getString(R.string.st_profile_failed) + " · " + e.describe(res) }
                        busy = false
                    }
                }
            }, kind = NxButtonKind.PRIMARY, enabled = !busy && name.isNotBlank())
        }
    }
}

/** A settings card as the web's (`rounded-xl border bg-card p-6`): a plain title, an optional line under it. */
@Composable
internal fun SettingsBlock(title: String, subtitle: String? = null, framed: Boolean = true, content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().then(if (framed) Modifier.background(c.card, RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).padding(16.dp) else Modifier),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column {
            Text(title, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = c.foreground)
            subtitle?.let { Text(it, fontSize = 13.sp, color = c.mutedFg) }
        }
        content()
    }
}

@Composable
private fun ProfileEntry(label: String, value: String, onChange: (String) -> Unit, options: KeyboardOptions = KeyboardOptions.Default) {
    val c = Nx.colors
    Column {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = c.mutedFg)
        TextField(value, onChange, singleLine = true, keyboardOptions = options, shape = RoundedCornerShape(12.dp),
            colors = TextFieldDefaults.colors(focusedContainerColor = c.muted, unfocusedContainerColor = c.muted, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent), modifier = Modifier.fillMaxWidth())
    }
}
