package id.znetworks.nexus.feature.inbox

/** Older rows predate bilingual `texts`. Translate known notification templates only; names and
 * task/document content stay verbatim, and unknown text stays as stored. */
internal object InboxLegacyText {
    fun translate(raw: String?, lang: String): String? {
        if (raw == null || lang != "id") return raw
        val templates = listOf(
            "New legal request from " to "Permintaan Legal baru dari ",
            " assigned you: " to " menugaskan kamu: ",
            " assigned you \"" to " menugaskan kamu \"",
            " commented on " to " mengomentari ",
        )
        for ((english, indonesian) in templates) {
            if (english.startsWith("New ")) {
                if (raw.startsWith(english)) return indonesian + raw.removePrefix(english)
            } else {
                val at = raw.indexOf(english)
                if (at > 0) return raw.take(at) + indonesian + raw.substring(at + english.length)
            }
        }
        return raw
    }
}
