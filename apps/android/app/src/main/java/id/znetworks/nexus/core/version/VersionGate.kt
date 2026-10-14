package id.znetworks.nexus.core.version

import id.znetworks.nexus.core.time.OfficeTime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * The `android` block of `GET /api/app/version-policy`. Every field optional: a policy the app
 * cannot fully read degrades to "no opinion", never to "blocked". The TOP-LEVEL fields of that
 * response are iOS's numbers and are deliberately not modelled here, so they can never be
 * compared with an Android versionName by accident.
 */
@Serializable
data class AndroidPolicy(
    val minSupported: String? = null,
    val latest: String? = null,
    val storeUrl: String? = null,
    val nextMinimum: String? = null,
    val graceUntil: String? = null,
    /**
     * The APK actually published (server current.json). The versionName can stay the same across
     * builds (owner: 0.1.6 until further notice), so the build number decides between equal names.
     */
    val latestName: String? = null,
    val latestBuild: Int? = null,
)

@Serializable
data class VersionPolicyResponse(val android: AndroidPolicy? = null)

/** Tiny persistence seam so the gate is testable on the JVM. */
interface GateStorage {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

/**
 * Forced update, ported from iOS `AppVersionGate` (PRD REQ-ATT-41/42).
 *
 * - The lock is PERSISTED (floor + the build that was locked) and restored on cold start, even
 *   offline. Only an update, or a successful policy answer with a lower floor, lifts it.
 * - A failed policy fetch changes nothing, in either direction.
 * - Any 426 UPGRADE_REQUIRED raises it at once ([require]); the server has already refused.
 */
class VersionGate(
    private val running: String?,
    private val storage: GateStorage,
    private val fetchPolicy: suspend () -> AndroidPolicy?,
    private val now: () -> Instant = Instant::now,
    private val runningCode: Int? = null,
) {
    data class Requirement(val minSupported: String, val storeUrl: String?)
    data class Grace(val nextMinimum: String, val deadline: Instant)
    data class Verdict(val required: Requirement? = null, val available: String? = null, val grace: Grace? = null)

    data class State(
        val required: Requirement? = null,
        val available: String? = null,
        val grace: Grace? = null,
        val storeUrl: String? = null,
        val checking: Boolean = false,
        val graceNoticeDue: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var lastCheckedAt: Instant? = null

    init {
        val store = storage.get(KEY_STORE)
        val floor = storage.get(KEY_FLOOR)
        var required: Requirement? = null
        if (floor != null) {
            val lockedOn = storage.get(KEY_LOCKED_ON).orEmpty()
            if (running != null && !lockLifted(running, floor, lockedOn)) {
                required = Requirement(floor, store)
            } else {
                forgetLock()
            }
        }
        _state.value = State(required = required, storeUrl = store)
    }

    /** Throttled to 30 min unless [force] (launch, sign-in, "Check again"). */
    suspend fun checkPolicy(force: Boolean = false) {
        val t = now()
        synchronized(this) {
            if (_state.value.checking) return
            val last = lastCheckedAt
            if (!force && last != null && t.isBefore(last.plusSeconds(RECHECK_SECONDS))) return
            _state.update { it.copy(checking = true) }
        }
        val policy = try {
            runCatching { fetchPolicy() }.getOrNull()
        } finally {
            _state.update { it.copy(checking = false) }
        }
        if (policy != null) {
            lastCheckedAt = now()
            apply(policy)
        }
    }

    /** Applies a policy the server actually answered with. May LOWER the gate (a rolled-back floor). */
    @Synchronized
    fun apply(policy: AndroidPolicy) {
        val t = now()
        policy.storeUrl?.takeIf { it.isNotBlank() }?.let { storage.put(KEY_STORE, it) }
        val store = storage.get(KEY_STORE)
        val running = running ?: return
        val verdict = evaluate(running, policy, t, runningCode)
        if (verdict.required != null) {
            lock(verdict.required.minSupported, verdict.required.storeUrl ?: store)
            _state.update { it.copy(available = verdict.available, grace = null, storeUrl = store) }
        } else {
            forgetLock()
            val due = verdict.grace != null && storage.get(KEY_GRACE_DAY) != OfficeTime.today(t).toString()
            _state.update {
                it.copy(required = null, available = verdict.available, grace = verdict.grace, storeUrl = store,
                    graceNoticeDue = due)
            }
        }
    }

    /** A real request came back 426 UPGRADE_REQUIRED: believed as-is. */
    @Synchronized
    fun require(minSupported: String?, storeUrl: String?) {
        storeUrl?.takeIf { it.isNotBlank() }?.let { storage.put(KEY_STORE, it) }
        val floor = minSupported?.takeIf { it.isNotBlank() } ?: _state.value.required?.minSupported.orEmpty()
        lock(floor, storage.get(KEY_STORE))
    }

    /** The once-a-day grace warning was shown; not again until tomorrow (WIB). */
    fun graceNoticeSeen() {
        storage.put(KEY_GRACE_DAY, OfficeTime.today(now()).toString())
        _state.update { it.copy(graceNoticeDue = false) }
    }

    private fun lock(floor: String, store: String?) {
        storage.put(KEY_FLOOR, floor)
        storage.put(KEY_LOCKED_ON, running.orEmpty())
        _state.update { it.copy(required = Requirement(floor, store), grace = null, storeUrl = store, graceNoticeDue = false) }
    }

    private fun forgetLock() {
        storage.put(KEY_FLOOR, null)
        storage.put(KEY_LOCKED_ON, null)
    }

    companion object {
        const val RECHECK_SECONDS = 30L * 60
        private const val KEY_FLOOR = "floor"
        private const val KEY_LOCKED_ON = "lockedOn"
        private const val KEY_STORE = "storeUrl"
        private const val KEY_GRACE_DAY = "graceShownDay"

        /**
         * Whether the build now running has moved past a persisted lock. With a floor: at or above
         * it. Without one (a 426 that named none): any build NEWER than the refused one, so the
         * refused build can never lift its own lock by relaunching.
         */
        fun lockLifted(running: String, floor: String, lockedOn: String): Boolean {
            if (floor.isNotBlank()) return !AppVersion.isBelow(running, floor)
            return lockedOn.isNotBlank() && AppVersion.isBelow(lockedOn, running)
        }

        /**
         * "Update available": a newer published name, or the same name with a higher build
         * (build 7 of 0.1.6 offered to build 6). Same name, higher build shows as "0.1.6 (7)".
         */
        fun available(running: String, runningCode: Int?, policy: AndroidPolicy): String? {
            val name = (policy.latestName ?: policy.latest)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            if (AppVersion.isBelow(running, name)) return name
            val build = policy.latestBuild ?: return null
            val sameName = !AppVersion.isBelow(name, running)
            return if (sameName && runningCode != null && build > runningCode) "$name ($build)" else null
        }

        /** Pure verdict for one policy and one running version. */
        fun evaluate(running: String, policy: AndroidPolicy, now: Instant, runningCode: Int? = null): Verdict {
            val floor = policy.minSupported?.trim()?.takeIf { it.isNotEmpty() }
            val required = if (floor != null && AppVersion.isBelow(running, floor)) {
                Requirement(floor, policy.storeUrl?.takeIf { it.isNotBlank() })
            } else null
            val available = available(running, runningCode, policy)
            val next = policy.nextMinimum?.trim()?.takeIf { it.isNotEmpty() }
            val deadline = policy.graceUntil?.let { runCatching { Instant.parse(it.trim()) }.getOrNull() }
            val grace = if (required == null && next != null && deadline != null &&
                AppVersion.isBelow(running, next) && now.isBefore(deadline)
            ) Grace(next, deadline) else null
            return Verdict(required, available, grace)
        }
    }
}
