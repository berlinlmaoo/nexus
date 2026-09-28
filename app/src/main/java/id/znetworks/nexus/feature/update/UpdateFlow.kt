package id.znetworks.nexus.feature.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.update.openUpdate
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * "Download update" from the lock screen, the grace notice or Tuning Room. Signed in: the in-app
 * flow. Signed out (the APK needs a session): the download page in the browser.
 */
fun startUpdate(context: Context, storeUrl: String?) {
    val c = (context.applicationContext as NexusApplication).container
    if (c.sessionStore.current == null) {
        openUpdate(context, storeUrl)
        return
    }
    c.appScope.launch { c.updater.run() }
}

/** The update's progress as one dialog, over whatever is on screen (lock screen included). */
@Composable
fun UpdateFlowHost() {
    val context = LocalContext.current
    val c = (context.applicationContext as NexusApplication).container
    val updater = c.updater
    val step by updater.step.collectAsStateWithLifecycle()
    // Back from "Install unknown apps": carry on by itself once it is allowed.
    LifecycleResumeEffect(step) {
        if (step == ApkUpdater.Step.NeedsPermission && updater.canInstall()) c.appScope.launch { updater.run() }
        onPauseOrDispose { }
    }
    val s = step
    if (s == ApkUpdater.Step.Idle) return
    val busy = s is ApkUpdater.Step.Checking || s is ApkUpdater.Step.Downloading || s is ApkUpdater.Step.Verifying || s is ApkUpdater.Step.Installing
    AlertDialog(
        onDismissRequest = { if (!busy) updater.reset() },
        title = { Text(stringResource(R.string.updater_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                when (s) {
                    ApkUpdater.Step.Checking -> Text(stringResource(R.string.updater_checking))
                    is ApkUpdater.Step.Downloading -> {
                        val frac = if (s.total > 0) s.done.toFloat() / s.total else 0f
                        Text(stringResource(R.string.updater_downloading, mb(s.done), if (s.total > 0) mb(s.total) else "…"))
                        LinearProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxWidth())
                    }
                    ApkUpdater.Step.Verifying -> Text(stringResource(R.string.updater_verifying))
                    ApkUpdater.Step.Installing -> Text(stringResource(R.string.updater_installing))
                    is ApkUpdater.Step.Confirm -> Text(stringResource(R.string.updater_confirm_body))
                    ApkUpdater.Step.NeedsPermission -> Text(stringResource(R.string.updater_permission))
                    is ApkUpdater.Step.UpToDate -> Text(stringResource(R.string.updater_up_to_date))
                    is ApkUpdater.Step.Failed -> Text(s.message ?: stringResource(
                        when (s.reason) {
                            ApkUpdater.Reason.NOTHING_PUBLISHED -> R.string.updater_nothing
                            ApkUpdater.Reason.NETWORK -> R.string.updater_network
                            ApkUpdater.Reason.CHECKSUM -> R.string.updater_checksum
                            ApkUpdater.Reason.WRONG_APP -> R.string.updater_wrong_app
                            ApkUpdater.Reason.NOT_NEWER -> R.string.updater_not_newer
                            ApkUpdater.Reason.INSTALL -> R.string.updater_install_failed
                            ApkUpdater.Reason.SIGNED_OUT -> R.string.updater_signed_out
                        },
                    ))
                    ApkUpdater.Step.Idle -> Unit
                }
            }
        },
        confirmButton = {
            when (s) {
                ApkUpdater.Step.NeedsPermission -> TextButton(onClick = {
                    runCatching {
                        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }
                }) { Text(stringResource(R.string.updater_allow)) }
                is ApkUpdater.Step.Failed -> TextButton(onClick = { c.appScope.launch { updater.run() } }) { Text(stringResource(R.string.try_again)) }
                // Always a way on: the system confirmation again, from the app in front.
                is ApkUpdater.Step.Confirm -> TextButton(onClick = { updater.continueInstall(context) }) { Text(stringResource(R.string.updater_continue)) }
                else -> if (!busy) TextButton(onClick = updater::reset) { Text("OK") }
            }
        },
        dismissButton = {
            // Installing and Confirm can be cancelled too (the session is abandoned): never stuck.
            if ((!busy || s is ApkUpdater.Step.Installing) && s !is ApkUpdater.Step.UpToDate) TextButton(onClick = updater::reset) { Text(stringResource(R.string.cancel)) }
        },
    )
}

private fun mb(bytes: Long) = String.format(Locale.ROOT, "%.1f MB", bytes / 1_048_576.0)
