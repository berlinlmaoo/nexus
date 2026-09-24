package id.znetworks.nexus.core

import android.content.Context
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ClientIdentity
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

/**
 * Manual dependency graph. Small enough that a DI framework would add build time and no safety;
 * revisit when the feature count makes wiring by hand error-prone.
 */
class AppContainer(private val context: Context) {
    val identity = ClientIdentity.current()

    /** Lives as long as the process: work that must not die with a screen (queue flush, checks). */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val sessionStore = SessionStore(
        file = File(context.noBackupFilesDir, "session/session.bin"),
        cipher = KeystoreSessionCipher(),
    )

    val api: ApiClient = ApiClient.production(
        identity = identity,
        sessionProvider = { sessionStore.current },
        onUnauthorized = { refused -> auth.sessionEnded(refused) },
        onUpgradeRequired = { err -> versionGate.require(err.minSupported, err.storeUrl) },
    )

    val versionGate: VersionGate = VersionGate(
        running = identity.versionName,
        storage = PrefsGateStorage(context),
        fetchPolicy = {
            // Unauthenticated: a signed-out phone must learn it is too old before it signs in.
            api.get("/api/app/version-policy", VersionPolicyResponse.serializer(), authed = false, callTimeoutMs = 8_000).android
        },
    )

    val auth = AuthRepository(api, sessionStore)

    val attendanceApi = AttendanceApi(api)
    val location = LocationProvider(context)
    val todayCache = TodayCache(File(context.noBackupFilesDir, "cache/attendance-today.json"))
    val reflectionDrafts = ReflectionDrafts(context)

    /** Live location while checked in (PRD §2.9). */
    val workTrail = WorkTrail(context, api, appScope, signedIn = { sessionStore.current != null })

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
        auth.addListener(object : AuthRepository.SessionListener {
            override fun onSignedIn(session: Session) {
                // Somebody else's taps are deleted; this person's own are sent now.
                attendanceQueue.keepOnly(session.userId)
                flushQueueSoon()
            }

            override fun onSignedOut(session: Session?, deliberate: Boolean) {
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
                // Location stops with the session; unsent points go with it.
                workTrail.stopForLogout()
            }
        })
    }

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
