package id.znetworks.nexus.ui.components

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.attendance.liveness.openAppSettings
import java.io.File

/**
 * The one way the app opens the camera for a photo (audit T5, iOS 672314b). The manifest declares
 * CAMERA, so ACTION_IMAGE_CAPTURE throws without it: the permission is asked first, and when it is
 * refused the person is told and offered Settings instead of a crash or a tap that does nothing.
 * Returns the function to call from a button; [prefix] names the file under cache/evidence.
 */
@Composable
fun rememberCameraCapture(prefix: String, onPhoto: (Uri) -> Unit): () -> Unit {
    val context = LocalContext.current
    var pending by rememberSaveable { mutableStateOf<String?>(null) }
    var denied by remember { mutableStateOf(false) }
    val take = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) pending?.let { onPhoto(Uri.parse(it)) }
    }
    fun shoot() {
        val f = File(File(context.cacheDir, "evidence").apply { mkdirs() }, "$prefix-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", f)
        pending = uri.toString()
        // No camera app, or a policy block: say so rather than fail silently.
        if (runCatching { take.launch(uri) }.isFailure) denied = true
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) shoot() else denied = true
    }
    if (denied) AlertDialog(
        onDismissRequest = { denied = false },
        title = { Text(stringResource(R.string.camera_off_title)) },
        text = { Text(stringResource(R.string.camera_off_body)) },
        confirmButton = { TextButton(onClick = { denied = false; openAppSettings(context) }) { Text(stringResource(R.string.open_settings)) } },
        dismissButton = { TextButton(onClick = { denied = false }) { Text(stringResource(R.string.cancel)) } },
    )
    return {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) shoot()
        else ask.launch(Manifest.permission.CAMERA)
    }
}
