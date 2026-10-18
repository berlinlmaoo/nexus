package id.znetworks.nexus.feature.auth

/** Settings › Profile: the phone number as the web takes it (`phoneNumber: phone.trim() || null`). */
object PhoneRules {
    /** Same display grouping as web phone-format.ts; other country codes stay as entered. */
    fun display(raw: String?): String {
        val text = raw.orEmpty().trim()
        val digits = text.filter(Char::isDigit)
        val national = when {
            text.startsWith("+") -> if (digits.startsWith("62")) digits.drop(2) else null
            digits.startsWith("62") -> digits.drop(2)
            digits.startsWith("0") -> digits.drop(1)
            else -> null
        } ?: return text
        if (national.length !in 6..13 || text.any { !it.isDigit() && !it.isWhitespace() && it !in "+().-" }) return text
        val rest = national.drop(3)
        val count = rest.length
        val sizes = when { count <= 4 -> listOf(count); count <= 8 -> listOf((count + 1) / 2, count / 2); count == 9 -> listOf(3, 3, 3); else -> listOf(4, 4, count - 8) }
        var offset = 0
        val parts = listOf(national.take(3)) + sizes.map { size -> rest.substring(offset, offset + size).also { offset += size } }
        return "+62 " + parts.filter { it.isNotEmpty() }.joinToString("-")
    }
    sealed interface Result {
        /** Saved as typed (trimmed); null clears it. */
        data class Ok(val value: String?) : Result
        data object Invalid : Result
    }

    /**
     * As the web: whatever is typed is sent (trimmed) and the server decides; blank clears the number. The app is
     * never stricter than the server.
     */
    fun check(raw: String): Result = Result.Ok(raw.trim().ifEmpty { null })
}

/**
 * What a session row in Settings › Security › Active sessions is (port of the web's lib/device-label.ts): the
 * NEXUS app from its X-Nexus-Client tag (or the old iOS / okhttp User-Agent), else a browser on an OS.
 */
sealed interface DeviceLabel {
    enum class Kind { PHONE, TABLET, DESKTOP, UNKNOWN }
    val kind: Kind
    data class App(val platform: String, val version: String?, val build: String?, override val kind: Kind) : DeviceLabel
    data class Browser(val browser: String?, val os: String?, override val kind: Kind) : DeviceLabel
    data object Unknown : DeviceLabel { override val kind = Kind.UNKNOWN }

    companion object {
        private val APP_TAG = Regex("^(ios|android)/(\\d+(?:\\.\\d+){0,2})[^/\\s]*(?:/([^/\\s]+))?", RegexOption.IGNORE_CASE)

        fun describe(userAgent: String?, client: String?): DeviceLabel {
            val ua = userAgent.orEmpty()
            APP_TAG.find(client.orEmpty().trim())?.let { m ->
                val platform = m.groupValues[1].lowercase()
                val kind = when {
                    Regex("iPad|Tablet", RegexOption.IGNORE_CASE).containsMatchIn(ua) -> Kind.TABLET
                    platform == "ios" && Regex("Macintosh|Mac OS X", RegexOption.IGNORE_CASE).containsMatchIn(ua) && !Regex("iPhone", RegexOption.IGNORE_CASE).containsMatchIn(ua) -> Kind.DESKTOP
                    else -> Kind.PHONE
                }
                return App(platform, m.groupValues[2], m.groupValues[3].ifEmpty { null }, kind)
            }
            // iOS 0.1.5 and older: URLSession's default `NEXUS/<build> CFNetwork/… Darwin/…`.
            Regex("^NEXUS/(\\d+)\\b").find(ua)?.let { return App("ios", null, it.groupValues[1], Kind.PHONE) }
            // The Android app without the header (okhttp).
            if (Regex("^okhttp/", RegexOption.IGNORE_CASE).containsMatchIn(ua)) return App("android", null, null, Kind.PHONE)
            if (ua.isEmpty()) return Unknown
            fun has(p: String) = Regex(p).containsMatchIn(ua)
            val browser = when {
                has("EdgA?/|EdgiOS/") -> "Edge"
                has("OPR/|Opera") -> "Opera"
                has("SamsungBrowser/") -> "Samsung Internet"
                has("Firefox/|FxiOS/") -> "Firefox"
                has("Chrome/|CriOS/") -> "Chrome"
                has("Safari/") && has("Version/") -> "Safari"
                else -> null
            }
            val os = when {
                has("iPad") -> "iPadOS"
                has("iPhone|iPod") -> "iOS"
                has("Android") -> "Android"
                has("Windows") -> "Windows"
                has("CrOS") -> "ChromeOS"
                has("Macintosh|Mac OS X") -> "macOS"
                has("Linux") -> "Linux"
                else -> null
            }
            val kind = when {
                has("iPad|Tablet") || (has("Android") && !has("Mobile")) -> Kind.TABLET
                has("iPhone|iPod|Mobile|Android") -> Kind.PHONE
                os != null -> Kind.DESKTOP
                else -> Kind.UNKNOWN
            }
            if (browser == null && os == null) return Unknown
            return Browser(browser, os, kind)
        }
    }
}

/** "Active now" under 5 minutes (the server writes lastActiveAt at most every 5), else a relative time. */
object SessionTime {
    fun activeNow(lastActiveMs: Long, nowMs: Long) = nowMs - lastActiveMs < 5 * 60_000
}
