package id.znetworks.nexus.feature.home

import android.content.Context
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

@Serializable
data class ShortcutRef(val id: String, val name: String, val icon: String? = null, val color: String? = null)

/**
 * Pinned and recently opened projects for Home (iOS ProjectShortcuts). Kept on the phone, per person,
 * recorded by the project screen itself so every route in counts. Cleared on logout.
 */
class ProjectShortcuts(context: Context, private val userId: () -> String?) {
    data class Lists(val pinned: List<ShortcutRef> = emptyList(), val recent: List<ShortcutRef> = emptyList())

    private val prefs = context.getSharedPreferences("nexus.shortcuts", Context.MODE_PRIVATE)
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
        prefs.edit().putString(key("pinned"), NexusJson.encodeToString(ser, l.pinned))
            .putString(key("recent"), NexusJson.encodeToString(ser, l.recent)).apply()
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

    fun togglePin(ref: ShortcutRef) {
        refresh()
        val l = _lists.value
        write(if (isPinned(ref.id)) l.copy(pinned = l.pinned.filterNot { it.id == ref.id }) else l.copy(pinned = (l.pinned + ref).take(MAX_PINNED)))
    }

    fun clearAll() {
        prefs.edit().clear().apply()
        loadedFor = null
        _lists.value = Lists()
    }

    companion object {
        const val MAX_RECENT = 5
        const val MAX_PINNED = 8
    }
}
