package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Chat ready to replace the WhatsApp groups (owner, 8 Oct; CHAT-CONTRACT / CHAT-REPORT), with old-server fallbacks. */
class ChatReadyTest {
    private fun m(id: String, at: String) = Message(id = id, createdAt = at, content = id)

    @Test fun mergeNeverDropsAMessage() {
        val held = (1..60).map { m("m$it", "2026-10-08T01:%02d:00Z".format(it - 1)) }
        // An older server answers a poll with only its latest 50: the 10 older ones stay.
        val latest = held.takeLast(50) + m("m61", "2026-10-08T02:00:00Z")
        val merged = ChatMerge.merge(held, latest)
        assertEquals(61, merged.size)
        assertEquals("m1", merged.first().id); assertEquals("m61", merged.last().id)
        // Same time: ordered by id; duplicates once.
        assertEquals(listOf("a", "b"), ChatMerge.merge(listOf(m("b", "t")), listOf(m("a", "t"), m("b", "t"))).map { it.id })
    }

    @Test fun aHoleIsSeen() {
        val held = listOf(m("old", "2026-10-08T01:00:00Z"))
        val farNewer = (1..50).map { m("n$it", "2026-10-08T05:%02d:00Z".format(it - 1)) }
        assertTrue(ChatMerge.gap(held, farNewer, 50))
        assertFalse(ChatMerge.gap(held, farNewer.take(10), 50))         // not a full page
        assertFalse(ChatMerge.gap(held, farNewer.dropLast(1) + held, 50)) // overlaps what is held
        assertEquals("cursor", ChatMerge.before(held, "cursor"))
        assertEquals("2026-10-08T01:00:00Z", ChatMerge.before(held, null))
    }

    @Test fun pushNewAndOldShapes() {
        val new = ChatPush.parse(mapOf("type" to "MESSAGE", "conversationId" to "c1", "messageId" to "x", "link" to "/messages?c=c1",
            "conversationName" to "Tim Event", "senderName" to "Ana", "title" to "Tim Event", "body" to "Ana: rapat jam 3", "isGroup" to "true"))!!
        assertEquals("c1", new.conversationId); assertTrue(new.isGroup); assertEquals("Ana", new.senderName); assertEquals("rapat jam 3", new.text)
        assertFalse(new.mention)
        // Old server: no conversationId/senderName — from the link and "New message from X".
        val old = ChatPush.parse(mapOf("type" to "MESSAGE", "title" to "New message from Budi", "body" to "", "link" to "/messages?c=c9"))!!
        assertEquals("c9", old.conversationId); assertEquals("Budi", old.senderName); assertEquals("", old.text) // drawn as "📷 Foto"
        assertTrue(ChatPush.parse(mapOf("type" to "MESSAGE_MENTION", "conversationId" to "c2", "title" to "x", "body" to "y"))!!.mention)
        assertNull(ChatPush.parse(mapOf("type" to "TASK_ASSIGNED", "link" to "/messages?c=c1")))
        assertNull(ChatPush.parse(mapOf("type" to "MESSAGE", "title" to "t")))    // nowhere to go: the generic path
        assertEquals(ChatNotifier.idFor("c1"), ChatNotifier.idFor("c1"))         // one card per conversation
    }

    @Test fun linksAreTappable() {
        val t = ChatText.tokens("cek https://nexus.znetworks.id/x, dan www.google.com @Ana")
        assertEquals(listOf(ChatText.Kind.LINK, ChatText.Kind.LINK, ChatText.Kind.MENTION), t.map { it.kind })
        val text = "cek https://nexus.znetworks.id/x, dan www.google.com @Ana"
        assertEquals("https://nexus.znetworks.id/x", text.substring(t[0].range))
        assertEquals("https://www.google.com", ChatText.url(text.substring(t[1].range)))
    }

    @Test fun muteAndUnreadWithOldAndNewServers() {
        val future = java.time.Instant.now().plusSeconds(3600).toString()
        val r = ConversationsResponse(listOf(Conversation("a", unreadCount = 3), Conversation("b", unreadCount = 5, mutedUntil = future)))
        assertEquals(3, r.unread())                       // old server: muted ones not counted
        assertEquals(9, r.copy(totalUnread = 9).unread()) // new server's own total wins
        assertTrue(Conversation("b", mutedUntil = future).muted()); assertFalse(Conversation("a").muted())
        assertFalse(Conversation("c", mutedUntil = "2020-01-01T00:00:00Z").muted())
        // Old JSON (no mutedUntil, totalUnread, nextCursor) still decodes.
        val parsed = NexusJson.decodeFromString(ConversationsResponse.serializer(), """{"conversations":[{"id":"a","unreadCount":2}]}""")
        assertNull(parsed.totalUnread); assertNull(parsed.conversations[0].mutedUntil)
        assertNull(NexusJson.decodeFromString(MessagesResponse.serializer(), """{"messages":[],"hasMore":true}""").nextCursor)
    }

    @Test fun neverPollsOrMarksReadInTheBackground() {
        val root = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "app/src/main").isDirectory }
        val thread = File(root, "app/src/main/java/id/znetworks/nexus/feature/chat/ChatThreadScreen.kt").readText()
        // The view model no longer loops on its own; the screen polls inside repeatOnLifecycle(RESUMED).
        assertFalse("while (isActive) { load()" in thread)
        assertTrue("repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.RESUMED)" in thread && "vm.markReadVisible()" in thread)
        assertTrue("api.markRead(id, last)" in thread && "api.newer(id, last)" in thread)
        val list = File(root, "app/src/main/java/id/znetworks/nexus/feature/chat/MessagesScreen.kt").readText()
        assertFalse("while (isActive) { load()" in list)
    }
}
