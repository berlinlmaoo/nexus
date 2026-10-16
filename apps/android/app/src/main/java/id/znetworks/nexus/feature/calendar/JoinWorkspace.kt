package id.znetworks.nexus.feature.calendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * Join the company's workspace with its code (owner, 16 Oct 2026; POST /api/workspaces/join, web Settings ›
 * Profile). Reached from the Calendar's "personal workspace" state. The personal workspace is deleted on join,
 * so the dialog asks before it sends.
 */
@Serializable private data class JoinBody(val code: String)
@Serializable private data class JoinedWorkspace(val id: String = "", val name: String = "")
@Serializable private data class JoinResult(val ok: Boolean = false, val workspace: JoinedWorkspace? = null)

@Composable
fun JoinWorkspaceDialog(onDismiss: () -> Unit, onJoined: (String) -> Unit) {
    val c = Nx.colors
    val api = (LocalContext.current.applicationContext as NexusApplication).container.api
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var confirming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val invalid = stringResource(R.string.ws_join_invalid)
    val notEligible = stringResource(R.string.ws_join_not_eligible)
    val already = stringResource(R.string.ws_join_already)
    val failed = stringResource(R.string.ws_join_failed)
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(if (confirming) R.string.ws_join_confirm_title else R.string.ws_join_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (confirming) {
                    Text(stringResource(R.string.ws_join_confirm_body), fontSize = 14.sp, color = c.foreground)
                } else {
                    Text(stringResource(R.string.ws_join_hint), fontSize = 13.sp, color = c.mutedFg)
                    OutlinedTextField(code, { code = it; error = null }, singleLine = true, label = { Text(stringResource(R.string.ws_join_field)) },
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth())
                }
                error?.let { Text(it, fontSize = 12.sp, color = c.dangerText) }
            }
        },
        confirmButton = {
            TextButton(enabled = code.isNotBlank() && !busy, onClick = {
                if (!confirming) { confirming = true; return@TextButton }
                busy = true
                scope.launch {
                    try {
                        val r = api.postJson("/api/workspaces/join", JoinBody(code.trim()), JoinBody.serializer(), JoinResult.serializer())
                        onJoined(r.workspace?.name ?: "")
                    } catch (e: ApiError) {
                        confirming = false
                        error = when ((e as? ApiError.Http)?.code) {
                            "INVALID_CODE" -> invalid
                            "NOT_ELIGIBLE" -> notEligible
                            "ALREADY_MEMBER" -> already
                            else -> (e as? ApiError.Http)?.serverMessage ?: failed
                        }
                    } finally { busy = false }
                }
            }) { Text(stringResource(if (confirming) R.string.ws_join_delete_and_join else R.string.ws_join_button)) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = { if (confirming) confirming = false else onDismiss() }) { Text(stringResource(R.string.cancel)) } },
    )
}
