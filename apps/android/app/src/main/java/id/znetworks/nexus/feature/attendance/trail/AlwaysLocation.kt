package id.znetworks.nexus.feature.attendance.trail

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.core.content.ContextCompat
import id.znetworks.nexus.R
import id.znetworks.nexus.core.config.configText
import id.znetworks.nexus.feature.attendance.liveness.openAppSettings

/**
 * Check-in needs location "Allow all the time" with precise location (owner, 28 Sep 2026; iOS 77818ba;
 * remote flag `requireAlwaysLocation`): the live location runs from check-in to check-out, also with the
 * app closed. Precise on Android = ACCESS_FINE_LOCATION (an "approximate" grant is COARSE only);
 * "all the time" = ACCESS_BACKGROUND_LOCATION from Android 10, implied by FINE before it.
 */
object AlwaysLocation {
    enum class Missing { PRECISE, ALL_THE_TIME }

    fun missing(fine: Boolean, background: Boolean, sdk: Int): Missing? = when {
        !fine -> Missing.PRECISE
        sdk >= 29 && !background -> Missing.ALL_THE_TIME
        else -> null
    }

    fun missing(context: Context): Missing? = missing(
        granted(context, Manifest.permission.ACCESS_FINE_LOCATION),
        Build.VERSION.SDK_INT < 29 || granted(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION),
        Build.VERSION.SDK_INT,
    )

    private fun granted(c: Context, p: String) = ContextCompat.checkSelfPermission(c, p) == PackageManager.PERMISSION_GRANTED

    /**
     * A permission request Android answers without showing anything (refused for good: "Don't ask
     * again", or twice on 11+) comes back at once. Faster than any person could tap = nothing was shown.
     */
    const val SILENT_REFUSAL_MS = 400L
    fun refusedSilently(startedAt: Long, now: Long) = now - startedAt < SILENT_REFUSAL_MS

    /**
     * Refused for good after a request came back denied: answered without a dialog (fast), or Android
     * will no longer show one (no rationale left: "Don't ask again", or the second refusal on 11+).
     */
    fun refusedForGood(fast: Boolean, rationaleLeft: Boolean) = fast || !rationaleLeft

    fun rationaleLeft(context: Context, permission: String): Boolean {
        val activity = generateSequence(context) { (it as? android.content.ContextWrapper)?.baseContext }.filterIsInstance<android.app.Activity>().firstOrNull()
            ?: return true
        return androidx.core.app.ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)
    }
}

/**
 * The required-permission dialog. Title, text and button are the server's (`location.always.*`),
 * else the app's own copy. [onReady] runs once everything is granted from here.
 */
@Composable
fun AlwaysLocationDialog(onDismiss: () -> Unit, onReady: () -> Unit) {
    val context = LocalContext.current
    // Scan final (owner 29 Sep): the button leads to the app's own Location permission screen. On
    // Android 11+ asking for "all the time" IS that screen (the system opens it); precise location is
    // the system dialog. Only when Android refuses without showing anything is App info the way left
    // (no public intent opens a single permission page), and the dialog text says where to tap.
    val startedAt = remember { longArrayOf(0L) }
    fun settled(fallback: Boolean) {
        when {
            AlwaysLocation.missing(context) == null -> onReady()
            fallback -> { openAppSettings(context); onDismiss() }
            else -> onDismiss()
        }
    }
    val background = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        settled(AlwaysLocation.refusedForGood(AlwaysLocation.refusedSilently(startedAt[0], SystemClock.elapsedRealtime()),
            AlwaysLocation.rationaleLeft(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)))
    }
    fun askBackground() { startedAt[0] = SystemClock.elapsedRealtime(); background.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }
    val fine = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        when (AlwaysLocation.missing(context)) {
            null -> onReady()
            // Precise now, "all the time" next: Android 10 asks in a dialog, 11+ opens the location screen.
            AlwaysLocation.Missing.ALL_THE_TIME -> askBackground()
            AlwaysLocation.Missing.PRECISE -> settled(AlwaysLocation.refusedForGood(AlwaysLocation.refusedSilently(startedAt[0], SystemClock.elapsedRealtime()),
                AlwaysLocation.rationaleLeft(context, Manifest.permission.ACCESS_FINE_LOCATION)))
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(configText("location.always.title", R.string.always_title)) },
        text = { Text(configText("location.always.body", R.string.always_body)) },
        confirmButton = {
            TextButton(onClick = {
                when (AlwaysLocation.missing(context)) {
                    null -> onReady()
                    AlwaysLocation.Missing.PRECISE -> {
                        startedAt[0] = SystemClock.elapsedRealtime()
                        fine.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    }
                    AlwaysLocation.Missing.ALL_THE_TIME -> askBackground()
                }
            }) { Text(configText("location.always.button", R.string.always_button), fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
