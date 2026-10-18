"""GIDEON Memory (19 Oct 2026, owner-approved). Server: src/lib/gideon-memory.ts.

Per-person memory: only ever about the person GIDEON is talking to, read only into their own chat. Hermes' own
memory stays OFF (it is shared between users). Small schemas on purpose: these are always loaded (GIDEON_EAGER_TOOLS).
"""
from .schemas import object_schema

MEMORY_SCHEMAS = {
    "nexus_remember": object_schema(
        "Remember something about the person you are talking to, for their next chats: how they like to be addressed "
        "(aku-kamu / gue-lo / formal), language, short or detailed answers, their role / team / projects, working hours, "
        "a date they shared (birthday), or anything they ask you to remember. ONLY about this person, never about others. "
        "explicit=true only when they asked you to remember it (\"inget ya\", \"remember\", \"catat\") or said yes to your "
        "suggestion; otherwise it becomes a suggestion with Save / Don't save under your answer. Never passwords, PINs, codes, "
        "card/account/ID numbers. Health, religion, politics, money: only when they ask.",
        {
            "text": {"type": "string", "description": "One short line in the person's language, e.g. 'Lebih suka dipanggil pakai aku-kamu'. Max 200 characters."},
            "kind": {"type": "string", "enum": ["PREFERENCE", "FACT", "PERSON", "DATE"], "description": "PREFERENCE = style/language/answer length/hours; PERSON = their role, team, projects; DATE = a date they shared; FACT = anything else."},
            "date": {"type": "string", "description": "For DATE: MM-DD (e.g. 03-14 for 14 March)."},
            "explicit": {"type": "boolean"},
        },
        required=["text"],
    ),
    "nexus_forget": object_schema(
        "Forget something you remember about the person (\"lupain itu\", \"forget that I…\"): by part of its text, by "
        "memoryId from nexus_list_my_memories, or all=true for everything.",
        {
            "query": {"type": "string", "description": "Words from the memory to forget."},
            "memoryId": {"type": "string"},
            "all": {"type": "boolean"},
        },
    ),
    "nexus_list_my_memories": object_schema(
        "What you remember about the person you are talking to (their own GIDEON Memory). Never anyone else's.",
        {},
    ),
}
