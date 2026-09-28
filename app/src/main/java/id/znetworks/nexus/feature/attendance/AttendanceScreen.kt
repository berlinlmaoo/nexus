package id.znetworks.nexus.feature.attendance

import id.znetworks.nexus.feature.attendance.history.MapFrame
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material.icons.filled.NearMe
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.material3.IconButton
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import android.Manifest
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Coffee
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.history.BoardViewModel
import id.znetworks.nexus.feature.attendance.history.CrewBoardCard
import id.znetworks.nexus.feature.attendance.history.MapCircle
import id.znetworks.nexus.feature.attendance.history.MapPin
import id.znetworks.nexus.feature.attendance.history.OsmMap
import id.znetworks.nexus.feature.attendance.liveness.LivenessCaptureScreen
import id.znetworks.nexus.feature.attendance.reflections.ReflectionsDialog
import id.znetworks.nexus.feature.attendance.requests.RequestsViewModel
import id.znetworks.nexus.feature.attendance.requests.SubmissionsCard
import id.znetworks.nexus.feature.attendance.liveness.openAppSettings
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

private val SKY = Color(0xFF0EA5E9)
private val AMBER_FILL = Color(0xFFD97706)

/** Port of iOS `AttendanceView` (PRD REQ-ATT-44), minus the map, crew board and requests (next). */
@Composable
fun AttendanceScreen(
    /** Pushed from Home or More: a back row on top. */
    onBack: (() -> Unit)? = null,
    vm: AttendanceViewModel = viewModel(),
    requests: RequestsViewModel = viewModel(),
    board: BoardViewModel = viewModel(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
    // Requests and the board need the viewer's permissions and quotas, which arrive with `today`.
    LaunchedEffect(s.today) {
        requests.onToday(s.today)
        board.onToday(s.today)
    }
    // A push / inbox row about attendance: the request with its buttons, the offsite review, or
    // the prefilled permit composer. Claimed here, so it survives a cold start and a sign-in.
    val context = LocalContext.current
    val router = (context.applicationContext as NexusApplication).container.router
    val pending by router.pending.collectAsStateWithLifecycle()
    LaunchedEffect(pending) {
        val t = pending as? Target.Attendance ?: return@LaunchedEffect
        router.consumed(t)
        when {
            t.permitToday -> requests.openPermitToday()
            t.requestId != null || t.offsiteId != null -> requests.focus(t.requestId, t.offsiteId)
            else -> vm.load()
        }
    }
    val q by vm.queueState.collectAsStateWithLifecycle()

    // Fine location is asked BEFORE the face check, so a refusal never wastes one.
    var wantedKind by remember { mutableStateOf<AttendanceKind?>(null) }
    val locationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        vm.onLocationPermissionResult()
        val kind = wantedKind
        wantedKind = null
        if (result[Manifest.permission.ACCESS_FINE_LOCATION] == true && kind != null) vm.startCapture(kind)
    }
    val locationPerms = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    LaunchedEffect(Unit) { if (!hasFine(context)) locationLauncher.launch(locationPerms) }
    // Check-in needs "Allow all the time" + precise (remote flag requireAlwaysLocation, iOS 77818ba).
    var needAlways by remember { mutableStateOf(false) }
    val config by (context.applicationContext as NexusApplication).container.remoteConfig.body.collectAsState()
    fun press(kind: AttendanceKind) {
        if (kind == AttendanceKind.CHECK_IN && config.requireAlwaysLocation && id.znetworks.nexus.feature.attendance.trail.AlwaysLocation.missing(context) != null) {
            needAlways = true; return
        }
        if (hasFine(context)) vm.startCapture(kind) else { wantedKind = kind; locationLauncher.launch(locationPerms) }
    }
    if (needAlways) id.znetworks.nexus.feature.attendance.trail.AlwaysLocationDialog(onDismiss = { needAlways = false }) {
        needAlways = false; vm.startCapture(AttendanceKind.CHECK_IN)
    }

    val capturing = s.capturing
    if (capturing != null) {
        LivenessCaptureScreen(onCaptured = vm::onSelfie, onCancel = vm::cancelCapture)
        return
    }

    var showReflections by remember { mutableStateOf(false) }
    if (showReflections) ReflectionsDialog(onClose = { showReflections = false })
    val checkedIn = vm.checkedIn(s)
    val checkedOut = vm.checkedOut(s)
    val forcePending = vm.forcePending(s)
    val offsitePending = vm.offsitePending(s)
    val needsReflection = vm.needsReflection(s)
    val reflectionOk = vm.reflectionOk(s)
    val c = Nx.colors

    Column(Modifier.fillMaxSize().background(c.background).imePadding()) {
    if (onBack != null) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Text(stringResource(R.string.home_attendance), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.foreground)
        }
    }
    // While typing the reflection the Check out button stays in sight above the keyboard.
    var reflectionFocused by remember { mutableStateOf(false) }
    val buttonInView = remember { androidx.compose.foundation.relocation.BringIntoViewRequester() }
    LaunchedEffect(reflectionFocused, s.reflection) {
        if (reflectionFocused) { kotlinx.coroutines.delay(250); buttonInView.bringIntoView() }
    }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    // A finger dragging the page puts the keyboard away (iOS: swipe to dismiss). Read from the pointer
    // itself, never from scroll events: the bring-into-view scroll above arrives as "user input" in
    // Compose, and closing the keyboard on it closed it at every letter typed (Berlin, 29 Sep, point 6).
    PullToRefreshBox(isRefreshing = false, onRefresh = { vm.load(); requests.load(); board.load() }, modifier = Modifier.fillMaxSize().weight(1f)) {
        Column(
            Modifier.fillMaxSize().dismissKeyboardOnDrag { focusManager.clearFocus() }.verticalScroll(rememberScrollState())
                // A tap on empty space closes the keyboard too.
                .pointerInput(Unit) { detectTapGestures { focusManager.clearFocus() } }
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // iOS hero (Berlin, 29 Sep, point 1): the purple time card floats over the map.
            HeroCard(s, checkedIn, checkedOut, forcePending)
            if (s.loading) LoadingRow()
            if (s.serverDown) DownCard(onRetry = { vm.load() })
            else s.error?.let { ErrorCard(it, onRetry = { vm.load() }) }
            s.savedCopyAt?.let {
                Text(stringResource(R.string.saved_copy_from, LocalNotifier.hhmm(it)), color = c.mutedFg, fontSize = 12.sp,
                    modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }

            if (!s.canTakeAttendance) {
                PhoneOnlyCard()
            } else {
                if (needsReflection) ReflectionCard(s.reflection, vm.reflectionCount(s), reflectionOk, vm::onReflection) { reflectionFocused = it }
                ReflectionsLink(onOpen = { showReflections = true })
                if (s.locationOff) LocationOffBanner()
                // One control that changes with the day (UPDATES §11); the press flow is drawn inside it.
                val mode = AttendanceButtonLogic.mode(checkedIn, checkedOut, forcePending, offsitePending,
                    vm.reflectionCount(s), AttendanceViewModel.REFLECTION_MIN, s.today?.today?.checkInAt, s.today?.today?.checkOutAt,
                    coveredBy = s.today?.todayRequest.takeIf { q.count == 0 }, workedMinutes = s.today?.today?.workedMinutes,
                    checkOutQueued = s.today?.today?.hasCheckedOut != true && q.has(AttendanceKind.CHECK_OUT))
                if (mode is ButtonMode.CoveredByRequest) CoveredByRequestCard(mode.type)
                else Box(Modifier.bringIntoViewRequester(buttonInView)) {
                    AttendanceButton(mode, s.flow, enabled = !s.loading, onPress = ::press, onDismissFlow = vm::dismissFlow)
                }
                if (s.offsitePrompt) OffsitePrompt(s.offsiteReason, vm::onOffsiteReason, vm::cancelOffsite, vm::submitOffsite)
            }

            if (forcePending) {
                InfoBanner(stringResource(if (reflectionOk) R.string.force_pending_ready else R.string.force_pending_reflection), c.warning)
            }
            if (offsitePending) InfoBanner(stringResource(R.string.offsite_waiting), c.warning)
            if (s.today?.today?.checkOutApproval == "REJECTED") InfoBanner(stringResource(R.string.offsite_rejected), c.danger)
            s.banner?.let { (text, good) -> InfoBanner(text, if (good) c.success else c.danger) }
            // A queued tap must never be invisible: somebody who thinks they clocked in and did not
            // would only find out at payroll.
            q.problem?.takeIf { q.count == 0 }?.let { InfoBanner(problemText(it), c.danger) }
            if (q.count > 0) {
                InfoBanner(pluralStringResource(R.plurals.queue_waiting, q.count, q.count), c.warning)
            }
            val trail = (context.applicationContext as NexusApplication).container.workTrail
            val trailTick by trail.changes.collectAsState()
            val recId = s.today?.today?.id
            val hereName = remember(trailTick, recId) { id.znetworks.nexus.feature.attendance.trail.TrailMachine.officeHereFor(trail.state, recId)?.name }
            Metrics(s, forcePending, hereName.takeIf { s.today?.today?.let { it.hasCheckedIn && !it.hasCheckedOut } == true })
            // Filing changes today's quota and cover: re-read it after a request goes in.
            SubmissionsCard(requests, onFiled = { vm.load() })
            CrewBoardCard(board)
        }
    }
    }

    if (q.heldNoticeDue && q.isHeldForUpdate) HeldNotice(q, onDismiss = vm::heldNoticeSeen)
}

private fun hasFine(context: android.content.Context) =
    androidx.core.content.ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED

@Composable
private fun problemText(p: QueueProblem): String = when (p) {
    is QueueProblem.RefusedOutsideRadius -> LocalNotifier.refusedSentence(LocalContext.current, p)
    is QueueProblem.ServerRefused -> {
        val why = p.message ?: stringResource(R.string.error_server_status, p.status ?: 0)
        if (p.dropped) stringResource(R.string.queue_dropped, why) else stringResource(R.string.queue_retrying, why)
    }
}

// region hero

/**
 * The hero as on iOS: a 360 dp map with the purple time card floating on its top, the status chips on
 * its bottom left and a recenter button on its bottom right. The map is drawn 180 dp taller and pushed
 * down 90 dp (iOS pinDrop) so the dot at its centre lands below the card, not under it.
 */
@Composable
private fun HeroCard(s: AttendanceUiState, checkedIn: Boolean, checkedOut: Boolean, forcePending: Boolean) {
    val c = Nx.colors
    var onMe by remember { mutableStateOf(0) } // recenter: frame the map on the person again
    Box(Modifier.fillMaxWidth().height(HERO_HEIGHT).clip(RoundedCornerShape(24.dp)).background(c.muted).border(1.dp, c.border, RoundedCornerShape(24.dp))) {
        androidx.compose.runtime.key(onMe) {
            HeroMap(s, Modifier.fillMaxWidth().requiredHeight(HERO_HEIGHT + PIN_DROP * 2).offset(y = PIN_DROP), centerOnMe = onMe > 0)
        }
        Column(Modifier.fillMaxSize()) {
            Hero(s, Modifier.padding(12.dp))
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Bottom) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val status = stringResource(when {
                        forcePending -> R.string.status_finish_yesterday
                        checkedOut -> R.string.status_done
                        checkedIn -> R.string.status_clocked_in
                        else -> R.string.status_ready
                    })
                    Text(status, color = c.mutedFg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.background(c.card.copy(alpha = 0.85f), CircleShape).padding(horizontal = 12.dp, vertical = 7.dp))
                    // Without it the exemption is invisible: the member only finds out by not being refused.
                    if (s.today?.noGeofence == true) Text(stringResource(R.string.location_free), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.background(SKY, CircleShape).padding(horizontal = 12.dp, vertical = 7.dp))
                }
                if (s.here != null) Box(Modifier.size(40.dp).background(c.card, CircleShape).border(1.dp, c.border, CircleShape).clip(CircleShape).clickable { onMe++ },
                    contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.NearMe, stringResource(R.string.hero_recenter), tint = c.foreground, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

private val HERO_HEIGHT = 360.dp
private val PIN_DROP = 90.dp

/** The hero's map: where you are and the office circle. Display only. */
@Composable
private fun HeroMap(s: AttendanceUiState, mod: Modifier, centerOnMe: Boolean) {
    val here = s.here
    val rec = s.today?.today ?: s.today?.pendingCheckout
    // Location-free members are not tied to an office: the map follows them (iOS 5ba2e93).
    if (s.today?.noGeofence == true || (centerOnMe && here != null)) {
        if (here == null) return
        val office = if (centerOnMe && s.today?.noGeofence != true) rec?.officeLocation?.takeIf { it.latitude != null && it.longitude != null } else null
        OsmMap(mod, circle = office?.let { MapCircle(it.latitude!!, it.longitude!!, it.radiusMeters ?: 100.0) }, path = emptyList(), pins = emptyList(),
            frame = MapFrame.person(here.lat, here.lng), userDot = here.lat to here.lng, circleColor = android.graphics.Color.rgb(123, 104, 238))
        return
    }
    // Today's record's office, else the nearest one before check-in, with its check-in circle and a
    // pin, framed a few radii across (≥ 300 m) so "am I inside?" reads at a glance (iOS 4bb25f8).
    val office = rec?.officeLocation?.takeIf { it.latitude != null && it.longitude != null }
        ?.let { MapCircle(it.latitude!!, it.longitude!!, it.radiusMeters ?: 100.0) to it.name.orEmpty() }
        ?: s.nearest?.let { MapCircle(it.lat, it.lng, it.radius) to it.name }
    if (office == null && here == null) return
    val circle = office?.first
    OsmMap(
        mod,
        circle = circle,
        path = emptyList(),
        pins = listOfNotNull(circle?.let { MapPin(it.lat, it.lng, office.second) }),
        frame = circle?.let { MapFrame.office(it.lat, it.lng, it.radius) } ?: here?.let { MapFrame.person(it.lat, it.lng) },
        userDot = here?.let { it.lat to it.lng },
        circleColor = android.graphics.Color.rgb(123, 104, 238),
    )
}

@Composable
private fun ReflectionsLink(onOpen: () -> Unit) {
    val c = Nx.colors
    Row(
        Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(20.dp)).border(1.dp, c.border, RoundedCornerShape(20.dp))
            .clickable(onClick = onOpen).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.AutoAwesome, null, tint = c.violetText, modifier = Modifier.size(22.dp))
        Spacer(Modifier.size(10.dp))
        Column(Modifier.weight(1f)) {
            Text(stringResource(R.string.reflections_title), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = c.foreground)
            Text(stringResource(R.string.reflections_link_sub), fontSize = 11.sp, color = c.mutedFg)
        }
    }
}

/** The purple time card (iOS timeCard): short date, running clock, shift, IN / OUT. */
@Composable
private fun Hero(s: AttendanceUiState, modifier: Modifier = Modifier) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1_000) } }
    val zoned = Instant.ofEpochMilli(now).atZone(OfficeTime.ZONE)
    val rec = s.today?.today ?: s.today?.pendingCheckout
    Column(
        modifier.fillMaxWidth()
            .shadow(14.dp, RoundedCornerShape(24.dp), ambientColor = Color(0xFFA78BFA), spotColor = Color(0xFFA78BFA))
            .background(Brush.linearGradient(listOf(Color(0xFFC4B5FD), Color(0xFF7C3AED))), RoundedCornerShape(24.dp))
            .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(24.dp))
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Short date in Indonesian, as iOS ("Sel, 29 Sep").
        Text(DateTimeFormatter.ofPattern("EEE, d MMM", Locale.forLanguageTag("id-ID")).format(zoned), color = Color.White.copy(alpha = 0.9f),
            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth())
        Text(DateTimeFormatter.ofPattern("HH:mm:ss").format(zoned), color = Color.White, fontFamily = DisplayFont,
            fontWeight = FontWeight.Bold, fontSize = 46.sp)
        Text(shiftLabel(s.today?.myShift), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.background(Color.White.copy(alpha = 0.18f), CircleShape).padding(horizontal = 12.dp, vertical = 5.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
            Text("IN ${hhmmIso(rec?.checkInAt)}", color = Color.White.copy(alpha = 0.9f), fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text("OUT ${hhmmIso(rec?.checkOutAt)}", color = Color.White.copy(alpha = 0.9f), fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}

@Composable
private fun shiftLabel(shift: MyShift?): String {
    val start = shift?.startTime
    val end = shift?.endTime
    if (start == null || end == null) return stringResource(R.string.my_schedule) + " —"
    // Flexi: the check-in WINDOW and the +9h rule, as on web and iOS (REQ-ATT-20).
    return if (shift.flexi == true) "Flexi $start–$end · +9h" else stringResource(R.string.my_schedule) + " $start – $end"
}

private fun hhmmIso(iso: String?): String = iso?.let {
    runCatching { DateTimeFormatter.ofPattern("HH:mm").format(Instant.parse(it).atZone(OfficeTime.ZONE)) }.getOrNull()
} ?: "--:--"

// endregion

@Composable
private fun ReflectionCard(text: String, count: Int, ok: Boolean, onChange: (String) -> Unit, onFocus: (Boolean) -> Unit = {}) {
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val c = Nx.colors
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.reflection_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                color = c.foreground, modifier = Modifier.weight(1f))
            Text("$count/${AttendanceViewModel.REFLECTION_MIN}", fontWeight = FontWeight.Bold, fontSize = 12.sp,
                color = if (ok) c.success else c.warning)
        }
        Text(stringResource(R.string.reflection_help), fontSize = 11.sp, color = c.mutedFg)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = text, onValueChange = onChange, minLines = 5, maxLines = 12,
            placeholder = { Text(stringResource(R.string.reflection_placeholder)) },
            shape = RoundedCornerShape(12.dp),
            // Done closes the keyboard (iOS 87ada44 "Selesai"); back, a tap outside and a scroll do too.
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { focus.clearFocus() }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = if (ok) c.success else c.violet,
                unfocusedBorderColor = if (ok) c.success.copy(alpha = 0.45f) else c.border,
            ),
            modifier = Modifier.fillMaxWidth().onFocusChanged { onFocus(it.isFocused) },
        )
        if (!ok) {
            Spacer(Modifier.height(6.dp))
            Text(pluralStringResource(R.plurals.reflection_more, AttendanceViewModel.REFLECTION_MIN - count, AttendanceViewModel.REFLECTION_MIN - count),
                fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.warning)
        }
    }
}

@Composable
private fun OffsitePrompt(reason: String, onReason: (String) -> Unit, onCancel: () -> Unit, onSubmit: () -> Unit) {
    val c = Nx.colors
    val amber = c.warning
    Column(
        Modifier.fillMaxWidth().background(amber.copy(alpha = 0.10f), RoundedCornerShape(16.dp))
            .border(1.dp, amber.copy(alpha = 0.5f), RoundedCornerShape(16.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(stringResource(R.string.offsite_title), fontWeight = FontWeight.Bold, fontSize = 14.sp, color = c.foreground)
        Text(stringResource(R.string.offsite_body), fontSize = 12.sp, color = c.mutedFg)
        OutlinedTextField(reason, onReason, minLines = 2, placeholder = { Text(stringResource(R.string.offsite_placeholder)) },
            modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = onCancel, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.cancel)) }
            Button(onClick = onSubmit, enabled = reason.isNotBlank(), modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = AMBER_FILL, contentColor = Color.White)) {
                Text(stringResource(R.string.offsite_submit), fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun Metrics(s: AttendanceUiState, forcePending: Boolean, hereName: String? = null) {
    val c = Nx.colors
    val rec = s.today?.today ?: s.today?.pendingCheckout
    val todayValue = when {
        forcePending -> stringResource(R.string.status_finish_yesterday)
        rec?.status != null -> humanize(rec.status)
        s.today?.todayRequest?.type != null -> "${humanize(s.today.todayRequest.type)} ${humanize(s.today.todayRequest.status.orEmpty())}".trim()
        else -> stringResource(R.string.status_ready)
    }
    // Once there is a check-in the record decides (iOS a0f1de4): away → where they checked in,
    // inside the radius → the office, location-free or not. Before it, the per-person rule.
    val checkedIn = rec?.checkInAt != null
    val away = if (checkedIn) rec?.checkedInAway else null
    val free = if (checkedIn && away != null) away else s.today?.noGeofence == true
    val officeName = if (free) null else rec?.officeLocation?.name
    // Moved to another active office since checking in: the helper says which one (iOS 45ea4ea).
    val movedTo = hereName?.takeIf { !free && rec?.checkOutAt == null && it != officeName }
    val officeValue = if (free) {
        (if (checkedIn) rec?.placeLabel else null)?.takeIf { it.isNotBlank() }
            ?: rec?.checkInAddress?.let(::shortAddress)?.takeIf { it.isNotBlank() }
            ?: stringResource(if (checkedIn) R.string.checked_in_away else R.string.location_free)
    } else officeName ?: s.nearest?.name ?: stringResource(if (s.locationOff) R.string.location_is_off else R.string.finding_you)
    val officeHelper = when {
        movedTo != null -> stringResource(R.string.now_at, movedTo) + " · In ${hhmmIso(rec?.checkInAt)} · Out ${hhmmIso(rec?.checkOutAt)}"
        checkedIn && away == true -> stringResource(R.string.away_from_office) + " · In ${hhmmIso(rec?.checkInAt)} · Out ${hhmmIso(rec?.checkOutAt)}"
        rec?.checkInAt != null -> "In ${hhmmIso(rec.checkInAt)} · Out ${hhmmIso(rec.checkOutAt)}"
        s.nearest != null -> if (s.nearest.inside) stringResource(R.string.inside_office)
            else stringResource(R.string.distance_from_here, distanceLabel(s.nearest.distanceMeters))
        s.locationOff -> stringResource(R.string.turn_location_on_office)
        else -> stringResource(R.string.checking_where)
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Metric(Icons.Filled.Coffee, stringResource(R.string.metric_today), todayValue, null, c.success, Modifier.weight(1f))
            Metric(Icons.Filled.LocationOn, stringResource(when { free && rec?.checkInAt != null -> R.string.metric_checkin_place; officeName != null -> R.string.metric_office; else -> R.string.metric_where }),
                officeValue, officeHelper, if (s.nearest?.inside == true || officeName != null) c.success else c.warning, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // Straight from the server, which already caps used at the quota (REQ-ATT-23).
            // The quota already includes extra days granted by the BoD for this period (§5).
            val bonus = s.today?.dayOffAllowance?.bonus ?: 0
            Metric(Icons.Filled.AutoAwesome, stringResource(R.string.metric_dayoff),
                quota(s.today?.dayOffUsedThisMonth, s.today?.dayOffQuota),
                if (bonus > 0) stringResource(R.string.metric_dayoff_help_bonus, s.today?.dayOffAllowance?.base ?: 4, bonus)
                else stringResource(R.string.metric_dayoff_help), c.warning, Modifier.weight(1f))
            Metric(Icons.Filled.CalendarMonth, stringResource(R.string.metric_holidays),
                quota(s.today?.redDateUsedThisMonth, s.today?.redDateQuota), stringResource(R.string.metric_holidays_help), Color(0xFFFB7185), Modifier.weight(1f))
        }
    }
}

/** A dash, not "0/4", when the server sent no quota: a made-up number would look true. */
@Composable
private fun quota(used: Int?, quota: Int?): String =
    if (quota == null) "—" else stringResource(R.string.quota_used, used ?: 0, quota)

private fun distanceLabel(m: Double) = if (m < 1000) "${m.toInt()} m" else String.format(Locale.ROOT, "%.1f km", m / 1000)

private fun humanize(raw: String) = raw.split('_', ' ').filter { it.isNotEmpty() }
    .joinToString(" ") { it.lowercase().replaceFirstChar(Char::titlecase) }

@Composable
private fun Metric(icon: ImageVector, label: String, value: String, helper: String?, tint: Color, modifier: Modifier) {
    val c = Nx.colors
    Column(modifier.background(c.card, RoundedCornerShape(20.dp)).border(1.dp, c.border, RoundedCornerShape(20.dp)).padding(14.dp)) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.height(8.dp))
        Text(label, fontSize = 11.sp, color = c.mutedFg, fontWeight = FontWeight.SemiBold)
        Text(value, fontSize = 15.sp, color = c.foreground, fontFamily = DisplayFont, fontWeight = FontWeight.Bold)
        helper?.let { Text(it, fontSize = 11.sp, color = c.mutedFg) }
    }
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    val c = Nx.colors
    Column(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(24.dp)).border(1.dp, c.border, RoundedCornerShape(24.dp)).padding(16.dp)) {
        content()
    }
}

@Composable
private fun InfoBanner(text: String, tone: Color) {
    Text(text, color = tone, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().background(tone.copy(alpha = 0.14f), RoundedCornerShape(12.dp))
            .border(1.dp, tone.copy(alpha = 0.2f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 9.dp))
}

@Composable
private fun LoadingRow() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Spacer(Modifier.size(8.dp))
        Text(stringResource(R.string.loading_attendance), fontSize = 12.sp, color = Nx.colors.mutedFg)
    }
}

@Composable
private fun DownCard(onRetry: () -> Unit) {
    val amber = Nx.colors.warning
    Column(
        Modifier.fillMaxWidth().background(amber.copy(alpha = 0.10f), RoundedCornerShape(14.dp))
            .border(1.dp, amber.copy(alpha = 0.5f), RoundedCornerShape(14.dp)).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.WifiOff, null, tint = amber, modifier = Modifier.size(16.dp))
            Spacer(Modifier.size(8.dp))
            Text(stringResource(R.string.down_title), fontWeight = FontWeight.Bold, fontSize = 14.sp, color = amber)
        }
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.down_body), fontSize = 12.sp, color = Nx.colors.foreground, textAlign = TextAlign.Center)
        TextButton(onClick = onRetry) { Text(stringResource(R.string.update_check_again), color = amber, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun ErrorCard(msg: String, onRetry: () -> Unit) {
    val d = Nx.colors.danger
    Column(
        Modifier.fillMaxWidth().background(d.copy(alpha = 0.14f), RoundedCornerShape(12.dp)).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(msg, color = d, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        TextButton(onClick = onRetry) { Text(stringResource(R.string.try_again), color = d, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun LocationOffBanner() {
    val context = LocalContext.current
    val w = Nx.colors.warning
    Row(
        Modifier.fillMaxWidth().background(w.copy(alpha = 0.12f), RoundedCornerShape(12.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.location_off_banner), fontSize = 12.sp, color = Nx.colors.foreground, modifier = Modifier.weight(1f))
        TextButton(onClick = { openAppSettings(context) }) { Text(stringResource(R.string.open_settings), color = w, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun CoveredByRequestCard(type: String?) {
    val c = Nx.colors
    Column(
        Modifier.fillMaxWidth().background(c.success.copy(alpha = 0.08f), RoundedCornerShape(18.dp))
            .border(1.dp, c.success.copy(alpha = 0.25f), RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.EventAvailable, null, tint = c.success, modifier = Modifier.size(26.dp))
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.covered_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.foreground, textAlign = TextAlign.Center)
        Text((type?.let { id.znetworks.nexus.feature.attendance.requests.typeLabel(it) } ?: stringResource(R.string.covered_request)) + " · " + stringResource(R.string.covered_body),
            fontSize = 12.sp, color = c.mutedFg, textAlign = TextAlign.Center)
    }
}

@Composable
private fun PhoneOnlyCard() {
    val c = Nx.colors
    Column(
        Modifier.fillMaxWidth().background(c.violet.copy(alpha = 0.07f), RoundedCornerShape(18.dp))
            .border(1.dp, c.violet.copy(alpha = 0.25f), RoundedCornerShape(18.dp)).padding(horizontal = 18.dp, vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.PhoneAndroid, null, tint = c.violetText, modifier = Modifier.size(30.dp))
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.phone_only_title), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = c.foreground)
        Text(stringResource(R.string.phone_only_body), fontSize = 13.sp, color = c.mutedFg, textAlign = TextAlign.Center)
    }
}

// region flow card

@Composable
private fun HeldNotice(q: AttendanceQueue.State, onDismiss: () -> Unit) {
    val kinds = q.entries.map { it.kind }.toSet()
    val title = stringResource(
        when (kinds) {
            setOf(AttendanceKind.CHECK_IN) -> R.string.held_title_in
            setOf(AttendanceKind.CHECK_OUT) -> R.string.held_title_out
            else -> R.string.held_title_both
        },
    )
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(stringResource(R.string.held_body)) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("OK") } },
    )
}

// endregion

/** The first two parts of a server address ("Jl. Sudirman 5, Senayan, Jakarta…" → "Jl. Sudirman 5, Senayan"). */
internal fun shortAddress(a: String): String = a.split(',').map { it.trim() }.filter { it.isNotEmpty() }.take(2).joinToString(", ")

/** Calls [dismiss] once per gesture whose finger travels past the touch slop; never consumes the events. */
internal fun Modifier.dismissKeyboardOnDrag(dismiss: () -> Unit): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = androidx.compose.ui.input.pointer.PointerEventPass.Initial)
        var travelled = 0f
        while (true) {
            val change = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: break
            travelled += (change.position - change.previousPosition).getDistance()
            if (travelled > viewConfiguration.touchSlop) { dismiss(); break }
            if (!change.pressed) break
        }
    }
}
