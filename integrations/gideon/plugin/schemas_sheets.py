"""Schemas of GIDEON's spreadsheet, NEXUS-image and file tools (18 Oct 2026). Server: src/lib/gideon-tools/
sheets.ts, images.ts, files.ts. Writes end in a CARD the person confirms (every approval mode)."""
from .schemas import object_schema, LIMIT, OFFSET

_SHEET_ID = {
    "sheetId": {"type": "string", "description": "From nexus_search_sheets."},
    "sheet": {"type": "string", "description": "The spreadsheet tab's name."},
    "project": {"type": "string", "description": "The project's name (alone = its first tab)."},
}

SHEET_SCHEMAS = {
    "nexus_search_sheets": object_schema(
        "Find project spreadsheets (the Spreadsheet tab of projects) this person can open: by tab name, project name, "
        "or words inside the cells. Returns sheetId, columns, and where the words were found.",
        {"query": {"type": "string"}, "project": {"type": "string"}, "limit": LIMIT},
    ),
    "nexus_get_sheet": object_schema(
        "Read one project spreadsheet as the grid shows it: column letters + headers, rows with their sheet row "
        "number (A1 style), formulas computed, and totals (sum / count / avg) of numeric columns over ALL rows — use "
        "those for 'berapa totalnya'. Paged (30 rows; offset / limit up to 200); query = only rows containing it; "
        "columns = 'A,C' or header names; formulas=true shows each formula next to its value.",
        {**_SHEET_ID, "query": {"type": "string"}, "columns": {"type": "string"}, "formulas": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 1, "maximum": 200}, "offset": OFFSET},
    ),
    "nexus_edit_sheet_cells": object_schema(
        "Change a project spreadsheet AS the person (Can edit needed): set cells, fill a column, add rows. It ALWAYS "
        "shows a card with every cell before → after and changes nothing until they tap Apply; if someone edits one "
        "of those cells meanwhile, Apply refuses. Values are typed like in the grid: '1.5' / 'Rp 1.500.000' / '15%' "
        "become numbers, '=SUM(B2:B9)' is a formula (A1 references). Read the sheet first (nexus_get_sheet) for the "
        "row numbers. fill: {column, fromRow, toRow, value} — `{r}` in value is the row number ('=B{r}*C{r}'), or "
        "values: [...] one per row. addRows: new rows after the last used row, each {\"Header or letter\": value} "
        "or [values in column order].",
        {
            **_SHEET_ID,
            "edits": {"type": "array", "items": {"type": "object", "properties": {"cell": {"type": "string", "description": "e.g. B5"}, "value": {"type": ["string", "number", "boolean", "null"]}}, "required": ["cell"], "additionalProperties": False}},
            "fill": {"type": "object", "properties": {"column": {"type": "string"}, "fromRow": {"type": "integer"}, "toRow": {"type": "integer"}, "value": {"type": ["string", "number", "boolean", "null"]}, "values": {"type": "array", "items": {"type": ["string", "number", "boolean", "null"]}}}, "additionalProperties": False},
            "addRows": {"type": "array", "items": {"type": ["object", "array"]}},
        },
    ),
    "nexus_create_sheet": object_schema(
        "Make a NEW spreadsheet tab in a project (Can edit needed) from a table you produced: header names + rows. "
        "ALWAYS a card showing the table; created only when the person taps Create. Numbers / Rupiah / dates in the "
        "cells are typed like in the grid; '=…' cells are formulas.",
        {
            "project": {"type": "string"},
            "name": {"type": "string", "description": "The tab's name."},
            "columns": {"type": "array", "items": {"type": "string"}, "description": "Header names, in order (max 50)."},
            "rows": {"type": "array", "items": {"type": "array", "items": {"type": ["string", "number", "boolean", "null"]}}, "description": "Max 500 rows."},
        },
        required=["project", "name", "columns", "rows"],
    ),
    "nexus_read_nexus_image": object_schema(
        "Look at a picture that lives in NEXUS: a task's attached picture (taskId, + attachment name when there are "
        "several), a picture sent in one of the person's chats (messageId from nexus_read_conversation), a Z Vault "
        "image (vaultItemId or vaultName), or a NEXUS picture link (url). Only what the person can open. It answers "
        "with imagePath: then call vision_analyze on that path. Not for pictures attached in this GIDEON chat (those "
        "are already given).",
        {
            "taskId": {"type": "string"}, "attachment": {"type": "string"}, "index": {"type": "integer", "minimum": 0},
            "messageId": {"type": "string"}, "vaultItemId": {"type": "string"}, "vaultName": {"type": "string"}, "url": {"type": "string"},
        },
    ),
    "nexus_export_file": object_schema(
        "Make a downloadable file for the person: a NEXUS doc (docId) or text you wrote (markdown: headings, lists, "
        "**bold**, | tables |) as docx or pdf; a table (columns + rows, or the first | table | of markdown) as xlsx; a "
        "project spreadsheet (sheetId) as xlsx. Answers with a link only they can open (30 days): give it as a "
        "Markdown link. Changes nothing in NEXUS. To keep it in Z Vault: nexus_save_file_to_vault.",
        {
            "format": {"type": "string", "enum": ["pdf", "docx", "xlsx"]},
            "title": {"type": "string", "description": "File name / title."},
            "docId": {"type": "string"}, "sheetId": {"type": "string"},
            "markdown": {"type": "string"},
            "columns": {"type": "array", "items": {"type": "string"}},
            "rows": {"type": "array", "items": {"type": "array", "items": {"type": ["string", "number", "boolean", "null"]}}},
        },
        required=["format"],
    ),
    "nexus_save_file_to_vault": object_schema(
        "Save a file you made with nexus_export_file into Z Vault (a folder the person can add files to; none = the top "
        "of Z Vault). ALWAYS a card; uploaded only when they tap Save.",
        {"fileId": {"type": "string"}, "folder": {"type": "string", "description": "Z Vault folder name."}},
        required=["fileId"],
    ),
}

SHEET_ACTIONS = {name: name[len("nexus_"):] for name in SHEET_SCHEMAS}
