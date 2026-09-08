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

# There are TWO attendance remedies, and the descriptions below are where the choice between them is
# actually made — the model reads these, not the code. While the only tool was "propose a correction"
# and its description talked only about times, every attendance case came out as a time: a man whose
# permit was still awaiting approval was handed a proposal to set his check-in to the time already on
# his record, and a man locked out by a Cloudflare Error 1033 was handed the timestamp off his own
# error screenshot — a time at which he was still late. Both proposals were faithful to the tool they
# had. Keep each description explicit about when NOT to use it.
SCHEMAS = {
    "nexus_propose_attendance_correction": object_schema(
        "PROPOSE a correction to the ticket reporter's attendance for one day, when the recorded TIMES "
        "are wrong. This does NOT change anything: it attaches a proposal to the ticket that a BoD "
        "approves or rejects. Call it only after nexus_get_attendance_day, and only when that call "
        "shows the times themselves are wrong. Works for a day with no record at all — that is the "
        "usual case when a check-in never landed — and then checkInAt is required. "
        "DO NOT use it when the day is covered by a leave/permit/sick request, or when NEXUS was down: "
        "there the recorded time is correct and only the penalty is unfair, so the remedy is "
        "nexus_propose_penalty_cancellation. Proposing a time in those cases changes nothing and leaves "
        "the XP deduction standing. NEVER propose a time you read off an error screenshot — that is "
        "when the person gave up trying, not when they were due; if a time is needed at all, use the "
        "shift start that nexus_get_attendance_day returns. Only an ATTENDANCE or EXP ticket can carry "
        "one: on an EXP ticket the XP was deducted BECAUSE the attendance record is wrong, so "
        "correcting the record is the fix. A DAY_OFF ticket is refused — you have no way to restore a "
        "day-off quota and must not imply otherwise.",
        {
            "complaintId": {"type": "string", "description": "The ticket this correction belongs to."},
            "date": {"type": "string", "description": "YYYY-MM-DD, the day being corrected. Default to the day the ticket was filed, never a date read off a photo."},
            "checkInAt": {"type": "string", "description": "Proposed check-in, \"HH:mm\" Jakarta time or full ISO-8601. Required if the day has no record. Use the person's shift start, not a screenshot timestamp."},
            "checkOutAt": {"type": "string", "description": "Proposed check-out, same format. Optional."},
            "reason": {"type": "string", "description": "Why, in one sentence, citing what the evidence shows. Minimum 10 characters."},
        },
        ["complaintId", "date", "reason"],
    ),
    "nexus_propose_penalty_cancellation": object_schema(
        "PROPOSE cancelling the XP penalty charged for one day of the ticket reporter's attendance, "
        "WITHOUT changing any recorded time. This does NOT change anything: it attaches a proposal to "
        "the ticket that a BoD approves or rejects, exactly like a correction and on the same card. "
        "This is the right remedy whenever the clock on the record is correct and the deduction is "
        "still unearned, which is two whole classes of ticket: (1) a leave, permit or sick request "
        "covers that date — a PENDING one counts, because a request merely filed already holds the "
        "penalty back; (2) NEXUS itself was unreachable, so there was nothing to check in to. In both, "
        "proposing a time is useless: the time is not what is wrong. Call it only after "
        "nexus_get_attendance_day, and only when that call shows a penalty still on the ledger "
        "(xpPenalties.hasPenaltyToCancel) — it refuses a day with nothing left to cancel, which usually "
        "means the XP already came back on its own. Takes no times, deliberately. Only an ATTENDANCE or "
        "EXP ticket can carry one; a DAY_OFF ticket is refused, and a day-off quota is not something "
        "you can restore. Never claim the XP is back: a BoD decides.",
        {
            "complaintId": {"type": "string", "description": "The ticket this proposal belongs to."},
            "date": {"type": "string", "description": "YYYY-MM-DD, the day whose penalty should be cancelled. Default to the day the ticket was filed, never a date read off a photo."},
            "reason": {"type": "string", "description": "Why the penalty is unearned, in one sentence, citing what the record shows — which request covers the day and its status, or what says NEXUS was down. Minimum 10 characters."},
        },
        ["complaintId", "date", "reason"],
    ),
    "nexus_get_attendance_day": object_schema(
        "Read ONE day of the requesting user's own attendance AND everything needed to choose a remedy "
        "for it, in a single call: the record (check-in/check-out, status, late minutes, office); the "
        "SHIFT that defines 'on time' for THIS person on THIS date (shift.shiftStartTime — this is the "
        "only time you may ever propose, and offices here disagree: 15:00 at one, 09:00 at another); "
        "whether the date is on NEXUS's outage register, plus an anonymous headcount of how many people "
        "in the workspace were penalised that same day; every leave/permit/sick request covering the "
        "date with its status (PENDING included) and coveredByRequest; and the XP penalties actually "
        "charged, with hasPenaltyToCancel. "
        "Use it before judging ANY attendance complaint, and call it even when the photo is unreadable — "
        "an unreadable photo is a reason to lean harder on the record, never a reason to skip it; "
        "default to the date the ticket was filed. Note that outage.recordedByNexus=false means NOT "
        "RECORDED, not 'did not happen': that register is maintained by hand and is often behind, so "
        "read the headcount before concluding nothing broke. Read-only, and always the requesting "
        "user's OWN day — a userId in the input is ignored. Changing a day goes through "
        "nexus_propose_attendance_correction or nexus_propose_penalty_cancellation and a human approval.",
        {"date": {"type": "string", "description": "YYYY-MM-DD, e.g. 2026-09-01. Default to the day the ticket was filed (Asia/Jakarta), never a date read off a photo."}},
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
