package id.znetworks.nexus.feature.home

import android.content.Context
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

@Serializable
data class ShortcutRef(val id: String, val name: String, val icon: String? = null, val color: String? = null)

/** The server side of pins (`/api/projects/pins`, the same list the web sidebar pins into). */
interface PinRemote {
    /** The person's pinned project ids, in the server's order (most recently pinned first). */
    suspend fun pins(): List<String>
    suspend fun setPin(projectId: String, pinned: Boolean)
    /** Every project this person can open now; null when the list could not be read. */
    suspend fun projects(): List<ShortcutRef>?
}

/**
 * Pinned and recently opened projects (iOS ProjectShortcuts 286cada). Pins are the person's on every
 * device: they live on the server and this keeps a copy so Home draws before the network answers
 * (owner 29 Sep). Recents stay on the phone — what was opened here is about this phone. Per person,
 * recorded by the project screen itself so every route in counts. Cleared on logout.
 */
class ProjectShortcuts(
    private val prefs: ShortcutStore,
    private val userId: () -> String?,
    private val remote: PinRemote? = null,
    private val scope: CoroutineScope? = null,
) {
    constructor(context: Context, userId: () -> String?, remote: PinRemote? = null, scope: CoroutineScope? = null) :
        this(ShortcutStore.of(context), userId, remote, scope)

    data class Lists(val pinned: List<ShortcutRef> = emptyList(), val recent: List<ShortcutRef> = emptyList())

    private val _lists = MutableStateFlow(Lists())
    val lists: StateFlow<Lists> = _lists.asStateFlow()
    private var loadedFor: String? = null

    private fun key(kind: String) = "${userId().orEmpty()}:$kind"
    private val ser = ListSerializer(ShortcutRef.serializer())

    private fun read(kind: String) = runCatching { NexusJson.decodeFromString(ser, prefs.getString(key(kind), null) ?: "[]") }.getOrDefault(emptyList())

    /** Re-reads when the person changed (a different login on the same phone). */
    fun refresh() {
        val me = userId()
        if (me == loadedFor) return
        loadedFor = me
        _lists.value = if (me == null) Lists() else Lists(read("pinned"), read("recent"))
    }

    private fun write(l: Lists) {
        _lists.value = l
        prefs.putString(key("pinned"), NexusJson.encodeToString(ser, l.pinned))
        prefs.putString(key("recent"), NexusJson.encodeToString(ser, l.recent))
    }

    fun visited(ref: ShortcutRef) {
        refresh()
        val l = _lists.value
        // A pinned one keeps its fresh name without also appearing as recent.
        write(l.copy(
            pinned = l.pinned.map { if (it.id == ref.id) ref else it },
            recent = (listOf(ref) + l.recent.filterNot { it.id == ref.id }).take(MAX_RECENT),
        ))
    }

    fun isPinned(id: String) = _lists.value.pinned.any { it.id == id }

    /** Changed here at once, then on the server; a refusal puts it back so the two never disagree. */
    fun togglePin(ref: ShortcutRef) {
        refresh()
        val nowPinned = !isPinned(ref.id)
        // Newest pin first, the server's order.
        edit { l -> if (nowPinned) l.copy(pinned = listOf(ref) + l.pinned) else l.copy(pinned = l.pinned.filterNot { it.id == ref.id }) }
        val r = remote ?: return
        scope?.launch {
            val ok = runCatching { r.setPin(ref.id, nowPinned) }.isSuccess
            if (!ok) edit { l ->
                if (nowPinned) l.copy(pinned = l.pinned.filterNot { it.id == ref.id })
                else if (l.pinned.none { it.id == ref.id }) l.copy(pinned = l.pinned + ref) else l
            }
        }
    }

    /**
     * The server's list is the truth: its order, and only projects this person can still open (the
     * web sidebar's filter). Pins made on this phone before pins synced are sent up once, so nobody
     * loses the ones they had. On sign-in and every return to the app.
     */
    suspend fun syncPins() {
        val r = remote ?: return
        refresh()
        val me = userId() ?: return
        val ids = runCatching { r.pins() }.getOrNull()?.toMutableList() ?: return
        val uploadedKey = "$me:pinsUploaded"
        if (!prefs.getBoolean(uploadedKey, false)) {
            for (ref in _lists.value.pinned) if (ref.id !in ids && runCatching { r.setPin(ref.id, true) }.isSuccess) ids += ref.id
            prefs.putBoolean(uploadedKey, true)
        }
        if (userId() != me) return
        val local = (_lists.value.pinned + _lists.value.recent).associateBy { it.id }
        val known = r.projects()?.associate { p -> p.id to p.copy(icon = p.icon ?: local[p.id]?.icon) } ?: local
        val synced = ids.distinct().mapNotNull { known[it] }
        edit { l -> if (l.pinned == synced) l else l.copy(pinned = synced) }
    }

    private fun edit(change: (Lists) -> Lists) {
        var out: Lists? = null
        _lists.update { change(it).also { n -> out = n } }
        out?.let { write(it) }
    }

    fun clearAll() {
        prefs.clear()
        loadedFor = null
        _lists.value = Lists()
    }

    companion object {
        const val MAX_RECENT = 5
    }
}

/** Where shortcuts are kept; SharedPreferences on the phone, a map in the JVM tests. */
interface ShortcutStore {
    fun getString(key: String, default: String?): String?
    fun putString(key: String, value: String)
    fun getBoolean(key: String, default: Boolean): Boolean
    fun putBoolean(key: String, value: Boolean)
    fun clear()

    companion object {
        fun of(context: Context): ShortcutStore {
            val p = context.getSharedPreferences("nexus.shortcuts", Context.MODE_PRIVATE)
            return object : ShortcutStore {
                override fun getString(key: String, default: String?) = p.getString(key, default)
                override fun putString(key: String, value: String) { p.edit().putString(key, value).apply() }
                override fun getBoolean(key: String, default: Boolean) = p.getBoolean(key, default)
                override fun putBoolean(key: String, value: Boolean) { p.edit().putBoolean(key, value).apply() }
                override fun clear() { p.edit().clear().apply() }
            }
        }
    }
}
