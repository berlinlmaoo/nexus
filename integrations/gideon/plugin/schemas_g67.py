"""Schemas for groups 6 (Pipeline) and 7 (Outlet Sales / Social Media Report), 18 Oct 2026. Server:
src/lib/gideon-tools/pipeline.ts and outlet-social.ts. Every one of these ALWAYS ends in a card the person
confirms; proposed:true means nothing has changed yet."""
from .schemas import object_schema, LIMIT  # noqa: F401

STAGES = ["Incoming", "Proposal / Quotation", "Negotiation", "Won – Contract Pending", "Won – In Execution", "Closing", "Closed", "Lost / Cancelled"]

G67_SCHEMAS = {
    # Control Tower v8 reads (22 Oct 2026): src/lib/gideon-tools/pipeline-read.ts. Read only.
    "nexus_get_deal": object_schema(
        "Read ONE Pipeline deal in full, as its board shows it to this person: values, stage, BD / PM, event date and year, "
        "barter (value in Rupiah + compensation form, e.g. '2 slot iklan TV'), cashback (each recipient + amount + total), "
        "project contacts (role, name, phone), budget categories (budget, spent, remaining or over by), real cost lines with "
        "the budget category each is booked to + margin, payment terms, statuses, documents & links by type (Deck, "
        "Quotation/Penawaran, Contract/Kontrak, SPK, MOU, Invoice, Report/Laporan, Other) and next action. Use it for "
        "'total cashback deal X', 'sisa budget Venue di deal Y', 'kontak klien deal Z', 'dokumen apa aja di deal X'. "
        "Budget never changes the margin. Quote the amounts exactly as given.",
        {
            "dealId": {"type": "string"},
            "deal": {"type": "string", "description": "Deal code (TZN-26001) or (part of) its name / brand, when no dealId."},
            "projectId": {"type": "string", "description": "Only this board."},
        },
    ),
    "nexus_all_pipelines": object_schema(
        "All Pipelines: every company's Pipeline board combined (Source = the board / company), for BoD and One Above All "
        "ONLY. Gives the combined KPIs (open, weighted, won, receivable, real profit), totals per board, cashback / barter / "
        "budget totals and the biggest deals with their company; filter by source (board), year, stage or query. For "
        "anyone else it answers access:false (ALL_PIPELINES_FORBIDDEN): then say All Pipelines is for BoD and One Above "
        "All only, and reveal NOTHING about other boards. Use it for 'semua pipeline', 'total pipeline semua perusahaan', "
        "'bandingin pipeline Suwara vs Intoo'.",
        {
            "source": {"type": "string", "description": "One board (company): its name or part of it, e.g. Suwara."},
            "year": {"type": "integer", "description": "Event year, e.g. 2026."},
            "stage": {"type": "string"},
            "query": {"type": "string", "description": "Deal name, brand, code, BD or PM."},
            "limit": {"type": "integer", "description": "Deals to list (default 15, max 50)."},
            "offset": {"type": "integer"},
        },
    ),
    "nexus_move_deal_stage": object_schema(
        "Move a deal's stage (card). Move a Pipeline deal to another stage, as the person (needs Can edit in that Pipeline board, like the board "
        "itself). ALWAYS a card showing the deal and stage before → after; saved only when they confirm. Find the "
        "deal with nexus_search_deals or pass its name / code.",
        {
            "dealId": {"type": "string"},
            "deal": {"type": "string", "description": "Deal name or code, when no dealId."},
            "stage": {"type": "string", "enum": STAGES},
        },
        required=["stage"],
    ),
    "nexus_add_payment_term": object_schema(
        "Add a deal payment term (card). Record a payment term (termin) on a Pipeline deal, as the person (Can edit in that board). ALWAYS a card with "
        "the amount in rupiah and the deal's terms before → after. amount = plain rupiah number (15 juta = 15000000). "
        "A blank label becomes 'Termin <n>'. A paid amount without paidAt is dated today.",
        {
            "dealId": {"type": "string"},
            "deal": {"type": "string", "description": "Deal name or code, when no dealId."},
            "label": {"type": "string"},
            "amount": {"type": "number"},
            "dueDate": {"type": "string", "description": "YYYY-MM-DD"},
            "invoiceNo": {"type": "string"},
            "invoiceDate": {"type": "string", "description": "YYYY-MM-DD"},
            "paidAmount": {"type": "number"},
            "paidAt": {"type": "string", "description": "YYYY-MM-DD"},
            "note": {"type": "string"},
        },
        required=["amount"],
    ),
    "nexus_log_outlet_sales": object_schema(
        "Enter outlet sales (card). Enter a night's numbers in an Outlet Sales project, as the person (Can edit): sales = TOTAL revenue after tax, "
        "service and discount as ONE rupiah number; pax = people who actually came. Fills the night (event) on that "
        "date; pass event (its name) when there are several, or to add a night not on the board yet. A night's report "
        "opens on the night itself (no future dates). ALWAYS a card with before → after.",
        {
            "project": {"type": "string", "description": "Outlet Sales project name."},
            "projectId": {"type": "string"},
            "date": {"type": "string", "description": "YYYY-MM-DD, the night (default today, WIB)."},
            "event": {"type": "string", "description": "The night's event name."},
            "sales": {"type": "number", "description": "Rupiah, whole number."},
            "pax": {"type": "integer"},
        },
    ),
    "nexus_log_social_media_day": object_schema(
        "Enter social media numbers (card). Enter one day of a Social Media Report project, as the person (Can edit): views, likes, comments, shares, "
        "posts for ONE platform (e.g. Instagram, TikTok — the project's own list), plus optional what worked / didn't. "
        "Whole numbers, never Rp; never a future day. Only the figures sent change. ALWAYS a card with before → after.",
        {
            "project": {"type": "string", "description": "Social Media Report project name."},
            "projectId": {"type": "string"},
            "date": {"type": "string", "description": "YYYY-MM-DD (default today, WIB)."},
            "platform": {"type": "string"},
            "views": {"type": "integer"},
            "likes": {"type": "integer"},
            "comments": {"type": "integer"},
            "shares": {"type": "integer"},
            "posts": {"type": "integer"},
            "worked": {"type": "string"},
            "didntWork": {"type": "string"},
        },
    ),
}
