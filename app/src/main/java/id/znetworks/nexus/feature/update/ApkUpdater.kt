package id.znetworks.nexus.feature.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.os.Build
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File
import java.security.MessageDigest

/** `GET /api/app/android/release` (session required, exempt from the 426 gate). */
@Serializable
data class AndroidRelease(
    val available: Boolean = false,
    val versionName: String? = null,
    val versionCode: Int? = null,
    val sizeBytes: Long? = null,
    val sha256: String? = null,
    val releasedAt: String? = null,
    val notes: String? = null,
    val downloadUrl: String? = null,
    val minSupported: String? = null,
    val latest: String? = null,
)

/**
 * In-app update for the sideloaded APK (owner, 28 Sep 2026): check the release, download it with the
 * session (resumable), verify it, install through PackageInstaller. The 426 lock stays as it is;
 * this is how the lock screen's button gets the new build without a browser.
 */
class ApkUpdater(
    private val context: Context,
    private val api: ApiClient,
    private val runningCode: Int,
) {
    sealed interface Step {
        data object Idle : Step
        data object Checking : Step
        data class UpToDate(val versionName: String?) : Step
        data class Downloading(val done: Long, val total: Long) : Step
        data object Verifying : Step
        /** "Install unknown apps" is off for NEXUS: the guided trip to Settings is due. */
        data object NeedsPermission : Step
        data object Installing : Step
        data class Failed(val reason: Reason, val message: String? = null) : Step
    }

    enum class Reason { NOTHING_PUBLISHED, NETWORK, CHECKSUM, WRONG_APP, NOT_NEWER, INSTALL, SIGNED_OUT }

    private val _step = MutableStateFlow<Step>(Step.Idle)
    val step: StateFlow<Step> = _step.asStateFlow()
    private val running = Mutex()

    private val dir get() = File(context.cacheDir, "updates").apply { mkdirs() }
    private val prefs = context.getSharedPreferences("nexus.updater", Context.MODE_PRIVATE)

    fun reset() {
        _step.value = Step.Idle
    }

    /** The whole flow, from check to the system's install prompt. */
    suspend fun run() {
        if (!running.tryLock()) return
        try {
            _step.value = Step.Checking
            val release = try {
                api.get("/api/app/android/release", AndroidRelease.serializer())
            } catch (e: ApiError) {
                _step.value = Step.Failed(if (e === ApiError.Unauthorized) Reason.SIGNED_OUT else Reason.NETWORK, (e as? ApiError.Http)?.serverMessage)
                return
            }
            val code = release.versionCode
            if (!release.available || code == null) { _step.value = Step.Failed(Reason.NOTHING_PUBLISHED); return }
            if (!isNewer(code, runningCode)) { _step.value = Step.UpToDate(release.versionName); return }

            val apk = File(dir, "NEXUS-${release.versionName ?: code}.apk")
            // A partial file only resumes for the same build; anything older is thrown away.
            dir.listFiles()?.filter { it != apk }?.forEach { it.delete() }
            val etagKey = "etag:${apk.name}"
            // Already complete (e.g. back from the permission screen): no second download, and no
            // Range past the end (the server would answer 416).
            val complete = release.sizeBytes != null && apk.exists() && apk.length() == release.sizeBytes
            if (!complete) try {
                val etag = api.download(release.downloadUrl ?: "/api/app/android/apk", apk, prefs.getString(etagKey, null)) { done, total ->
                    _step.value = Step.Downloading(done, total)
                }
                prefs.edit().putString(etagKey, etag).apply()
            } catch (e: ApiError) {
                // Kept on disk: the next try continues where this one stopped.
                _step.value = Step.Failed(Reason.NETWORK, (e as? ApiError.Http)?.serverMessage)
                return
            }

            _step.value = Step.Verifying
            val problem = withContext(Dispatchers.IO) { verify(apk, release) }
            if (problem != null) {
                apk.delete()
                prefs.edit().remove(etagKey).apply()
                _step.value = Step.Failed(problem)
                return
            }
            if (!canInstall()) { _step.value = Step.NeedsPermission; return }
            _step.value = Step.Installing
            withContext(Dispatchers.IO) { install(apk) }
        } finally {
            running.unlock()
        }
    }

    fun canInstall(): Boolean = Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

    /** Checksum, package, signing certificate and version: a wrong or tampered file never reaches the installer. */
    private fun verify(apk: File, release: AndroidRelease): Reason? {
        release.sha256?.takeIf { it.isNotBlank() }?.let { expected ->
            if (!sha256(apk).equals(expected.replace(":", ""), ignoreCase = true)) return Reason.CHECKSUM
        }
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(apk.path, flags) ?: return Reason.WRONG_APP
        if (archive.packageName != context.packageName) return Reason.WRONG_APP
        val installed = runCatching { pm.getPackageInfo(context.packageName, flags) }.getOrNull() ?: return Reason.WRONG_APP
        if (signers(archive) != signers(installed)) return Reason.WRONG_APP
        if (!isNewer(versionCode(archive), runningCode)) return Reason.NOT_NEWER
        return null
    }

    private fun install(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("nexus.apk", 0, apk.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val intent = Intent(context, InstallResultReceiver::class.java)
            // Mutable: the installer fills in the status and the confirmation intent.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            session.commit(PendingIntent.getBroadcast(context, id, intent, flags).intentSender)
        }
    }

    internal fun installFailed(message: String?) {
        _step.value = Step.Failed(Reason.INSTALL, message)
    }

    companion object {
        fun isNewer(candidate: Int, running: Int) = candidate > running

        fun sha256(f: File): String {
            val md = MessageDigest.getInstance("SHA-256")
            f.inputStream().use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    md.update(buf, 0, n)
                }
            }
            return md.digest().joinToString("") { "%02x".format(it) }
        }

        @Suppress("DEPRECATION")
        private fun signers(p: PackageInfo): Set<String> {
            val sigs = if (Build.VERSION.SDK_INT >= 28) {
                p.signingInfo?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory }
            } else p.signatures
            return sigs.orEmpty().map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { b -> "%02x".format(b) } }.toSet()
        }

        @Suppress("DEPRECATION")
        private fun versionCode(p: PackageInfo): Int = if (Build.VERSION.SDK_INT >= 28) p.longVersionCode.toInt() else p.versionCode
    }
}

/** PackageInstaller's answer: show the system confirmation, or report a failure. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val updater = (context.applicationContext as id.znetworks.nexus.NexusApplication).container.updater
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else intent.getParcelableExtra(Intent.EXTRA_INTENT)
                confirm?.let { runCatching { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // the app is replaced and restarted by the system
            else -> updater.installFailed(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }
}
