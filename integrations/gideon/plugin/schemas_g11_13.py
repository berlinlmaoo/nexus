"""Schemas of GIDEON tools 11-13 of the 18 Oct 2026 package: edit a page, form responses, performance.
Server: src/lib/gideon-tools/doc-edit.ts, forms.ts, performance.ts."""
from .schemas import object_schema, LIMIT, OFFSET

G11_13_SCHEMAS = {
    "nexus_edit_doc": object_schema(
        "Edit a doc / task page (card). Edit an EXISTING page as the person: a project doc (docId or its title) or a task's page (taskId). Modes: "
        "append (to the end), append_section (under a heading), replace_section (replace what is under a heading; the "
        "heading stays), add_section (a new heading + text at the end). It ALWAYS shows a card with the before → after "
        "and changes the page only when they tap Apply edit; people editing the page live keep their changes. Needs Can "
        "edit in its project. Write `content` as Markdown (headings, lists, bold). Read the page first (nexus_get_doc) "
        "when replacing, so you know the section names. A NEW page is nexus_create_document instead.",
        {
            "docId": {"type": "string"},
            "doc": {"type": "string", "description": "The page title, when no docId."},
            "taskId": {"type": "string", "description": "Edit this task's page body instead of a doc."},
            "mode": {"type": "string", "enum": ["append", "append_section", "replace_section", "add_section"]},
            "section": {"type": "string", "description": "The heading text (for the *_section modes)."},
            "content": {"type": "string", "description": "The exact text to put in, Markdown (max 20000 characters)."},
        },
        required=["mode", "content"],
    ),
    "nexus_get_form_responses": object_schema(
        "Summarise form responses. Summarise the responses of a form the person can see (Can view in its project): total, per question the "
        "count of each option / sum-average-min-max of numbers / date range / latest text answers, the status of the "
        "tasks the responses made, and a page of the latest responses (who, when). Name it by `form` (its name) or "
        "formId; narrow with from/to (YYYY-MM-DD).",
        {
            "formId": {"type": "string"},
            "form": {"type": "string", "description": "Part of the form name."},
            "from": {"type": "string", "description": "YYYY-MM-DD (WIB)."},
            "to": {"type": "string", "description": "YYYY-MM-DD (WIB)."},
            "limit": LIMIT,
            "offset": OFFSET,
        },
    ),
    "nexus_get_performance": object_schema(
        "Performance + leaderboard. Performance for the attendance period (28th → 27th; period=YYYY-MM for another): tasks assigned / completed / "
        "on time / overdue (split between assignees), attendance (present, late, absent, leave, sick, izin, day off), "
        "XP score, level, streak, and for the person themselves their leaderboard rank. Who can be seen follows Reports: "
        "staff only themselves, a manager their direct reports, BoD / One Above All everyone. team=true lists the "
        "people they may see; person=<name> one of them; nothing = themselves.",
        {
            "person": {"type": "string", "description": "A name, or 'me' (default)."},
            "team": {"type": "boolean", "description": "Everyone this person may see (direct reports, or all for BoD)."},
            "period": {"type": "string", "description": "YYYY-MM: the period that ENDS on the 27th of that month."},
            "limit": LIMIT,
        },
    ),
}
