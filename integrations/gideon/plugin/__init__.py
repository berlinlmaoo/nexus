import os

from .client import call_nexus, check_available
from .schemas import SCHEMAS

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
    "nexus_create_document": "create_document",
    "nexus_get_attendance_day": "get_attendance_day",
    # Two remedies, both PROPOSAL-only. Neither has a counterpart that applies one: a BoD decides both
    # at POST /api/complaints/[id]/correction, and that is the only place attendance or XP moves.
    "nexus_propose_attendance_correction": "propose_attendance_correction",
    "nexus_propose_penalty_cancellation": "propose_penalty_cancellation",
    # Menutup tiket yang sudah tidak menyisakan apa pun. Server yang memverifikasi (ledger kosong,
    # jatah day-off utuh, tidak ada usulan menunggu) dan menolak kalau tidak; ini bukan hak model.
    "nexus_resolve_ticket": "resolve_ticket",
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


def _make_handler(action):
    def _handler(args=None, **_kwargs):
        return call_nexus(action, args or {})

    return _handler


def register(ctx) -> None:
    no_attendance = os.getenv("NEXUS_GIDEON_NO_ATTENDANCE", "").strip() == "1"
    for tool_name, action in _ACTION_BY_TOOL.items():
        if no_attendance and tool_name in _ATTENDANCE_TOOLS:
            continue
        ctx.register_tool(
            name=tool_name,
            toolset="nexus",
            schema=SCHEMAS[tool_name],
            handler=_make_handler(action),
            check_fn=check_available,
            requires_env=["NEXUS_BASE_URL", "NEXUS_SERVICE_TOKEN"],
            emoji="🧭",
        )
