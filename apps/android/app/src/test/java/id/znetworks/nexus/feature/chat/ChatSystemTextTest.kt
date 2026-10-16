package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** SYSTEM-MESSAGES (owner, 8 Oct): every event in both languages, "You"/"Kamu" for the reader (iOS Tests/ChatSystemText). */
class ChatSystemTextTest {
    private val en = ChatSystemText.Words("You", "you", "and", "%1\$s added %2\$s", "%1\$s removed %2\$s", "%1\$s left",
        "%1\$s created the group", "%1\$s created the group “%2\$s”", "%1\$s renamed the group to “%2\$s”")
    private val id = ChatSystemText.Words("Kamu", "kamu", "dan", "%1\$s menambahkan %2\$s", "%1\$s mengeluarkan %2\$s", "%1\$s keluar",
        "%1\$s membuat grup", "%1\$s membuat grup “%2\$s”", "%1\$s mengubah nama grup jadi “%2\$s”")
    private fun p(id: String, name: String) = ChatSystemEvent.Person(id, name)
    private val budi = p("b", "Budi Santoso"); private val mira = p("m", "Mira"); private val yoga = p("y", "Yoga"); private val anita = p("a", "Anita")
    private fun s(e: ChatSystemEvent, me: String? = "viewer", w: ChatSystemText.Words = en) = ChatSystemText.sentence(e, "FALLBACK", me, w)

    @Test fun added() {
        val e = ChatSystemEvent("members_added", budi, listOf(mira, yoga, anita))
        assertEquals("Budi Santoso added Mira, Yoga and Anita", s(e))
        assertEquals("Budi Santoso menambahkan Mira, Yoga dan Anita", s(e, w = id))
        assertEquals("You added Mira, Yoga and Anita", s(e, me = "b"))
        assertEquals("Budi Santoso added you, Yoga and Anita", s(e, me = "m"))
        assertEquals("Budi Santoso menambahkan kamu", s(ChatSystemEvent("members_added", budi, listOf(mira)), me = "m", w = id))
        // The same person twice is named once.
        assertEquals("Budi Santoso added Mira", s(ChatSystemEvent("members_added", budi, listOf(mira, mira))))
    }

    @Test fun removedLeftCreatedRenamed() {
        assertEquals("Budi Santoso removed Mira", s(ChatSystemEvent("member_removed", budi, listOf(mira))))
        assertEquals("Budi Santoso mengeluarkan kamu", s(ChatSystemEvent("member_removed", budi, listOf(mira)), me = "m", w = id))
        assertEquals("Mira left", s(ChatSystemEvent("member_left", mira)))
        assertEquals("Kamu keluar", s(ChatSystemEvent("member_left", null, listOf(mira)), me = "m", w = id))
        assertEquals("Budi Santoso created the group “QA”", s(ChatSystemEvent("group_created", budi, listOf(mira), name = "QA")))
        assertEquals("Kamu membuat grup", s(ChatSystemEvent("group_created", budi), me = "b", w = id))
        assertEquals("Budi Santoso mengubah nama grup jadi “QA baru”", s(ChatSystemEvent("group_renamed", budi, name = "QA baru", previousName = "QA"), w = id))
    }

    @Test fun anythingUnclearIsTheServersSentence() {
        assertEquals("FALLBACK", ChatSystemText.sentence(null, "FALLBACK", "v", en))
        assertEquals("FALLBACK", s(ChatSystemEvent("pinned_message", budi)))
        assertEquals("FALLBACK", s(ChatSystemEvent("members_added", budi, listOf(p("x", " ")))))
        assertEquals("FALLBACK", s(ChatSystemEvent("group_renamed", budi)))
        assertEquals("FALLBACK", s(ChatSystemEvent("members_added", null, listOf(mira))))
    }

    @Test fun messagesCarryKindAndEvent() {
        val m = NexusJson.decodeFromString(Message.serializer(), """{"id":"1","content":"Budi Santoso menambahkan Mira ke grup","kind":"SYSTEM",
            "event":{"type":"members_added","actor":{"id":"b","name":"Budi Santoso"},"targets":[{"id":"m","name":"Mira"}],"extra":1}}""")
        assertTrue(m.isSystem); assertEquals("members_added", m.event?.type); assertEquals("Mira", m.event?.targets?.single()?.name)
        // An older server: no kind = a person's message, as before.
        assertFalse(NexusJson.decodeFromString(Message.serializer(), """{"id":"2","content":"hi"}""").isSystem)
        // A shape this build doesn't expect never costs the thread the message.
        val odd = NexusJson.decodeFromString(Message.serializer(), """{"id":"3","content":"x","kind":"SYSTEM","event":{"type":"members_added","targets":"oops"}}""")
        assertTrue(odd.isSystem)
    }
}
