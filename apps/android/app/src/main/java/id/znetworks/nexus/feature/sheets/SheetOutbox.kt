package id.znetworks.nexus.feature.sheets

import android.content.Context
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File

/**
 * One sheet's unsent cell edits (web ProjectSheetView save queue, iOS SheetOutbox): newest value per cell wins,
 * at most one batch in flight, and a batch that failed for the network goes back UNDER anything typed since.
 * Pure: [SheetOutbox] keeps it on disk.
 */
class SheetQueue {
    private val pending = LinkedHashMap<String, LinkedHashMap<String, JsonElement>>()
    private var inflight: Map<String, Map<String, JsonElement>>? = null

    val isEmpty: Boolean get() = pending.isEmpty() && inflight == null
    val busy: Boolean get() = inflight != null
    /** Cells waiting (in flight included), for the offline badge. */
    val count: Int get() = pending.values.sumOf { it.size } + (inflight?.values?.sumOf { it.size } ?: 0)

    fun put(rowId: String, colId: String, value: JsonElement) {
        pending.getOrPut(rowId) { LinkedHashMap() }[colId] = value
    }

    /** The next batch (≤ [maxRows] rows), now in flight; null while one is out or nothing waits. */
    fun take(maxRows: Int = 200): Map<String, Map<String, JsonElement>>? {
        if (inflight != null || pending.isEmpty()) return null
        val keys = pending.keys.take(maxRows)
        val batch = LinkedHashMap<String, Map<String, JsonElement>>()
        keys.forEach { k -> batch[k] = pending.remove(k)!! }
        inflight = batch
        return batch
    }

    fun succeeded() { inflight = null }
    /** A refusal (4xx): the batch is dropped; the screen reloads with the server's sentence. */
    fun dropped() { inflight = null }

    /** The network failed: the batch comes back under what was typed meanwhile (that stays newer). */
    fun putBack() {
        val b = inflight ?: return
        inflight = null
        val merged = LinkedHashMap<String, LinkedHashMap<String, JsonElement>>()
        b.forEach { (row, cells) -> merged[row] = LinkedHashMap(cells) }
        pending.forEach { (row, cells) -> merged.getOrPut(row) { LinkedHashMap() }.putAll(cells) }
        pending.clear(); pending.putAll(merged)
    }

    /** Values not yet confirmed for a row (pending first, then in flight). */
    fun valuesFor(rowId: String): Map<String, JsonElement> = (inflight?.get(rowId).orEmpty()) + pending[rowId].orEmpty()

    fun all(): Map<String, Map<String, JsonElement>> {
        val out = LinkedHashMap<String, MutableMap<String, JsonElement>>()
        inflight?.forEach { (r, c) -> out.getOrPut(r) { LinkedHashMap() }.putAll(c) }
        pending.forEach { (r, c) -> out.getOrPut(r) { LinkedHashMap() }.putAll(c) }
        return out
    }

    fun toJson(): JsonObject = JsonObject(all().mapValues { (_, c) -> JsonObject(c) })

    companion object {
        fun fromJson(o: JsonObject?): SheetQueue = SheetQueue().also { q ->
            o?.forEach { (row, cells) -> (cells as? JsonObject)?.forEach { (col, v) -> q.put(row, col, v) } }
        }
    }
}

/** The queues on disk, one file per sheet, owned by the person who typed them (another account never sends them). */
object SheetOutbox {
    private fun dir(context: Context) = File(context.filesDir, "sheet-outbox")
    private fun file(context: Context, sheetId: String) = File(dir(context), sheetId.replace(Regex("[^A-Za-z0-9_-]"), "_") + ".json")

    fun load(context: Context, sheetId: String, owner: String?): SheetQueue = runCatching {
        val f = file(context, sheetId)
        if (!f.exists()) return SheetQueue()
        val o = NexusJson.parseToJsonElement(f.readText()) as? JsonObject ?: return SheetQueue()
        if ((o["owner"] as? JsonPrimitive)?.content != owner) return SheetQueue()
        SheetQueue.fromJson(o["rows"] as? JsonObject)
    }.getOrDefault(SheetQueue())

    fun save(context: Context, sheetId: String, owner: String?, q: SheetQueue) {
        runCatching {
            val f = file(context, sheetId)
            if (q.isEmpty) { f.delete(); return }
            dir(context).mkdirs()
            f.writeText(JsonObject(mapOf("owner" to JsonPrimitive(owner ?: ""), "rows" to q.toJson())).toString())
        }
    }

    /** Sign-out: unsent edits belong to that account; the next person must not send them. */
    fun clearAll(context: Context) { runCatching { dir(context).deleteRecursively() } }
}
