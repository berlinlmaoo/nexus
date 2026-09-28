package id.znetworks.nexus.feature.attendance.trail

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import id.znetworks.nexus.MainActivity
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.attendance.LocalNotifier
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * The work session (REQ-ATT-37): a foreground service of type `location`, with a persistent
 * notification for the whole time it records. It only owns the GPS; every decision is
 * [TrailMachine]'s, via [WorkTrail]. Started from the foreground (Android 12+ forbids otherwise).
 *
 * Inside the office: a low-power (Wi-Fi/cell) stream that notices leaving, and about once an
 * hour a presence check: one high-accuracy request of at most 45 s. Outside: a fix every 30 s or
 * every 20 m; the machine queues a point every ~50 m or 5 min and uploads about every 2 min.
 */
class WorkTrailService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var modeJob: Job? = null
    private var tickJob: Job? = null
    private var preciseJob: Job? = null
    private var currentMode: WorkTrail.Mode? = null
    private val trail get() = (application as NexusApplication).container.workTrail
    private val fused by lazy { LocationServices.getFusedLocationProviderClient(this) }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.forEach { trail.onFix(it.toPoint()) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel(this)
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
        } catch (e: Exception) {
            // Not allowed now (started from the background, or permission gone): say so and stop.
            trail.permissionLost()
            stopSelf()
            return START_NOT_STICKY
        }
        if (modeJob == null) {
            // This process may be new (killed, restarted, rebooted): nothing watched in between.
            trail.resume()
            modeJob = scope.launch {
                trail.gps.collect { g ->
                    applyMode(g.mode)
                    applyPrecise(g.precise)
                }
            }
            scope.launch { trail.fixRequested.collect { if (it) oneFix() } }
            // Stage changes (left, back, excuse filed, server reply) show at once; the tick covers 90/120 min.
            scope.launch { trail.changes.collect { refreshNotification() } }
            tickJob = scope.launch {
                var minutes = 0
                while (true) {
                    delay(60_000)
                    trail.tick()
                    refreshNotification()
                    // Level-triggered, as iOS 13e7784: re-assert the location request every 10 min,
                    // so one that the system dropped silently is put back without waiting for a
                    // zone change that may never come.
                    if (++minutes % 10 == 0) {
                        currentMode = null
                        applyMode(trail.gps.value.mode)
                    }
                }
            }
        }
        return START_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun applyMode(mode: WorkTrail.Mode) {
        if (mode == currentMode) return
        currentMode = mode
        fused.removeLocationUpdates(callback)
        if (mode == WorkTrail.Mode.OFF) {
            if (trail.state.pending.isEmpty()) stopSelf()
            return
        }
        if (!hasFine()) {
            trail.permissionLost()
            stopSelf()
            return
        }
        val request = when (mode) {
            // Cheap between presence checks; usually still clear enough (Wi-Fi) to notice leaving.
            WorkTrail.Mode.WATCH_OFFICE -> LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 5 * 60_000L)
                .setMinUpdateIntervalMillis(2 * 60_000L).build()
            // Outside: the precise route (UPDATES §10). A finer filter than the 50 m step, so a
            // step is noticed close to where it happened; the machine decides what is queued.
            else -> LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 30_000L)
                .setMinUpdateDistanceMeters(20f).setMinUpdateIntervalMillis(15_000L).build()
        }
        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            trail.permissionLost()
            stopSelf()
        }
        refreshNotification()
    }

    /** The presence check's precise window: one high-accuracy request, at most 45 s, fresh only. */
    @SuppressLint("MissingPermission")
    private fun applyPrecise(precise: Boolean) {
        if (!precise) {
            preciseJob?.cancel()
            preciseJob = null
            return
        }
        if (preciseJob?.isActive == true || !hasFine()) return
        preciseJob = scope.launch {
            val loc = runCatching {
                fused.getCurrentLocation(CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                    .setMaxUpdateAgeMillis(0).setDurationMillis(TrailMachine.PRECISE_TIMEOUT_MS).build(), null).await()
            }.getOrNull()
            loc?.let { trail.onFix(it.toPoint()) }
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun oneFix() {
        trail.fixRequested.value = false
        if (!hasFine()) return
        val loc = runCatching {
            // Fresh only: a cached fix from before a kill must not speak for "now".
            fused.getCurrentLocation(CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(TrailMachine.FRESH_FIX_MS).setDurationMillis(30_000).build(), null).await()
        }.getOrNull()
        loc?.let { trail.onFix(it.toPoint()) }
    }

    /** What the notification shows now; re-posted only when this changes (the chronometer ticks itself). */
    private var shown: Any? = null

    private fun refreshNotification() {
        outsideAlerts(System.currentTimeMillis())
        val key = listOf(currentMode, OutsideClock.present(trail.state, System.currentTimeMillis()), trail.state.checkInAtMillis)
        if (key == shown) return
        getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification())
    }

    private fun notification(): Notification {
        val now = System.currentTimeMillis()
        val outside = OutsideClock.present(trail.state, now)
        shown = listOf(currentMode, outside, trail.state.checkInAtMillis)
        val since = trail.state.checkInAtMillis
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // No check-out action, ever (REQ-ATT-01/40): only opening the app, and outside the permit composer.
        val b = NotificationCompat.Builder(this, CHANNEL_WORK_SESSION)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        if (outside == null) {
            b.setColor(VIOLET)
                .setContentTitle(getString(R.string.work_session_title))
                .setContentText(getString(if (currentMode == WorkTrail.Mode.OUTSIDE) R.string.work_session_outside else R.string.work_session_inside))
                .setShowWhen(since != null)
                .setUsesChronometer(since != null)
                .apply { if (since != null) setWhen(since) }
        } else {
            val auto = LocalNotifier.hhmm(outside.autoAtMillis)
            val text = when (outside.level) {
                OutsideClock.Level.OUTSIDE -> getString(R.string.outside_auto_at, auto)
                OutsideClock.Level.REMIND -> getString(R.string.outside_remind, auto)
                OutsideClock.Level.WARN -> getString(R.string.outside_warn, auto)
            }
            b.setColor(AMBER)
                .setContentTitle(getString(R.string.outside_since, LocalNotifier.hhmm(outside.sinceMillis)))
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                // Counts down to the automatic check-out by itself; no per-minute re-posting.
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setWhen(outside.autoAtMillis)
            if (outside.level != OutsideClock.Level.OUTSIDE) b.permitAction(1)
        }
        return b.build()
    }

    /** The only action these notifications carry: the permit composer, as the push's. Never check-out. */
    private fun NotificationCompat.Builder.permitAction(requestCode: Int) {
        val permit = Intent(Intent.ACTION_VIEW, Uri.parse("nexus://attendance?permit=today"), this@WorkTrailService, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        addAction(0, getString(R.string.file_a_permit),
            PendingIntent.getActivity(this@WorkTrailService, requestCode, permit, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }

    /**
     * UPDATES §10: a local notification on leaving the office and one at minute 60 with the time
     * left, each once per episode; taken back on coming back, an excuse, check-out or logout.
     * Computed here from the tracker, so it holds when a push is lost.
     */
    private fun outsideAlerts(now: Long) {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val prefs = getSharedPreferences("nexus.outsideAlerts", MODE_PRIVATE)
        val episode = OutsideClock.episode(trail.state)
        val posted = if (episode != null && prefs.getLong("episode", -1) == episode) {
            prefs.getStringSet("posted", emptySet()).orEmpty().mapNotNull { runCatching { OutsideClock.Alert.valueOf(it) }.getOrNull() }.toSet()
        } else emptySet()
        val step = OutsideClock.alertStep(trail.state, now, posted)
        if (step.cancel) { nm.cancel(ALERT_ID); return }
        val alert = step.post ?: return
        val o = OutsideClock.present(trail.state, now) ?: return
        val auto = LocalNotifier.hhmm(o.autoAtMillis)
        val (title, text) = when (alert) {
            OutsideClock.Alert.LEFT -> getString(R.string.outside_left_title, LocalNotifier.hhmm(o.sinceMillis)) to getString(R.string.outside_left_body, auto)
            OutsideClock.Alert.HOUR -> {
                val left = ((o.autoAtMillis - now) / 60_000L).coerceAtLeast(0).toInt()
                val dur = if (left >= 60) getString(R.string.dur_hm, left / 60, left % 60) else getString(R.string.dur_m, left)
                getString(R.string.outside_hour_title) to getString(R.string.outside_hour_body, dur, auto)
            }
        }
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(this, ALERT_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setColor(AMBER)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .apply { permitAction(3) }
            .build()
        runCatching { nm.notify(ALERT_ID, n) }
        prefs.edit().putLong("episode", episode ?: -1).putStringSet("posted", (posted + alert).map { it.name }.toSet()).apply()
    }


    private fun hasFine() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onDestroy() {
        // Check-out, logout or tracking stopped: an "outside" alert no longer holds.
        runCatching { getSystemService(NotificationManager::class.java)?.cancel(ALERT_ID) }
        runCatching { fused.removeLocationUpdates(callback) }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_WORK_SESSION = "work_session"
        private const val NOTIFICATION_ID = 4201
        private const val ALERT_ID = 4202
        /** The server's channel for outside-the-office pushes (PushManager.CHANNELS). */
        private const val ALERT_CHANNEL = "attendance_location"
        private const val VIOLET = 0xFF7B68EE.toInt()
        private const val AMBER = 0xFFF59E0B.toInt()

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(CHANNEL_WORK_SESSION, context.getString(R.string.channel_work_session), NotificationManager.IMPORTANCE_LOW),
            )
        }

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, WorkTrailService::class.java)) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, WorkTrailService::class.java)) }
        }

        private fun android.location.Location.toPoint() = TrailPoint(
            recordId = "",
            lat = latitude,
            lng = longitude,
            accuracy = if (hasAccuracy()) accuracy.toDouble() else null,
            atMillis = time,
        )
    }
}

/**
 * After a reboot, resume an open work session, but only where Android allows starting a location
 * service from the background (background location granted). Otherwise it resumes the next time
 * NEXUS is opened.
 */
class WorkTrailBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val trail = (context.applicationContext as NexusApplication).container.workTrail
        if (!trail.state.isActive) return
        val background = Build.VERSION.SDK_INT < 29 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (background) WorkTrailService.start(context)
    }
}
