package id.znetworks.nexus.feature.chat

/**
 * How an open thread keeps its messages (CHAT-REPORT: "poll merges only the latest 50" lost messages).
 * Pure, so it is tested.
 */
object ChatMerge {
    /** Every message once (by id), oldest first: (createdAt, id). Nothing already held is ever dropped. */
    fun merge(held: List<Message>, incoming: List<Message>): List<Message> =
        (held.associateBy { it.id } + incoming.associateBy { it.id }).values
            .sortedWith(compareBy<Message>({ it.createdAt.orEmpty() }, { it.id }))

    /**
     * A poll answer leaves a hole: a full page whose oldest message is newer than the newest one held, with
     * none of the held ids in it (an older server that ignored `after`, after a long pause). The thread then
     * pages back with `before` until the pages overlap.
     */
    fun gap(held: List<Message>, page: List<Message>, pageSize: Int): Boolean {
        if (held.isEmpty() || page.size < pageSize) return false
        val ids = held.mapTo(HashSet()) { it.id }
        if (page.any { it.id in ids }) return false
        val newestHeld = held.maxOf { it.createdAt.orEmpty() }
        return page.minOf { it.createdAt.orEmpty() } > newestHeld
    }

    /** What `before` to ask for the page older than [messages]: the server's cursor, else the oldest createdAt. */
    fun before(messages: List<Message>, nextCursor: String?): String? = nextCursor ?: messages.firstOrNull()?.createdAt
}
