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
    "nexus_create_document": "create_document",
    "nexus_get_attendance_day": "get_attendance_day",
}


def _make_handler(action):
    def _handler(args=None, **_kwargs):
        return call_nexus(action, args or {})

    return _handler


def register(ctx) -> None:
    for tool_name, action in _ACTION_BY_TOOL.items():
        ctx.register_tool(
            name=tool_name,
            toolset="nexus",
            schema=SCHEMAS[tool_name],
            handler=_make_handler(action),
            check_fn=check_available,
            requires_env=["NEXUS_BASE_URL", "NEXUS_SERVICE_TOKEN"],
            emoji="🧭",
        )
