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
        "means the XP already came back on its own. Takes no times, deliberately. ATTENDANCE, EXP and "
        "DAY_OFF tickets can all carry one: approving it also restores the AUTO-deducted day-off "
        "allowance for that date (alpha / late >120), which is what nearly every DAY_OFF ticket is "
        "about. A day off the person filed themselves is not a penalty and cannot be cancelled here. "
        "Never claim the XP or the allowance is back: a BoD decides.",
        {
            "complaintId": {"type": "string", "description": "The ticket this proposal belongs to."},
            "date": {"type": "string", "description": "YYYY-MM-DD, the day whose penalty should be cancelled. Default to the day the ticket was filed, never a date read off a photo."},
            "reason": {"type": "string", "description": "Why the penalty is unearned, in one sentence, citing what the record shows — which request covers the day and its status, or what says NEXUS was down. Minimum 10 characters."},
        },
        ["complaintId", "date", "reason"],
    ),
    "nexus_resolve_ticket": object_schema(
        "Mark the ticket RESOLVED because there is genuinely nothing left to do for the day in question: "
        "the penalties already came back, no day-off allowance is still deducted, and no proposal is "
        "waiting on a BoD. Call it ONLY after nexus_get_attendance_day shows xpPenalties.hasPenaltyToCancel "
        "= false and no autoDayOffs, AND the day already has an attendance record (if the record is missing "
        "and the person says they worked, propose an attendance correction instead so the day is recorded "
        "present). The server re-checks all of that and refuses otherwise — if refused, do not retry; report "
        "the reason. Your note is posted to the thread as the closing message the reporter reads.",
        {
            "complaintId": {"type": "string", "description": "The ticket to resolve."},
            "date": {"type": "string", "description": "YYYY-MM-DD, the day the ticket is about — the server verifies nothing remains for it."},
            "note": {"type": "string", "description": "One or two sentences, Bahasa Indonesia, telling the reporter what was already restored and that nothing else remains. Minimum 10 characters."},
        },
        ["complaintId", "date", "note"],
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
    "nexus_get_task": object_schema(
        "Read ONE NEXUS task in full: title, description, status, priority, due date, assignees, project, "
        "section, custom fields, and its latest comments (newest last). Use it before changing a task, and "
        "whenever someone asks about a specific task.",
        {"taskId": {"type": "string"}},
        required=["taskId"],
    ),
    "nexus_search_docs": object_schema(
        "Search the NEXUS Knowledge Library (documents/pages) by title or text, optionally inside one project. "
        "Returns id, title, project, a short excerpt and the URL. Use nexus_get_doc to read one in full.",
        {
            "query": {"type": "string"},
            "projectId": {"type": "string"},
            "limit": LIMIT,
        },
        required=["query"],
    ),
    "nexus_search_workspace": object_schema(
        "Search EVERYTHING the person can see in NEXUS at once: projects, tasks, docs/pages, task comments, forms and "
        "chat messages. Use this first for any question about the workspace (who said what, where something is, what "
        "the status of X is). Pass the person's words or a few keywords. Returns ranked hits with kind, id, title, "
        "excerpt, project and link. Cite the titles you use; never claim something the hits do not show.",
        {
            "query": {"type": "string"},
            "kinds": {"type": "array", "items": {"type": "string", "enum": ["project", "task", "doc", "comment", "form", "message"]}},
            "projectId": {"type": "string"},
            "limit": LIMIT,
        },
        required=["query"],
    ),
    "nexus_get_calendar": object_schema(
        "Read the person's Master Calendar for a range of days: every task due on those days that someone is doing, "
        "exactly as their Calendar shows it — day, time, title, status, project and who is doing it. Use it for "
        "'what's on my calendar this week', 'what is due Friday', 'what does the design team have next week'. "
        "A row with masked:true is a task of a private project the person is not in: call it 'Internal task' and never "
        "guess or invent its title, project or details. Tasks with nobody assigned are not on the calendar. "
        "Default range: this week (Monday to Sunday, WIB). At most 62 days per call. Read only.",
        {
            "from": {"type": "string", "description": "First day, YYYY-MM-DD (WIB). A relative day such as 'friday' or 'besok' is also understood."},
            "to": {"type": "string", "description": "Last day, YYYY-MM-DD, inclusive."},
            "date": {"type": "string", "description": "One day only, YYYY-MM-DD (instead of from/to)."},
            "mine": {"type": "boolean", "description": "Only tasks the person is doing."},
            "projectId": {"type": "string"},
            "projectName": {"type": "string"},
            "division": {"type": "string", "description": "A division or unit of the org chart, by name or id: its tasks and those of the units under it."},
        },
    ),
    "nexus_list_room_bookings": object_schema(
        "Read Room Booking: the bookings of the company's meeting rooms for a range of days (room, time in WIB, title, "
        "who booked), the free time of each room per day, and — with `time` — which rooms are free for that exact slot "
        "and the nearest free slots. Use it for 'is the meeting room free tomorrow at 2?' or 'what's booked in the "
        "Studio this week'. Default: today and the next 6 days. At most 62 days per call. Read only.",
        {
            "from": {"type": "string", "description": "First day, YYYY-MM-DD (WIB)."},
            "to": {"type": "string", "description": "Last day, YYYY-MM-DD, inclusive."},
            "date": {"type": "string", "description": "One day only, YYYY-MM-DD; needed with `time`."},
            "room": {"type": "string", "description": "A room name as said (e.g. 'Studio', 'VIP'). Omit for every room."},
            "time": {"type": "string", "description": "A start time to check, HH:mm WIB, on `date`."},
            "endTime": {"type": "string", "description": "End of the slot to check, HH:mm WIB. Default: one hour after `time`."},
            "durationMinutes": {"type": "integer", "minimum": 15, "maximum": 720},
        },
    ),
    "nexus_book_room": object_schema(
        "Book one of the company's rooms for the person, as them (they own the booking and get the usual confirmation). "
        "The server applies the Room Booking page's rules and never double-books. Depending on the person's approval mode "
        "it is booked directly or shown as a card they approve. If the person did not name a room, or the name could be "
        "more than one room, leave `room` out (or pass what they said): do NOT guess and do NOT ask in the chat — the card "
        "shows every room with whether it is free then and they pick there. If the slot is taken you get the holder and the "
        "nearest free slots; tell the person, do not retry another room on your own. Cancelling or moving a booking is not "
        "possible yet. Check first with nexus_list_room_bookings when the person asks whether something is free.",
        {
            "room": {"type": "string", "description": "The room as the person named it (e.g. 'Studio', 'VIP'). Omit when not named."},
            "date": {"type": "string", "description": "YYYY-MM-DD (WIB). A weekday name means the NEXT one, never today."},
            "start": {"type": "string", "description": "Start time, HH:mm WIB."},
            "end": {"type": "string", "description": "End time, HH:mm WIB. Or give durationMinutes; default one hour."},
            "durationMinutes": {"type": "integer", "minimum": 15, "maximum": 720},
            "title": {"type": "string", "description": "What the room is for, as it will show on the Room Booking page."},
        },
        ["date", "start", "title"],
    ),
    "nexus_get_doc": object_schema(
        "Read ONE NEXUS document (page) as plain text, with its title, project and URL.",
        {"docId": {"type": "string"}},
        required=["docId"],
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
        "Create a NEXUS task. Prefer projectId; taskListId can target a specific list. Performs server-side read-back verification. "
        "ONE call per task, complete: put the people it is for in assigneeIds and the deadline in dueDate here — never create "
        "first and assign or date it with nexus_update_task afterwards. When the answer is proposed:true, the returned "
        "proposalId is the task's only id until it is approved; nexus_update_task with taskId = that proposalId joins the same card.",
        {
            "projectId": {"type": "string"},
            "taskListId": {"type": "string"},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "status": TASK_STATUS,
            "priority": TASK_PRIORITY,
            "dueDate": {"type": "string", "description": "YYYY-MM-DD or ISO datetime, e.g. 2026-04-30 or 2026-04-30T10:00:00+07:00. A weekday name means the NEXT one, never today (said on a Friday, 'Friday' = next week's Friday); only 'today' is today. Say the resolved date in your reply."},
            "assigneeIds": {"type": "array", "items": {"type": "string"}, "description": "The people the task is for (user ids from nexus_list_members). Include them here, in this call."},
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
