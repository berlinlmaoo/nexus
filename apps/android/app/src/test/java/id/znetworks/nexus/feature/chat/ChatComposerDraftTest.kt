package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.session.Session
import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.*
import org.junit.Test

class ChatComposerDraftTest {
    private val scope = ChatComposerScope("https://example.test", "me", "room")
    private val quote = Message("quoted", conversationId = "room", content = "Original message", user = ChatUser(name = "QA person"))
    private val file = ChatUpload("/uploads/chat/document.pdf", "application/pdf", "file", "document.pdf", 123)
    private fun full() = ChatComposerDraft(scope).editText("Hello @QA").mention("person", "QA person").selectReply(quote).attach(file)

    @Test fun processRestorationKeepsTextReplyUploadedFileAndMentionUidTogether() {
        val original = full()
        val handle = SavedStateHandle(mapOf("id" to scope.conversationId))
        original.save(handle)
        // Framework restoration provides the saved primitive string to a new navigation-entry handle.
        val recreated = SavedStateHandle(mapOf("id" to scope.conversationId, ChatComposerDraft.SAVED_KEY to handle.get<String>(ChatComposerDraft.SAVED_KEY)))
        val restored = ChatComposerDraft.restore(recreated, scope)
        assertEquals(original, restored)
        assertEquals("quoted", restored.reply?.message(scope.conversationId)?.id)
        assertEquals("Original message", restored.reply?.content)
        assertEquals(file, restored.attachment)
        assertEquals(listOf("person"), Mentions.ids(restored.text, restored.picked))
        assertEquals(scope.conversationId, recreated.get<String>("id"))
    }

    @Test fun anotherServerAccountOrConversationCannotRestorePrivateMetadata() {
        for (other in listOf(scope.copy(serverBase = "https://other.test"), scope.copy(userId = "other"), scope.copy(conversationId = "other"))) {
            assertEquals(ChatComposerDraft(other), ChatComposerDraft.restore(full().encode(), other))
        }
    }

    @Test fun malformedMissingAndOldSnapshotsSafelyStartEmpty() {
        for (raw in listOf(null, "{", "{}", "null", full().copy(textRevision = -1).encode())) {
            assertEquals(ChatComposerDraft(scope), ChatComposerDraft.restore(raw, scope))
        }
    }

    @Test fun successfulSendClearsOnlyItsSubmittedSnapshot() {
        val sent = full()
        val acknowledged = sent.acknowledged(sent)
        assertEquals("", acknowledged.text)
        assertNull(acknowledged.reply)
        assertNull(acknowledged.attachment)
        assertTrue(acknowledged.picked.isEmpty())
        val fresh = sent.editText("A new draft").selectReply(quote.copy(id = "new quote")).attach(file.copy(url = "/new.pdf"))
        val result = fresh.acknowledged(sent)
        assertEquals(fresh.text, result.text)
        assertEquals(fresh.reply, result.reply)
        assertEquals(fresh.attachment, result.attachment)
    }

    @Test fun lateAcknowledgementPreservesNewTypingAndItsMentionMap() {
        val sent = full()
        val typing = sent.editText(sent.text + "still typing")
        val result = typing.acknowledged(sent)
        assertEquals(typing.text, result.text)
        assertEquals(listOf("person"), Mentions.ids(result.text, result.picked))
        assertNull(result.reply)
        assertNull(result.attachment)
        // Editing away and back or reselecting the same attachment/quote is still a new draft action.
        val reselected = sent.editText("changed").editText(sent.text).selectReply(quote).attach(file)
        val later = reselected.acknowledged(sent)
        assertEquals(sent.text, later.text)
        assertEquals(sent.reply, later.reply)
        assertEquals(file, later.attachment)
    }

    @Test fun readRefusalWipesReferencesButKeepsOwnTextAndInvalidatesLateUpload() {
        val pending = full()
        val denied = pending.denied()
        assertEquals(pending.text, denied.text)
        assertNull(denied.reply)
        assertNull(denied.attachment)
        assertTrue(denied.picked.isEmpty())
        assertNotEquals(pending.attachmentRevision, denied.attachmentRevision)
        assertEquals(denied, ChatComposerDraft.restore(denied.encode(), scope))
    }

    @Test fun asyncResultsRequireTheOriginalCredentialsAccountAndServer() {
        val session = Session("private-old-token", "session", "me")
        assertTrue(scope.accepts(session, session, scope.serverBase))
        assertFalse(scope.accepts(session, session.copy(token = "replacement"), scope.serverBase))
        assertFalse(scope.accepts(session, session.copy(cookieName = "other-cookie"), scope.serverBase))
        assertFalse(scope.accepts(session, session.copy(userId = "other"), scope.serverBase))
        assertFalse(scope.accepts(session, null, scope.serverBase))
        assertFalse(scope.accepts(session, session, "https://other.test"))
        assertFalse(scope.accepts(null, session, scope.serverBase))
        assertFalse(full().encode().contains(session.token))
    }

    @Test fun profileMetadataChangesDoNotInvalidateTheAuthenticatedDraftOwner() {
        val original = Session("same-credential", "session", "me", userName = "Before", userEmail = "before@example.test", expiresAtMillis = 100)
        val updated = original.copy(userName = "After", userEmail = "after@example.test", expiresAtMillis = 200)
        assertTrue(scope.accepts(original, updated, scope.serverBase))
        val saved = full().encode()
        assertEquals(full(), ChatComposerDraft.restore(saved, scope))
    }

    @Test fun cachedAndPreRefusalResponsesCannotRestoreWritePermission() {
        val before = ChatComposerWriteAccess()
        val refused = before.refused()
        assertTrue(refused.denied)
        assertEquals(refused, refused.observed(true, fresh = false, startedGeneration = refused.generation))
        assertEquals(refused, refused.observed(true, fresh = true, startedGeneration = before.generation))
        assertFalse(refused.observed(true, fresh = true, startedGeneration = refused.generation).denied)
        assertEquals(refused, refused.observed(null, fresh = true, startedGeneration = refused.generation))
        val newerRefusal = refused.observed(false, fresh = true, startedGeneration = refused.generation)
        assertTrue(newerRefusal.observed(true, fresh = true, startedGeneration = refused.generation).denied)
    }

    @Test fun failedSendDoesNotChangeTheSavedSnapshotAndAnotherScopeCannotAcknowledgeIt() {
        val failed = full()
        val saved = failed.encode()
        // Failure has no acknowledgement transition; the next recreated observer gets the same draft.
        assertEquals(failed, ChatComposerDraft.restore(saved, scope))
        assertEquals(failed, failed.acknowledged(failed.copy(scope = scope.copy(conversationId = "other"))))
        assertFalse(saved.contains("sending"))
        assertFalse(saved.contains("uploading"))
    }
}
