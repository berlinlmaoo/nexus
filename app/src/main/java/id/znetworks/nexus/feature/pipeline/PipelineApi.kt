package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.feature.admin.WsRoster
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import okhttp3.Request
import java.io.File
import java.net.URLEncoder

/** /api/projects/:id/pipeline and below (PIPELINE-DASHBOARD §6). Access as the board: read = VIEWER, write = MEMBER. */
class PipelineApi(private val api: ApiClient) {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun base(projectId: String) = "/api/projects/${enc(projectId)}/pipeline"

    suspend fun load(projectId: String) = PipelineData.of(api.get(base(projectId), JsonObject.serializer()))

    /** One deal and its edit history, newest first (at most 200). */
    suspend fun deal(projectId: String, dealId: String): Pair<PipelineDeal, List<PipelineChange>> {
        val o = api.get("${base(projectId)}/${enc(dealId)}", JsonObject.serializer())
        val deal = PipelineDeal(o["deal"] as? JsonObject ?: JsonObject(emptyMap()))
        val history = (o["history"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let { c ->
            PipelineChange(c["id"].str().orEmpty(), c["field"].str().orEmpty(), c["before"], c["after"], c["createdAt"].str(), PipelinePerson.of(c["user"]))
        } }
        return deal to history
    }

    /** Any editable field; the server fills the GM's defaults for the rest. */
    suspend fun create(projectId: String, fields: JsonObject) =
        PipelineDeal(api.send(Request.Builder().url(api.url(base(projectId))).post(fields.toString().toJsonBody()).build(), JsonObject.serializer()))

    /** Only the fields sent change; each one is written to the deal's history. 400 INVALID_FIELD names a bad one. */
    suspend fun update(projectId: String, dealId: String, fields: JsonObject) =
        PipelineDeal(api.send(Request.Builder().url(api.url("${base(projectId)}/${enc(dealId)}")).patch(fields.toString().toJsonBody()).build(), JsonObject.serializer()))

    /** The execution project of a won deal (§10.3): 201 made / 200 already had one → its id; 400 NOT_WON otherwise. */
    suspend fun execution(projectId: String, dealId: String): String? =
        (api.send(Request.Builder().url(api.url("${base(projectId)}/${enc(dealId)}/execution")).post("{}".toJsonBody()).build(), JsonObject.serializer())["projectId"]).str()

    /** Restorable from Control Room › Audit ("pipeline_deal"), with its history. */
    suspend fun delete(projectId: String, dealId: String) =
        api.send(Request.Builder().url(api.url("${base(projectId)}/${enc(dealId)}")).delete().build(), JsonObject.serializer())

    /** The people the BD and PM pickers offer: the members of the PROJECT's workspace (the server refuses anyone else). */
    suspend fun people(workspaceId: String?) =
        api.get("/api/workspaces/members" + (workspaceId?.let { "?workspaceId=${enc(it)}" } ?: ""), WsRoster.serializer()).members

    /** The .xlsx "Master Project" sheet (the GM's columns) into [dir], to hand to the share sheet. */
    suspend fun export(projectId: String, lang: String, dir: File): File {
        dir.mkdirs()
        val file = File(dir, "pipeline-${java.time.LocalDate.now()}.xlsx")
        val part = File(file.path + ".part").also { it.delete() }
        api.download("${base(projectId)}/export?lang=$lang", part, null)
        part.renameTo(file)
        return file
    }
}
