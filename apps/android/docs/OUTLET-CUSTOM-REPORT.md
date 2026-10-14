# Outlet Sales: report settings, daily targets, guest overview (14 Oct 2026)

Spec for `feature/outlet/*`. Server, web and iOS shipped on `dev` (server rules: `src/lib/outlet-sales.ts`,
`src/lib/outlet-sales-server.ts`; web: `apps/web/src/components/outlet-sales/*`; iOS:
`apps/ios/Sources/Views/OutletSalesCustom.swift`). The released Android build keeps working unchanged: the
server maps its old keys. This spec is what the next Android build adds.

## 1. Compatibility (nothing breaks if Android does nothing)

- The seven original items keep their keys AND their ids: `rsvpWalkIn rsvpTeam rsvpPr rsvpEo hostingTeam hostingPr hostingEo`.
  An event still carries them as top-level fields; PATCH/POST with them still works.
- `form` (GET month / GET event) now lists in the `rsvp` / `hosting` sections only the original items that are
  still active in this outlet, under the outlet's labels. Items added later are not in `form`.
- `rsvpTotal` / `hostingTotal` now add up every item of the outlet's config (custom ones too).

## 2. New data in GET `/api/projects/:id/outlet-sales?month=YYYY-MM`

```jsonc
{
  "canManageSettings": true,           // same rule as canManageTargets
  "config": {                          // the outlet's Report settings
    "version": 1,
    "rsvp":    [{ "id": "rsvpWalkIn", "label": "Walk-in RSVP" }, { "id": "i_k3f9x2ab01", "label": "VIP list" }],
    "hosting": [{ "id": "hostingTeam", "label": "Hosting Team" }, { "id": "i_...", "label": "Old", "archived": true }],
    "communities": [
      { "id": "c_...", "name": "Run Club", "mode": "total", "items": [] },
      { "id": "c_...", "name": "Art Collective", "mode": "breakdown", "items": [{ "id": "i_...", "label": "RSVP" }] }
    ]
  },
  "guests": {                          // Overview's Guest overview for the month (server-computed)
    "reportCount": 1,                  // 0 = show the empty state
    "rsvp":    { "total": 40, "items": [{ "id": "...", "label": "...", "archived": false, "total": 25 }] },
    "hosting": { "total": 6,  "items": [ ... ] },
    "communities": { "total": 22, "items": [{ "id": "...", "name": "...", "mode": "breakdown", "archived": false, "total": 10,
                                             "items": [{ "id": "...", "label": "RSVP", "archived": false, "total": 7 }] }] }
  },
  "days": [                            // every day of the month
    { "date": "2026-10-15", "sales": 6000000, "pax": 45,
      "salesTarget": 5000000, "paxTarget": 50,          // target in force (may have 2 decimals for the month share)
      "salesTargetSource": "day", "paxTargetSource": "day",  // "day" | "month" | null
      "salesPct": 120, "paxPct": 90 }
  ],
  "dayTargets": [{ "date": "2026-10-15", "salesTarget": 5000000, "paxTarget": 50, "updatedBy": {...} }]
}
```

Each event additionally has `values` (`{ itemId: number }`, originals included), `communityTotal`, `communityTotals` (`{ communityId: number|null }`).

## 3. Writes

- Report: POST/PATCH events accept `values: { itemId: number | null }` (null clears). Send only changed ids on PATCH.
  Unknown id → 400 `CONFIG_CHANGED` (settings changed meanwhile): refetch the month and keep what was typed.
- Daily target: `PUT …/outlet-sales/day-targets { date, salesTarget?, paxTarget? }`. Each part optional and independent;
  null clears that part (falls back to the month target ÷ days). 403 `TARGETS_FORBIDDEN` unless `canManageTargets`.
- Report settings: `GET …/outlet-sales/config` → `{ config, usage: { id: reportCount }, canManage }`;
  `PUT …/outlet-sales/config { config }` with the whole list in order. New item/community = omit `id` (server mints it).
  Renaming keeps the id. Removing an item whose `usage > 0`: ask first (centred alert), send it with `"archived": true`
  (the server would archive it anyway). Unused items are dropped. Restore = `archived` removed. 403 `SETTINGS_FORBIDDEN`.
- Realtime: all of these emit `outlet-sales-changed` on `project:<id>` (refetch as today).

## 4. UI (match web/iOS)

- Overview: REMOVE the counts strip (Events / Reported / Waiting report / RSVP / Hosting) and the "Events in <Month>" list.
  Keep Sales/Pax cards + target line + waiting banner, then one "Guests · <Month>" card: RSVP total + items,
  Hosting total + items, Communities total + each community (Breakdown ones expand to their items). Each line shows a thin
  share bar. Empty (`reportCount == 0`): why + "Fill a report" (+ "Report settings" for managers).
- Calendar: target icon on cells whose date is in `dayTargets`. Under the picked day: "Day target" card with Sales and Pax
  `actual / target (pct%)`, source caption ("Own target" / "Month's target ÷ days" / "No target"), bar; managers get
  "Set/Change day target" with two optional boxes (placeholder = the month share).
- Report form: RSVP and Hosting sections built from `config` (active items + archived ones this report already has),
  live totals in the titles; a "Communities – TOTAL" section after Hosting: Total-only community = one box, Breakdown = its
  items in a sub-card (plus a "Total only" box if the report already has a single number for it).
- Event detail: same breakdown, archived items marked "· archived".
- Report settings (managers only): lists for RSVP items, Hosting items, Communities (name, Total only / Breakdown,
  sub-items); add, rename, reorder, remove→archive confirm, restore archived.
- Strings: EN + ID, copy from `apps/web/src/lib/i18n/id-outlet.ts` (block "Owner's revisions … 14 Oct 2026").
