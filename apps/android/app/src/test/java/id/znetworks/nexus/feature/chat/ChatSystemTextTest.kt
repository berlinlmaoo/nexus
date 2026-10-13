package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** SYSTEM-MESSAGES (Berlin, 8 Oct): every event in both languages, "You"/"Kamu" for the reader (iOS Tests/ChatSystemText). */
class ChatSystemTextTest {
    private val en = ChatSystemText.Words("You", "you", "and", "%1\$s added %2\$s", "%1\$s removed %2\$s", "%1\$s left",
        "%1\$s created the group", "%1\$s created the group “%2\$s”", "%1\$s renamed the group to “%2\$s”")
    private val id = ChatSystemText.Words("Kamu", "kamu", "dan", "%1\$s menambahkan %2\$s", "%1\$s mengeluarkan %2\$s", "%1\$s keluar",
        "%1\$s membuat grup", "%1\$s membuat grup “%2\$s”", "%1\$s mengubah nama grup jadi “%2\$s”")
    private fun p(id: String, name: String) = ChatSystemEvent.Person(id, name)
    private val bagas = p("b", "Bagas Putro"); private val mey = p("m", "Mey"); private val yuza = p("y", "Yuza"); private val angela = p("a", "Angela")
    private fun s(e: ChatSystemEvent, me: String? = "viewer", w: ChatSystemText.Words = en) = ChatSystemText.sentence(e, "FALLBACK", me, w)

    @Test fun added() {
        val e = ChatSystemEvent("members_added", bagas, listOf(mey, yuza, angela))
        assertEquals("Bagas Putro added Mey, Yuza and Angela", s(e))
        assertEquals("Bagas Putro menambahkan Mey, Yuza dan Angela", s(e, w = id))
        assertEquals("You added Mey, Yuza and Angela", s(e, me = "b"))
        assertEquals("Bagas Putro added you, Yuza and Angela", s(e, me = "m"))
        assertEquals("Bagas Putro menambahkan kamu", s(ChatSystemEvent("members_added", bagas, listOf(mey)), me = "m", w = id))
        // The same person twice is named once.
        assertEquals("Bagas Putro added Mey", s(ChatSystemEvent("members_added", bagas, listOf(mey, mey))))
    }

    @Test fun removedLeftCreatedRenamed() {
        assertEquals("Bagas Putro removed Mey", s(ChatSystemEvent("member_removed", bagas, listOf(mey))))
        assertEquals("Bagas Putro mengeluarkan kamu", s(ChatSystemEvent("member_removed", bagas, listOf(mey)), me = "m", w = id))
        assertEquals("Mey left", s(ChatSystemEvent("member_left", mey)))
        assertEquals("Kamu keluar", s(ChatSystemEvent("member_left", null, listOf(mey)), me = "m", w = id))
        assertEquals("Bagas Putro created the group “QA”", s(ChatSystemEvent("group_created", bagas, listOf(mey), name = "QA")))
        assertEquals("Kamu membuat grup", s(ChatSystemEvent("group_created", bagas), me = "b", w = id))
        assertEquals("Bagas Putro mengubah nama grup jadi “QA baru”", s(ChatSystemEvent("group_renamed", bagas, name = "QA baru", previousName = "QA"), w = id))
    }

    @Test fun anythingUnclearIsTheServersSentence() {
        assertEquals("FALLBACK", ChatSystemText.sentence(null, "FALLBACK", "v", en))
        assertEquals("FALLBACK", s(ChatSystemEvent("pinned_message", bagas)))
        assertEquals("FALLBACK", s(ChatSystemEvent("members_added", bagas, listOf(p("x", " ")))))
        assertEquals("FALLBACK", s(ChatSystemEvent("group_renamed", bagas)))
        assertEquals("FALLBACK", s(ChatSystemEvent("members_added", null, listOf(mey))))
    }

    @Test fun messagesCarryKindAndEvent() {
        val m = NexusJson.decodeFromString(Message.serializer(), """{"id":"1","content":"Bagas Putro menambahkan Mey ke grup","kind":"SYSTEM",
            "event":{"type":"members_added","actor":{"id":"b","name":"Bagas Putro"},"targets":[{"id":"m","name":"Mey"}],"extra":1}}""")
        assertTrue(m.isSystem); assertEquals("members_added", m.event?.type); assertEquals("Mey", m.event?.targets?.single()?.name)
        // An older server: no kind = a person's message, as before.
        assertFalse(NexusJson.decodeFromString(Message.serializer(), """{"id":"2","content":"hi"}""").isSystem)
        // A shape this build doesn't expect never costs the thread the message.
        val odd = NexusJson.decodeFromString(Message.serializer(), """{"id":"3","content":"x","kind":"SYSTEM","event":{"type":"members_added","targets":"oops"}}""")
        assertTrue(odd.isSystem)
    }
}
