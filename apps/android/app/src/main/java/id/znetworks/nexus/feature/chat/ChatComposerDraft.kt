package id.znetworks.nexus.feature.chat

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.core.session.Session
import androidx.lifecycle.SavedStateHandle
import kotlinx.serialization.Serializable

/** Saved with this navigation entry. Authentication tokens and in-flight requests are never saved. */
@Serializable
data class ChatComposerScope(val serverBase: String = "", val userId: String = "", val conversationId: String = "") {
    fun accepts(expected: Session?, current: Session?, currentBase: String): Boolean =
        expected != null && current != null && expected.token == current.token && expected.cookieName == current.cookieName &&
            expected.userId == current.userId && expected.userId == userId && currentBase == serverBase
}

/** A cached or pre-refusal header response has no authority to restore permission to send. */
data class ChatComposerWriteAccess(val generation: Long = 0, val denied: Boolean = false) {
    fun refused() = copy(generation = generation + 1, denied = true)
    fun observed(canPost: Boolean?, fresh: Boolean, startedGeneration: Long): ChatComposerWriteAccess = when {
        canPost == false -> refused()
        canPost == true && fresh && startedGeneration == generation -> copy(denied = false)
        else -> this
    }
}

/** Only the quote preview and send reference are needed; no nested replies, email or avatar are retained. */
@Serializable
data class ChatComposerReply(val id: String, val content: String = "", val name: String? = null,
                             val attachmentType: String? = null, val attachmentName: String? = null) {
    fun message(conversationId: String) = Message(id = id, conversationId = conversationId, content = content,
        user = ChatUser(name = name), attachmentType = attachmentType, attachmentName = attachmentName)

    companion object {
        fun of(message: Message) = ChatComposerReply(message.id, message.content, message.user?.name,
            message.attachmentType, message.attachmentName)
    }
}

@Serializable
data class ChatComposerDraft(
    val scope: ChatComposerScope = ChatComposerScope(),
    val text: String = "",
    val reply: ChatComposerReply? = null,
    val attachment: ChatUpload? = null,
    val picked: Map<String, String> = emptyMap(),
    val textRevision: Long = 0,
    val replyRevision: Long = 0,
    val attachmentRevision: Long = 0,
    val pickedRevision: Long = 0,
) {
    fun editText(value: String) = if (value == text) this else copy(text = value, textRevision = textRevision + 1)
    fun selectReply(value: Message?) = copy(reply = value?.let(ChatComposerReply::of), replyRevision = replyRevision + 1)
    fun attach(value: ChatUpload?) = copy(attachment = value, attachmentRevision = attachmentRevision + 1)

    fun mention(userId: String, name: String): ChatComposerDraft = if (userId.isBlank()) this else copy(
        text = Mentions.insert(text, name), textRevision = textRevision + 1,
        picked = picked + (userId to Mentions.tag(name)), pickedRevision = pickedRevision + 1,
    )

    /** A successful old send must not erase text or metadata selected after that send began. */
    fun acknowledged(sent: ChatComposerDraft): ChatComposerDraft {
        if (scope != sent.scope) return this
        val clearText = textRevision == sent.textRevision && text == sent.text
        val clearReply = replyRevision == sent.replyRevision && reply == sent.reply
        val clearAttachment = attachmentRevision == sent.attachmentRevision && attachment == sent.attachment
        // New typing can retain a picked tag from the submitted text; it still needs its UID mapping.
        val clearPicked = clearText && pickedRevision == sent.pickedRevision && picked == sent.picked
        return copy(
            text = if (clearText) "" else text, textRevision = if (clearText) textRevision + 1 else textRevision,
            reply = if (clearReply) null else reply, replyRevision = if (clearReply) replyRevision + 1 else replyRevision,
            attachment = if (clearAttachment) null else attachment,
            attachmentRevision = if (clearAttachment) attachmentRevision + 1 else attachmentRevision,
            picked = if (clearPicked) emptyMap() else picked,
            pickedRevision = if (clearPicked) pickedRevision + 1 else pickedRevision,
        )
    }

    /** Read refusal/deletion removes private references while retaining the author's own unsent text. */
    fun denied() = copy(reply = null, attachment = null, picked = emptyMap(),
        replyRevision = replyRevision + 1, attachmentRevision = attachmentRevision + 1, pickedRevision = pickedRevision + 1)

    fun encode(): String = NexusJson.encodeToString(serializer(), this)
    fun save(handle: SavedStateHandle) { handle[SAVED_KEY] = encode() }

    companion object {
        const val SAVED_KEY = "chat.composer.v1"
        fun restore(handle: SavedStateHandle, scope: ChatComposerScope) = restore(handle.get<String>(SAVED_KEY), scope)
        fun restore(raw: String?, scope: ChatComposerScope): ChatComposerDraft = runCatching {
            raw?.let { NexusJson.decodeFromString(serializer(), it) }?.takeIf {
                it.scope == scope && listOf(it.textRevision, it.replyRevision, it.attachmentRevision, it.pickedRevision).all { revision -> revision >= 0 }
            }
        }.getOrNull() ?: ChatComposerDraft(scope)
    }
}
