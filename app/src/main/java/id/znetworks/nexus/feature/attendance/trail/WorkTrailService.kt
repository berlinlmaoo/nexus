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
 * hour a presence check: one high-accuracy request of at most 45 s. Outside: a fix a minute or
 * every 50 m, and the machine decides what is queued (about every 15 min).
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
            tickJob = scope.launch {
                var minutes = 0
                while (true) {
                    delay(60_000)
                    trail.tick()
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
            else -> LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 60_000L)
                .setMinUpdateDistanceMeters(50f).setMinUpdateIntervalMillis(30_000L).build()
        }
        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            trail.permissionLost()
            stopSelf()
        }
        getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification())
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

    private fun notification(): Notification {
        val since = trail.state.checkInAtMillis
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        // No check-out action, ever (REQ-ATT-01/40): only opening the app.
        return NotificationCompat.Builder(this, CHANNEL_WORK_SESSION)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setContentTitle(getString(R.string.work_session_title))
            .setContentText(getString(if (currentMode == WorkTrail.Mode.OUTSIDE) R.string.work_session_outside else R.string.work_session_inside))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(since != null)
            .setUsesChronometer(since != null)
            .apply { if (since != null) setWhen(since) }
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun hasFine() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    override fun onDestroy() {
        runCatching { fused.removeLocationUpdates(callback) }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_WORK_SESSION = "work_session"
        private const val NOTIFICATION_ID = 4201

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
