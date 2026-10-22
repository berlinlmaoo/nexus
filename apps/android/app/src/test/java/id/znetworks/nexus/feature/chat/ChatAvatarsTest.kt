package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.net.ResponseCache
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ChatAvatarsTest {
    @get:Rule val tmp = TemporaryFolder()
    @Before fun setUp() { ChatAvatars.useCache(null); ChatAvatars.clear() }
    @After fun tearDown() { ChatAvatars.useCache(null); ChatAvatars.clear() }

    @Test fun removalImmediatelyOverridesAStaleModelAndOfflineList() {
        val old = "/api/files/avatars/group-old.jpg?t=1"
        ChatAvatars.changed("c", old)
        val event = RealtimeEvents.parse("conversation-updated", """{"conversationId":"c","reason":"membership","change":"avatar","avatarUrl":null}""")
        assertTrue(event.avatarChanged)
        ChatAvatars.changed(event.conversationId!!, event.avatarUrl)
        // A failed refetch may return yesterday's cached conversation. It must not restore the photo.
        ChatAvatars.observed("c", old, ChatAvatars.revision(), cached = true)
        assertNull(ChatAvatars.resolve("c", old))
        assertEquals("unaffected", ChatAvatars.resolve("other", "unaffected"))
    }

    @Test fun anInFlightResponseCannotOverwriteANewerPhotoEvent() {
        val startedAt = ChatAvatars.revision()
        val next = "/api/files/avatars/group-c-123.webp?t=123&opaque=value"
        val event = RealtimeEvents.parse("conversation-updated", """{"conversationId":"c","reason":"membership","change":"avatar","avatarUrl":"$next"}""")
        assertTrue(event.avatarChanged)
        ChatAvatars.changed(event.conversationId!!, event.avatarUrl)
        ChatAvatars.observed("c", "old-photo", startedAt)
        ChatAvatars.mutated("c", "older-upload-response", startedAt)
        assertEquals(next, ChatAvatars.resolve("c", null))
        // A read begun after the event can reconcile a later server change whose event was missed.
        ChatAvatars.observed("c", "latest-photo", ChatAvatars.revision())
        assertEquals("latest-photo", ChatAvatars.resolve("c", null))
    }

    @Test fun unrelatedOrMalformedEventsDoNotRemoveAPhoto() {
        listOf(
            """{"conversationId":"c","reason":"membership"}""",
            """{"conversationId":"c","change":"name","avatarUrl":null}""",
            """{"conversationId":"c","change":"avatar"}""",
            """{"conversationId":"c","change":"avatar","avatarUrl":123}""",
        ).forEach { assertFalse(RealtimeEvents.parse("conversation-updated", it).avatarChanged) }
        assertFalse(RealtimeEvents.parse("typing", """{"conversationId":"c","avatarUrl":null,"change":"avatar"}""").avatarChanged)
    }

    @Test fun clearingOnSignOutAlsoRejectsResponsesFromThePreviousSession() {
        val startedAt = ChatAvatars.revision()
        ChatAvatars.changed("c", "private-photo")
        ChatAvatars.clear()
        ChatAvatars.observed("c", "private-photo", startedAt)
        ChatAvatars.mutated("c", "private-photo", startedAt)
        assertTrue(ChatAvatars.avatars.value.isEmpty())
    }

    @Test fun removedPhotoStaysRemovedAfterRestartAndAStaleResponseCannotRestoreItsDiskEntry() {
        val cache = ResponseCache(tmp.root) { "member" }
        val oldBody = """{"conversations":[{"id":"c","type":"GROUP","avatarUrl":"old-photo","serverExtra":"keep"},{"id":"other","type":"GROUP","avatarUrl":"other-photo"}],"totalUnread":7}"""
        cache.save("conversations", oldBody, savedAtMillis = 1234000)
        ChatAvatars.useCache(cache)
        val inFlight = ChatAvatars.revision()
        ChatAvatars.changed("c", null)
        assertEquals(1234000L, cache.load("conversations")!!.savedAtMillis)
        // Simulate an older API response finishing after the event and writing its own cache copy.
        cache.save("conversations", oldBody)
        ChatAvatars.observed("c", "old-photo", inFlight)

        ChatAvatars.clear() // Only in-memory state disappears when the process restarts.
        val saved = cache.load("conversations")!!.body
        val list = NexusJson.decodeFromString(ConversationsResponse.serializer(), saved)
        list.conversations.forEach { ChatAvatars.observed(it.id, it.avatarUrl, ChatAvatars.revision(), cached = true) }
        assertNull(ChatAvatars.resolve("c", "old-photo"))
        assertEquals("other-photo", ChatAvatars.resolve("other", null))
        assertEquals(7, list.totalUnread)
        assertTrue(saved.contains("\"serverExtra\":\"keep\""))
    }
}
