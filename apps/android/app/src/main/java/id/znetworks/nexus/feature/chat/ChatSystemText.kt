package id.znetworks.nexus.feature.chat

import android.content.res.Resources
import id.znetworks.nexus.R
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.nullable

// Chat system messages: "Budi Santoso added Mira", like WhatsApp (owner, 8 Oct; SYSTEM-MESSAGES.md, iOS 7029ba5).
// The server writes one SYSTEM row per membership change in a GROUP; its `content` is an Indonesian fallback
// for clients that don't know `kind`. Every client builds the sentence from `event` in its own language,
// with "You"/"Kamu" for the reader.

/** What a SYSTEM message says happened. Every field optional: an unexpected shape falls back to `content`. */
@Serializable
data class ChatSystemEvent(
    /** "members_added" | "member_removed" | "member_left" | "group_created" | "group_renamed". */
    val type: String? = null,
    val actor: Person? = null,
    val targets: List<Person> = emptyList(),
    val name: String? = null,
    val previousName: String? = null,
) {
    @Serializable data class Person(val id: String? = null, val name: String? = null)
}

/** `event` read leniently: a shape this build doesn't expect is null (the pill shows `content`), never a failed page. */
object LenientSystemEvent : kotlinx.serialization.KSerializer<ChatSystemEvent?> {
    override val descriptor = ChatSystemEvent.serializer().descriptor.nullable
    override fun deserialize(decoder: kotlinx.serialization.encoding.Decoder): ChatSystemEvent? {
        val el = (decoder as kotlinx.serialization.json.JsonDecoder).decodeJsonElement()
        return runCatching { decoder.json.decodeFromJsonElement(ChatSystemEvent.serializer(), el) }.getOrNull()
    }
    override fun serialize(encoder: kotlinx.serialization.encoding.Encoder, value: ChatSystemEvent?) {
        val enc = encoder as kotlinx.serialization.json.JsonEncoder
        enc.encodeJsonElement(value?.let { enc.json.encodeToJsonElement(ChatSystemEvent.serializer(), it) } ?: kotlinx.serialization.json.JsonNull)
    }
}

object ChatSystemText {
    /** The sentence parts in the app's language (strings.xml; [of] reads them). */
    data class Words(
        val you: String, val youObject: String, val and: String,
        val added: String, val removed: String, val left: String,
        val created: String, val createdNamed: String, val renamed: String,
    ) {
        companion object {
            fun of(r: Resources) = Words(
                you = r.getString(R.string.sys_you), youObject = r.getString(R.string.sys_you_object), and = r.getString(R.string.au_and),
                added = r.getString(R.string.sys_added), removed = r.getString(R.string.sys_removed), left = r.getString(R.string.sys_left),
                created = r.getString(R.string.sys_created), createdNamed = r.getString(R.string.sys_created_named), renamed = r.getString(R.string.sys_renamed),
            )
        }
    }

    /**
     * The pill's text for [event], seen by [meId]. Anything this build can't put into words — no event, an
     * unknown type, a missing name — is the server's own [fallback] (the row's `content`), never a sentence
     * with a hole in it.
     */
    fun sentence(event: ChatSystemEvent?, fallback: String, meId: String?, w: Words): String {
        val type = event?.type ?: return fallback
        return when (type) {
            "members_added" -> {
                val actor = subject(event.actor, meId, w) ?: return fallback
                val names = objects(event.targets, meId, w) ?: return fallback
                w.added.format(actor, names)
            }
            "member_removed" -> {
                val actor = subject(event.actor, meId, w) ?: return fallback
                val names = objects(event.targets, meId, w) ?: return fallback
                w.removed.format(actor, names)
            }
            // The one leaving is the actor; a server that also lists them as the target reads the same.
            "member_left" -> w.left.format(subject(event.actor ?: event.targets.firstOrNull(), meId, w) ?: return fallback)
            "group_created" -> {
                val actor = subject(event.actor, meId, w) ?: return fallback
                clean(event.name)?.let { w.createdNamed.format(actor, it) } ?: w.created.format(actor)
            }
            "group_renamed" -> {
                val actor = subject(event.actor, meId, w) ?: return fallback
                w.renamed.format(actor, clean(event.name) ?: return fallback)
            }
            else -> fallback
        }
    }

    /** "Mira", "Mira and Yuda", "Mira, Yuda and Anita" — no serial comma, as the contract writes it. */
    fun joinNames(names: List<String>, and: String): String = when (names.size) {
        0 -> ""; 1 -> names[0]
        else -> names.dropLast(1).joinToString(", ") + " $and " + names.last()
    }

    private fun subject(p: ChatSystemEvent.Person?, meId: String?, w: Words): String? {
        p ?: return null
        return if (isMe(p, meId)) w.you else clean(p.name)
    }

    /** The people it was done to: "you" first (as WhatsApp: "Budi added you and Mira"), duplicates once. Null = nobody nameable. */
    private fun objects(people: List<ChatSystemEvent.Person>, meId: String?, w: Words): String? {
        val names = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        var me = false
        for (p in people) {
            if (!p.id.isNullOrEmpty() && !seen.add(p.id)) continue
            if (isMe(p, meId)) me = true else clean(p.name)?.let(names::add)
        }
        if (me) names.add(0, w.youObject)
        return names.takeIf { it.isNotEmpty() }?.let { joinNames(it, w.and) }
    }

    private fun isMe(p: ChatSystemEvent.Person, meId: String?) = !meId.isNullOrEmpty() && p.id == meId
    private fun clean(s: String?) = s?.trim()?.takeIf { it.isNotEmpty() }
}
