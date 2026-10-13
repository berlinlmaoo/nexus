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

    /** The New project gallery (DEV-REDESIGN §1): every template, both languages. */
    suspend fun projectTemplates(): List<ProjectTemplate> =
        api.get("/api/project-templates", ProjectTemplatesResponse.serializer()).templates

    /**
     * [template]: built from it (Task Project only) in [lang] ("en"/"id": section, field and page names
     * become the project's own data); [starter] = its starter pages and tasks too.
     */
    suspend fun createProject(name: String, workspaceId: String, folderId: String?, type: ProjectType = ProjectType.TASK,
                              hiddenTabs: List<String>? = null, memberIds: List<String>? = null,
                              template: ProjectTemplate? = null, lang: String = "id", starter: Boolean = true, memberLevel: AccessLevel = AccessLevel.EDIT): String {
        val body = buildJsonObject {
            put("name", name.trim()); put("workspaceId", workspaceId)
            // No "icon" or "color": every project shares one default mark, the server stores its defaults (PROJECT-ICON, 11 Oct).
            folderId?.let { put("folderId", it) }
            // Task Project and Pipeline Dashboard exist; the others are 400 TYPE_COMING_SOON (PROJECT-TYPES-TABS).
            put("type", type.code)
            // PROJECT-SETUP-MEMBERS (server eecca18): starting tabs (TASK only) and members; left out when empty.
            if (type == ProjectType.TASK) hiddenTabs?.let { put("hiddenTabs", kotlinx.serialization.json.JsonArray(it.map(::JsonPrimitive))) }
            memberIds?.let { put("memberIds", kotlinx.serialization.json.JsonArray(it.map(::JsonPrimitive))); put("memberAccessLevel", memberLevel.code) }
            if (template != null && type == ProjectType.TASK) { put("templateId", template.id); put("lang", lang); put("starter", starter) }
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

    /**
     * A project's photo (multipart `projectId` + `file`, ≤ 5 MB, LEAD). Returns its `/api/files/…` url, which
     * the caller then PATCHes as the project's `icon` — the upload alone does not change the project.
     */
    suspend fun uploadProjectIcon(projectId: String, jpeg: ByteArray): String? =
        (api.send(Request.Builder().url(api.url("/api/upload/project-icon")).post(MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("projectId", projectId)
            .addFormDataPart("file", "icon.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()).build(), JsonObject.serializer())["url"] as? JsonPrimitive)?.content

    suspend fun updateFolder(id: String, name: String, icon: String?, color: String?) =
        patch("/api/project-folders/$id", buildJsonObject {
            put("name", name.trim()); icon?.let { put("icon", it) }; color?.let { put("color", it) }
        })

    /** Contents move up one level; nothing inside is deleted, and the folder is restorable from Audit. */
    suspend fun deleteFolder(id: String) = delete("/api/project-folders/$id")

    /** A folder (with all it holds) into another folder, or to the top level with null; 400 with a message on a bad place (FOLDERS-DND). */
    suspend fun moveFolder(id: String, parentFolderId: String?) =
        patch("/api/project-folders/$id", JsonObject(mapOf("parentFolderId" to (parentFolderId?.let { JsonPrimitive(it) } ?: JsonNull))))

    /** The person's pinned folders, in the server's order; [] from a server without folder pins. */
    suspend fun folderPins(): List<String> =
        (api.get("/api/project-folders/pins", JsonObject.serializer())["folderIds"] as? kotlinx.serialization.json.JsonArray)
            .orEmpty().mapNotNull { (it as? JsonPrimitive)?.content }

    suspend fun setFolderPin(folderId: String, pinned: Boolean) =
        post("/api/project-folders/pins", buildJsonObject { put("folderId", folderId); put("pinned", pinned) })

    /** The folder calendar's project subset ([] = all of the folder's projects, now and later). */
    suspend fun setFolderAggregate(id: String, projectIds: List<String>) =
        patch("/api/project-folders/$id", JsonObject(mapOf("aggregateProjectIds" to kotlinx.serialization.json.JsonArray(projectIds.map { JsonPrimitive(it) }))))

    /** The task status a section stands for (DEV-REDESIGN §1): tasks moved in take it; null = a plain section. */
    suspend fun setSectionStatus(projectId: String, sectionId: String, taskStatus: String?) =
        patch("/api/projects/$projectId/sections", JsonObject(mapOf("id" to JsonPrimitive(sectionId), "taskStatus" to (taskStatus?.let { JsonPrimitive(it) } ?: JsonNull))))

    // region tasks

    suspend fun createTask(
        projectId: String, taskListId: String, title: String, priority: String?, dueDate: String?, parentId: String? = null,
        assigneeIds: List<String> = emptyList(),
    ): String {
        val body = buildJsonObject {
            put("title", title.trim()); put("projectId", projectId); put("taskListId", taskListId)
            // No "status": the server gives the section's own (TaskList.taskStatus, DEV-REDESIGN §1), else TODO.
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

    /** A copy in the same list (subtasks, assignees, fields come along); [body] from TaskBulkLogic. */
    suspend fun duplicateTask(taskId: String, body: JsonObject) = post("/api/tasks/$taskId/duplicate", body)

    // endregion

    // region project tabs

    /** The project's rules and whether the caller may toggle / run them (DEV-REDESIGN §2). */
    suspend fun automations(projectId: String) = api.get("/api/automations?projectId=$projectId", AutomationsResponse.serializer())

    suspend fun setAutomation(id: String, enabled: Boolean) = patch("/api/automations", buildJsonObject { put("id", id); put("enabled", enabled) })

    /** One rule's run log, newest first; [before] = the oldest run shown (Load older). */
    suspend fun automationRuns(automationId: String, before: String? = null) =
        api.get("/api/automations/runs?automationId=${URLEncoder.encode(automationId, "UTF-8")}" + (before?.let { "&before=${URLEncoder.encode(it, "UTF-8")}" } ?: ""),
            AutomationRunsResponse.serializer())

    /** "Run now": once, by hand, on [taskId] or on no task (only task-free actions run then). LEAD only. */
    suspend fun runAutomation(id: String, taskId: String?): RunNowResponse =
        api.json.decodeFromJsonElement(RunNowResponse.serializer(), post("/api/automations/run", buildJsonObject { put("id", id); taskId?.let { put("taskId", it) } }))

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

    /**
     * Several people in one request (MEMBER-PICKER.md): `{ userIds }` → `{ added, alreadyMembers, unknown }`; anyone
     * already in is skipped, not an error. Answers how many were added.
     */
    suspend fun addMembers(projectId: String, userIds: Collection<String>, accessLevel: AccessLevel = AccessLevel.EDIT): Int {
        val o = post("/api/projects/$projectId/members", buildJsonObject {
            put("userIds", kotlinx.serialization.json.JsonArray(userIds.map { JsonPrimitive(it) }))
            // The level (13 Oct), exactly as the web sends it.
            put("accessLevel", accessLevel.code)
        })
        return (o["added"] as? kotlinx.serialization.json.JsonArray)?.size ?: if (o["userId"] != null || o["id"] != null) 1 else 0
    }

    /** A JSON body on a DELETE (the route reads it). */
    suspend fun removeMember(projectId: String, userId: String): JsonObject =
        api.send(Request.Builder().url(api.url("/api/projects/$projectId/members")).delete(buildJsonObject { put("userId", userId) }.toString().toJsonBody()).build(), JsonObject.serializer())

    suspend fun invite(projectId: String, email: String, level: AccessLevel) = post("/api/projects/$projectId/invite", buildJsonObject {
        put("email", email.trim()); put("accessLevel", level.code)
    })

    /** One member's level (Full access only; 409 LAST_OWNER would leave no Project Owner). */
    suspend fun setMemberAccess(projectId: String, userId: String, level: AccessLevel) =
        patch("/api/projects/$projectId/members", buildJsonObject { put("userId", userId); put("accessLevel", level.code) })

    // endregion

    // region status updates (project Overview, SPRINTS-OVERVIEW §3)

    /** Latest first. */
    suspend fun statusUpdates(projectId: String) =
        api.get("/api/status-updates?projectId=${URLEncoder.encode(projectId, "UTF-8")}", ListSerializer(StatusUpdate.serializer()))

    suspend fun postStatusUpdate(projectId: String, text: String) =
        post("/api/status-updates", buildJsonObject { put("projectId", projectId); put("text", text.trim()) })

    /** An AI draft from the project's tasks; the person edits it before posting. */
    suspend fun draftStatusUpdate(projectId: String): String =
        (post("/api/projects/$projectId/status-updates/generate", JsonObject(emptyMap()))["content"] as? JsonPrimitive)?.content.orEmpty()

    // endregion

    // region Redesign (13 Oct 2026): saved views, bulk edits with undo, manual order, status options

    suspend fun views(projectId: String) = api.get("/api/projects/$projectId/views", ProjectViewsResponse.serializer())

    suspend fun createView(projectId: String, name: String?, layout: String, shared: Boolean): ProjectView? =
        api.send(Request.Builder().url(api.url("/api/projects/$projectId/views")).post(buildJsonObject {
            put("name", name?.trim()?.takeIf { it.isNotEmpty() }?.let { JsonPrimitive(it) } ?: JsonNull)
            put("layout", layout); put("shared", shared)
            put("config", buildJsonObject { if (layout in setOf("board", "list", "table", "timeline")) put("groupBy", "section") })
        }.toString().toJsonBody()).build(), ProjectViewResponse.serializer()).view

    /** `patch` merges top-level config keys; [name] / [shared] when set. */
    suspend fun updateView(projectId: String, viewId: String, name: String? = null, shared: Boolean? = null, patch: JsonObject? = null, config: JsonObject? = null): ProjectView? =
        api.send(Request.Builder().url(api.url("/api/projects/$projectId/views/$viewId")).patch(buildJsonObject {
            name?.let { put("name", it.trim()) }; shared?.let { put("shared", it) }
            patch?.let { put("patch", it) }; config?.let { put("config", it) }
        }.toString().toJsonBody()).build(), ProjectViewResponse.serializer()).view

    suspend fun deleteView(projectId: String, viewId: String) = delete("/api/projects/$projectId/views/$viewId")

    /** Move to a section and/or set the priority (≤ 200 tasks); some may fail while the rest move. */
    suspend fun batchMove(projectId: String, taskIds: List<String>, taskListId: String? = null, priority: String? = null, status: String? = null): BatchResult =
        api.json.decodeFromJsonElement(BatchResult.serializer(), post("/api/tasks/batch-move", buildJsonObject {
            putJsonArray("taskIds") { taskIds.forEach { add(JsonPrimitive(it)) } }
            taskListId?.let { put("taskListId", it); put("projectContextId", projectId) }
            priority?.let { put("priority", it) }
            status?.let { put("status", it) }
        }))

    suspend fun addAssignee(taskId: String, userId: String) = post("/api/tasks/$taskId/assignees", buildJsonObject { put("userId", userId) })

    suspend fun removeAssignee(taskId: String, userId: String) =
        api.send(Request.Builder().url(api.url("/api/tasks/$taskId/assignees")).delete(buildJsonObject { put("userId", userId) }.toString().toJsonBody()).build(), JsonObject.serializer())

    /** The delete's audit entry, for Undo (null = an older server: no Undo offered). */
    suspend fun deleteTaskForUndo(taskId: String): String? = (delete("/api/tasks/$taskId")["auditLogId"] as? JsonPrimitive)?.takeIf { it.isString }?.content

    suspend fun undoDelete(auditLogIds: List<String>): BatchResult =
        api.json.decodeFromJsonElement(UndoDeleteResult.serializer(), post("/api/tasks/undo-delete", buildJsonObject {
            putJsonArray("auditLogIds") { auditLogIds.forEach { add(JsonPrimitive(it)) } }
        })).let { BatchResult(it.restored, it.failed) }

    /** A column's top-level order, top first (manual order). */
    suspend fun reorder(taskListId: String, orderedIds: List<String>, movedId: String?) = post("/api/tasks/reorder", buildJsonObject {
        put("taskListId", taskListId); putJsonArray("orderedIds") { orderedIds.forEach { add(JsonPrimitive(it)) } }; movedId?.let { put("movedId", it) }
    })

    /** The copy's id (`{task, copiedTo}`). */
    suspend fun duplicateTaskId(taskId: String, body: JsonObject): String? =
        ((duplicateTask(taskId, body)["task"] as? JsonObject)?.get("id") as? JsonPrimitive)?.content

    suspend fun createSection(projectId: String, name: String, taskStatus: String?, color: String?) = post("/api/projects/$projectId/sections", buildJsonObject {
        put("name", name.trim()); taskStatus?.let { put("taskStatus", it) }; color?.let { put("color", it) }
    })

    suspend fun updateSection(projectId: String, id: String, name: String? = null, position: Int? = null, color: String? = null) =
        patch("/api/projects/$projectId/sections", buildJsonObject { put("id", id); name?.let { put("name", it.trim()) }; position?.let { put("position", it) }; color?.let { put("color", it) } })

    suspend fun deleteSection(projectId: String, id: String, moveTo: String?) =
        api.send(Request.Builder().url(api.url("/api/projects/$projectId/sections")).delete(buildJsonObject { put("id", id); moveTo?.let { put("moveTo", it) } }.toString().toJsonBody()).build(), JsonObject.serializer())

    // endregion

    private suspend fun post(path: String, body: JsonElement): JsonObject =
        api.send(Request.Builder().url(api.url(path)).post(body.toString().toJsonBody()).build(), JsonObject.serializer())

    private suspend fun patch(path: String, body: JsonElement): JsonObject =
        api.send(Request.Builder().url(api.url(path)).patch(body.toString().toJsonBody()).build(), JsonObject.serializer())

    private suspend fun delete(path: String): JsonObject =
        api.send(Request.Builder().url(api.url(path)).delete().build(), JsonObject.serializer())
}

@kotlinx.serialization.Serializable
data class BatchFailure(val id: String? = null, val error: String? = null)

/** `batch-move` / `undo-delete`: what went through and what didn't (HTTP 200 either way). */
@kotlinx.serialization.Serializable
data class BatchResult(val moved: List<String> = emptyList(), val failed: List<BatchFailure> = emptyList())

@kotlinx.serialization.Serializable
data class UndoDeleteResult(val restored: List<String> = emptyList(), val failed: List<BatchFailure> = emptyList())
