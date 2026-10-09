package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
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
            PipelineChange(c["id"].str().orEmpty(), c["field"].str().orEmpty(), c["before"], c["after"], c["createdAt"].str(), PipelinePerson.of(c["user"]),
                c["termId"].str(), c["termLabel"].str())
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

    /**
     * The people the BD and PM pickers offer: the board PROJECT's members (§11.1 — whoever its lead added),
     * read fresh so someone just added is offered at once. Anyone else goes in by name.
     */
    suspend fun people(projectId: String): List<PipelinePerson> =
        api.get("/api/projects/${enc(projectId)}/members", JsonArray.serializer()).mapNotNull { m ->
            val o = m as? JsonObject ?: return@mapNotNull null
            val u = o["user"] as? JsonObject
            val uid = o["userId"].str() ?: u?.get("id").str() ?: return@mapNotNull null
            PipelinePerson(uid, u?.get("name").str() ?: u?.get("email").str(), u?.get("image").str() ?: u?.get("avatar").str())
        }

    // Payment terms (§11.2): each call answers the whole deal, whose receivable and health changed.
    private fun termDeal(o: JsonObject) = (o["deal"] as? JsonObject)?.let(::PipelineDeal)

    /** POST …/terms: any of label, amount, dueDate, invoiceNo, invoiceDate, paidAmount, paidAt, note (blank label → "Termin n"). */
    suspend fun addTerm(projectId: String, dealId: String, fields: JsonObject) = termDeal(
        api.send(Request.Builder().url(api.url("${base(projectId)}/${enc(dealId)}/terms")).post(fields.toString().toJsonBody()).build(), JsonObject.serializer()))

    /** PATCH one term: only the fields sent change. "Mark paid" = paidAmount (total received) + paidAt. */
    suspend fun updateTerm(projectId: String, dealId: String, termId: String, fields: JsonObject) = termDeal(
        api.send(Request.Builder().url(api.url("${base(projectId)}/${enc(dealId)}/terms/${enc(termId)}")).patch(fields.toString().toJsonBody()).build(), JsonObject.serializer()))

    /** Restorable from Control Room › Audit ("pipeline_term"). */
    suspend fun deleteTerm(projectId: String, dealId: String, termId: String) = termDeal(
        api.send(Request.Builder().url(api.url("${base(projectId)}/${enc(dealId)}/terms/${enc(termId)}")).delete().build(), JsonObject.serializer()))

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
