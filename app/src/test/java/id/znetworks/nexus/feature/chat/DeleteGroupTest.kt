package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.realtime.RealtimeEvents
import id.znetworks.nexus.feature.admin.AuditRestoreCounts
import id.znetworks.nexus.feature.admin.RestoreKinds
import id.znetworks.nexus.feature.admin.RestoreTarget
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** DELETE-GROUP (Berlin, 9 Oct): built so today's server (no canDelete, no DELETE route) simply shows nothing new. */
class DeleteGroupTest {
    private fun body(code: String? = null) = JsonObject(buildMap { put("error", JsonPrimitive("x")); code?.let { put("code", JsonPrimitive(it)) } })

    @Test fun canDeleteIsOptIn() {
        val old = NexusJson.decodeFromString(ChatInfo.serializer(), """{"conversation":{"id":"c","type":"GROUP","memberCount":1}}""")
        assertFalse(old.conversation.canDelete)
        assertTrue(NexusJson.decodeFromString(ChatInfo.serializer(), """{"conversation":{"id":"c","canDelete":true}}""").conversation.canDelete)
    }

    @Test fun deleteOutcomes() {
        assertEquals(ChatInfoLogic.DeleteOutcome.UNSUPPORTED, ChatInfoLogic.deleteOutcome(ApiError.Http(405, null, null, null)))
        assertEquals(ChatInfoLogic.DeleteOutcome.UNSUPPORTED, ChatInfoLogic.deleteOutcome(ApiError.Http(404, null, null, null))) // no route (HTML)
        assertEquals(ChatInfoLogic.DeleteOutcome.GONE, ChatInfoLogic.deleteOutcome(ApiError.Http(404, "Not found", null, body()))) // already deleted
        assertEquals(ChatInfoLogic.DeleteOutcome.NOT_ALLOWED, ChatInfoLogic.deleteOutcome(ApiError.Http(403, "x", "MANAGER_REQUIRED", body("MANAGER_REQUIRED"))))
        assertEquals(ChatInfoLogic.DeleteOutcome.NOT_A_GROUP, ChatInfoLogic.deleteOutcome(ApiError.Http(400, "x", "NOT_A_GROUP", body("NOT_A_GROUP"))))
        assertEquals(ChatInfoLogic.DeleteOutcome.FAILED, ChatInfoLogic.deleteOutcome(ApiError.Http(500, null, null, null)))
    }

    @Test fun lastMemberIsAStateNotAnError() {
        assertTrue(ChatInfoLogic.lastMember(ApiError.Http(400, "Kamu anggota terakhir…", "LAST_MEMBER", body("LAST_MEMBER"))))
        assertTrue(ChatInfoLogic.lastMember(ApiError.Http(400, "A group needs at least one member", null, body())))
        assertFalse(ChatInfoLogic.lastMember(ApiError.Http(400, "userId required", null, body())))
        val alone = ChatInfo(ChatInfoConversation("c", "GROUP", memberCount = 1), listOf(ChatInfoMember("me", isMe = true)))
        assertTrue(ChatInfoLogic.onlyMember(alone))
        assertFalse(ChatInfoLogic.onlyMember(alone.copy(members = alone.members + ChatInfoMember("x"))))
        assertFalse(ChatInfoLogic.onlyMember(alone.copy(conversation = alone.conversation.copy(type = "PROJECT"))))
    }

    @Test fun deletedElsewhereReachesTheScreens() {
        val e = RealtimeEvents.parse("conversation-updated", """{"conversationId":"c1","lastMessageAt":null,"reason":"deleted"}""")
        assertTrue(RealtimeEvents.groupDeleted(e)); assertTrue(RealtimeEvents.groupDeleted(e, "c1")); assertFalse(RealtimeEvents.groupDeleted(e, "c2"))
        assertFalse(RealtimeEvents.groupDeleted(RealtimeEvents.parse("conversation-updated", """{"conversationId":"c1","reason":"membership"}""")))
    }

    @Test fun auditRestoresAGroupChat() {
        assertEquals(R.string.au_rb_chat_group, RestoreKinds.button("chat_group"))
        assertEquals(R.string.au_note_chat_group, RestoreKinds.note("chat_group", false))
        assertEquals(listOf(R.plurals.au_n_messages to 42, R.plurals.au_n_members to 3), RestoreKinds.parts(AuditRestoreCounts(messages = 42, members = 3, items = 46), "chat_group"))
        val open = NexusJson.parseToJsonElement("""{"type":"chat","id":"c1"}""")
        assertEquals(RestoreTarget(RestoreTarget.Kind.CHAT, "c1"), RestoreKinds.target(open, "chat_group", "c1"))
        assertEquals(R.string.au_open_chat, RestoreKinds.openLabel(RestoreTarget.Kind.CHAT))
    }
}
