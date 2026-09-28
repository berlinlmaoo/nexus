package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.Request
import java.net.URLEncoder

/** Projects, folders and task writes (API.md §2.4). Reads go through the response cache. */
class ProjectsApi(private val api: ApiClient) {

    suspend fun projects() = api.getCached("/api/projects", "projects", ListSerializer(Project.serializer()))

    suspend fun folders() = api.getCached("/api/project-folders", "project-folders", ListSerializer(ProjectFolder.serializer()))

    suspend fun project(id: String) = api.getCached("/api/projects/$id", "project-$id", ProjectDetail.serializer())

    /** Every task of a project, subtasks included (flat). */
    suspend fun projectTasks(id: String) = api.getCached("/api/tasks?projectId=$id", "project-tasks-$id", ListSerializer(BoardTask.serializer()))

    /** Tasks of several projects at once (card tallies, folder calendar). */
    suspend fun tasksOf(projectIds: List<String>): List<BoardTask> =
        if (projectIds.isEmpty()) emptyList()
        else api.get("/api/tasks?projectIds=${projectIds.joinToString(",")}", ListSerializer(BoardTask.serializer()))

    /** The person's own tasks, cached per person so two people on one phone never see each other's. */
    suspend fun myTasks(userId: String) = api.getCached("/api/tasks?assigneeId=$userId", "tasks-$userId", ListSerializer(BoardTask.serializer()))

    suspend fun searchTasks(q: String): List<BoardTask> =
        api.get("/api/tasks?search=${URLEncoder.encode(q, "UTF-8")}", ListSerializer(BoardTask.serializer()))

    suspend fun createProject(name: String, workspaceId: String, color: String?, icon: String?, folderId: String?): String {
        val body = buildJsonObject {
            put("name", name.trim()); put("workspaceId", workspaceId)
            color?.let { put("color", it) }; icon?.let { put("icon", it) }; folderId?.let { put("folderId", it) }
        }
        return (post("/api/projects", body)["id"] as? JsonPrimitive)?.content.orEmpty()
    }

    /** Explicit JSON null moves a project to the root (omitting the key changes nothing). */
    suspend fun moveProject(projectId: String, folderId: String?) =
        patch("/api/projects/$projectId", JsonObject(mapOf("folderId" to (folderId?.let { JsonPrimitive(it) } ?: JsonNull))))

    /** Returns the new folder's id (needed to upload its photo icon). */
    suspend fun createFolder(workspaceId: String, name: String, icon: String?, color: String?, parentFolderId: String?): String? =
        post("/api/project-folders", buildJsonObject {
            put("workspaceId", workspaceId); put("name", name.trim())
            icon?.let { put("icon", it) }; color?.let { put("color", it) }; parentFolderId?.let { put("parentFolderId", it) }
        })["id"]?.let { (it as? JsonPrimitive)?.content }

    /** Photo icon (multipart `folderId` + `file`, ≤ 5 MB); the folder's icon becomes its `/…` path. */
    suspend fun uploadFolderIcon(folderId: String, jpeg: ByteArray) =
        api.send(Request.Builder().url(api.url("/api/upload/folder-icon")).post(MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("folderId", folderId)
            .addFormDataPart("file", "icon.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()).build(), JsonObject.serializer())

    suspend fun updateFolder(id: String, name: String, icon: String?, color: String?) =
        patch("/api/project-folders/$id", buildJsonObject {
            put("name", name.trim()); icon?.let { put("icon", it) }; color?.let { put("color", it) }
        })

    suspend fun deleteFolder(id: String) = delete("/api/project-folders/$id")

    // region tasks

    suspend fun createTask(
        projectId: String, taskListId: String, title: String, priority: String?, dueDate: String?, parentId: String? = null,
        assigneeIds: List<String> = emptyList(),
    ): String {
        val body = buildJsonObject {
            put("title", title.trim()); put("projectId", projectId); put("taskListId", taskListId); put("status", "TODO")
            if (priority != null && priority != "NONE") put("priority", priority)
            dueDate?.let { put("dueDate", it) }
            parentId?.let { put("parentId", it) }
            if (assigneeIds.isNotEmpty()) putJsonArray("assigneeIds") { assigneeIds.forEach { add(JsonPrimitive(it)) } }
        }
        return (post("/api/tasks", body)["id"] as? JsonPrimitive)?.content.orEmpty()
    }

    /** Any subset of the task fields; a JSON null clears a date. */
    suspend fun updateTask(taskId: String, fields: JsonObject) = patch("/api/tasks/$taskId", fields)

    suspend fun deleteTask(taskId: String) = delete("/api/tasks/$taskId")

    // endregion

    // region project tabs

    suspend fun sprints(projectId: String) = api.get("/api/sprints?projectId=$projectId", SprintsResponse.serializer()).sprints

    suspend fun createSprint(projectId: String, name: String, start: String, end: String) = post("/api/sprints", buildJsonObject {
        put("projectId", projectId); put("name", name.trim()); put("startDate", start); put("endDate", end)
    })

    /** [moveIncompleteTo]: a sprint id or "backlog"; without it, completing with open cards changes nothing. */
    suspend fun setSprintStatus(id: String, status: String, moveIncompleteTo: String? = null): SprintPatchReply =
        api.send(Request.Builder().url(api.url("/api/sprints")).patch(buildJsonObject {
            put("id", id); put("status", status); moveIncompleteTo?.let { put("moveIncompleteTo", it) }
        }.toString().toJsonBody()).build(), SprintPatchReply.serializer())

    suspend fun automations(projectId: String) = api.get("/api/automations?projectId=$projectId", AutomationsResponse.serializer()).automations

    suspend fun setAutomation(id: String, enabled: Boolean) = patch("/api/automations", buildJsonObject { put("id", id); put("enabled", enabled) })

    suspend fun finance(projectId: String, year: Int) = api.get("/api/finance/dashboard?projectId=$projectId&year=$year", FinanceDashboard.serializer())

    suspend fun pnl(projectId: String, year: Int) = api.get("/api/pnl/dashboard?projectId=$projectId&year=$year", PnlDashboard.serializer())

    suspend fun customFields(projectId: String) = api.get("/api/custom-fields?projectId=$projectId", CustomFieldsResponse.serializer()).fields.sortedBy { it.position ?: Int.MAX_VALUE }

    // region settings, fields, members (API.md §2.4)

    suspend fun taskFields(projectId: String, taskId: String) =
        api.get("/api/custom-fields?projectId=$projectId&taskId=$taskId", CustomFieldsResponse.serializer()).fields.sortedBy { it.position ?: Int.MAX_VALUE }

    /** string for TEXT/SELECT/STATUS/NUMBER/DATE, string[] for MULTI_SELECT, {label,mapUrl} for PLACE. */
    suspend fun setFieldValue(fieldId: String, taskId: String, value: JsonElement) =
        patch("/api/custom-fields", buildJsonObject { put("id", fieldId); put("taskId", taskId); put("value", value) })

    suspend fun createField(projectId: String, name: String, type: String, options: List<String>) = post("/api/custom-fields", buildJsonObject {
        put("projectId", projectId); put("name", name.trim()); put("type", type)
        if (options.isNotEmpty()) putJsonArray("options") { options.forEach { add(JsonPrimitive(it)) } }
    })

    suspend fun deleteField(id: String) = delete("/api/custom-fields?id=$id")

    suspend fun updateProject(id: String, fields: JsonObject) = patch("/api/projects/$id", fields)

    suspend fun deleteProject(id: String) = delete("/api/projects/$id")

    /** BoD+: returns the copy's id. */
    suspend fun duplicateProject(id: String): String =
        (api.send(Request.Builder().url(api.url("/api/projects/$id/duplicate")).post("".toJsonBody()).build(), JsonObject.serializer())["id"] as? JsonPrimitive)?.content.orEmpty()

    suspend fun roster() = api.get("/api/workspaces/members", Roster.serializer())

    suspend fun addMember(projectId: String, userId: String) = post("/api/projects/$projectId/members", buildJsonObject { put("userId", userId); put("role", "MEMBER") })

    /** A JSON body on a DELETE (the route reads it). */
    suspend fun removeMember(projectId: String, userId: String): JsonObject =
        api.send(Request.Builder().url(api.url("/api/projects/$projectId/members")).delete(buildJsonObject { put("userId", userId) }.toString().toJsonBody()).build(), JsonObject.serializer())

    suspend fun invite(projectId: String, email: String, role: String) = post("/api/projects/$projectId/invite", buildJsonObject { put("email", email.trim()); put("role", role) })

    // endregion

    private suspend fun post(path: String, body: JsonElement): JsonObject =
        api.send(Request.Builder().url(api.url(path)).post(body.toString().toJsonBody()).build(), JsonObject.serializer())

    private suspend fun patch(path: String, body: JsonElement): JsonObject =
        api.send(Request.Builder().url(api.url(path)).patch(body.toString().toJsonBody()).build(), JsonObject.serializer())

    private suspend fun delete(path: String): JsonObject =
        api.send(Request.Builder().url(api.url(path)).delete().build(), JsonObject.serializer())
}
