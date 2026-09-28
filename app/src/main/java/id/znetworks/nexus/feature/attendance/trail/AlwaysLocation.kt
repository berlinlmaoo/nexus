package id.znetworks.nexus.feature.attendance.trail

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.core.content.ContextCompat
import id.znetworks.nexus.R
import id.znetworks.nexus.core.config.configText
import id.znetworks.nexus.feature.attendance.liveness.openAppSettings

/**
 * Check-in needs location "Allow all the time" with precise location (Berlin, 28 Sep 2026; iOS 77818ba;
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

    /** Each system dialog is offered once; after that (or "don't ask again") the way is Settings. */
    private const val PREFS = "nexus.alwaysLocation"
    fun asked(context: Context, m: Missing) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(m.name, false)
    fun markAsked(context: Context, m: Missing) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(m.name, true).apply()
}

/**
 * The required-permission dialog. Title, text and button are the server's (`location.always.*`),
 * else the app's own copy. [onReady] runs once everything is granted from here.
 */
@Composable
fun AlwaysLocationDialog(onDismiss: () -> Unit, onReady: () -> Unit) {
    val context = LocalContext.current
    val background = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        if (AlwaysLocation.missing(context) == null) onReady() else onDismiss()
    }
    val fine = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        when (AlwaysLocation.missing(context)) {
            null -> onReady()
            // Precise now, "all the time" next: Android 10 asks in a dialog, 11+ opens the setting.
            AlwaysLocation.Missing.ALL_THE_TIME -> if (!AlwaysLocation.asked(context, AlwaysLocation.Missing.ALL_THE_TIME)) {
                AlwaysLocation.markAsked(context, AlwaysLocation.Missing.ALL_THE_TIME)
                background.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            } else { openAppSettings(context); onDismiss() }
            AlwaysLocation.Missing.PRECISE -> onDismiss()
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(configText("location.always.title", R.string.always_title)) },
        text = { Text(configText("location.always.body", R.string.always_body)) },
        confirmButton = {
            TextButton(onClick = {
                when (val m = AlwaysLocation.missing(context)) {
                    null -> onReady()
                    else -> if (!AlwaysLocation.asked(context, m)) {
                        AlwaysLocation.markAsked(context, m)
                        if (m == AlwaysLocation.Missing.PRECISE) fine.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                        else background.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                    } else {
                        // Refused before: Android will not ask again; Settings › Location is the way.
                        openAppSettings(context); onDismiss()
                    }
                }
            }) { Text(configText("location.always.button", R.string.always_button), fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
