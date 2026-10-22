package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatGroupPhotoTest {
    @Test fun groupPhotoUsesTheExplicitServerCapability() {
        val group = ChatInfoConversation("group", canEdit = true, canEditAvatar = true)
        assertTrue(ChatInfoLogic.canEditPhoto(group))
        // Managing members is a separate permission; it does not grant a photo change.
        assertFalse(ChatInfoLogic.canEditPhoto(group.copy(canEditAvatar = false, canManageMembers = true)))
        // The explicit photo permission is authoritative when present.
        assertFalse(ChatInfoLogic.canEditPhoto(group.copy(canEditAvatar = false)))
        assertFalse(ChatInfoLogic.canEditPhoto(group.copy(canEditAvatar = null)))
        assertTrue(ChatInfoLogic.canEditPhoto(group.copy(canEdit = false, canEditAvatar = true)))
        assertFalse(ChatInfoLogic.canEditPhoto(group.copy(type = "PROJECT")))
        assertFalse(ChatInfoLogic.canEditPhoto(group.copy(type = "DM")))
        assertFalse(ChatInfoLogic.canEditPhoto(group, legacy = true))
    }

    @Test fun groupPhotoSurvivesListAndInfoDecoding() {
        val photo = "/api/files/group-photo.jpg?t=123"
        val list = NexusJson.decodeFromString(ConversationsResponse.serializer(), """{"conversations":[{"id":"group","type":"GROUP","name":"QA","avatarUrl":"$photo"}]}""")
        val info = NexusJson.decodeFromString(ChatInfo.serializer(), """{"conversation":{"id":"group","type":"GROUP","name":"QA","avatarUrl":"$photo","canEditAvatar":true}}""")
        assertEquals(photo, list.conversations.single().avatarUrl)
        assertEquals(photo, info.conversation.avatarUrl)
        assertTrue(ChatInfoLogic.canEditPhoto(info.conversation))
        assertEquals(photo, ChatInfoLogic.legacy(list.conversations.single(), "me").conversation.avatarUrl)
        assertFalse(ChatInfoLogic.canEditPhoto(ChatInfoLogic.legacy(list.conversations.single(), "me").conversation, legacy = true))

        assertNull(NexusJson.decodeFromString(Conversation.serializer(), """{"id":"old"}""").avatarUrl)
        val oldInfo = NexusJson.decodeFromString(ChatInfo.serializer(), """{"conversation":{"id":"old"}}""")
        assertNull(oldInfo.conversation.avatarUrl)
        assertNull(oldInfo.conversation.canEditAvatar)
        assertFalse(ChatInfoLogic.canEditPhoto(oldInfo.conversation.copy(canEdit = true)))
    }

    @Test fun uploadLimitAndServerErrors() {
        assertTrue(ChatGroupPhotoRules.accepts(ChatGroupPhotoRules.MAX_BYTES))
        assertFalse(ChatGroupPhotoRules.accepts(ChatGroupPhotoRules.MAX_BYTES + 1))
        assertFalse(ChatGroupPhotoRules.accepts(0))
        assertEquals(R.string.cg_photo_too_large, ChatGroupPhotoRules.errorRes(ApiError.Http(400, null, "TOO_LARGE", null), false))
        assertEquals(R.string.cg_photo_bad_type, ChatGroupPhotoRules.errorRes(ApiError.Http(400, null, "BAD_TYPE", null), false))
        assertEquals(R.string.cg_photo_error, ChatGroupPhotoRules.errorRes(ApiError.Http(500, null, null, null), false))
        assertEquals(R.string.cg_photo_error_remove, ChatGroupPhotoRules.errorRes(ApiError.Http(500, null, null, null), true))
    }
}
