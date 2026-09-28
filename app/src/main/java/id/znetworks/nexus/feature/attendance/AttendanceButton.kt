package id.znetworks.nexus.feature.attendance

import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.attendance.liveness.openAppSettings
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import java.time.Duration
import java.time.Instant

private val IN_GREEN = Color(0xFF10B981)
private val OUT_ROSE = Color(0xFFF43F5E)

/** What the one attendance button shows when no press is in flight (UPDATES §11). */
sealed interface ButtonMode {
    data object CheckIn : ButtonMode
    /** [count]/[min] reflection characters; unlocks at [min]. [waiting]: an offsite check-out awaits approval. */
    data class CheckOut(val count: Int, val min: Int, val unlocked: Boolean, val waiting: Boolean) : ButtonMode
    data class DoneForToday(val workedMinutes: Int?) : ButtonMode
}

object AttendanceButtonLogic {
    /**
     * Ready → check in; checked in (or a forgotten check-out first) → check out, locked until the
     * reflection reaches 200 characters; checked out → done. Same rules as the two buttons had.
     */
    fun mode(checkedIn: Boolean, checkedOut: Boolean, forcePending: Boolean, offsitePending: Boolean,
             reflectionCount: Int, reflectionMin: Int, checkInAt: String?, checkOutAt: String?): ButtonMode = when {
        forcePending -> ButtonMode.CheckOut(reflectionCount, reflectionMin, reflectionCount >= reflectionMin, offsitePending)
        checkedOut && !offsitePending -> ButtonMode.DoneForToday(worked(checkInAt, checkOutAt))
        checkedIn -> ButtonMode.CheckOut(reflectionCount, reflectionMin, reflectionCount >= reflectionMin, offsitePending)
        else -> ButtonMode.CheckIn
    }

    fun worked(inAt: String?, outAt: String?): Int? {
        val a = inAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
        val b = outAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return null
        return Duration.between(a, b).toMinutes().toInt().takeIf { it >= 0 }
    }
}

@Composable
fun AttendanceButton(
    mode: ButtonMode,
    flow: CaptureFlow?,
    enabled: Boolean,
    onPress: (AttendanceKind) -> Unit,
    onDismissFlow: () -> Unit,
) {
    val c = Nx.colors
    val context = LocalContext.current
    val view = LocalView.current

    // Feedback belongs to the outcome, once per outcome: a light tick, nothing theatrical (owner, 28 Sep).
    LaunchedEffect(flow) {
        when (flow) {
            is CaptureFlow.Done -> view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP)
            is CaptureFlow.Failed -> view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.KEYBOARD_TAP)
            else -> Unit
        }
    }

    val kindOfMode = if (mode is ButtonMode.CheckIn) AttendanceKind.CHECK_IN else AttendanceKind.CHECK_OUT
    val isIn = (flow?.kind ?: kindOfMode) == AttendanceKind.CHECK_IN
    val lockedOut = mode is ButtonMode.CheckOut && (!mode.unlocked || mode.waiting)
    val tint = when (flow) {
        is CaptureFlow.SelfieOk, is CaptureFlow.Locating, is CaptureFlow.Sending -> c.violet
        is CaptureFlow.Done -> if (isIn) IN_GREEN else OUT_ROSE
        is CaptureFlow.SavedOffline -> c.warning
        is CaptureFlow.Failed -> c.danger
        null -> when {
            mode is ButtonMode.DoneForToday -> c.success.copy(alpha = 0.14f)
            mode is ButtonMode.CheckIn -> if (enabled) IN_GREEN else IN_GREEN.copy(alpha = 0.4f)
            lockedOut || !enabled -> c.muted
            else -> OUT_ROSE
        }
    }
    val bg by animateColorAsState(tint, label = "attendance-button")
    val fg = when {
        flow == null && mode is ButtonMode.DoneForToday -> c.success
        flow == null && (lockedOut || (!enabled && mode is ButtonMode.CheckOut)) -> c.mutedFg
        else -> Color.White
    }
    val clickable = when (flow) {
        null -> enabled && mode !is ButtonMode.DoneForToday && !lockedOut
        is CaptureFlow.Failed, is CaptureFlow.Done, is CaptureFlow.SavedOffline -> true
        else -> false
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box {
            Box(
                Modifier.fillMaxWidth().heightIn(min = 64.dp).clip(RoundedCornerShape(20.dp)).background(bg)
                    .clickable(enabled = clickable) {
                        when (flow) {
                            // Failed: the button is the retry.
                            is CaptureFlow.Failed -> { onDismissFlow(); onPress(flow.kind) }
                            null -> onPress(kindOfMode)
                            else -> onDismissFlow()
                        }
                    }
                    .semantics { liveRegion = LiveRegionMode.Polite },
                contentAlignment = Alignment.Center,
            ) {
                // A locked check-out is grey that fills with red as the reflection grows (owner's
                // pick, as on iOS): at 200 characters it is the red Check out.
                if (flow == null && mode is ButtonMode.CheckOut && !mode.unlocked && !mode.waiting) {
                    val fill by animateFloatAsState(mode.count.coerceAtMost(mode.min).toFloat() / mode.min, tween(250), label = "reflection-fill")
                    Box(Modifier.matchParentSize()) {
                        Box(Modifier.fillMaxHeight().fillMaxWidth(fill).background(OUT_ROSE.copy(alpha = 0.45f)))
                    }
                }
                // A plain crossfade between steps: simple and smooth, no bounce.
                AnimatedContent(flow?.let { it::class to it } ?: (mode::class to mode), modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp), transitionSpec = {
                    fadeIn(tween(200)) togetherWith fadeOut(tween(150))
                }, label = "attendance-label") { (_, state) ->
                    when (state) {
                        is CaptureFlow -> FlowLabel(state, fg)
                        is ButtonMode -> ModeLabel(state, fg)
                    }
                }
            }
        }
        // Why it is locked, right under it.
        if (flow == null && mode is ButtonMode.CheckOut && !mode.unlocked && !mode.waiting) {
            Text(stringResource(R.string.presence_out_locked), color = c.mutedFg, fontSize = 11.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        if (flow is CaptureFlow.Failed) {
            Text(flow.message, color = c.danger, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            flow.fix?.let { fix ->
                TextButton(onClick = {
                    if (fix == FixHint.LOCATION_SETTINGS) runCatching { context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
                    else openAppSettings(context)
                }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text(stringResource(R.string.open_settings), fontWeight = FontWeight.Bold) }
            }
        }
    }
}

@Composable
private fun Line(icon: ImageVector?, text: String, fg: Color, spinner: Boolean = false, trailing: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center, modifier = Modifier.fillMaxWidth()) {
        if (spinner) CircularProgressIndicator(Modifier.size(20.dp), color = fg, strokeWidth = 2.5.dp)
        else icon?.let { Icon(it, null, tint = fg) }
        Spacer(Modifier.width(10.dp))
        Text(text, color = fg, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp, textAlign = TextAlign.Center)
        trailing?.let { Spacer(Modifier.width(10.dp)); Text(it, color = fg, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
    }
}

@Composable
private fun ModeLabel(mode: ButtonMode, fg: Color) = when (mode) {
    ButtonMode.CheckIn -> Line(Icons.AutoMirrored.Filled.Login, stringResource(R.string.btn_check_in), fg)
    is ButtonMode.CheckOut -> Line(
        if (mode.unlocked && !mode.waiting) Icons.AutoMirrored.Filled.Logout else Icons.Filled.Lock, stringResource(R.string.btn_check_out), fg,
        trailing = if (!mode.unlocked && !mode.waiting) "${mode.count}/${mode.min}" else null,
    )
    is ButtonMode.DoneForToday -> Line(Icons.Filled.CheckCircle,
        mode.workedMinutes?.let { stringResource(R.string.btn_done_worked, it / 60, it % 60) } ?: stringResource(R.string.btn_done), fg)
}

@Composable
private fun FlowLabel(flow: CaptureFlow, fg: Color) {
    val isIn = flow.kind == AttendanceKind.CHECK_IN
    when (flow) {
        is CaptureFlow.SelfieOk -> Line(Icons.Filled.Face, stringResource(R.string.btn_selfie_ok), fg)
        is CaptureFlow.Locating -> Line(null, stringResource(R.string.btn_locating), fg, spinner = true)
        is CaptureFlow.Sending -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            flow.place?.let { p ->
                Text(if (p.inside) stringResource(R.string.btn_at_office, p.name, p.meters) else stringResource(R.string.btn_near_office, p.name, p.meters),
                    color = fg.copy(alpha = 0.9f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
            Line(null, stringResource(R.string.btn_sending), fg, spinner = true)
        }
        is CaptureFlow.Done -> {
            val text = when {
                flow.pendingApproval -> stringResource(R.string.btn_offsite_sent)
                !isIn -> stringResource(R.string.btn_checked_out, flow.at)
                (flow.lateMinutes ?: 0) > 0 -> stringResource(R.string.btn_checked_in_late, flow.at, flow.lateMinutes!!)
                flow.lateMinutes == 0 -> stringResource(R.string.btn_checked_in_on_time, flow.at)
                else -> stringResource(R.string.btn_checked_in, flow.at)
            }
            Line(Icons.Filled.Check, text, fg)
        }
        is CaptureFlow.SavedOffline -> Line(Icons.Filled.PhoneAndroid, stringResource(R.string.btn_saved_offline), fg)
        is CaptureFlow.Failed -> Line(Icons.Filled.Refresh, stringResource(if (isIn) R.string.btn_retry_in else R.string.btn_retry_out), fg)
    }
}
