package id.znetworks.nexus.feature.auth

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

@Serializable data class ProfileUser(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null, val googleWorkspaceEmail: String? = null)
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

/** Tuning Room › Profile: photo (upload/remove), name, and the company Google address (read-only). */
@Composable
fun ProfileCard() {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val container = (context.applicationContext as NexusApplication).container
    val api = remember { ProfileApi(container.api) }
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<ProfileUser?>(null) }
    var name by remember { mutableStateOf(container.sessionStore.current?.userName.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var photoBusy by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { api.profile() }.getOrNull()?.let { user = it; name = it.name ?: name } }
    val pick = rememberAvatarPicker { jpeg ->
        if (jpeg == null) { problem = res.getString(R.string.chat_photo_unreadable); return@rememberAvatarPicker }
        scope.launch {
            photoBusy = true; problem = null
            try { val url = api.uploadAvatar(jpeg); user = user?.copy(avatar = url) } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
            photoBusy = false
        }
    }
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(18.dp)).border(1.dp, c.border, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.pf_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(name, user?.avatar, 64.dp); Spacer(Modifier.width(14.dp))
            Column {
                TextButton(onClick = pick, enabled = !photoBusy) { Text(stringResource(R.string.pf_change_photo)) }
                if (!user?.avatar.isNullOrEmpty()) TextButton(onClick = {
                    scope.launch {
                        photoBusy = true; problem = null
                        try { api.removeAvatar(); user = user?.copy(avatar = null) } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                        photoBusy = false
                    }
                }, enabled = !photoBusy) { Text(stringResource(R.string.pf_remove_photo), color = c.mutedFg) }
            }
            if (photoBusy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        }
        OutlinedTextField(name, { name = it; saved = false }, singleLine = true, label = { Text(stringResource(R.string.signup_name)) }, modifier = Modifier.fillMaxWidth())
        OutlinedButton(onClick = {
            scope.launch {
                busy = true; problem = null
                try {
                    api.rename(name)
                    container.sessionStore.current?.let { container.sessionStore.save(it.copy(userName = name.trim())) }
                    saved = true
                } catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
                busy = false
            }
        }, enabled = !busy && name.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text(stringResource(if (saved) R.string.pf_saved else R.string.pf_save)) }
        // Read-only: a BoD links it from Control Room; the person only needs to know which address it is.
        Text("GOOGLE WORKSPACE", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = c.mutedFg)
        val g = user?.googleWorkspaceEmail
        Text(g ?: stringResource(R.string.pf_no_google), fontSize = if (g == null) 12.sp else 15.sp, color = if (g == null) c.mutedFg else c.foreground, maxLines = 1)
        problem?.let { Text(it, fontSize = 12.sp, color = c.danger) }
    }
}
