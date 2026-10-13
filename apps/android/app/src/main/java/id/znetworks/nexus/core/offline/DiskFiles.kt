package id.znetworks.nexus.core.offline

import java.io.File
import java.security.MessageDigest

/**
 * The phone's offline copy of session-only files (selfies, attachments, vault files): keyed by
 * URL, under the app's cache, per signed-in session (wiped at logout with everything else).
 */
object DiskFiles {
    @Volatile private var root: File? = null

    fun init(cacheDir: File) { root = File(cacheDir, "offline").apply { mkdirs() } }

    private fun key(url: String) = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }

    /** Where [url] lives on disk (it may not exist yet). [name] keeps the extension for viewers. */
    fun fileFor(url: String, name: String = "file"): File? = root?.let { r ->
        File(File(r, key(url)).apply { mkdirs() }, name.replace("/", "_").ifBlank { "file" })
    }

    /** An already-downloaded copy, whatever it was named. */
    fun existing(url: String): File? = root?.let { File(it, key(url)) }?.listFiles()?.firstOrNull { it.length() > 0 }

    fun bytes(): Long = root?.walkTopDown()?.filter { it.isFile }?.sumOf { it.length() } ?: 0L

    /** Oldest first until under [capBytes]. */
    fun sweep(capBytes: Long) {
        val files = root?.walkTopDown()?.filter { it.isFile }?.sortedBy { it.lastModified() }?.toMutableList() ?: return
        var total = files.sumOf { it.length() }
        while (total > capBytes && files.isNotEmpty()) { val f = files.removeAt(0); total -= f.length(); f.delete() }
    }

    fun clear() { root?.deleteRecursively(); root?.mkdirs() }
}
