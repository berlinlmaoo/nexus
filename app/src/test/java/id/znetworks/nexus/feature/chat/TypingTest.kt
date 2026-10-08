package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.realtime.RealtimeEvents
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** TYPING.md (Berlin, 9 Oct): who is typing, when this phone says so, what the thread reads. */
class TypingTest {
    private var clock = 0L
    private fun ev(json: String) = RealtimeEvents.parse(if ("\"typing\"" in json) "typing" else "message-created", json)
    private fun typing(cid: String, uid: String, on: Boolean, name: String? = null) =
        RealtimeEvents.parse("typing", """{"conversationId":"$cid","userId":"$uid",${name?.let { "\"name\":\"$it\"," } ?: ""}"avatar":"/api/files/a.png","typing":$on}""")

    @Test fun storeFollowsTheSocket() {
        val s = TypingStore { clock }
        s.apply(typing("c", "a", true, "Bagas Z"), "me")
        s.apply(typing("c", "b", true), "me")
        assertEquals(listOf("a", "b"), s.rooms.value["c"]!!.map { it.userId })
        assertEquals("Bagas Z", s.rooms.value["c"]!![0].name); assertEquals("/api/files/a.png", s.rooms.value["c"]!![0].avatar)
        // Refreshing keeps the order; stopping removes at once.
        clock = 4_000; s.apply(typing("c", "a", true, "Bagas Z"), "me")
        assertEquals(listOf("a", "b"), s.rooms.value["c"]!!.map { it.userId })
        s.apply(typing("c", "b", false), "me"); assertEquals(listOf("a"), s.rooms.value["c"]!!.map { it.userId })
        // Their message ends it.
        s.apply(RealtimeEvents.parse("message-created", """{"id":"m","conversationId":"c","userId":"a"}"""), "me")
        assertNull(s.rooms.value["c"])
        // Never me; 6 s without a refresh expires.
        s.apply(typing("d", "me", true), "me"); assertNull(s.rooms.value["d"])
        s.apply(typing("d", "x", true), "me"); clock += 6_001; s.expire(); assertTrue(s.isEmpty())
        s.apply(typing("d", "x", true), "me"); s.clear(); assertTrue(s.isEmpty())
    }

    @Test fun senderThrottlesAndOnlyTakesBackWhatItSaid() {
        val sent = mutableListOf<Boolean>()
        var up = true
        val t = TypingSender("c", { _, on -> if (up) sent += on; up }) { clock }
        clock = 0; t.stop(); assertEquals(emptyList<Boolean>(), sent) // nothing to take back
        t.onText("h"); clock = 1_000; t.onText("he"); clock = 2_999; t.onText("hel")
        assertEquals(listOf(true), sent)
        clock = 3_000; t.onText("hell"); assertEquals(listOf(true, true), sent)
        t.onText("   "); assertEquals(listOf(true, true, false), sent) // emptied
        t.stop(); assertEquals(3, sent.size)
        // Socket down: nothing goes out, and a later stop has nothing to take back.
        up = false; t.onText("x"); t.stop(); assertEquals(3, sent.size)
        up = true; t.onText("y"); t.forget(); t.stop(); assertEquals(listOf(true, true, false, true), sent)
    }

    @Test fun threadSentence() {
        fun s(n: Int, dm: Boolean, name: String? = "Bagas Z") = TypingText.sentence((1..n).map { Typer("u$it", name, null, 0) }, dm, { "$it is typing…" }, "Someone", { "$it people are typing…" })
        assertEquals("Bagas Z is typing…", s(1, false)); assertEquals("Someone is typing…", s(1, false, null))
        assertEquals("2 people are typing…", s(2, false)); assertNull(s(1, true)); assertNull(s(0, false))
    }
}
