package id.znetworks.nexus.feature.attendance

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import id.znetworks.nexus.MainActivity
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.time.OfficeTime
import kotlinx.serialization.Serializable
import java.io.File
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

/**
 * The last `/api/attendance/today` the server gave, for the "NEXUS is down" mode (REQ-ATT-17).
 * Only served for the SAME office date: yesterday's "checked in 09:00" drawn this morning is wrong,
 * not merely old. Deleted on logout.
 */
class TodayCache(private val file: File) {
    @Serializable
    private data class Entry(val savedAtMillis: Long, val userId: String, val today: AttendanceToday)

    data class Saved(val today: AttendanceToday, val savedAtMillis: Long)

    fun save(userId: String, today: AttendanceToday, now: Long = System.currentTimeMillis()) {
        runCatching {
            file.parentFile?.mkdirs()
            file.writeText(NexusJson.encodeToString(Entry.serializer(), Entry(now, userId, today)))
        }
    }

    fun load(userId: String, now: Instant = Instant.now()): Saved? = runCatching {
        val e = NexusJson.decodeFromString(Entry.serializer(), file.readText())
        val todayKey = OfficeTime.today(now).toString()
        if (e.userId != userId || e.today.attendanceDateKey != todayKey) null else Saved(e.today, e.savedAtMillis)
    }.getOrNull()

    fun clear() {
        file.delete()
    }
}

/**
 * The daily reflection survives backgrounding and process death (PRD §2.5), per person and per
 * record being closed. Cleared after a successful or queued check-out, and on logout.
 */
class ReflectionDrafts(context: Context) {
    private val prefs = context.getSharedPreferences("nexus.reflectionDrafts", Context.MODE_PRIVATE)
    private fun key(userId: String, target: String) = "$userId|$target"
    fun load(userId: String, target: String): String = prefs.getString(key(userId, target), "").orEmpty()
    fun save(userId: String, target: String, text: String) {
        // One live draft at a time: an old day's text must not reappear on a later day.
        prefs.edit().clear().apply { if (text.isNotEmpty()) putString(key(userId, target), text) }.apply()
    }
    fun clearAll() = prefs.edit().clear().apply()
}

/** Local notifications the app raises itself (API.md §3.2: `attendance_queue_refused`). */
object LocalNotifier {
    const val CHANNEL_SYSTEM = "system"
    private const val REFUSED_ID = 4101

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SYSTEM, context.getString(R.string.channel_system), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun queueRefused(context: Context, problem: QueueProblem.RefusedOutsideRadius) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ensureChannels(context)
        val text = refusedSentence(context, problem)
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                .setData(android.net.Uri.parse("nexus://attendance")).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(context, CHANNEL_SYSTEM)
            .setSmallIcon(R.drawable.ic_stat_nexus)
            .setContentTitle(context.getString(R.string.queue_refused_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(REFUSED_ID, n) }
    }

    fun refusedSentence(context: Context, p: QueueProblem.RefusedOutsideRadius): String {
        val at = hhmm(p.atMillis)
        return if (p.kind == AttendanceKind.CHECK_IN) context.getString(R.string.queue_refused_checkin, at)
        else context.getString(R.string.queue_refused_checkout, at)
    }

    fun hhmm(millis: Long): String = DateTimeFormatter.ofPattern("HH:mm").format(Instant.ofEpochMilli(millis).atZone(OfficeTime.ZONE))
}

/**
 * Drains the attendance queue in the background when a network is available (REQ-ATT-13). Unique,
 * so a burst of triggers is one pass; "unreachable" asks WorkManager to retry later without ever
 * counting against the entry.
 */
class QueueFlushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as NexusApplication).container
        return when (container.attendanceQueue.flush()) {
            AttendanceQueue.FlushResult.UNREACHABLE -> Result.retry()
            else -> Result.success()
        }
    }

    companion object {
        private const val ONE_SHOT = "attendance-queue-flush"
        private const val PERIODIC = "attendance-queue-flush-periodic"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val wm = WorkManager.getInstance(context)
            wm.enqueueUniqueWork(
                ONE_SHOT, ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<QueueFlushWorker>()
                    .setConstraints(constraints)
                    // Not expedited: below Android 12 that needs a foreground notification
                    // (getForegroundInfo) or the worker crashes, and staff phones run Android 11.
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build(),
            )
            wm.enqueueUniquePeriodicWork(
                PERIODIC, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<QueueFlushWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build(),
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(ONE_SHOT)
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }
    }
}
