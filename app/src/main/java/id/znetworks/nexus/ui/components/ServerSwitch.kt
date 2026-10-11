package id.znetworks.nexus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ServerEnv
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

/** What a server is called in Settings, the dialog and on the sign-in screen. */
fun serverLabel(env: ServerEnv) = when (env) {
    ServerEnv.PRODUCTION -> R.string.server_production
    ServerEnv.DEV -> R.string.server_dev
}

/**
 * The centred confirmation for a server switch (DEV-REDESIGN.md). Signed in, it signs out first, and
 * it is refused while sign-out is (workday rule) or while check-ins still wait to be sent, which a
 * sign-out would throw away. Confirmed, the app relaunches on [to].
 */
@Composable
fun ServerSwitchDialog(to: ServerEnv, onDismiss: () -> Unit) {
    val c = Nx.colors
    val container = (LocalContext.current.applicationContext as NexusApplication).container
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val signedIn = container.sessionStore.current != null
    val held = when {
        signedIn && container.signOutBlocked() -> R.string.server_switch_blocked_workday
        container.serverSwitchHeld() -> R.string.server_switch_blocked_queue
        else -> null
    }
    if (held != null) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(stringResource(R.string.server_switch_blocked_title)) },
            text = { Text(stringResource(held)) },
            confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
        )
        return
    }
    val name = stringResource(serverLabel(to))
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.server_switch_title, name)) },
        text = {
            Text(stringResource(if (signedIn) R.string.server_switch_body_signed_in else R.string.server_switch_body, name) +
                if (to == ServerEnv.DEV) "\n\n" + stringResource(R.string.server_switch_dev_note) else "")
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = { busy = true; scope.launch { container.switchServer(to) } }) {
                Text(stringResource(if (signedIn) R.string.server_switch_cta_signed_in else R.string.server_switch_cta),
                    color = if (signedIn) c.danger else Color.Unspecified)
            }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** The always-visible marker while the app talks to the DEV server. */
@Composable
fun DevBadge(modifier: Modifier = Modifier) {
    Text(stringResource(R.string.server_dev_badge), modifier = modifier
        .background(Color(0xFFEA580C), RoundedCornerShape(6.dp))
        .padding(horizontal = 7.dp, vertical = 2.dp),
        color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
}
