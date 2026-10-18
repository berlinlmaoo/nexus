package id.znetworks.nexus.feature.meetings

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.gideon.GProjectOption
import id.znetworks.nexus.feature.gideon.GTaskMember
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.*
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

@Serializable data class Meeting(
    val id: String, val title: String = "", val status: String = "UPLOADING", val progress: Double = 0.0,
    val language: String = "auto", val source: String = "upload", val projectId: String? = null, val project: GProjectOption? = null,
    val createdBy: GTaskMember? = null, val audio: MeetingAudio = MeetingAudio(), val durationSec: Double? = null,
    val recordedAt: String? = null, val detectedLanguage: String? = null, val tier: String? = null,
    val doc: MeetingDoc? = null, val taskCount: Int = 0, val errorCode: String? = null, val error: String? = null,
    val appliedAt: String? = null, val version: Int = 0, val createdAt: String? = null, val updatedAt: String? = null,
    val beta: Boolean = true, val can: MeetingCan = MeetingCan(), val queue: MeetingQueue? = null,
    val overview: String? = null, val mom: MeetingMom? = null, val proposals: List<MeetingProposal> = emptyList(),
    val speakers: Map<String, MeetingSpeaker>? = null, val speakersMap: Map<String, MeetingSpeaker>? = null,
    val transcript: List<MeetingSegment> = emptyList(), val members: List<GTaskMember>? = null,
    val tasks: List<MeetingTask> = emptyList(),
) {
    val working get() = status in setOf("UPLOADING", "QUEUED", "TRANSCRIBING", "SUMMARIZING", "APPLYING")
    val editable get() = can.edit && status == "READY"
    val projectMembers get() = members.orEmpty()
}
@Serializable data class MeetingAudio(val name: String = "", val mime: String = "", val bytes: Long = 0, val received: Long = 0, val available: Boolean = false, val deletedAt: String? = null, val deleteAfter: String? = null)
@Serializable data class MeetingCan(val edit: Boolean = false, val apply: Boolean = false, val delete: Boolean = false, val retry: Boolean = false)
@Serializable data class MeetingQueue(val waiting: Boolean = false, val position: Int? = null, val etaSec: Double = 0.0)
@Serializable data class MeetingMom(val attendees: List<String> = emptyList(), val topics: List<MeetingTopic> = emptyList(), val decisions: List<String> = emptyList(), val openQuestions: List<String> = emptyList(), val actionItems: List<MeetingAction> = emptyList())
@Serializable data class MeetingTopic(val title: String = "", val points: List<String> = emptyList())
@Serializable data class MeetingAction(val text: String = "", val owner: String? = null, val due: String? = null)
@Serializable data class MeetingProposal(val key: String, val include: Boolean = true, val title: String = "", val description: String = "", val assigneeIds: List<String> = emptyList(), val dueDate: String? = null, val actionIndex: Int? = null)
@Serializable data class MeetingSpeaker(val name: String = "", val userId: String? = null)
@Serializable data class MeetingSegment(val start: Double = 0.0, val end: Double = 0.0, val text: String = "", val speaker: String? = null)
@Serializable data class MeetingTask(val id: String, val title: String = "", val status: String? = null, val dueDate: String? = null, val projectId: String? = null, val assignees: List<GTaskMember> = emptyList())
@Serializable data class MeetingDoc(val id: String, val title: String = "", val url: String? = null)
@Serializable data class MeetingEnvelope(val meeting: Meeting, val upload: MeetingUpload = MeetingUpload())
@Serializable data class MeetingUpload(val chunkBytes: Int = 8_388_608, val maxChunkBytes: Int = 16_777_216)
@Serializable data class MeetingChunk(val received: Long = 0, val complete: Boolean = false)
@Serializable data class MeetingList(val meetings: List<Meeting> = emptyList(), val settings: MeetingSettings = MeetingSettings())
@Serializable data class MeetingSettings(val enabled: Boolean = true, val maxMinutes: Int = 180, val maxBytes: Long = 500L * 1024 * 1024, val retentionDays: Int = 30)
@Serializable data class MeetingProject(val id: String, val name: String = "", val icon: String? = null, val viewerAccessLevel: String? = null, val archivedAt: String? = null)
@Serializable data class MeetingChanged(val meetingId: String, val projectId: String? = null, val status: String? = null, val progress: Double? = null, val version: Int? = null, val deleted: Boolean = false)

object MeetingRules {
    val extensions = setOf("m4a", "mp4", "mov", "mp3", "wav", "webm", "ogg", "oga", "opus", "aac", "flac", "3gp", "amr")
    fun accepts(name: String) = name.substringAfterLast('.', "").lowercase() in extensions
    fun editableProjects(projects: List<MeetingProject>) = projects.filter { it.archivedAt == null && (it.viewerAccessLevel == null || it.viewerAccessLevel in setOf("EDIT", "FULL")) }
    fun retryable(meeting: Meeting) = meeting.can.retry && meeting.errorCode !in setOf("unsupported_type", "too_long", "undecodable", "upload_abandoned") && (meeting.audio.available || meeting.transcript.isNotEmpty())
    fun canApply(meeting: Meeting) = meeting.status == "READY" && meeting.can.apply && !meeting.projectId.isNullOrBlank() && meeting.proposals.none { it.include && it.title.isBlank() }
    fun estimateMinutes(seconds: Double) = kotlin.math.ceil(seconds.coerceAtLeast(0.0) / 60).toInt().coerceAtLeast(1)
    fun timestamp(seconds: Double): String { val s = seconds.toInt().coerceAtLeast(0); return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60) }
}

class MeetingsApi(val api: ApiClient) {
    private fun path(id: String) = "/api/meetings/" + URLEncoder.encode(id, "UTF-8")
    suspend fun list(project: String? = null) = api.get("/api/meetings?limit=50" + (project?.let { "&projectId=" + URLEncoder.encode(it, "UTF-8") } ?: ""), MeetingList.serializer())
    suspend fun get(id: String) = api.get(path(id), MeetingEnvelope.serializer()).meeting
    suspend fun projects() = MeetingRules.editableProjects(api.get("/api/projects", ListSerializer(MeetingProject.serializer())))
    suspend fun create(body: JsonObject) = api.send(Request.Builder().url(api.url("/api/meetings")).post(body.toString().toJsonBody()).build(), MeetingEnvelope.serializer())
    suspend fun chunk(id: String, offset: Long, bytes: ByteArray) = api.send(Request.Builder().url(api.url(path(id) + "/audio?offset=$offset")).put(bytes.toRequestBody("application/octet-stream".toMediaType())).build(), MeetingChunk.serializer())
    suspend fun complete(id: String) = post(id, "/audio/complete", buildJsonObject {})
    suspend fun post(id: String, suffix: String, body: JsonObject) = api.send(Request.Builder().url(api.url(path(id) + suffix)).post(body.toString().toJsonBody()).build(), MeetingEnvelope.serializer()).meeting
    suspend fun patch(id: String, version: Int, fields: JsonObject): Meeting {
        val body = JsonObject(fields + ("version" to JsonPrimitive(version)))
        return try { api.send(Request.Builder().url(api.url(path(id))).patch(body.toString().toJsonBody()).build(), MeetingEnvelope.serializer()).meeting }
        catch (e: ApiError.Http) { throw e }
    }
    suspend fun delete(id: String) = api.send(Request.Builder().url(api.url(path(id))).delete().build(), JsonObject.serializer())
}
