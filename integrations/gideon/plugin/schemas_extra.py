"""Schemas of the GIDEON tools added on 18 Oct 2026 (owner-approved package). Server: src/lib/gideon-tools/.

Every write here ends in a CARD the person confirms in the NEXUS chat (some in every approval mode: anything
outward-facing or on attendance). When a tool answers proposed:true, nothing has happened yet — say it waits on the
card, never that it is done.
"""
from .schemas import object_schema, LIMIT

EXTRA_SCHEMAS = {
    # 1. What needs me now
    "nexus_get_my_inbox": object_schema(
        "What needs the person now: unread notifications, mentions, unread chats, and what waits on their decision (requests they approve, GIDEON cards, tickets, Legal). Own inbox only.",
        {
            "section": {"type": "string", "enum": ["all", "notifications", "mentions", "chat", "approvals"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 25},
        },
    ),
    # 2. Chat
    "nexus_list_conversations": object_schema(
        "My chats. The person's own chats (DMs, groups, project rooms they are a member of), newest first, with unread counts and "
        "the last message. Use to find a chat or 'chat mana yang belum gw baca'.",
        {
            "query": {"type": "string", "description": "Part of the chat / person / project name."},
            "unread": {"type": "boolean", "description": "Only chats with unread messages."},
            "limit": LIMIT,
        },
    ),
    "nexus_read_conversation": object_schema(
        "Read one of my chats. Read the messages of ONE of the person's chats (they must be a member) to summarise or answer from it. Name it "
        "by `with` (a person: their DM), `conversation` (a group or project room name) or conversationId. Newest "
        "`limit` messages (default 40, max 100), oldest first; unread=true = only what they have not read; "
        "since=YYYY-MM-DD for a period.",
        {
            "conversationId": {"type": "string"},
            "with": {"type": "string", "description": "A person's name: their direct-message chat."},
            "conversation": {"type": "string", "description": "A group or project room name."},
            "unread": {"type": "boolean"},
            "since": {"type": "string", "description": "YYYY-MM-DD (WIB)."},
            "limit": LIMIT,
        },
    ),
    "nexus_send_message": object_schema(
        "Send a chat message (card). Send a chat message AS the person, to a person (`with`, their DM — made if none yet) or a group / project room "
        "(`conversation`). It NEVER sends by itself: it ALWAYS shows a card with the exact text and the recipient, and "
        "it is sent only when they tap Send. Write the text exactly as it should appear, in the person's voice; never "
        "add facts they did not give. After calling, say in one sentence that it waits on the card.",
        {
            "with": {"type": "string", "description": "Recipient person's name (DM)."},
            "conversation": {"type": "string", "description": "Group or project room name."},
            "conversationId": {"type": "string"},
            "text": {"type": "string", "description": "The exact message (max 4000 characters)."},
            "replyToId": {"type": "string", "description": "A message id from nexus_read_conversation to reply to."},
        },
        required=["text"],
    ),
    # 3. Reminders
    "nexus_create_reminder": object_schema(
        "Set a reminder. A personal reminder for the person ('ingetin gw besok jam 9 follow up vendor'): it goes off as a NEXUS "
        "notification + push at that time (WIB). Resolve the time yourself: at = YYYY-MM-DDTHH:MM in WIB (a bare "
        "'jam 9' = 09:00; 'besok' = tomorrow; a weekday = the next one). Must be in the future, at most a year ahead. "
        "Say the resolved day, date and time in your reply.",
        {
            "text": {"type": "string", "description": "What to remind them about, short, in their words (max 280)."},
            "at": {"type": "string", "description": "YYYY-MM-DDTHH:MM, WIB."},
        },
        required=["text", "at"],
    ),
    "nexus_list_reminders": object_schema(
        "My reminders. The person's reminders that have not gone off yet (and, with includeDone, the last ones that did).",
        {"includeDone": {"type": "boolean"}},
    ),
    "nexus_cancel_reminder": object_schema(
        "Cancel a reminder. Cancel one of the person's waiting reminders, by reminderId (from nexus_list_reminders) or part of its text.",
        {"reminderId": {"type": "string"}, "text": {"type": "string", "description": "Part of the reminder's text."}},
    ),
    # 4. Leave / permission
    "nexus_get_leave_balance": object_schema(
        "My leave / day-off balance. The person's own leave numbers: day off left this period (28th → 27th; when it is used up there is no more, "
        "no borrowing), annual leave left this year (12 days, every calendar day counts, weekends too; needs 12 months "
        "of service), their pending requests, and who approves them.",
        {},
    ),
    "nexus_submit_leave_request": object_schema(
        "File day off / leave (card). File a DAY_OFF (day off), LEAVE (cuti tahunan) or RED_DATE (public holiday) request AS the person. It ALWAYS "
        "shows a card (type, dates, reason, balance, approver) and is filed only when they tap Submit, with exactly the "
        "Attendance page's rules: one date per request except annual leave (a range), never a past day, a reason of 3+ "
        "characters, no day off once the quota is used up. Sick (SICK) and izin (PERMIT) need a photo and cannot be "
        "filed from chat: send the person to the Attendance page. Izin is never a day off or a cover for a forgotten "
        "check-in. Never invent a reason; ask for it.",
        {
            "type": {"type": "string", "enum": ["DAY_OFF", "LEAVE", "RED_DATE", "SICK", "PERMIT"]},
            "date": {"type": "string", "description": "YYYY-MM-DD (one day)."},
            "startDate": {"type": "string", "description": "YYYY-MM-DD (annual leave range start)."},
            "endDate": {"type": "string", "description": "YYYY-MM-DD (annual leave range end)."},
            "reason": {"type": "string"},
        },
        required=["type", "reason"],
    ),
    "nexus_decide_attendance_request": object_schema(
        "Approve/reject a request (card). For an approver: approve or reject a pending attendance request (leave, day off, sick, izin) of someone they "
        "approve for (the Approval chart decides; never their own). ALWAYS a card they confirm. A rejection needs a "
        "reason the requester will read. Find requests with nexus_get_my_inbox (waitingForYou.attendanceRequests).",
        {
            "requestId": {"type": "string", "description": "From nexus_get_my_inbox."},
            "person": {"type": "string", "description": "The requester's name, when no requestId."},
            "date": {"type": "string", "description": "YYYY-MM-DD, to pick one of several requests of that person."},
            "decision": {"type": "string", "enum": ["approve", "reject"]},
            "note": {"type": "string", "description": "Required to reject (3+ characters); optional to approve."},
        },
        required=["decision"],
    ),
    # 5. Bulk task work
    "nexus_bulk_update_tasks": object_schema(
        "Change many tasks (card). Change MANY tasks at once — move to another column/status, reassign (PIC), re-date, re-prioritise — on ONE card "
        "that lists every change; nothing changes until the person taps Apply all (every approval mode). Either "
        "changes = [{taskId, status?, section?, dueDate?, priority?, assignees? | addAssignees? / removeAssignees?}] "
        "(different per task) or taskIds + the fields to set on all of them. Max 50 tasks. Find the tasks first with "
        "nexus_list_tasks / nexus_search_tasks. A task someone edits meanwhile is skipped, not overwritten. Use this "
        "instead of several nexus_update_task calls whenever 2+ tasks change.",
        {
            "changes": {"type": "array", "items": {"type": "object", "properties": {
                "taskId": {"type": "string"},
                "status": {"type": "string", "enum": ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]},
                "section": {"type": "string", "description": "Column name in that task's project."},
                "dueDate": {"type": ["string", "null"], "description": "YYYY-MM-DD (or ISO with time); null clears."},
                "priority": {"type": "string", "enum": ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]},
                "assignees": {"type": "array", "items": {"type": "string"}, "description": "Full new PIC list (names or ids)."},
                "addAssignees": {"type": "array", "items": {"type": "string"}},
                "removeAssignees": {"type": "array", "items": {"type": "string"}},
            }, "required": ["taskId"], "additionalProperties": False}},
            "taskIds": {"type": "array", "items": {"type": "string"}},
            "status": {"type": "string", "enum": ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]},
            "section": {"type": "string"},
            "dueDate": {"type": ["string", "null"]},
            "priority": {"type": "string", "enum": ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]},
            "assignees": {"type": "array", "items": {"type": "string"}},
            "addAssignees": {"type": "array", "items": {"type": "string"}},
            "removeAssignees": {"type": "array", "items": {"type": "string"}},
        },
    ),
    "nexus_add_subtasks": object_schema(
        "Add subtasks (card). Add subtasks (checklist items) under a task, one title each (max 20), optionally with PIC and a due date. "
        "Always a card the person confirms.",
        {
            "taskId": {"type": "string", "description": "The parent task."},
            "titles": {"type": "array", "items": {"type": "string"}},
            "assignees": {"type": "array", "items": {"type": "string"}, "description": "Names or ids (project members)."},
            "dueDate": {"type": "string", "description": "YYYY-MM-DD."},
        },
        required=["taskId", "titles"],
    ),
}

EXTRA_ACTIONS = {name: name[len("nexus_"):] for name in EXTRA_SCHEMAS}
