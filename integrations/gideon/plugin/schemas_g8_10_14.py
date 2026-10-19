"""Schemas of GIDEON groups 8 (Legal draft), 10 (Z Vault) and 14 (announcement), 18 Oct 2026.
Server: src/lib/gideon-tools/legal.ts, vault.ts, announcement.ts. Every write is a card the person confirms."""
from .schemas import object_schema, LIMIT

G8_10_14_SCHEMAS = {
    "nexus_create_legal_draft": object_schema(
        "Legal draft from a template (card). Prepare a Legal document from a template up to DRAFT, as the person (Legal is invitation only: no access = "
        "a refusal to relay). Fill the template's form fields from what the person said, by field NAME in `values` "
        "(dates YYYY-MM-DD, amounts as numbers, lists as arrays of row objects). If fields are missing the tool lists "
        "the whole form: ask the person for the missing values — never invent names, amounts or dates. It ALWAYS "
        "shows a card (template, company, the number preview, every field); the number is issued and the DRAFT made "
        "only when they tap Create draft. It never finalizes, sends or signs (that is on the Legal page). Addenda "
        "are made from the signed document on the Legal page.",
        {
            "template": {"type": "string", "description": "Template name or document type (NDA, PKS, SPK, SURAT …)."},
            "templateId": {"type": "string"},
            "company": {"type": "string", "description": "Issuing company name or code, when the template has none."},
            "values": {"type": "object", "description": "Form values by field NAME, e.g. {\"NAMA_PIHAK_KEDUA\": \"…\", \"TANGGAL_DOKUMEN\": \"2026-10-20\"}."},
            "title": {"type": "string"},
            "counterparty": {"type": "string"},
        },
        required=["template"],
    ),
    "nexus_search_vault": object_schema(
        "Search Z Vault files. Search Z Vault (the company drive) for files and folders by name — only what this person can open (folder "
        "role locks apply). Returns name, kind, size, folder path, uploader, last change and a link.",
        {
            "query": {"type": "string", "description": "Part of the file or folder name."},
            "kind": {"type": "string", "enum": ["FILE", "FOLDER"]},
            "limit": LIMIT,
        },
        required=["query"],
    ),
    "nexus_create_vault_share_link": object_schema(
        "Vault share link (card). Make a share link to a Z Vault file or folder AS the person. ALWAYS a card they confirm; the link exists "
        "only after they tap Create link. Default = internal (NEXUS login required), download allowed, no expiry. An "
        "external link (anyone with the link, no login) only for its uploader / owner / BoD — only when they ask for "
        "one. Find the item with nexus_search_vault first.",
        {
            "itemId": {"type": "string", "description": "From nexus_search_vault."},
            "name": {"type": "string", "description": "The file / folder name, when no itemId."},
            "external": {"type": "boolean", "description": "true = anyone with the link (no login)."},
            "expires": {"type": "string", "enum": ["3d", "7d", "14d", "30d", "permanent"]},
            "allowDownload": {"type": "boolean"},
        },
    ),
    "nexus_draft_announcement": object_schema(
        "Post an announcement (card). Draft a company announcement (pop-up + push) and put it on a card for the person to POST — only BoD may "
        "post (for anyone else the tool says so: then give the draft as text in your reply). Write the full title and "
        "body yourself from what they asked; never invent facts (dates, places, amounts) they did not give. Audience "
        "= everyone unless names are given. Optional daily repeat (repeatDays 1–30 + repeatAtTime HH:mm WIB).",
        {
            "title": {"type": "string", "description": "Max 140 characters."},
            "body": {"type": "string", "description": "Max 4000 characters."},
            "tone": {"type": "string", "enum": ["info", "success", "warning"]},
            "audience": {"type": "array", "items": {"type": "string"}, "description": "People's names; empty = everyone."},
            "repeatDays": {"type": "integer", "minimum": 0, "maximum": 30},
            "repeatAtTime": {"type": "string", "description": "HH:mm (WIB), required when repeatDays > 0."},
        },
        required=["title", "body"],
    ),
}
