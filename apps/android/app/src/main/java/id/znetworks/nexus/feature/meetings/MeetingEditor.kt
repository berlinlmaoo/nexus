package id.znetworks.nexus.feature.meetings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

data class MeetingState(val meeting: Meeting? = null, val loading: Boolean = true, val saving: Boolean = false, val busy: Boolean = false, val error: Int? = null, val notice: Int? = null, val deleted: Boolean = false, val dirty: Boolean = false)

internal fun meetingProblem(code: String?): Int = when (code?.lowercase()) {
    "unsupported_type" -> R.string.meet_unsupported_type
    "too_large", "chunk_too_large" -> R.string.meet_too_large
    "too_long" -> R.string.meet_too_long
    "undecodable" -> R.string.meet_undecodable
    "no_speech" -> R.string.meet_no_speech
    "audio_missing", "audio_gone", "local_audio_missing" -> R.string.meet_audio_missing
    "upload_abandoned" -> R.string.meet_upload_abandoned
    "transcriber_unreachable" -> R.string.meet_transcriber_unreachable
    "transcribe_failed" -> R.string.meet_transcribe_failed
    "gpu_busy" -> R.string.meet_gpu_busy
    "gideon_failed" -> R.string.meet_gideon_failed
    "gideon_off" -> R.string.meet_gideon_off
    "credits_exhausted" -> R.string.meet_credits_exhausted
    "owner_gone" -> R.string.meet_owner_gone
    "deleted" -> R.string.meet_deleted
    "needs_edit_access", "owner_only" -> R.string.meet_needs_edit_access
    "disabled" -> R.string.meet_disabled
    "too_many_uploads" -> R.string.meet_too_many_uploads
    "rate_limited" -> R.string.meet_rate_limited
    "empty_file" -> R.string.meet_empty_file
    "needs_project" -> R.string.meet_need_project
    "no_section" -> R.string.meet_no_section
    "not_ready" -> R.string.meet_not_ready
    "upload_failed" -> R.string.meet_upload_failed
    else -> R.string.meet_save_failed
}

/** Apply local fields over the latest version while preserving a server's fresh member list and permissions. */
internal fun meetingMerge(meeting: Meeting, fields: Map<String, JsonElement>): Meeting {
    val json = NexusJson.encodeToJsonElement(Meeting.serializer(), meeting).jsonObject
    return NexusJson.decodeFromJsonElement(Meeting.serializer(), JsonObject(json + fields))
}

class MeetingEditor(application: Application) : AndroidViewModel(application) {
    private val container = (application as NexusApplication).container
    val api = MeetingsApi(container.api)
    private val mutable = MutableStateFlow(MeetingState())
    val state = mutable.asStateFlow()
    private var id: String? = null
    private val pending = linkedMapOf<String, JsonElement>()
    private val saveLock = Mutex()
    private var delaySave: Job? = null
    private var version = 0
    fun open(value: String) {
        if (id == value) return
        id = value; viewModelScope.launch { refresh() }
    }
    suspend fun refresh() {
        val key = id ?: return
        try {
            val fresh = api.get(key)
            if (!mutable.value.saving && pending.isEmpty() && (mutable.value.meeting?.version ?: -1) <= fresh.version) { version = fresh.version; mutable.update { it.copy(meeting = fresh, loading = false, error = null) } }
        } catch (e: ApiError.Http) {
            if (e.status == 404) mutable.update { it.copy(deleted = true, notice = R.string.meet_deleted, loading = false) }
            else mutable.update { it.copy(error = R.string.meet_load_failed, loading = false) }
        } catch (_: ApiError) { mutable.update { it.copy(error = R.string.meet_load_failed, loading = false) } }
    }
    fun change(fields: JsonObject) {
        val current = mutable.value.meeting ?: return
        pending.putAll(fields)
        mutable.update { it.copy(meeting = meetingMerge(current, fields), dirty = true, error = null) }
        delaySave?.cancel()
        delaySave = viewModelScope.launch { delay(650); viewModelScope.launch { save() } }
    }
    suspend fun save(): Boolean = saveLock.withLock {
        val key = id ?: return@withLock false
        if (pending.isEmpty()) return@withLock mutable.value.error == null
        mutable.update { it.copy(saving = true) }
        try {
            while (pending.isNotEmpty()) {
                val fields = pending.toMap(); pending.clear()
                try {
                    val fresh = api.patch(key, version, JsonObject(fields))
                    version = fresh.version
                    mutable.update { it.copy(meeting = meetingMerge(fresh, pending), dirty = pending.isNotEmpty(), error = null) }
                } catch (e: ApiError.Http) {
                    val remote = e.body?.get("meeting")?.let { runCatching { NexusJson.decodeFromJsonElement(Meeting.serializer(), it) }.getOrNull() }
                    if (e.code == "VERSION_CONFLICT" && remote != null) {
                        pending.clear(); version = remote.version
                        mutable.update { it.copy(meeting = remote, notice = R.string.meet_conflict, dirty = false, error = null) }
                    } else { requeue(fields); mutable.update { it.copy(error = meetingProblem(e.code), dirty = true) } }
                    return@withLock false
                } catch (_: ApiError) { requeue(fields); mutable.update { it.copy(error = R.string.meet_save_failed, dirty = true) }; return@withLock false }
            }
            true
        } finally { mutable.update { it.copy(saving = false) } }
    }
    private fun requeue(fields: Map<String, JsonElement>) { val newer = pending.toMap(); pending.clear(); pending.putAll(fields); pending.putAll(newer) }
    fun action(kind: String, lang: String = "en") {
        if (mutable.value.busy) return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            try {
                if (kind == "delete") {
                    api.delete(id!!); pending.clear(); mutable.update { it.copy(deleted = true, notice = R.string.meet_deleted) }; return@launch
                }
                if (!save()) return@launch
                val m = mutable.value.meeting ?: return@launch
                val result = when (kind) {
                    "apply" -> {
                        if (!MeetingRules.canApply(m)) { mutable.update { it.copy(error = if (m.projectId == null) R.string.meet_need_project else R.string.meet_empty_title) }; return@launch }
                        api.post(m.id, "/apply", buildJsonObject {
                            put("projectId", m.projectId); put("title", m.title); put("overview", m.overview.orEmpty()); put("mom", NexusJson.encodeToJsonElement(MeetingMom.serializer(), m.mom ?: MeetingMom()))
                            put("proposals", NexusJson.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(MeetingProposal.serializer()), m.proposals)); put("lang", lang)
                        })
                    }
                    else -> api.post(m.id, "/retry", buildJsonObject { if (kind == "rewrite") put("stage", "minutes") })
                }
                val full = if (result.status == "APPLIED") runCatching { api.get(result.id) }.getOrDefault(result) else result
                version = full.version; mutable.update { it.copy(meeting = full, error = null) }
            } catch (e: ApiError.Http) {
                val remote = e.body?.get("meeting")?.let { runCatching { NexusJson.decodeFromJsonElement(Meeting.serializer(), it) }.getOrNull() }
                if (e.code == "ALREADY_APPLIED" && remote != null) { version = remote.version; mutable.update { it.copy(meeting = remote) } }
                else mutable.update { it.copy(error = meetingProblem(e.code)) }
            } catch (_: ApiError) { mutable.update { it.copy(error = R.string.meet_save_failed) } }
            finally { mutable.update { it.copy(busy = false) } }
        }
    }
    fun deleted() { pending.clear(); mutable.update { it.copy(deleted = true, notice = R.string.meet_deleted) } }
    fun noticeSeen() { mutable.update { it.copy(notice = null) } }
}
