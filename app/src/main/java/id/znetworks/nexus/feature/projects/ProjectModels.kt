package id.znetworks.nexus.feature.projects

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

// API.md §2.4. Everything optional past the id: a field the server renames costs a label, not a screen.

@Serializable
data class UserRef(val id: String? = null, val name: String? = null, val email: String? = null, val avatar: String? = null,
                   /** Set on task people whose account was offboarded (GET /api/tasks/:id, 8 Oct). */
                   val deactivatedAt: String? = null)

@Serializable
data class ProjectMemberRef(val userId: String? = null, val role: String? = null, val user: UserRef? = null,
                            /** FULL | EDIT | COMMENT | VIEW (access levels, 13 Oct); older servers send none. */
                            val accessLevel: String? = null) {
    val uid: String get() = userId ?: user?.id.orEmpty()
}

@Serializable
data class LaneCount(val tasks: Int? = null)

@Serializable
data class LaneSummary(val id: String? = null, @SerialName("_count") val count: LaneCount? = null)

@Serializable
data class ProjectCounts(val members: Int? = null, val taskLists: Int? = null, val tasks: Int? = null)

/** One project of `GET /api/projects`. */
@Serializable
data class Project(
    val id: String,
    val name: String = "",
    val description: String? = null,
    val color: String? = null,
    val icon: String? = null,
    val status: String? = null,
    val folderId: String? = null,
    val workspaceId: String? = null,
    val position: Int? = null,
    val type: String? = null,
    @SerialName("_count") val count: ProjectCounts? = null,
    val taskLists: List<LaneSummary> = emptyList(),
    val members: List<ProjectMemberRef> = emptyList(),
) {
    val taskCount: Int get() = taskLists.sumOf { it.count?.tasks ?: 0 }
    val laneCount: Int get() = count?.taskLists ?: taskLists.size
    val memberCount: Int get() = count?.members ?: members.size
}

/** `GET /api/project-folders`: nests through [parentFolderId]. */
@Serializable
data class ProjectFolder(
    val id: String,
    val name: String = "",
    val icon: String? = null,
    val color: String? = null,
    val position: Int? = null,
    val parentFolderId: String? = null,
    val workspaceId: String? = null,
    /** The folder calendar's curated projects; empty = every project in the folder. */
    val aggregateProjectIds: List<String>? = null,
)

@Serializable
data class TaskCounts(val comments: Int? = null, val subtasks: Int? = null)

@Serializable
data class Assignee(val userId: String? = null, val user: UserRef? = null)

@Serializable
data class SubRef(val id: String? = null, val status: String? = null)

@Serializable
data class QuestRef(val id: String, val title: String? = null, val xpReward: Int? = null, val total: Int? = null, val done: Int? = null)

@Serializable
data class TaskListRef(val id: String? = null, val name: String? = null, val projectId: String? = null, val project: ProjectRef? = null)

@Serializable
data class ProjectRef(val id: String? = null, val name: String? = null, val color: String? = null, val icon: String? = null)

@Serializable
data class FieldRef(val name: String? = null, val type: String? = null, val options: JsonElement? = null)

@Serializable
data class CustomFieldValue(val customFieldId: String? = null, val value: JsonElement? = null, val customField: FieldRef? = null)

/**
 * A card: from the project's lanes (top-level, with subtasks/custom fields) or from `GET /api/tasks`
 * (flat, with taskList). [parentTitle] is filled client-side for subtasks.
 */
@Serializable
data class BoardTask(
    val id: String,
    val title: String = "",
    /** When it was finished / last touched (THREADS-TASK-FOLDERS: Home leaves out work done over 30 days ago). */
    val completedAt: String? = null,
    /** Who marked it done (project Overview's "Recently completed"). */
    val completedById: String? = null,
    val updatedAt: String? = null,
    val status: String? = null,
    val priority: String? = null,
    val startDate: String? = null,
    val dueDate: String? = null,
    val position: Int? = null,
    val parentId: String? = null,
    val taskListId: String? = null,
    val assignees: List<Assignee> = emptyList(),
    val subtasks: List<SubRef> = emptyList(),
    @SerialName("_count") val count: TaskCounts? = null,
    val customFieldValues: List<CustomFieldValue> = emptyList(),
    val quests: List<QuestRef> = emptyList(),
    val taskList: TaskListRef? = null,
    val parentTitle: String? = null,
) {
    val isDone: Boolean get() = status.equals("DONE", true)
    val isSubtask: Boolean get() = !parentId.isNullOrBlank()
    val projectId: String? get() = taskList?.projectId ?: taskList?.project?.id
    val doneSubs: Int get() = subtasks.count { it.status.equals("DONE", true) }
    val questXp: Int get() = quests.sumOf { it.xpReward ?: 0 }
}

@Serializable
data class Lane(
    val id: String, val name: String = "", val position: Int? = null, val tasks: List<BoardTask> = emptyList(),
    /** The task status this section stands for (DEV-REDESIGN §1, TaskList.taskStatus); null = a plain section. */
    val taskStatus: String? = null,
    /** The status option's colour key (gray, blue, …; StatusOptions.palette); null = by its status. */
    val color: String? = null,
)

/** `GET /api/projects/{id}`. */
@Serializable
data class ProjectDetail(
    val id: String,
    val name: String = "",
    val description: String? = null,
    val color: String? = null,
    val icon: String? = null,
    val status: String? = null,
    val workspaceId: String? = null,
    val taskLists: List<Lane> = emptyList(),
    val members: List<ProjectMemberRef> = emptyList(),
    // Decoded but no longer read (PROJECT-CUSTOMIZE-CLEANUP, 11 Oct): the server always reports duplicate mode on
    // and P&L, Finance, proof-before-Done and calendar mode off, and ignores writes to them.
    val enableTaskBatchDuplicate: Boolean? = null,
    val enablePnlDashboard: Boolean? = null,
    val autoAssignEnabled: Boolean? = null,
    val autoAssignAssigneeIds: List<String> = emptyList(),
    val requireAttachmentForDone: Boolean? = null,
    val disableTaskStatus: Boolean? = null,
    /** "TASK" | "FINANCE" | "CONTENT" | "PIPELINE" (9 Oct); missing = TASK. */
    val type: String? = null,
    /** Tab keys this project hides: raw, read leniently by ProjectTabsLogic. */
    val hiddenTabs: kotlinx.serialization.json.JsonElement? = null,
    val financeEnabled: kotlinx.serialization.json.JsonElement? = null,
    /** The template it was built from (DEV-REDESIGN §1); null = blank. */
    val templateId: String? = null,
    /** The viewer's level here (FULL | EDIT | COMMENT | VIEW, 13 Oct); null = an older server, nothing is gated. */
    val viewerAccessLevel: String? = null,
    /** May manage the project (members, settings); null = an older server. */
    val viewerCanManage: Boolean? = null,
)

/** Custom field options arrive as `[..]`, `{options:[..]}` or `{choices:[..]}` (API.md §2.4). */
fun optionList(options: JsonElement?): List<String> {
    val arr = when (options) {
        is JsonArray -> options
        is JsonObject -> (options["options"] ?: options["choices"]) as? JsonArray
        else -> null
    } ?: return emptyList()
    return arr.mapNotNull { e ->
        when (e) {
            is JsonPrimitive -> e.contentOrNull
            is JsonObject -> (e["label"] as? JsonPrimitive)?.contentOrNull ?: (e["value"] as? JsonPrimitive)?.contentOrNull
            else -> null
        }
    }
}

/** A custom field value as display text (string, string[], or `{label, mapUrl}`). */
fun valueText(v: JsonElement?): String? = when (v) {
    null -> null
    is JsonPrimitive -> v.contentOrNull?.takeIf { it.isNotBlank() }
    is JsonArray -> v.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ").takeIf { it.isNotBlank() }
    is JsonObject -> (v["label"] as? JsonPrimitive)?.contentOrNull
}

object TaskEnums {
    val STATUSES = listOf("TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED")
    val PRIORITIES = listOf("URGENT", "HIGH", "MEDIUM", "LOW", "NONE")
}
