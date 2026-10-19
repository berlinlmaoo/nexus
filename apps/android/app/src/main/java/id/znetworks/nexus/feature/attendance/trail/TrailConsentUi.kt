package id.znetworks.nexus.feature.attendance.trail

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.R

/**
 * The prominent disclosure (REQ-ATT-36), shown in the app BEFORE any system prompt, once per
 * record. It says "location", "even when the app is closed", the purpose and what is not recorded,
 * with a real choice. Then the OEM battery guide, once (REQ-ATT-38).
 */
@Composable
fun TrailConsentHost(trail: WorkTrail, enabled: Boolean = true, onBusyChanged: (Boolean) -> Unit = {}) {
    val context = LocalContext.current
    val recordId by trail.disclosureFor.collectAsStateWithLifecycle()
    var showBattery by rememberSaveable { mutableStateOf(false) }
    var askBackground by rememberSaveable { mutableStateOf(false) }
    var permissionPending by rememberSaveable { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(recordId, showBattery, askBackground, permissionPending) { onBusyChanged(recordId != null || showBattery || askBackground || permissionPending) }

    val background = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permissionPending = false; showBattery = BatteryGuide.due(context) }
    val fine = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        permissionPending = false
        val id = recordId ?: return@rememberLauncherForActivityResult
        val ok = result[Manifest.permission.ACCESS_FINE_LOCATION] == true || hasFine(context)
        trail.consentGiven(id, ok)
        if (ok) askBackground = needsBackground(context) else showBattery = false
    }

    recordId?.takeIf { enabled && !permissionPending }?.let { id ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text(stringResource(R.string.trail_disclosure_title)) },
            text = { Text(stringResource(R.string.trail_disclosure_body)) },
            confirmButton = {
                TextButton(onClick = {
                    if (hasFine(context)) {
                        trail.consentGiven(id, true)
                        if (needsBackground(context)) askBackground = true else showBattery = BatteryGuide.due(context)
                    } else {
                        permissionPending = true; fine.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                    }
                }) { Text(stringResource(R.string.trail_agree), fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { trail.consentDeclined(id) }) { Text(stringResource(R.string.not_now)) } },
        )
    }

    if (askBackground && enabled && !permissionPending) {
        // "Allow all the time" lets the session resume after a restart. On Android 11+ this is a
        // trip to Settings, and the dialog says so.
        AlertDialog(
            onDismissRequest = { askBackground = false; showBattery = BatteryGuide.due(context) },
            title = { Text(stringResource(R.string.trail_always_title)) },
            text = { Text(stringResource(if (Build.VERSION.SDK_INT >= 30) R.string.trail_always_body_settings else R.string.trail_always_body)) },
            confirmButton = {
                TextButton(onClick = {
                    askBackground = false
                    if (Build.VERSION.SDK_INT >= 29) { permissionPending = true; background.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }
                }) { Text(stringResource(R.string.trail_always_go)) }
            },
            dismissButton = { TextButton(onClick = { askBackground = false; showBattery = BatteryGuide.due(context) }) { Text(stringResource(R.string.not_now)) } },
        )
    }

    if (showBattery && enabled && !permissionPending) {
        AlertDialog(
            onDismissRequest = { showBattery = false; BatteryGuide.markShown(context) },
            title = { Text(stringResource(R.string.battery_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.battery_body))
                    BatteryGuide.oemHint(context)?.let { Text(stringResource(it), fontWeight = FontWeight.SemiBold) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    BatteryGuide.requestIgnore(context)
                    BatteryGuide.openOemScreen(context)
                    BatteryGuide.markShown(context)
                    showBattery = false
                }) { Text(stringResource(R.string.battery_go), fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { showBattery = false; BatteryGuide.markShown(context) }) { Text(stringResource(R.string.later)) } },
        )
    }
}

private fun hasFine(c: Context) = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
private fun needsBackground(c: Context) = Build.VERSION.SDK_INT >= 29 &&
    ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED

/**
 * Surviving OEM battery killers (REQ-ATT-38). Owner decision (24 Sep 2026): sideloaded, so the
 * direct system dialog is allowed; re-check if the app moves to Play. Every OEM intent is tried in
 * order and wrapped: component names change between OS versions, the fallback is app details.
 */
object BatteryGuide {
    private const val PREF = "nexus.batteryGuide"

    fun due(c: Context): Boolean {
        val shown = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).getBoolean("shown", false)
        val pm = c.getSystemService(PowerManager::class.java)
        return !shown && pm?.isIgnoringBatteryOptimizations(c.packageName) != true
    }

    fun markShown(c: Context) = c.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putBoolean("shown", true).apply()

    @SuppressLint("BatteryLife")
    fun requestIgnore(c: Context) {
        runCatching {
            c.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${c.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure {
            runCatching { c.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    private val brand get() = (Build.MANUFACTURER + " " + Build.BRAND).lowercase()

    fun oemHint(c: Context): Int? = when {
        listOf("xiaomi", "redmi", "poco").any { it in brand } -> R.string.battery_xiaomi
        listOf("oppo", "realme", "oneplus").any { it in brand } -> R.string.battery_oppo
        listOf("vivo", "iqoo").any { it in brand } -> R.string.battery_vivo
        "samsung" in brand -> R.string.battery_samsung
        listOf("huawei", "honor").any { it in brand } -> R.string.battery_huawei
        else -> null
    }

    private val candidates: List<Pair<String, String>> get() = when {
        listOf("xiaomi", "redmi", "poco").any { it in brand } -> listOf(
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            "com.miui.powerkeeper" to "com.miui.powerkeeper.ui.HiddenAppsConfigActivity",
        )
        listOf("oppo", "realme", "oneplus").any { it in brand } -> listOf(
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
        )
        listOf("vivo", "iqoo").any { it in brand } -> listOf(
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager",
        )
        "samsung" in brand -> listOf("com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity")
        listOf("huawei", "honor").any { it in brand } -> listOf(
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
        )
        else -> emptyList()
    }

    fun openOemScreen(c: Context) {
        for ((pkg, cls) in candidates) {
            val intent = Intent().setComponent(ComponentName(pkg, cls)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("package_name", c.packageName).putExtra("package_label", c.getString(R.string.app_name))
            if (runCatching { c.startActivity(intent) }.isSuccess) return
        }
        if (candidates.isNotEmpty()) {
            runCatching {
                c.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", c.packageName, null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
    }
}
