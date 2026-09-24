package id.znetworks.nexus.feature.push

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.AttendanceKind
import id.znetworks.nexus.feature.attendance.AttendanceToday
import java.time.Duration
import java.time.LocalTime
import java.util.concurrent.TimeUnit

/**
 * The check-in reminder the app schedules itself ONLY while push is not delivering (iOS
 * NotificationManager: `pushDeliveryActive == false`), 15 min before today's shift. When push works
 * the server sends the same reminders and this stands down.
 */
object LocalReminders {
    private const val WORK = "local-checkin-reminder"

    fun sync(context: Context, today: AttendanceToday?, pushActive: Boolean) {
        val wm = WorkManager.getInstance(context)
        val start = today?.myShift?.startTime?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
        val due = pushActive || today == null || start == null || today.today?.hasCheckedIn == true ||
            today.isRestDayToday == true || today.todayRequest != null
        if (due) {
            wm.cancelUniqueWork(WORK)
            return
        }
        val at = OfficeTime.today().atTime(start).minusMinutes(15).atZone(OfficeTime.ZONE).toInstant()
        val delay = Duration.between(java.time.Instant.now(), at)
        if (delay.isNegative) {
            wm.cancelUniqueWork(WORK)
            return
        }
        wm.enqueueUniqueWork(
            WORK, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<CheckInReminderWorker>()
                .setInitialDelay(delay.toMillis(), TimeUnit.MILLISECONDS)
                .setInputData(workDataOf("date" to OfficeTime.today().toString(), "start" to start.toString()))
                .build(),
        )
    }
}

class CheckInReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as NexusApplication).container
        if (c.sessionStore.current == null) return Result.success()
        if (inputData.getString("date") != OfficeTime.today().toString()) return Result.success()
        // Still not checked in (live or queued)? A fresh look when possible; the queue otherwise.
        if (c.attendanceQueue.state.value.has(AttendanceKind.CHECK_IN)) return Result.success()
        val today = runCatching { c.attendanceApi.today() }.getOrNull()
        if (today?.today?.hasCheckedIn == true) return Result.success()
        NexusMessagingService.show(
            applicationContext,
            applicationContext.getString(R.string.reminder_checkin_title),
            applicationContext.getString(R.string.reminder_checkin_body, inputData.getString("start").orEmpty()),
            "attendance_checkin", "/attendance", null, null, null, null, "attendance_reminders",
        )
        return Result.success()
    }
}
