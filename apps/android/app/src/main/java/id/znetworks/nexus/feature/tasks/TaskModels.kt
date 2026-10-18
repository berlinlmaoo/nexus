package id.znetworks.nexus.feature.tasks

import id.znetworks.nexus.feature.projects.Assignee
import id.znetworks.nexus.feature.projects.QuestRef
import id.znetworks.nexus.feature.projects.UserRef
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// API.md §2.4, GET /api/tasks/{id} and its satellites. Tolerant like every other model.

@Serializable
data class Comment(val id: String, val content: String = "", val parentId: String? = null, val createdAt: String? = null, val user: UserRef? = null)

@Serializable
data class ParentRef(val id: String, val title: String? = null)

@Serializable
data class SubtaskDetail(val id: String, val title: String = "", val status: String? = null, val assignees: List<Assignee> = emptyList()) {
    val isDone get() = status.equals("DONE", true)
}

@Serializable
data class TaskProjectRef(val id: String? = null, val name: String? = null, val color: String? = null, val icon: String? = null)

@Serializable
data class TaskListInfo(val id: String? = null, val name: String? = null, val projectId: String? = null, val project: TaskProjectRef? = null) {
    val pid: String? get() = project?.id ?: projectId
}

@Serializable
data class ActivityLog(val id: String, val action: String? = null, val details: JsonElement? = null, val createdAt: String? = null, val user: UserRef? = null)

@Serializable
data class TaskDetail(
    val id: String,
    val updatedAt: String? = null,
    val tags: List<String> = emptyList(),
    val title: String = "",
    val description: JsonElement? = null,
    val status: String? = null,
    val priority: String? = null,
    val startDate: String? = null,
    val dueDate: String? = null,
    val taskListId: String? = null,
    val assignees: List<Assignee> = emptyList(),
    val subtasks: List<SubtaskDetail> = emptyList(),
    val comments: List<Comment> = emptyList(),
    val parent: ParentRef? = null,
    val taskList: TaskListInfo? = null,
    val activityLogs: List<ActivityLog> = emptyList(),
    val creator: UserRef? = null,
    val likeCount: Int? = null,
    val liked: Boolean? = null,
    val quests: List<QuestRef> = emptyList(),
) {
    val isDone get() = status.equals("DONE", true)
    val projectId: String? get() = taskList?.pid
    val descriptionText: String get() = blockText(description)
}

@Serializable
data class Attachment(
    val id: String,
    val filename: String? = null,
    val name: String? = null,
    val url: String? = null,
    val mimeType: String? = null,
    val size: Long? = null,
    val kind: String? = null,
    val createdAt: String? = null,
) {
    val label: String get() = name ?: filename ?: "file"
    val isImage: Boolean get() = mimeType.orEmpty().startsWith("image/")
}

@Serializable
data class DepTask(val id: String, val title: String = "", val status: String? = null)

@Serializable
data class Dependency(val id: String, val type: String? = null, val dependsOnTask: DepTask? = null, val task: DepTask? = null)

@Serializable
data class Dependencies(val dependencies: List<Dependency> = emptyList(), val dependedOnBy: List<Dependency> = emptyList())

@Serializable
data class TimeEntry(val id: String, val duration: Int? = null, val description: String? = null, val startTime: String? = null, val user: UserRef? = null)

@Serializable
data class TimeEntries(val entries: List<TimeEntry> = emptyList())

/**
 * A description is a plain string or a BlockNote document (array/object of blocks with inline
 * `content` and nested `children`); flattened to text, one block per line (iOS `blockText`).
 */
fun blockText(e: JsonElement?): String = when (e) {
    null -> ""
    is JsonPrimitive -> e.contentOrNull.orEmpty()
    is JsonArray -> e.joinToString("\n") { blockText(it) }.trim()
    is JsonObject -> {
        val own = when (val content = e["content"]) {
            is JsonArray -> content.joinToString("") { inline ->
                (inline as? JsonObject)?.let { (it["text"] as? JsonPrimitive)?.contentOrNull ?: blockText(it["content"]) } ?: ""
            }
            is JsonPrimitive -> content.contentOrNull.orEmpty()
            else -> (e["text"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        }
        val kids = (e["children"] as? JsonArray)?.joinToString("\n") { blockText(it) }.orEmpty()
        listOf(own, kids).filter { it.isNotBlank() }.joinToString("\n")
    }
}
