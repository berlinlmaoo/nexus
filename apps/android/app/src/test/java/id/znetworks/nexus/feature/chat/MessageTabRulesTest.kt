package id.znetworks.nexus.feature.chat

import org.junit.Assert.*
import org.junit.Test

class MessageTabRulesTest {
    @Test fun unreadIsSummedByTypeAndExcludesActiveMutes() {
        val rooms = listOf(Conversation("a", unreadCount = 3), Conversation("b", unreadCount = 8, mutedUntil = "2100-01-01T00:00:00Z"), Conversation("c", type = "GROUP", unreadCount = 5), Conversation("d", unreadCount = 2, mutedUntil = "2000-01-01T00:00:00Z"))
        assertEquals(5, MessageTabRules.unread(rooms, "DM", 1_000_000_000_000L))
        assertEquals(5, MessageTabRules.unread(rooms, "GROUP", 1_000_000_000_000L))
        assertEquals(0, MessageTabRules.unread(rooms, "PROJECT"))
    }
    @Test fun defaultsDirectAndRestoresKnownTab() {
        assertEquals(0, MessageTabRules.restored(null))
        assertEquals(0, MessageTabRules.restored("bad"))
        assertEquals(2, MessageTabRules.restored("PROJECT"))
    }
    @Test fun departedPeerRetainsNameAndAvatarWithoutCombiningDifferentRooms() {
        val a = Conversation("a", peer = ChatPeer("old-account", "Bagas Z", "photo", left = true))
        val b = Conversation("b", peer = ChatPeer("new-account", "Bagas Z"))
        assertEquals("Bagas Z", a.title("me"))
        assertEquals("photo", a.other("me")?.avatar)
        assertEquals("old-account", a.other("me")?.id)
        assertNotEquals(a.other("me")?.id, b.other("me")?.id)
        assertNotEquals(a.id, b.id)
        assertEquals("Fallback", Conversation("c", name = "").title("me", "Fallback"))
    }
}
