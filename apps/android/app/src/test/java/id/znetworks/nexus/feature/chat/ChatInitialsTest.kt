package id.znetworks.nexus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Test

/** DM names and initials like the web / iOS messages list (run 5: "?" avatars and a DM called "—"). */
class ChatInitialsTest {
    private fun dm(name: String?, vararg members: Pair<String, String?>) =
        Conversation("c", "DM", name, members = members.map { (id, n) -> ChatMember(userId = id, user = ChatUser(id, n)) })

    @Test fun titlesAndInitials() {
        val me = "me"
        // The other person is known: their name.
        assertEquals("Budi Z", dm(null, "z" to "Budi Z", me to "Budi Santoso").title(me, "Direct message"))
        // Only me in the member list: the room's name, else "Direct message".
        assertEquals("BZ", dm("Budi Z", me to "Budi Santoso").initials(me, "Direct message"))
        assertEquals("Direct message", dm(null, me to "Budi Santoso").title(me, "Direct message"))
        assertEquals("DM", dm(null, me to "Budi Santoso").initials(me, "Direct message"))
        assertEquals("M", ChatInitials.of("Mira"))
        assertEquals("?", ChatInitials.of("  "))
    }
}
