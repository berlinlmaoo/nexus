"""Schemas for groups 6 (Pipeline) and 7 (Outlet Sales / Social Media Report), 18 Oct 2026. Server:
src/lib/gideon-tools/pipeline.ts and outlet-social.ts. Every one of these ALWAYS ends in a card the person
confirms; proposed:true means nothing has changed yet."""
from .schemas import object_schema, LIMIT  # noqa: F401

STAGES = ["Incoming", "Proposal / Quotation", "Negotiation", "Won – Contract Pending", "Won – In Execution", "Closing", "Closed", "Lost / Cancelled"]

G67_SCHEMAS = {
    "nexus_move_deal_stage": object_schema(
        "Move a Pipeline deal to another stage, as the person (needs Can edit in that Pipeline board, like the board "
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
        "Record a payment term (termin) on a Pipeline deal, as the person (Can edit in that board). ALWAYS a card with "
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
        "Enter a night's numbers in an Outlet Sales project, as the person (Can edit): sales = TOTAL revenue after tax, "
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
        "Enter one day of a Social Media Report project, as the person (Can edit): views, likes, comments, shares, "
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
