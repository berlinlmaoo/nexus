package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChatModelsTest {
    @Test fun payloadsRoundTrip() {
        assertEquals(ChatPayload.Location(-6.2, 106.8), ChatPayload.parse(ChatPayload.location(-6.2, 106.8, "Lokasi saya")))
        assertEquals(ChatPayload.Task("t1", "Invoice"), ChatPayload.parse(ChatPayload.task("t1", "Invoice")))
        assertEquals(ChatPayload.Plain, ChatPayload.parse("hello google.com/maps?q=abc"))
    }

    @Test fun mentionTyping() {
        assertEquals("ali", Mentions.query("hi @ali"))
        assertEquals("", Mentions.query("hi @"))
        assertNull(Mentions.query("mail a@b"))
        assertNull(Mentions.query("hi @ali done"))
        assertEquals("hi @AliFawan ", Mentions.insert("hi @ali", "Ali Fawan"))
        assertEquals("ok @Budi ", Mentions.insert("ok", "Budi"))
        assertEquals(listOf("u1"), Mentions.ids("hey @Budi", mapOf("u1" to "@Budi", "u2" to "@Citra")))
    }

    @Test fun dmTitleIsTheOtherPerson() {
        val c = Conversation("c", "DM", members = listOf(ChatMember(userId = "me", user = ChatUser("me", "Me")), ChatMember(userId = "u", user = ChatUser("u", "Budi"))))
        assertEquals("Budi", c.title("me"))
        assertEquals("Tim A", c.copy(type = "GROUP", name = "Tim A").title("me"))
    }

    @Test fun messageLinks() {
        assertEquals(Target.Chat("c1"), Links.parse("/messages?c=c1"))
        assertEquals(Target.Chat(null), Links.parse("/messages"))
        assertEquals(Target.Chat(null), Links.forNotification("MESSAGE", null, null, null))
    }
}
