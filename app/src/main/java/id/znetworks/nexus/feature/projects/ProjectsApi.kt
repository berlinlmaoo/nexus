package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

    suspend fun createFolder(workspaceId: String, name: String, icon: String?, color: String?, parentFolderId: String?) {
        post("/api/project-folders", buildJsonObject {
            put("workspaceId", workspaceId); put("name", name.trim())
            icon?.let { put("icon", it) }; color?.let { put("color", it) }; parentFolderId?.let { put("parentFolderId", it) }
        })
    }

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

    private suspend fun post(path: String, body: JsonElement): JsonObject =
        api.send(Request.Builder().url(api.url(path)).post(body.toString().toJsonBody()).build(), JsonObject.serializer())

    private suspend fun patch(path: String, body: JsonElement): JsonObject =
        api.send(Request.Builder().url(api.url(path)).patch(body.toString().toJsonBody()).build(), JsonObject.serializer())

    private suspend fun delete(path: String): JsonObject =
        api.send(Request.Builder().url(api.url(path)).delete().build(), JsonObject.serializer())
}
