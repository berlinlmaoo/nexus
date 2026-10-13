package id.znetworks.nexus.core.net

import java.io.File

/**
 * The raw bytes of the last response that decoded, one file per key and per person (API.md §1.11,
 * iOS `ResponseCache`). Screens read it only when nobody answered, and say "Saved copy from HH:mm".
 * Wiped on logout: a roster or a task list must not outlive the session that fetched it.
 */
class ResponseCache(private val dir: File, private val userId: () -> String?) {
    data class Hit(val body: String, val savedAtMillis: Long)

    private fun file(key: String): File? {
        val uid = userId() ?: return null
        val safe = key.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return File(File(dir, uid.replace(Regex("[^A-Za-z0-9_-]"), "_")), "$safe.json")
    }

    fun save(key: String, body: String) {
        // Entries over 8 MB are not stored, as on iOS.
        if (body.length > 8 * 1024 * 1024) return
        val f = file(key) ?: return
        runCatching {
            f.parentFile?.mkdirs()
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(body)
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        }
    }

    fun load(key: String): Hit? {
        val f = file(key)?.takeIf { it.exists() } ?: return null
        return runCatching { Hit(f.readText(), f.lastModified()) }.getOrNull()
    }

    fun clearAll() {
        dir.deleteRecursively()
    }
}
