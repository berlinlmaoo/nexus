package id.znetworks.nexus.feature.calendar.widget

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.feature.calendar.CalendarGlance
import id.znetworks.nexus.feature.calendar.GlanceScope
import java.util.concurrent.TimeUnit

/**
 * Hourly, with a network: the glance snapshots of the scopes the placed widgets use, so they stay current
 * while the app sleeps (plan 4.2). Every fetch path (this worker, foreground, the Calendar screen) goes
 * through CalendarSnapshots.refresh, which asks nothing while no calendar widget is placed (audit #20).
 */
class CalendarGlanceWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as NexusApplication).container
        if (container.sessionStore.current == null) return Result.success()
        if (!CalendarWidgets.anyPlaced(applicationContext)) return Result.success()
        container.calendarSnapshots.refresh(force = true)
        return Result.success()
    }
}

/**
 * Redraws every calendar widget at the moment its picture changes on its own (CalendarGlance.redrawTimes:
 * WIB midnight, the minute after an open timed task, the snapshot turning stale), then books the next
 * one. No network: the rules run on the saved snapshot.
 */
class CalendarRedrawWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        // No widget left: nothing to draw and no next alarm (audit #20).
        if (!CalendarWidgets.anyPlaced(applicationContext)) return Result.success()
        CalendarWidgets.updateAll(applicationContext)
        CalendarWidgetWork.scheduleRedraw(applicationContext)
        return Result.success()
    }
}

object CalendarWidgetWork {
    private const val PERIODIC = "calendar-glance-periodic"
    private const val REDRAW = "calendar-widget-redraw"
    private const val HORIZON_MS = 36 * 3_600_000L

    /** While signed in; KEEP, so calling it on every launch does not reset the hour. */
    fun schedulePeriodic(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<CalendarGlanceWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build(),
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        WorkManager.getInstance(context).cancelUniqueWork(REDRAW)
    }

    /** The next moment any saved snapshot changes on its own; at the latest the next WIB midnight. */
    fun nextRedraw(saved: List<SavedGlance>, nowMs: Long): Long {
        val midnight = CalendarGlance.wibInstant(CalendarGlance.addDays(CalendarGlance.wibClock(nowMs).day, 1), "00:00")
        return (saved.mapNotNull { CalendarGlance.redrawTimes(it.snapshot, it.savedAt, nowMs, HORIZON_MS).firstOrNull() } + midnight).min()
    }

    suspend fun scheduleRedraw(context: Context) {
        if (!CalendarWidgets.anyPlaced(context)) { WorkManager.getInstance(context).cancelUniqueWork(REDRAW); return }
        val snapshots = (context.applicationContext as NexusApplication).container.calendarSnapshots
        val now = System.currentTimeMillis()
        val at = nextRedraw(GlanceScope.entries.mapNotNull(snapshots::load), now)
        WorkManager.getInstance(context).enqueueUniqueWork(
            REDRAW, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<CalendarRedrawWorker>().setInitialDelay((at - now).coerceAtLeast(0) + 2_000, TimeUnit.MILLISECONDS).build(),
        )
    }

    /** Now (language changed, a widget configured): redraw and book the next one. */
    fun redrawNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(REDRAW, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<CalendarRedrawWorker>().build())
    }
}
