import os

from .humanize import humanize_json
from .client import call_nexus, check_available
from .schemas import SCHEMAS
from .schemas_extra import EXTRA_SCHEMAS
from .schemas_g67 import G67_SCHEMAS
from .schemas_g8_10_14 import G8_10_14_SCHEMAS
from .schemas_sheets import SHEET_SCHEMAS
from .schemas_g11_13 import G11_13_SCHEMAS
from .schemas_presence import PRESENCE_SCHEMAS
from .images import read_nexus_image_handler
from .schemas_memory import MEMORY_SCHEMAS

# The 18 Oct 2026 package (inbox, chat, reminders, …): schemas_extra.py.
# GIDEON Memory (19 Oct 2026): nexus_remember / nexus_forget / nexus_list_my_memories -> remember / forget / list_my_memories.
_PACKAGE = {**EXTRA_SCHEMAS, **G67_SCHEMAS, **G8_10_14_SCHEMAS, **SHEET_SCHEMAS, **G11_13_SCHEMAS, **MEMORY_SCHEMAS, **PRESENCE_SCHEMAS}
SCHEMAS = {**SCHEMAS, **_PACKAGE}
EXTRA_ACTIONS = {name: name[len("nexus_"):] for name in _PACKAGE}

_ACTION_BY_TOOL = {
    "nexus_list_projects": "list_projects",
    "nexus_list_members": "list_members",
    "nexus_list_tasks": "list_tasks",
    "nexus_search_tasks": "search_tasks",
    "nexus_get_project_summary": "get_project_summary",
    "nexus_list_custom_fields": "list_custom_fields",
    "nexus_create_task": "create_task",
    "nexus_update_task": "update_task",
    "nexus_add_task_comment": "add_task_comment",
    "nexus_get_task": "get_task",
    "nexus_search_docs": "search_docs",
    "nexus_get_doc": "get_doc",
    # Workspace Q&A (12 Oct 2026): one search over projects, tasks, docs, comments, forms and chat,
    # with the asker's visibility only.
    "nexus_search_workspace": "search_workspace",
    # The Master Calendar and Room Booking, read as the asking user sees them (16 Oct 2026).
    "nexus_get_calendar": "get_calendar",
    "nexus_list_room_bookings": "list_room_bookings",
    # A write, as the asking user, through the Room Booking page's own rules; held for approval like
    # create_task (and always when no single room was named: the person picks it on the card).
    "nexus_book_room": "book_room",
    # Moving / cancelling an existing booking (16 Oct 2026): the Room Booking page's own PATCH / DELETE
    # rules, as the asking user, held for approval the same way.
    "nexus_move_room_booking": "move_room_booking",
    "nexus_cancel_room_booking": "cancel_room_booking",
    "nexus_create_document": "create_document",
    # Deleting a task (18 Oct 2026): ALWAYS a card the person confirms, in every approval mode; the web Delete
    # button's own rule (Can edit) and path (restorable from the Audit). The model can never delete directly.
    "nexus_delete_task": "delete_task",
    # Pipeline deals and Legal documents (18 Oct 2026): read only.
    "nexus_search_deals": "search_deals",
    "nexus_search_legal_documents": "search_legal_documents",
    "nexus_get_attendance_day": "get_attendance_day",
    # Two remedies, both PROPOSAL-only. Neither has a counterpart that applies one: a BoD decides both
    # at POST /api/complaints/[id]/correction, and that is the only place attendance or XP moves.
    "nexus_propose_attendance_correction": "propose_attendance_correction",
    "nexus_propose_penalty_cancellation": "propose_penalty_cancellation",
    # Menutup tiket yang sudah tidak menyisakan apa pun. Server yang memverifikasi (ledger kosong,
    # jatah day-off utuh, tidak ada usulan menunggu) dan menolak kalau tidak; ini bukan hak model.
    "nexus_resolve_ticket": "resolve_ticket",
    **EXTRA_ACTIONS,
}


# The support-ticket tools: they read the requester's OWN attendance day and file proposals a BoD
# decides. Production keeps them (GIDEON Support answers ATTENDANCE / EXP / DAY_OFF tickets). An
# instance started with NEXUS_GIDEON_NO_ATTENDANCE=1 — the DEV instance — never registers them, so the
# model there cannot even see that attendance exists. (The server keeps refusing anything that would
# APPLY an attendance change, everywhere.)
_ATTENDANCE_TOOLS = {
    "nexus_get_attendance_day",
    "nexus_propose_attendance_correction",
    "nexus_propose_penalty_cancellation",
    "nexus_resolve_ticket",
}


def _function_schema(name, schema):
    """Hermes wants an OpenAI function schema ({name, description, parameters}). SCHEMAS holds plain JSON
    schemas with the description on top; handed over as they were (until 18 Oct 2026) the model saw every
    NEXUS tool with NO parameters at all — it called nexus_list_tasks with {} and got every task it could see,
    and never knew projectId / assigneeId / limit existed."""
    params = {k: v for k, v in schema.items() if k != "description"}
    return {"name": name, "description": schema.get("description", ""), "parameters": params}


def _make_handler(action):
    def _handler(args=None, **_kwargs):
        # Enums -> human labels before the model sees them (see humanize.py).
        return humanize_json(call_nexus(action, args or {}))

    return _handler


def register(ctx) -> None:
    no_attendance = os.getenv("NEXUS_GIDEON_NO_ATTENDANCE", "").strip() == "1"
    for tool_name, action in _ACTION_BY_TOOL.items():
        if no_attendance and tool_name in _ATTENDANCE_TOOLS:
            continue
        ctx.register_tool(
            name=tool_name,
            toolset="nexus",
            schema=_function_schema(tool_name, SCHEMAS[tool_name]),
            # A NEXUS picture is written to the work dir and opened with vision_analyze (images.py), never as text.
            handler=read_nexus_image_handler if tool_name == "nexus_read_nexus_image" else _make_handler(action),
            check_fn=check_available,
            requires_env=["NEXUS_BASE_URL", "NEXUS_SERVICE_TOKEN"],
            emoji="🧭",
        )
