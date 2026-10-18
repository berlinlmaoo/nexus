package id.znetworks.nexus.feature.sheets

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Request
import java.security.SecureRandom

/**
 * The spreadsheet routes (dev web lib/nexus-api.ts sheets, iOS SheetAPI.swift). Every call carries
 * `X-Nexus-Tab`, which the server stamps as `originTab` on its realtime events, so this app can skip its own echo.
 */
class SheetApi(private val api: ApiClient) {
    companion object {
        /** One id per app process ("android-" + 16 hex). */
        val TAB_ID: String = "android-" + ByteArray(8).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    }

    private fun req(path: String) = Request.Builder().url(api.url(path)).header("X-Nexus-Tab", TAB_ID)
    private suspend fun send(b: Request.Builder): JsonObject = api.send(b.build(), JsonObject.serializer())
    private fun JsonElement.body() = toString().toJsonBody()

    suspend fun tabs(projectId: String): List<SheetTab> = SheetParse.tabs(send(req("/api/projects/$projectId/sheets").get()))

    /** A new sheet (the server names it when [name] is null); its id. */
    suspend fun create(projectId: String, name: String? = null): String? =
        (send(req("/api/projects/$projectId/sheets").post(buildJsonObject { name?.let { put("name", it) } }.body()))["id"] as? JsonPrimitive)?.content

    suspend fun duplicate(projectId: String, sheetId: String): String? =
        (send(req("/api/projects/$projectId/sheets").post(buildJsonObject { put("duplicateOf", sheetId) }.body()))["id"] as? JsonPrimitive)?.content

    suspend fun rename(sheetId: String, name: String) = send(req("/api/sheets/$sheetId").patch(buildJsonObject { put("name", name.trim()) }.body()))

    suspend fun delete(sheetId: String) = send(req("/api/sheets/$sheetId").delete())

    suspend fun sheet(sheetId: String): SheetData? = SheetParse.sheet(send(req("/api/sheets/$sheetId?computed=1").get()))

    /** One batch of cell edits; the saved rows come back (with their updatedAt). */
    suspend fun saveCells(sheetId: String, batch: Map<String, Map<String, JsonElement>>): List<SheetRow> {
        val body = buildJsonObject {
            put("edits", buildJsonArray {
                batch.forEach { (rowId, values) -> add(buildJsonObject { put("rowId", rowId); put("values", JsonObject(values)) }) }
            })
        }
        return SheetParse.rows(send(req("/api/sheets/$sheetId/cells").patch(body.body())))
    }

    suspend fun insertRow(sheetId: String, afterRowId: String?, beforeRowId: String?) = send(req("/api/sheets/$sheetId/rows").post(buildJsonObject {
        put("count", 1); afterRowId?.let { put("afterRowId", it) }; beforeRowId?.let { put("beforeRowId", it) }
    }.body()))

    suspend fun deleteRows(sheetId: String, rowIds: List<String>) =
        send(req("/api/sheets/$sheetId/rows").delete(buildJsonObject { put("rowIds", JsonArray(rowIds.map { JsonPrimitive(it) })) }.body()))

    /** The whole column list (a new column is an entry without id); the server keeps the ids it knows. */
    suspend fun setColumns(sheetId: String, columns: List<JsonObject>, structureVersion: Int?) =
        send(req("/api/sheets/$sheetId").patch(buildJsonObject {
            put("columns", JsonArray(columns)); structureVersion?.let { put("structureVersion", it) }
        }.body()))

    suspend fun deleteColumn(sheetId: String, colId: String) = send(req("/api/sheets/$sheetId/columns/$colId").delete())
}
