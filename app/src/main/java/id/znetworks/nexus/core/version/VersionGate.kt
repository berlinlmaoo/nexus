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
     * Build-number floor and latest (versionCode). Android keeps versionName 0.1.6 and raises only
     * versionCode per APK, so a name comparison can never tell build 2 from build 3. Read when the
     * server sends them (SERVER-REQUESTS: OPEN); absent, the name rules above apply alone.
     */
    val minBuild: Int? = null,
    val latestBuild: Int? = null,
    val nextMinimumBuild: Int? = null,
)

/** The published APK as `GET /api/app/android/release` describes it: what "Update available" compares. */
data class ReleaseBuild(val versionName: String?, val versionCode: Int)

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
    /** The running versionCode: builds share one versionName, so this is what "newer" means. */
    private val runningCode: Int? = null,
    /** The published APK (signed in only); null when unknown. Never locks anything, only offers. */
    private val fetchRelease: suspend () -> ReleaseBuild? = { null },
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
            if (running != null && !lockLifted(running, floor, lockedOn, runningCode, storage.get(KEY_FLOOR_BUILD)?.toIntOrNull())) {
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
        // "Update available" by build: 0.1.6 (2) → 0.1.6 (3) is invisible to any name comparison.
        val release = runCatching { fetchRelease() }.getOrNull()
        offerFromRelease(release)
    }

    /** A published build newer than this one becomes "Update available" (the lock is the policy's alone). */
    @Synchronized
    fun offerFromRelease(release: ReleaseBuild?) {
        val label = releaseOffer(release, runningCode) ?: return
        _state.update { it.copy(available = label) }
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
            lock(verdict.required.minSupported, verdict.required.storeUrl ?: store, policy.minBuild)
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

    private fun lock(floor: String, store: String?, floorBuild: Int? = null) {
        storage.put(KEY_FLOOR, floor)
        storage.put(KEY_FLOOR_BUILD, floorBuild?.toString())
        storage.put(KEY_LOCKED_ON, running.orEmpty())
        _state.update { it.copy(required = Requirement(floor, store), grace = null, storeUrl = store, graceNoticeDue = false) }
    }

    private fun forgetLock() {
        storage.put(KEY_FLOOR, null)
        storage.put(KEY_FLOOR_BUILD, null)
        storage.put(KEY_LOCKED_ON, null)
    }

    companion object {
        const val RECHECK_SECONDS = 30L * 60
        private const val KEY_FLOOR = "floor"
        private const val KEY_FLOOR_BUILD = "floorBuild"
        private const val KEY_LOCKED_ON = "lockedOn"
        private const val KEY_STORE = "storeUrl"
        private const val KEY_GRACE_DAY = "graceShownDay"

        /**
         * Whether the build now running has moved past a persisted lock. With a floor: at or above
         * it. Without one (a 426 that named none): any build NEWER than the refused one, so the
         * refused build can never lift its own lock by relaunching.
         */
        fun lockLifted(running: String, floor: String, lockedOn: String, runningCode: Int? = null, floorBuild: Int? = null): Boolean {
            // A build floor holds until a build at or above it runs (same versionName, higher code).
            if (floorBuild != null && runningCode != null && runningCode < floorBuild) return false
            if (floor.isNotBlank()) return !AppVersion.isBelow(running, floor)
            return lockedOn.isNotBlank() && AppVersion.isBelow(lockedOn, running)
        }

        /** Pure verdict for one policy and one running version. */
        fun evaluate(running: String, policy: AndroidPolicy, now: Instant, runningCode: Int? = null): Verdict {
            val floor = policy.minSupported?.trim()?.takeIf { it.isNotEmpty() }
            val belowBuild = policy.minBuild != null && runningCode != null && runningCode < policy.minBuild
            val required = if (floor != null && (AppVersion.isBelow(running, floor) || belowBuild)) {
                Requirement(floor, policy.storeUrl?.takeIf { it.isNotBlank() })
            } else if (belowBuild) Requirement(running, policy.storeUrl?.takeIf { it.isNotBlank() }) else null
            val latest = policy.latest?.trim()?.takeIf { it.isNotEmpty() }
            val available = latest?.takeIf { AppVersion.isBelow(running, it) }
                ?: policy.latestBuild?.takeIf { runningCode != null && it > runningCode }?.let { "${latest ?: running} ($it)" }
            val next = policy.nextMinimum?.trim()?.takeIf { it.isNotEmpty() }
            val deadline = policy.graceUntil?.let { runCatching { Instant.parse(it.trim()) }.getOrNull() }
            val belowNextBuild = policy.nextMinimumBuild != null && runningCode != null && runningCode < policy.nextMinimumBuild
            val grace = if (required == null && next != null && deadline != null &&
                (AppVersion.isBelow(running, next) || belowNextBuild) && now.isBefore(deadline)
            ) Grace(next, deadline) else null
            return Verdict(required, available, grace)
        }

        /** "0.1.6 (3)" when the published build's versionCode is above the running one; else null. */
        fun releaseOffer(release: ReleaseBuild?, runningCode: Int?): String? {
            if (release == null || runningCode == null || release.versionCode <= runningCode) return null
            return "${release.versionName ?: ""} (${release.versionCode})".trim()
        }
    }
}
