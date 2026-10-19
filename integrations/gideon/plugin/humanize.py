"""Human labels for NEXUS tool output (DEV, audit 12 Oct 2026).

The NEXUS tools answer with database enums (status IN_PROGRESS, priority URGENT) and the model tends to
copy them into its reply word for word. This rewrites a tool's JSON before the model sees it:
  - a task's `status` becomes its column (taskList.name) when it has one, else "To do / In progress / ...";
    the plain state is kept beside it as `progress` ("In progress"), so a custom column still says
    whether the task is done;
  - `priority` becomes "Urgent / High / Medium / Low / None";
  - other enum-looking statuses (a project's ACTIVE, ON_HOLD) become "Active", "On hold";
  - counts keyed by enum (byStatus, byPriority) get the same labels as keys.
Ids stay: the model needs them to call the next tool. The profile's SOUL.md tells it never to show them.
"""
import json
import re

TASK_STATUS = {
    "TODO": "To do",
    "IN_PROGRESS": "In progress",
    "IN_REVIEW": "In review",
    "DONE": "Done",
    "CANCELLED": "Cancelled",
}
PRIORITY = {"URGENT": "Urgent", "HIGH": "High", "MEDIUM": "Medium", "LOW": "Low", "NONE": "None"}
_ENUM = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$")


def _word(value):
    """ON_HOLD -> On hold."""
    return value.replace("_", " ").lower().capitalize()


def _label_status(value):
    if value in TASK_STATUS:
        return TASK_STATUS[value]
    if isinstance(value, str) and _ENUM.match(value) and len(value) > 1:
        return _word(value)
    return value


def _relabel_keys(d, table):
    if not isinstance(d, dict):
        return d
    out = {}
    for k, v in d.items():
        label = table.get(k) or (_word(k) if isinstance(k, str) and _ENUM.match(k) else k)
        out[label] = out.get(label, 0) + v if isinstance(v, (int, float)) and label in out else v
    return out


def humanize(node):
    if isinstance(node, list):
        return [humanize(x) for x in node]
    if not isinstance(node, dict):
        return node
    out = {k: humanize(v) for k, v in node.items()}
    status = node.get("status")
    if isinstance(status, str) and status in TASK_STATUS and "title" in node:
        word = TASK_STATUS[status]
        column = node.get("taskList", {}).get("name") if isinstance(node.get("taskList"), dict) else None
        out["status"] = column.strip() if isinstance(column, str) and column.strip() else word
        out["progress"] = word
    elif isinstance(status, str):
        out["status"] = _label_status(status)
    priority = node.get("priority")
    if isinstance(priority, str) and priority in PRIORITY:
        out["priority"] = PRIORITY[priority]
    for key in ("byStatus", "tasksByStatus", "statusCounts"):
        if isinstance(node.get(key), dict):
            out[key] = _relabel_keys(node[key], TASK_STATUS)
    for key in ("byPriority", "tasksByPriority", "priorityCounts"):
        if isinstance(node.get(key), dict):
            out[key] = _relabel_keys(node[key], PRIORITY)
    return out


def humanize_json(text):
    """Tool output is a JSON string; anything that is not JSON is passed through untouched."""
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return text
    try:
        return json.dumps(humanize(data), ensure_ascii=False)
    except Exception:
        return text
