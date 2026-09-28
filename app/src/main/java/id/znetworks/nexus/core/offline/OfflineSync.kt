package id.znetworks.nexus.core.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.core.AppContainer
import id.znetworks.nexus.core.files.FileOpener
import id.znetworks.nexus.core.time.OfficeTime
import id.znetworks.nexus.feature.attendance.history.HistoryApi
import id.znetworks.nexus.feature.attendance.requests.RequestsApi
import id.znetworks.nexus.feature.forms.FormsApi
import id.znetworks.nexus.feature.home.Gamification
import id.znetworks.nexus.feature.projects.ProjectsApi
import id.znetworks.nexus.feature.tasks.TaskApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit

/**
 * Keeps the offline copy warm (iOS OfflineSync): the small half (today, tasks, projects, board,
 * requests, submissions — every read already lands in the response cache) often and on any
 * network; the files (this period's selfies, task attachments ≤ 40 MB for up to 80 tasks per
 * project) only on an unmetered network unless the person allowed mobile data. Nothing depends on
 * it: every screen works without it, this only means there is less left to fetch.
 */
class OfflineSync(private val context: Context, private val c: AppContainer) {
    data class State(val running: String? = null, val progress: Float? = null, val lastData: Long? = null, val lastMedia: Long? = null, val bytes: Long = 0)

    private val prefs = context.getSharedPreferences("nexus.offline", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(State(lastData = prefs.getLong(K_DATA, 0).takeIf { it > 0 }, lastMedia = prefs.getLong(K_MEDIA, 0).takeIf { it > 0 }))
    val state: StateFlow<State> = _state.asStateFlow()
    private val dataLock = Mutex()
    private val mediaLock = Mutex()
    private var mediaJob: Job? = null

    /** Big downloads on mobile data: off by default (somebody's own quota). */
    var mediaOverCellular: Boolean
        get() = prefs.getBoolean(K_CELL, false)
        set(v) { prefs.edit().putBoolean(K_CELL, v).apply(); schedule() }

    private fun metered(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
        return cm.isActiveNetworkMetered
    }
    private fun online(): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
        return cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }
    fun mayFetchMedia() = online() && (!metered() || mediaOverCellular)

    /** Ordered by what somebody opening the app looks at first. */
    suspend fun syncData() = dataLock.withLock {
        val me = c.sessionStore.current?.userId ?: return@withLock
        val projects = ProjectsApi(c.api)
        val history = HistoryApi(c.api)
        val requests = RequestsApi(c.api)
        val period = OfficeTime.periodKey(OfficeTime.today())
        val steps: List<suspend () -> Unit> = listOf(
            { c.attendanceApi.today().also { t ->
                c.todayCache.save(me, t)
                if (t.canManageAttendance == true || t.canReviewAttendanceRequests == true) history.history("workspace", period)
                if (t.canReviewAttendanceRequests == true || t.canManageAttendance == true) requests.list("workspace")
            } },
            { projects.myTasks(me) },
            { projects.projects() },
            { c.api.getCached("/api/gamification/me", "gamification", Gamification.serializer()) },
            { history.history("me", period); requests.list("me") },
            { FormsApi(context, c.api, c.sessionStore).mySubmissions() },
        )
        steps.forEachIndexed { i, step ->
            if (!currentCoroutineContext().isActive) return@withLock
            _state.update { it.copy(running = "data", progress = i.toFloat() / steps.size) }
            runCatching { step() }
        }
        val now = System.currentTimeMillis()
        prefs.edit().putLong(K_DATA, now).apply()
        _state.update { it.copy(running = null, progress = null, lastData = now) }
    }

    /** Each project's board and task list (small, any network), then the files. */
    suspend fun syncMedia() = mediaLock.withLock {
        if (c.sessionStore.current == null || !online()) return@withLock
        val projectsApi = ProjectsApi(c.api)
        val projects = runCatching { projectsApi.projects().value }.getOrDefault(emptyList())
        for (p in projects) { if (!currentCoroutineContext().isActive) return@withLock; runCatching { projectsApi.project(p.id); projectsApi.projectTasks(p.id) } }
        if (!mayFetchMedia()) return@withLock
        _state.update { it.copy(running = "media", progress = 0f) }
        val files = mutableListOf<Pair<String, String>>()
        // 1. This period's selfies, the ones a board cell opens.
        runCatching { HistoryApi(c.api).history("me", OfficeTime.periodKey(OfficeTime.today())).records }.getOrNull()?.forEach { r ->
            r.checkInPhotoUrl?.let { files += it to "img" }; r.checkOutPhotoUrl?.let { files += it to "img" }
        }
        // 2. What hangs off the tasks of my projects: ≤ 80 tasks each, files ≤ 40 MB.
        val taskApi = TaskApi(c.api, c.uploads)
        for (p in projects) {
            if (!currentCoroutineContext().isActive) return@withLock
            val tasks = runCatching { projectsApi.projectTasks(p.id).value }.getOrNull() ?: continue
            for (t in tasks.take(MAX_TASKS)) {
                if (!currentCoroutineContext().isActive) return@withLock
                runCatching { taskApi.attachments(t.id).value }.getOrNull()?.forEach { a ->
                    val u = a.url ?: return@forEach
                    if ((a.size ?: 0) <= MAX_FILE) files += u to a.label
                }
            }
        }
        files.forEachIndexed { i, (url, name) ->
            if (!currentCoroutineContext().isActive || !mayFetchMedia()) return@withLock
            if (DiskFiles.existing(url) == null) runCatching { FileOpener.fetch(context, c.api, url, name) }
            _state.update { it.copy(progress = (i + 1f) / files.size.coerceAtLeast(1)) }
        }
        DiskFiles.sweep(CAP_BYTES)
        val now = System.currentTimeMillis()
        prefs.edit().putLong(K_MEDIA, now).apply()
        _state.update { it.copy(running = null, progress = null, lastMedia = now, bytes = DiskFiles.bytes()) }
    }

    /** The data now; the files behind it, never holding anybody up. */
    fun syncAll() {
        c.appScope.launch { syncData() }
        mediaJob?.cancel()
        mediaJob = c.appScope.launch { syncMedia() }
    }

    /** On foreground: only when the copy is older than half an hour. */
    fun warmIfStale() {
        val last = _state.value.lastData ?: 0
        if (c.sessionStore.current != null && System.currentTimeMillis() - last > 30 * 60_000L) syncAll()
    }

    fun refreshUsage() = c.appScope.launch { _state.update { it.copy(bytes = DiskFiles.bytes()) } }

    fun schedule() {
        val wm = WorkManager.getInstance(context)
        wm.enqueueUniquePeriodicWork(DATA_WORK, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<OfflineWorker>(1, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(workDataOf("media" to false)).build())
        wm.enqueueUniquePeriodicWork(MEDIA_WORK, ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<OfflineWorker>(6, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(if (mediaOverCellular) NetworkType.CONNECTED else NetworkType.UNMETERED).build())
                .setInputData(workDataOf("media" to true)).build())
    }

    /** Logout: an offline copy of somebody's files must not outlive their login. */
    fun reset() {
        mediaJob?.cancel()
        WorkManager.getInstance(context).cancelUniqueWork(DATA_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(MEDIA_WORK)
        DiskFiles.clear()
        prefs.edit().remove(K_DATA).remove(K_MEDIA).apply()
        _state.value = State()
    }

    companion object {
        private const val K_DATA = "lastData"
        private const val K_MEDIA = "lastMedia"
        private const val K_CELL = "mediaOverCellular"
        private const val DATA_WORK = "offline-data"
        private const val MEDIA_WORK = "offline-media"
        const val MAX_TASKS = 80
        const val MAX_FILE = 40L shl 20
        const val CAP_BYTES = 1500L shl 20
    }
}

class OfflineWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val c = (applicationContext as NexusApplication).container
        if (c.sessionStore.current == null) return Result.success()
        if (inputData.getBoolean("media", false)) c.offline.syncMedia() else c.offline.syncData()
        return Result.success()
    }
}
