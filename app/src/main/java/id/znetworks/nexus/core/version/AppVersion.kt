package id.znetworks.nexus.core.version

/**
 * Dotted version compared numerically per component ("0.1.10" > "0.1.9"); missing parts count as
 * 0, so "0.1" == "0.1.0". Mirrors iOS AppVersionGate so both apps judge a floor the same way.
 */
class AppVersion private constructor(private val parts: List<Int>) : Comparable<AppVersion> {

    override fun compareTo(other: AppVersion): Int {
        val n = maxOf(parts.size, other.parts.size)
        for (i in 0 until n) {
            val a = parts.getOrElse(i) { 0 }
            val b = other.parts.getOrElse(i) { 0 }
            if (a != b) return a.compareTo(b)
        }
        return 0
    }

    override fun equals(other: Any?) = other is AppVersion && compareTo(other) == 0
    override fun hashCode() = parts.dropLastWhile { it == 0 }.hashCode()
    override fun toString() = parts.joinToString(".")

    companion object {
        /** Null for anything that is not digits-and-dots: an unreadable floor must never lock anyone. */
        fun parse(raw: String?): AppVersion? {
            val s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            val parts = s.split('.').map { it.toIntOrNull()?.takeIf { n -> n >= 0 } ?: return null }
            return AppVersion(parts)
        }
    }
}
