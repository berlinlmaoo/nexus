from typing import Optional


def object_schema(description: str, properties: dict, required: Optional[list] = None) -> dict:
    return {
        "type": "object",
        "description": description,
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


PROJECT_STATUS = {"type": "string", "enum": ["ACTIVE", "ARCHIVED", "COMPLETED"]}
TASK_STATUS = {"type": "string", "enum": ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]}
TASK_PRIORITY = {"type": "string", "enum": ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]}
LIMIT = {"type": "integer", "minimum": 1, "maximum": 100}
CUSTOM_FIELD_UPDATES = {
    "type": "array",
    "description": "Custom field updates by fieldId/customFieldId or exact name. For Finance Harga, use name='Harga' and numeric rupiah value, e.g. 1500000.",
    "items": {
        "type": "object",
        "properties": {
            "fieldId": {"type": "string"},
            "customFieldId": {"type": "string"},
            "name": {"type": "string"},
            "fieldName": {"type": "string"},
            "value": {"type": ["string", "number", "boolean", "array", "object", "null"]},
        },
        "additionalProperties": False,
    },
}

SCHEMAS = {
    "nexus_get_attendance_day": object_schema(
        "Read ONE day of the requesting user's own attendance record: check-in and check-out times, "
        "status, late minutes, office. Use this before judging any attendance complaint — the photo "
        "alone is not evidence of what the record says. Read-only; correcting a day goes through "
        "propose_attendance_correction and a human approval.",
        {"date": {"type": "string", "description": "YYYY-MM-DD, e.g. 2026-09-01."}},
        ["date"],
    ),
    "nexus_create_document": object_schema(
        "Write a document into the NEXUS Knowledge Library, inside a project. Use this whenever the "
        "user asks for a report, summary, brief, minutes, SOP or any written deliverable they will "
        "keep. Body is Markdown: headings, lists, quotes, bold and inline code are rendered. Returns "
        "the document id and its URL.",
        {
            "projectId": {"type": "string", "description": "Project the document belongs to. Use nexus_list_projects first if unsure."},
            "title": {"type": "string"},
            "markdown": {"type": "string", "description": "Document body in Markdown."},
            "parentId": {"type": "string", "description": "Optional parent document, to nest this one under it."},
        },
        ["projectId", "title", "markdown"],
    ),
    "nexus_list_projects": object_schema(
        "List NEXUS projects visible to the GIDEON service actor.",
        {
            "workspaceId": {"type": "string"},
            "status": PROJECT_STATUS,
        },
    ),
    "nexus_list_members": object_schema(
        "List NEXUS workspace or project members.",
        {
            "workspaceId": {"type": "string"},
            "projectId": {"type": "string"},
        },
    ),
    "nexus_list_tasks": object_schema(
        "List NEXUS tasks visible to the GIDEON service actor.",
        {
            "projectId": {"type": "string"},
            "status": TASK_STATUS,
            "priority": TASK_PRIORITY,
            "assigneeId": {"type": "string"},
            "limit": LIMIT,
        },
    ),
    "nexus_search_tasks": object_schema(
        "Search NEXUS tasks by title or description.",
        {
            "query": {"type": "string"},
            "projectId": {"type": "string"},
            "status": TASK_STATUS,
            "priority": TASK_PRIORITY,
            "assigneeId": {"type": "string"},
            "limit": LIMIT,
        },
        required=["query"],
    ),
    "nexus_get_project_summary": object_schema(
        "Get a compact NEXUS project summary with task counts by status and priority.",
        {"projectId": {"type": "string"}},
        required=["projectId"],
    ),
    "nexus_list_custom_fields": object_schema(
        "List NEXUS custom fields for a project, including IDs, names, types, and options. Use before setting project-specific custom fields.",
        {"projectId": {"type": "string"}},
        required=["projectId"],
    ),
    "nexus_create_task": object_schema(
        "Create a NEXUS task. Prefer projectId; taskListId can target a specific list. Performs server-side read-back verification.",
        {
            "projectId": {"type": "string"},
            "taskListId": {"type": "string"},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "status": TASK_STATUS,
            "priority": TASK_PRIORITY,
            "dueDate": {"type": "string", "description": "ISO date/datetime, e.g. 2026-04-30 or 2026-04-30T10:00:00+07:00"},
            "assigneeIds": {"type": "array", "items": {"type": "string"}},
            "customFields": CUSTOM_FIELD_UPDATES,
        },
        required=["title"],
    ),
    "nexus_update_task": object_schema(
        "Update a NEXUS task's status/priority/due date/title/description/list/assignees. Performs server-side read-back verification.",
        {
            "taskId": {"type": "string"},
            "title": {"type": "string"},
            "description": {"type": ["string", "null"]},
            "status": TASK_STATUS,
            "priority": TASK_PRIORITY,
            "dueDate": {"type": ["string", "null"], "description": "ISO date/datetime, or null to clear"},
            "taskListId": {"type": "string"},
            "assigneeIds": {"type": "array", "items": {"type": "string"}, "description": "Full replacement set. Empty array clears assignees."},
            "customFields": CUSTOM_FIELD_UPDATES,
        },
        required=["taskId"],
    ),
    "nexus_add_task_comment": object_schema(
        "Add a comment to a NEXUS task and notify relevant task participants.",
        {
            "taskId": {"type": "string"},
            "content": {"type": "string"},
        },
        required=["taskId", "content"],
    ),
}
