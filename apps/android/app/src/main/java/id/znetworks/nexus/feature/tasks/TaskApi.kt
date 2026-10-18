package id.znetworks.nexus.feature.tasks

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.Uploads
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.Request

/** One task and what hangs off it: comments, files, dependencies, time, quests (API.md §2.4). */
class TaskApi(private val api: ApiClient, private val uploads: Uploads) {

    suspend fun saveDescription(taskId: String, text: String, baseText: String) = api.send(
        Request.Builder().url(api.url("/api/tasks/$taskId/body"))
            .put(id.znetworks.nexus.core.net.ConcurrentEdits.description(text, baseText).toString().toJsonBody()).build(), JsonObject.serializer())

    suspend fun task(id: String) = api.getCached("/api/tasks/$id", "task-$id", TaskDetail.serializer())

    suspend fun attachments(taskId: String) =
        api.getCached("/api/attachments?taskId=$taskId", "task-attachments-$taskId", ListSerializer(Attachment.serializer()))

    suspend fun upload(taskId: String, file: Uploads.Picked, onProgress: (Long, Long) -> Unit): Attachment =
        uploads.send(file, "/api/attachments", listOf("taskId" to taskId), listOf("taskId" to taskId), Attachment.serializer(), onProgress)

    suspend fun deleteAttachment(id: String) = delete("/api/attachments/$id")

    suspend fun comment(taskId: String, content: String) = post("/api/tasks/$taskId/comments", buildJsonObject { put("content", content.trim()) })

    suspend fun dependencies(taskId: String) = api.get("/api/tasks/$taskId/dependencies", Dependencies.serializer())

    suspend fun addDependency(taskId: String, dependsOn: String) =
        post("/api/tasks/$taskId/dependencies", buildJsonObject { put("dependsOnTaskId", dependsOn); put("type", "BLOCKING") })

    suspend fun removeDependency(taskId: String, dependencyId: String) = delete("/api/tasks/$taskId/dependencies?id=$dependencyId")

    suspend fun timeEntries(taskId: String) = api.get("/api/time-entries?taskId=$taskId", TimeEntries.serializer()).entries

    suspend fun logTime(taskId: String, minutes: Int, note: String?) = post("/api/time-entries", buildJsonObject {
        put("taskId", taskId); put("duration", minutes); note?.takeIf { it.isNotBlank() }?.let { put("description", it.trim()) }
    })

    /** BoD: a quest that completes when this task is DONE; XP to the assignee, capped at 50. */
    suspend fun createTaskQuest(taskId: String, title: String, xp: Int) = post("/api/gamification/quests/admin", buildJsonObject {
        put("title", title.trim()); put("xpReward", xp.coerceIn(1, 50)); put("requirementType", "specific_tasks")
        putJsonArray("taskIds") { add(JsonPrimitive(taskId)) }
    })

    private suspend fun post(path: String, body: JsonElement): JsonObject =
        api.send(Request.Builder().url(api.url(path)).post(body.toString().toJsonBody()).build(), JsonObject.serializer())

    private suspend fun delete(path: String): JsonObject =
        api.send(Request.Builder().url(api.url(path)).delete().build(), JsonObject.serializer())
}
