package id.znetworks.nexus.feature.attendance.liveness

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.net.Uri
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.attendance.liveness.LivenessEngine.Presence
import id.znetworks.nexus.feature.attendance.liveness.LivenessEngine.Step
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/**
 * An attendance selfie that came out of the face check. Only [FaceCheck] builds one (the source
 * guard test in AttendanceGuardTest fails the build otherwise), and the attendance screen only
 * accepts this type: no attendance path can submit a photo that skipped liveness (REQ-ATT-01,
 * UPDATES 28 Sep §6).
 */
class LiveSelfie(val jpeg: ByteArray)

/**
 * The dedicated full-screen face check that takes the attendance selfie itself (REQ-ATT-02). No
 * other code path produces a check-in/out photo (REQ-ATT-01): the attendance screen only accepts
 * bytes from [onCaptured].
 */
@Composable
fun LivenessCaptureScreen(onCaptured: (LiveSelfie) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(hasCamera(context)) }
    var askedOnce by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        askedOnce = true
    }
    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }
    BackHandler(onBack = onCancel)

    if (!granted) {
        CameraDenied(asked = askedOnce, onRetry = { launcher.launch(Manifest.permission.CAMERA) }, onCancel = onCancel)
    } else {
        FaceCheck(onCaptured, onCancel)
    }
}

@Composable
private fun FaceCheck(onCaptured: (LiveSelfie) -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val engine = remember { LivenessEngine() }
    val stateFlow = remember { MutableStateFlow(LivenessEngine.State()) }
    var ui by remember { mutableStateOf(LivenessEngine.State()) }
    var dark by remember { mutableStateOf(false) }
    var manualLight by remember { mutableStateOf<Boolean?>(null) }
    var done by remember { mutableStateOf(false) }
    val lit = manualLight ?: dark

    LaunchedEffect(Unit) { stateFlow.collect { ui = it } }

    // The screen is the ring light: full brightness while lit, restored exactly afterwards.
    val activity = context.findActivity()
    DisposableEffect(lit) {
        val window = activity?.window
        val saved = window?.attributes?.screenBrightness
        if (lit && window != null) {
            window.attributes = window.attributes.apply { screenBrightness = 1f }
        }
        onDispose {
            if (window != null && saved != null) window.attributes = window.attributes.apply { screenBrightness = saved }
        }
    }
    DisposableEffect(Unit) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    DisposableEffect(lifecycleOwner) {
        val executor = Executors.newSingleThreadExecutor()
        val detector = FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                .setMinFaceSize(0.15f)
                .build(),
        )
        val capturing = AtomicBoolean(false)
        var frameCount = 0
        var darkSamples = 0
        var latchedDark = false
        val imageCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()

        fun takePhoto() {
            if (!capturing.compareAndSet(false, true)) return
            imageCapture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val jpeg = runCatching { image.use { uprightMirroredJpeg(it) } }.getOrNull()
                    // Verified, not trusted: the finished picture must hold a usable face, or the
                    // person holds still again and a new one is taken.
                    val ok = jpeg != null && runBlocking { FaceGuard.check(jpeg) } == FaceGuard.Verdict.OK
                    if (ok) {
                        ContextCompat.getMainExecutor(context).execute { done = true; onCaptured(LiveSelfie(jpeg!!)) }
                    } else {
                        engine.retryCapture()
                        stateFlow.value = engine.state
                        capturing.set(false)
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    engine.retryCapture()
                    stateFlow.value = engine.state
                    capturing.set(false)
                }
            })
        }

        val analysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
        analysis.setAnalyzer(executor) { proxy ->
            if (capturing.get()) { proxy.close(); return@setAnalyzer }
            frameCount++
            if (!latchedDark && frameCount % 8 == 0) {
                val mean = meanLuma(proxy)
                val struggling = engine.framesWithoutFace > 60
                darkSamples = if (mean < 55 || (struggling && mean < 100)) darkSamples + 1 else 0
                // Latches: once lit it stays lit, or its own light would switch it off again (strobe).
                if (darkSamples >= 3) {
                    latchedDark = true
                    ContextCompat.getMainExecutor(context).execute { dark = true }
                }
            }
            val media = proxy.image
            if (media == null) { proxy.close(); return@setAnalyzer }
            val rotation = proxy.imageInfo.rotationDegrees
            val w = if (rotation % 180 == 0) proxy.width else proxy.height
            val h = if (rotation % 180 == 0) proxy.height else proxy.width
            detector.process(InputImage.fromMediaImage(media, rotation))
                // Same single executor as the analyzer and the capture callback: the engine is
                // confined to one thread (ML Kit would otherwise call back on the main thread).
                .addOnSuccessListener(executor) { faces ->
                    val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
                    val frame = if (face == null) {
                        LivenessEngine.Frame(false)
                    } else {
                        val b = face.boundingBox
                        LivenessEngine.Frame(
                            faceFound = true,
                            yawDeg = face.headEulerAngleY,
                            leftEyeOpen = face.leftEyeOpenProbability,
                            rightEyeOpen = face.rightEyeOpenProbability,
                            sizeFraction = max(b.width(), b.height()).toFloat() / minOf(w, h),
                            offsetX = b.exactCenterX() / w - 0.5f,
                            offsetY = b.exactCenterY() / h - 0.5f,
                        )
                    }
                    val s = engine.onFrame(frame)
                    stateFlow.value = s
                    if (s.readyToCapture) takePhoto()
                }
                .addOnCompleteListener(executor) { proxy.close() }
        }

        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_FRONT_CAMERA, preview, analysis, imageCapture)
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            runCatching { providerFuture.get().unbindAll() }
            detector.close()
            executor.shutdown()
        }
    }

    val c = Nx.colors
    val ink = if (lit) Color.Black else Color.White
    val inkSoft = ink.copy(alpha = 0.72f)
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView({ previewView }, Modifier.fillMaxSize())
        // Everything but the face window is dimmed, or lit white when it is dark.
        Canvas(Modifier.fillMaxSize().graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
            drawRect(if (lit) Color.White else Color.Black.copy(alpha = 0.55f))
            val ww = size.width * 0.72f
            val wh = ww * 1.32f
            val topLeft = Offset((size.width - ww) / 2, size.height * 0.40f - wh / 2)
            drawRoundRect(Color.Transparent, topLeft, Size(ww, wh), CornerRadius(ww / 2, ww / 2), blendMode = BlendMode.Clear)
            val ring = when {
                done -> c.success
                ui.presence == Presence.OK -> c.violet
                else -> ink.copy(alpha = 0.5f)
            }
            drawRoundRect(ring, topLeft, Size(ww, wh), CornerRadius(ww / 2, ww / 2), style = Stroke(width = 5.dp.toPx()))
        }

        Column(Modifier.fillMaxSize().systemBarsPadding().padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, stringResource(R.string.cancel), tint = ink) }
                Text(stringResource(R.string.liveness_title), color = inkSoft, fontFamily = TextFont, fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                IconButton(onClick = { manualLight = !lit }) {
                    Icon(Icons.Filled.LightMode, stringResource(R.string.liveness_screen_light), tint = if (lit) c.warning else ink)
                }
            }
            Spacer(Modifier.weight(1f))
            StepPills(ui.step, done, lit)
            Spacer(Modifier.height(14.dp))
            Text(headline(ui, done), color = ink, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(6.dp))
            Text(hint(ui, done, dark), color = inkSoft, fontFamily = TextFont, fontSize = 14.sp,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(), lineHeight = 19.sp)
            if (ui.step == Step.SIDE_A || ui.step == Step.SIDE_B) {
                Spacer(Modifier.height(12.dp))
                LinearProgressIndicator(
                    progress = { ui.turnProgress },
                    modifier = Modifier.fillMaxWidth(0.6f).height(6.dp).align(Alignment.CenterHorizontally),
                    color = c.violet, trackColor = ink.copy(alpha = 0.2f),
                )
            }
            if (ui.step == Step.BLINK) {
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.liveness_close_open), color = inkSoft, fontSize = 11.sp,
                    modifier = Modifier.align(Alignment.CenterHorizontally))
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun StepPills(step: Step, done: Boolean, lit: Boolean) {
    val c = Nx.colors
    val labels = listOf(R.string.liveness_pill_straight, R.string.liveness_pill_right, R.string.liveness_pill_left, R.string.liveness_pill_blink)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
        labels.forEachIndexed { i, label ->
            val passed = done || step.ordinal > i
            val current = !done && step.ordinal == i
            val bg = when {
                passed -> c.success
                current -> c.violet
                else -> (if (lit) Color.Black else Color.White).copy(alpha = if (lit) 0.18f else 0.28f)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.width(56.dp).height(5.dp).background(bg, RoundedCornerShape(3.dp)))
                Spacer(Modifier.height(4.dp))
                Text(stringResource(label), fontSize = 11.sp, color = (if (lit) Color.Black else Color.White).copy(alpha = 0.75f))
            }
        }
    }
}

@Composable
private fun headline(s: LivenessEngine.State, done: Boolean): String = stringResource(
    when {
        done -> R.string.liveness_verified
        else -> when (s.step) {
            Step.CENTER -> R.string.liveness_look_straight
            Step.SIDE_A -> R.string.liveness_turn_right
            Step.SIDE_B -> R.string.liveness_turn_left
            Step.BLINK -> R.string.liveness_blink
            Step.CAPTURE -> R.string.liveness_hold_still
        }
    },
)

@Composable
private fun hint(s: LivenessEngine.State, done: Boolean, dark: Boolean): String = stringResource(
    when {
        done -> R.string.liveness_taking
        s.notice == LivenessEngine.Notice.FACE_LOST -> R.string.liveness_face_lost
        s.presence == Presence.NONE && dark -> R.string.liveness_dark
        s.presence == Presence.NONE -> R.string.liveness_no_face
        s.presence == Presence.SMALL -> R.string.liveness_closer
        s.presence == Presence.OFF_CENTRE -> R.string.liveness_into_window
        s.stalled -> when (s.step) {
            Step.SIDE_A, Step.SIDE_B -> R.string.liveness_turn_further
            Step.BLINK -> R.string.liveness_blink_glasses
            else -> R.string.liveness_keep_inside_light
        }
        else -> when (s.step) {
            Step.CENTER -> R.string.liveness_keep_inside
            Step.SIDE_A -> R.string.liveness_slowly
            Step.SIDE_B -> R.string.liveness_same_other_way
            Step.BLINK -> R.string.liveness_blink_hint
            Step.CAPTURE -> R.string.liveness_eyes_open
        }
    },
)

@Composable
private fun CameraDenied(asked: Boolean, onRetry: () -> Unit, onCancel: () -> Unit) {
    val context = LocalContext.current
    val c = Nx.colors
    Box(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding().padding(28.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.liveness_needs_camera), color = Color.White, fontFamily = TextFont,
                fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center)
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = {
                    // After a "don't ask again" the system dialog no longer appears: Settings is the way.
                    if (asked) openAppSettings(context) else onRetry()
                },
                colors = ButtonDefaults.buttonColors(containerColor = c.violet, contentColor = Color.White),
                shape = CircleShape,
            ) { Text(stringResource(if (asked) R.string.open_settings else R.string.allow_camera)) }
            TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel), color = Color.White.copy(alpha = 0.8f)) }
        }
    }
}

private fun hasCamera(context: Context) =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

fun openAppSettings(context: Context) {
    runCatching {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** Mean of a 16×16 grid of the luma plane: cheap enough for every 8th frame. */
private fun meanLuma(proxy: ImageProxy): Int {
    val plane = proxy.planes.firstOrNull() ?: return 128
    val buf = plane.buffer
    val stride = plane.rowStride
    var sum = 0L
    var n = 0
    for (gy in 0 until 16) for (gx in 0 until 16) {
        val x = (gx * 2 + 1) * proxy.width / 32
        val y = (gy * 2 + 1) * proxy.height / 32
        val i = y * stride + x * plane.pixelStride
        if (i < buf.limit()) { sum += buf.get(i).toInt() and 0xFF; n++ }
    }
    return if (n == 0) 128 else (sum / n).toInt()
}

/**
 * Upright, mirrored like the preview the person just looked at (as iOS does), long edge ≤ 1280,
 * JPEG q80: ≈ 150–400 KB, far under the server's 10 MB.
 */
private fun uprightMirroredJpeg(image: ImageProxy): ByteArray {
    val src = image.toBitmap()
    val scale = minOf(1f, 1280f / max(src.width, src.height))
    val m = Matrix().apply {
        postRotate(image.imageInfo.rotationDegrees.toFloat())
        postScale(-scale, scale)
    }
    val out = Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    return ByteArrayOutputStream().use { bos ->
        out.compress(Bitmap.CompressFormat.JPEG, 80, bos)
        bos.toByteArray()
    }
}
