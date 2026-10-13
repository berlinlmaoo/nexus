package id.znetworks.nexus.ui.components

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx

/** A destructive step waiting for its "yes". */
class PendingConfirm(val title: String, val message: String?, val action: String, val run: () -> Unit)

/**
 * Every confirmation is a plain alert in the middle of the screen (Berlin 29 Sep, iOS 173ffff): never a
 * sheet or a menu pinned to the button, and never an action that runs straight from a menu.
 */
@Composable
fun ConfirmDialog(p: PendingConfirm?, onDismiss: () -> Unit) {
    p ?: return
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(p.title) },
        text = p.message?.let { m -> { Text(m) } },
        confirmButton = { TextButton(onClick = { onDismiss(); p.run() }) { Text(p.action, color = Nx.colors.danger, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
