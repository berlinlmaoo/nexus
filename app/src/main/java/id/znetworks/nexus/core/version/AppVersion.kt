package id.znetworks.nexus.core.version

/**
 * Dotted version compared numerically per component ("0.1.10" > "0.1.9"); missing parts count as
 * 0, so "0.1" == "0.1.0". A component is read by its leading ASCII digits ("6-beta" is 6) and one
 * with none is 0, exactly like iOS `compareVersions`, so both apps judge a floor the same way and
 * nothing the server sends can make this throw.
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
        /** Null only for a blank string: "no version" must never be read as 0.0.0 and lock anyone. */
        fun parse(raw: String?): AppVersion? {
            val s = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            val parts = s.split('.').map { part ->
                part.takeWhile { it in '0'..'9' }.take(9).toIntOrNull() ?: 0
            }
            return AppVersion(parts)
        }

        /** a < b, with both readable. Anything unreadable compares as "not below". */
        fun isBelow(a: String?, b: String?): Boolean {
            val x = parse(a) ?: return false
            val y = parse(b) ?: return false
            return x < y
        }
    }
}
