package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** SYSTEM-MESSAGES part 2 (Berlin, 8 Oct): the group info screen's decisions. */
class ChatInfoTest {
    private val json = JsonObject(mapOf("error" to JsonPrimitive("Not found")))

    @Test fun infoDecodes() {
        val i = NexusJson.decodeFromString(ChatInfo.serializer(), """{"conversation":{"id":"c","type":"GROUP","name":"QA","description":null,"memberCount":3,
            "canManageMembers":true,"canEdit":true,"createdBy":{"id":"b","name":"Bagas"}},
            "members":[{"userId":"b","name":"Bagas","isAdmin":true},{"userId":"me","name":"Me","isMe":true},{"userId":"r","name":"Rina","deactivatedAt":"2026-10-08T09:00:00.000Z"}],
            "counts":{"photos":4,"links":2,"docs":1}}""")
        assertEquals(7, i.counts.total)
        // The viewer first, then the server's order (admins first).
        assertEquals(listOf("me", "b", "r"), ChatInfoLogic.ordered(i.members).map { it.userId })
        assertTrue(ChatInfoLogic.canRemove(i, i.members[0])); assertFalse(ChatInfoLogic.canRemove(i, i.members[1]))
        assertFalse(ChatInfoLogic.canRemove(i.copy(conversation = i.conversation.copy(type = "PROJECT")), i.members[0]))
    }

    @Test fun olderServerFallsBackToTheList() {
        // Next.js's own 404 page (no JSON) = no such route; a JSON 404 = the chat is gone.
        assertTrue(ChatInfoLogic.missingRoute(ApiError.Http(404, null, null, null)))
        assertFalse(ChatInfoLogic.missingRoute(ApiError.Http(404, "Not found", null, json)))
        val conv = Conversation("c", "GROUP", "QA", members = listOf(ChatMember(userId = "me", user = ChatUser("me", "Me")), ChatMember(userId = "x", user = ChatUser("x", "X"))))
        val l = ChatInfoLogic.legacy(conv, "me")
        assertEquals(2, l.conversation.memberCount); assertTrue(l.conversation.canEdit); assertTrue(l.conversation.canManageMembers)
        assertTrue(l.members.first { it.userId == "me" }.isMe)
        assertFalse(ChatInfoLogic.legacy(conv.copy(canManageMembers = false), "me").conversation.canManageMembers)
    }

    @Test fun refusalsInTheAppsWords() {
        assertEquals(R.string.chat_manager_required, ChatInfoLogic.errorRes(ApiError.Http(403, "x", "MANAGER_REQUIRED", null), R.string.ci_err_members))
        assertEquals(R.string.ci_err_gone_member, ChatInfoLogic.errorRes(ApiError.Http(403, "Forbidden", null, null), R.string.ci_err_members))
        assertEquals(R.string.ci_err_gone_chat, ChatInfoLogic.errorRes(ApiError.Http(404, "Not found", null, json), R.string.ci_err_info))
        assertEquals(R.string.ci_err_last, ChatInfoLogic.errorRes(ApiError.Http(400, "A group needs at least one member", null, json), R.string.ci_err_leave))
        assertEquals(R.string.ci_err_desc_len, ChatInfoLogic.errorRes(ApiError.Http(400, "too long", "BAD_DESCRIPTION", json), R.string.ci_err_save))
        assertEquals(R.string.ci_err_save, ChatInfoLogic.errorRes(ApiError.Http(500, null, null, null), R.string.ci_err_save))
    }

    @Test fun aroundPagesAndMute() {
        val p = NexusJson.decodeFromString(MessagesResponse.serializer(), """{"messages":[{"id":"a"},{"id":"b"}],"hasMore":true,"nextCursor":"a","hasMoreNewer":true,"newerCursor":"b","anchorId":"b"}""")
        assertTrue(p.hasMoreNewer); assertEquals("b", p.anchorId)
        assertNull(ChatMute.untilText(null)); assertNull(ChatMute.untilText("9999-01-01T00:00:00Z"))
        assertEquals("forever", ChatMute.until(ChatThreadViewModel.Mute.ALWAYS)); assertNull(ChatMute.until(ChatThreadViewModel.Mute.OFF))
    }

    @Test fun headerOpensInfoAndRoutesExist() {
        val shell = File("src/main/java/id/znetworks/nexus/ui/shell/SignedInShell.kt").readText()
        listOf("\"chat-info/{id}\"", "\"chat-media/{id}\"", "\"chat-search/{id}\"", "chat/{id}?at={at}").forEach { assertTrue(it, shell.contains(it)) }
        val thread = File("src/main/java/id/znetworks/nexus/feature/chat/ChatThreadScreen.kt").readText()
        assertTrue(thread.contains("onClick = onOpenInfo")); assertTrue(thread.contains("if (m.isSystem) { SystemPill"))
    }
}
