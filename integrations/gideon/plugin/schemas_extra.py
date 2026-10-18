"""Schemas of the GIDEON tools added on 18 Oct 2026 (owner-approved package). Server: src/lib/gideon-tools/.

Every write here ends in a CARD the person confirms in the NEXUS chat (some in every approval mode: anything
outward-facing or on attendance). When a tool answers proposed:true, nothing has happened yet — say it waits on the
card, never that it is done.
"""
from .schemas import object_schema, LIMIT

EXTRA_SCHEMAS = {
    # 1. What needs me now
    "nexus_get_my_inbox": object_schema(
        "What needs the person now, in one call: unread notifications (assignments, comments, due dates, Threads, "
        "announcements), mentions (tasks, docs, Threads, chat), unread chat, and everything waiting on THEIR decision — "
        "attendance requests and offsite check-outs they approve, GIDEON cards they have not decided, support tickets "
        "(BoD), Legal requests where they are PIC. Use it for 'apa yang perlu gw kerjain/approve', 'ada notif apa', "
        "'siapa mention gw', 'ada yang nunggu approval gw?'. Only the person's own inbox.",
        {
            "section": {"type": "string", "enum": ["all", "notifications", "mentions", "chat", "approvals"], "description": "Default all."},
            "limit": {"type": "integer", "minimum": 1, "maximum": 25, "description": "Rows per list (default 8)."},
        },
    ),
    # 2. Chat
    "nexus_list_conversations": object_schema(
        "The person's own chats (DMs, groups, project rooms they are a member of), newest first, with unread counts and "
        "the last message. Use to find a chat or 'chat mana yang belum gw baca'.",
        {
            "query": {"type": "string", "description": "Part of the chat / person / project name."},
            "unread": {"type": "boolean", "description": "Only chats with unread messages."},
            "limit": LIMIT,
        },
    ),
    "nexus_read_conversation": object_schema(
        "Read the messages of ONE of the person's chats (they must be a member) to summarise or answer from it. Name it "
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
        "Send a chat message AS the person, to a person (`with`, their DM — made if none yet) or a group / project room "
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
        "A personal reminder for the person ('ingetin gw besok jam 9 follow up vendor'): it goes off as a NEXUS "
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
        "The person's reminders that have not gone off yet (and, with includeDone, the last ones that did).",
        {"includeDone": {"type": "boolean"}},
    ),
    "nexus_cancel_reminder": object_schema(
        "Cancel one of the person's waiting reminders, by reminderId (from nexus_list_reminders) or part of its text.",
        {"reminderId": {"type": "string"}, "text": {"type": "string", "description": "Part of the reminder's text."}},
    ),
}

EXTRA_ACTIONS = {name: name[len("nexus_"):] for name in EXTRA_SCHEMAS}
