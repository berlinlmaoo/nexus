package id.znetworks.nexus.core

import android.content.Context
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
import id.znetworks.nexus.core.net.LanRoute
import id.znetworks.nexus.core.net.ResponseCache
import id.znetworks.nexus.core.session.KeystoreSessionCipher
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.core.session.SessionStore
import id.znetworks.nexus.core.version.GateStorage
import id.znetworks.nexus.core.version.VersionGate
import id.znetworks.nexus.core.version.VersionPolicyResponse
import id.znetworks.nexus.feature.attendance.ApiQueueSender
import id.znetworks.nexus.feature.attendance.AttendanceKind
import id.znetworks.nexus.feature.attendance.trail.WorkTrail
import id.znetworks.nexus.feature.attendance.AttendanceApi
import id.znetworks.nexus.feature.attendance.AttendanceQueue
import id.znetworks.nexus.feature.attendance.LocalNotifier
import id.znetworks.nexus.feature.attendance.LocationProvider
import id.znetworks.nexus.feature.attendance.QueueFlushWorker
import id.znetworks.nexus.feature.attendance.ReflectionDrafts
import id.znetworks.nexus.feature.attendance.TodayCache
import id.znetworks.nexus.feature.auth.AuthRepository
import id.znetworks.nexus.core.nav.Router
import id.znetworks.nexus.feature.push.PushManager
import id.znetworks.nexus.feature.update.ApkUpdater
import id.znetworks.nexus.feature.inbox.AnnouncementHost
import id.znetworks.nexus.feature.inbox.InboxApi
import id.znetworks.nexus.ui.theme.AppTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import java.io.File
import id.znetworks.nexus.feature.calendar.widget.CalendarSnapshots
import id.znetworks.nexus.feature.calendar.widget.CalendarWidgetWork
import id.znetworks.nexus.feature.calendar.widget.CalendarWidgets

/**
 * Manual dependency graph. Small enough that a DI framework would add build time and no safety;
 * revisit when the feature count makes wiring by hand error-prone.
 */
/** Cache folders holding one person's files, emptied at sign-out (FileProvider paths "shared", "evidence"). */
object SignOutFiles { val dirs = listOf("shared", "evidence") }

class AppContainer(private val context: Context) {
    val identity = ClientIdentity.current()

    /** Lives as long as the process: work that must not die with a screen (queue flush, checks). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default + kotlinx.coroutines.CoroutineExceptionHandler { _, e ->
        // A background job that throws something unexpected is logged, never a crash of the app (audit S8).
        android.util.Log.w("NEXUS", "background job failed: ${e.javaClass.simpleName}")
    })

    val sessionStore = SessionStore(
        file = File(context.noBackupFilesDir, "session/session.bin"),
        cipher = KeystoreSessionCipher(),
    )

    /** Office LAN shortcut (API.md §1.2): one host rewrite for every call, uploads included. */
    val lanRoute = LanRoute.create(context, identity, { sessionStore.current }, appScope)

    val api: ApiClient = ApiClient.production(
        identity = identity,
        sessionProvider = { sessionStore.current },
        onUnauthorized = { refused -> auth.sessionEnded(refused) },
        onUpgradeRequired = { err -> versionGate.require(err.minSupported, err.storeUrl) },
        routeInterceptor = lanRoute.interceptor,
    )

    val versionGate: VersionGate = VersionGate(
        running = identity.versionName,
        runningCode = identity.versionCode,
        storage = PrefsGateStorage(context),
        fetchPolicy = {
            // Unauthenticated: a signed-out phone must learn it is too old before it signs in.
            api.get("/api/app/version-policy", VersionPolicyResponse.serializer(), authed = false, callTimeoutMs = 8_000).android
        },
    )

    val auth = AuthRepository(api, sessionStore)

    /** Last good answers per person for reads when nobody answers (API.md §1.11); wiped on logout. */
    val responseCache = ResponseCache(File(context.cacheDir, "responses")) { sessionStore.current?.userId }.also { api.cache = it }

    val push = PushManager(context, api, identity, appScope)

    /** In-app update of the sideloaded APK (owner, 28 Sep 2026). */
    val updater = ApkUpdater(context, api, identity.versionCode)

    val router = Router()
    val viewer = Viewer(api)
    val gideon = id.znetworks.nexus.feature.gideon.GideonChat(api, appScope)
    val offline: id.znetworks.nexus.core.offline.OfflineSync by lazy {
        id.znetworks.nexus.core.offline.DiskFiles.init(context.cacheDir)
        id.znetworks.nexus.core.offline.OfflineSync(context, this)
    }
    /** Master Calendar API (ETag-aware); its held responses are forgotten at sign-out. */
    val calendar = id.znetworks.nexus.feature.calendar.CalendarApi(api)
    /** The calendar widgets' three glance snapshots (phase 4); deleted on sign-out and when the server turns widgets off. */
    val calendarSnapshots = CalendarSnapshots(File(context.filesDir, "calendar-glance"),
        fetch = { calendar.glance(it).value },
        currentUserId = { sessionStore.current?.userId },
        widgetsOn = { remoteConfig.current.calendarWidgets },
        changed = { runCatching { CalendarWidgets.updateAll(context) }; CalendarWidgetWork.scheduleRedraw(context) })

    /** Foreground, the Calendar screen loading, a widget placed: at most every 5 minutes unless [force]. */
    fun refreshCalendarWidgets(force: Boolean = false) { appScope.launch { calendarSnapshots.refresh(force) } }
    val shortcuts = id.znetworks.nexus.feature.home.ProjectShortcuts(context, { sessionStore.current?.userId }, ProjectPins(api), appScope)
    val uploads = id.znetworks.nexus.core.net.Uploads(context, api)
    val announcements = AnnouncementHost(InboxApi(api))
    val appearance = Appearance(context)

    val attendanceApi = AttendanceApi(api)
    val location = LocationProvider(context)
    val todayCache = TodayCache(File(context.noBackupFilesDir, "cache/attendance-today.json"))
    val reflectionDrafts = ReflectionDrafts(context)

    /** Live location while checked in (PRD §2.9). */
    val workTrail = WorkTrail(context, api, appScope, signedIn = { sessionStore.current != null })

    /** The home-screen widget's one funnel (iOS AttendancePresence). */
    val presence by lazy {
        id.znetworks.nexus.feature.widget.AttendancePresence(context, api, appScope,
            queue = { attendanceQueue.state.value.entries },
            hereName = { id.znetworks.nexus.feature.attendance.trail.TrailMachine.officeHere(workTrail.state)?.name },
            signedIn = { sessionStore.current != null })
    }

    /** In noBackupFilesDir, never cacheDir: an OS cache purge must never delete a check-in. */
    val attendanceQueue = AttendanceQueue(
        dir = File(context.noBackupFilesDir, "attendance-queue"),
        sender = ApiQueueSender(attendanceApi),
        currentUserId = { sessionStore.current?.userId },
        isLocked = { versionGate.state.value.required != null },
        onRefused = { LocalNotifier.queueRefused(context, it) },
        // A queued check-in that just landed is when the work-hours trail may start, and nothing
        // else fetches today at that moment.
        onCheckInLanded = { reconcileTrail() },
    )

    init {
        // Everything the widget shows moves with today, the queue, or the office the person is in.
        workTrail.onToday = { presence.refresh(it) }
        appScope.launch { attendanceQueue.state.map { it.entries.size }.distinctUntilChanged().drop(1).collect { presence.refresh() } }
        appScope.launch {
            workTrail.changes.map { id.znetworks.nexus.feature.attendance.trail.TrailMachine.officeHere(workTrail.state)?.name }
                .distinctUntilChanged().drop(1).collect { presence.refresh() }
        }
        auth.addListener(object : AuthRepository.SessionListener {
            override fun onSignedIn(session: Session) {
                // Somebody else's taps are deleted; this person's own are sent now.
                attendanceQueue.keepOnly(session.userId)
                flushQueueSoon()
                push.register()
                offline.schedule()
                offline.syncAll()
                // Pins made on the web or another device, and this phone's old local ones sent up once.
                appScope.launch { shortcuts.syncPins() }
                // The calendar widgets: this person's snapshots now, then hourly.
                CalendarWidgetWork.schedulePeriodic(context)
                refreshCalendarWidgets(force = true)
            }

            override fun onSignedOut(session: Session?, deliberate: Boolean) {
                calendar.clear()
                // No previous person's tasks may survive on a widget (expired or deliberate alike).
                calendarSnapshots.wipe()
                CalendarWidgetWork.cancel(context)
                appScope.launch { calendarSnapshots.clear() }
                // With the old cookie, before anything else forgets the session (API.md §1.3).
                val pushGone = push.unregister(session)
                // Logout revokes the token on the server too (Berlin, 29 Sep; iOS f068bbf): fire and forget,
                // with the session's own cookie, after the push device is gone (it needs that cookie).
                // Offline, a 404 while the route is new, any error: the phone signs out regardless.
                if (deliberate && session != null) appScope.launch {
                    runCatching { pushGone?.join() }
                    runCatching { auth.revokeOnServer(session) }
                }
                if (deliberate) {
                    // Logout: the phone may be handed over. Everything this person left goes.
                    attendanceQueue.clearAll()
                    QueueFlushWorker.cancel(context)
                } else {
                    // Session expired: queued taps wait for the SAME person (REQ-ATT-16).
                    attendanceQueue.holdForSignIn(session?.userId)
                }
                todayCache.clear()
                reflectionDrafts.clearAll()
                // A cached roster or task list must not outlive the session that fetched it.
                responseCache.clearAll()
                viewer.reset()
                gideon.reset()
                offline.reset()
                if (deliberate) shortcuts.clearAll()
                id.znetworks.nexus.ui.components.ImageMemory.clear()
                // Location stops with the session; unsent points go with it.
                workTrail.stopForLogout()
                // The widget must not keep this person's hours on a phone handed to somebody else.
                presence.stop()
                // Exports, opened attachments, camera shots and request evidence (audit R4, build 5):
                // private to the app, but they must not outlive the session on a phone handed over.
                SignOutFiles.dirs.forEach { File(context.cacheDir, it).deleteRecursively() }
            }
        })
    }

    /** Server-side flags, numbers and sentences (GET /api/app/config?platform=android). */
    val remoteConfig = id.znetworks.nexus.core.config.RemoteConfig(context, fetch = {
        api.get("/api/app/config?platform=android", id.znetworks.nexus.core.config.ConfigBody.serializer(), authed = false, callTimeoutMs = 8_000)
    })

    init {
        // flags.calendarWidgets off → snapshots deleted, widgets say "Open NEXUS"; back on → fetched again.
        appScope.launch {
            remoteConfig.body.map { it.calendarWidgets }.distinctUntilChanged().drop(1).collect { on ->
                if (on) refreshCalendarWidgets(force = true) else calendarSnapshots.clear()
            }
        }
    }

    /** The person's own logout is held now: a workday runs and the server's flag says to hold it. */
    fun signOutBlocked(): Boolean = remoteConfig.current.blockSignOutDuringWorkday && workdayOpen()

    /** A workday is running on this phone (see WorkdayRule). */
    fun workdayOpen(): Boolean = id.znetworks.nexus.feature.widget.WorkdayRule.open(
        attendanceQueue.state.value.entries, presence.lastToday?.today, workTrail.state.isActive, todayKnown = presence.lastToday != null)

    /** Re-reads today and lets the trail start or stop accordingly (foreground, queue replay, push). */
    fun reconcileTrail() {
        if (sessionStore.current == null) return
        appScope.launch {
            val today = runCatching { attendanceApi.today() }.getOrNull() ?: return@launch
            todayCache.save(sessionStore.current?.userId.orEmpty(), today)
            workTrail.sync(today, attendanceQueue.state.value.has(AttendanceKind.CHECK_OUT))
        }
    }

    /** Replay now if possible, and leave a network-constrained job behind in case it is not. */
    fun flushQueueSoon() {
        if (attendanceQueue.state.value.count == 0) return
        appScope.launch { attendanceQueue.flush() }
        QueueFlushWorker.schedule(context)
    }
}

private class PrefsGateStorage(context: Context) : GateStorage {
    private val prefs = context.getSharedPreferences("nexus.versionGate", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    // commit(), not apply(): a lock must be on disk before the process can be killed.
    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.commit()
    }
}

/** Light / dark / system, applied at once and kept across launches (iOS AppAppearance). */
class Appearance(context: Context) {
    private val prefs = context.getSharedPreferences("nexus.appearance", Context.MODE_PRIVATE)
    private val _theme = MutableStateFlow(runCatching { AppTheme.valueOf(prefs.getString("theme", "SYSTEM")!!) }.getOrDefault(AppTheme.SYSTEM))
    val theme: StateFlow<AppTheme> = _theme.asStateFlow()
    fun set(t: AppTheme) {
        prefs.edit().putString("theme", t.name).apply()
        _theme.value = t
    }
}

/** `/api/projects/pins` (iOS APIClient.projectPins / setProjectPin, web sidebar). */
private class ProjectPins(private val api: id.znetworks.nexus.core.net.ApiClient) : id.znetworks.nexus.feature.home.PinRemote {
    @kotlinx.serialization.Serializable private data class Pins(val projectIds: List<String> = emptyList())

    override suspend fun pins() = api.get("/api/projects/pins", Pins.serializer()).projectIds

    override suspend fun setPin(projectId: String, pinned: Boolean) {
        api.send(okhttp3.Request.Builder().url(api.url("/api/projects/pins")).post(
            kotlinx.serialization.json.buildJsonObject {
                put("projectId", kotlinx.serialization.json.JsonPrimitive(projectId)); put("pinned", kotlinx.serialization.json.JsonPrimitive(pinned))
            }.toString().toJsonBody()).build(), kotlinx.serialization.json.JsonObject.serializer())
    }

    override suspend fun projects() = runCatching {
        id.znetworks.nexus.feature.projects.ProjectsApi(api).projects().value
            .map { id.znetworks.nexus.feature.home.ShortcutRef(it.id, it.name, it.icon, it.color) }
    }.getOrNull()
}
