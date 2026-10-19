"""Schemas of the presence-status tools (owner, 19 Oct 2026). Server: src/lib/gideon-tools/presence.ts.

Read-only on attendance: the status is computed from what NEXUS already knows (check-in / check-out, in or out of
the office, approved requests, the person's shift, a manual status). Location is only "in / out of the office" —
never a place, an address or coordinates. NOT gated by NEXUS_GIDEON_NO_ATTENDANCE (that flag is only the ticket
tools). set_my_status ALWAYS ends in a card the person confirms.
"""
from .schemas import object_schema

PRESENCE_SCHEMAS = {
    "nexus_get_person_status": object_schema(
        "Where is someone / are they in. A person's presence status right now, exactly as everyone in the workspace "
        "sees it on their avatar: Online · In the office, Away · Out of the office, Online / Away / Do not disturb · "
        "<their own status text> "
        "(with until), Sick leave, Leave, Day off, Not checked in yet, Offline (checked out / outside working hours). "
        "Use for 'Berlin ke mana?', 'X udah dateng?', 'X lagi di kantor?', 'X sakit?'. Location is ONLY in / out of the "
        "office: never guess or invent where they are. Without a person: everyone, optionally filtered by `state` "
        "('siapa yang sakit hari ini?' = state sick).",
        {
            "person": {"type": "string", "description": "The person's name (or part of it); 'me' for the asker."},
            "userId": {"type": "string"},
            "state": {"type": "string", "enum": ["online", "away", "dnd", "sick", "leave", "not_checked_in", "offline"], "description": "Only with no person: list everyone in this state."},
        },
    ),
    "nexus_set_my_status": object_schema(
        "Set my status (card). Set the asker's OWN manual status '<Online | Away | Do not disturb> · <text>' from a start "
        "to an end time (availability default away; 'jangan diganggu' / 'lagi fokus' = dnd), e.g. "
        "'set status gw potong rambut besok 18:00-20:00' → text 'Potong rambut', startsAt 'YYYY-MM-DD 18:00', endsAt "
        "'YYYY-MM-DD 20:00'. Resolve the day and times yourself in WIB (Asia/Jakarta) and pass them as "
        "'YYYY-MM-DD HH:MM'; no start = from now; an end is required (ask if they gave none). Everyone in the workspace "
        "sees it until the end, then it clears by itself; nobody is notified. clear=true removes the current one. It "
        "NEVER applies by itself: it always shows a card and is set only when they tap Apply — say so in one sentence.",
        {
            "text": {"type": "string", "description": "The status text, short (max 80 characters), in the person's words."},
            "startsAt": {"type": "string", "description": "'YYYY-MM-DD HH:MM' WIB; omit for now."},
            "endsAt": {"type": "string", "description": "'YYYY-MM-DD HH:MM' WIB (required unless clear)."},
            "availability": {"type": "string", "enum": ["online", "away", "dnd"], "description": "What the status shows: online, away (default) or dnd = Do not disturb."},
            "clear": {"type": "boolean", "description": "true = clear the current status instead."},
        },
    ),
}
