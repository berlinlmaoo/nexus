# GIDEON — the parts that run outside the NEXUS server

GIDEON, the NEXUS assistant, runs as an agent on a separate host. NEXUS talks to it over a small HTTP
shim; the agent calls back into NEXUS through a tool plugin. This folder keeps versioned copies of both so
changes have a history. The host-specific install notes (paths, service units, addresses) are kept
privately with the operations runbook, not here.

| Here | What it is |
|---|---|
| `plugin/` | Tool plugin for the agent runtime: every tool calls `POST /api/gideon/tools` on NEXUS as the asking user |
| `shim/codex-oracle-shim.js` | HTTP shim NEXUS calls (`GET /health`, `POST /chat`, `POST /chat-stream`); picks the model tier |
| `shim/gideon-stream-runner.py` | Token-by-token streaming for `/chat-stream` (NDJSON) |
| `shim/systemd/graceful-restart.conf` | systemd drop-in for the shim unit: `KillMode=mixed`, `TimeoutStopSec=460` (graceful restart) |

## Environment (values are never stored here)

Agent runtime env:

    NEXUS_BASE_URL=https://<your NEXUS host>
    NEXUS_SERVICE_TOKEN=<secret>
    NEXUS_GIDEON_NO_ATTENDANCE=1      # optional: do not register attendance/ticket tools at all

Shim env:

    ORACLE_LLM_SECRET=<secret, same value as ORACLE_LLM_SECRET in the NEXUS container>
    ORACLE_LLM_PORT=8765              # default
    CODEX_BIN / HERMES_BIN            # optional; default: found on PATH

Check that the tool path works, not just the shim: calling `call_nexus('list_projects', {'limit': 1})` from
`plugin/client.py` must answer `{"ok":true,...}`. A 401 means `NEXUS_BASE_URL` points at the wrong service;
`error code: 1010` means the request lost its User-Agent and was refused by the CDN.

## Restarting the shim

The shim drains on SIGTERM: answers in flight finish (hosted tiers up to `GIDEON_DRAIN_MS`, default 120 s after the
signal; Model 0 up to its own timeout), new requests get `503 {"error":"shim_restarting"}` with `x-gideon-shim:
restarting` and `Retry-After`, and `GET /health` answers `x-gideon-shim: draining` plus `x-gideon-shim-started`. A
run still going at its cap ends with the stream line `{"t":"error","c":"shim_restart"}` (or `503` with
`x-gideon-shim: stopped` on `/chat`). NEXUS retries a restarting or unreachable shim once and records what is still
lost as `shim_restart`, which Control Room > GIDEON > Performance shows as "restarts", not as errors
(`src/lib/gideon-shim-retry.ts`). The unit needs the drop-in in `shim/systemd/`, or systemd's SIGTERM still reaches
the children and its 90 s stop timeout cuts the drain short. A restart therefore waits for the answers in flight.

## Rules that must not be broken

- The plugin never gets an attendance tool, not even a role-limited one. Every other tool is safe because it
  acts AS the user and is refused wherever that user is refused; but a person may check themselves in, so
  "acting as the user" does not hold anything back there.
- A dev server gets its own agent profile and token and never reaches production data, and the other way round.
- New plugin tools go live only together with the NEXUS server release that has the matching action.

## Workspace search tool

`nexus_search_workspace` (plugin `__init__.py` + `schemas.py`) maps to action `search_workspace` on
`/api/gideon/tools`: one search over projects, tasks, docs, task comments, forms and chat — only what the
acting user may see (same rules as ⌘K `/api/search`). Attendance is never searched. The server also searches
before answering (pre-search, `/api/gideon` with `stream:true`) and only hits cited in the answer become
Sources. The editor's "Ask AI" (`/api/gideon/write`) and AI Autofill use the same shim with a "do not call
tools" prompt and stay actor-scoped if the model ignores it.

## Calendar and Room Booking tools

`nexus_get_calendar` (action `get_calendar`) reads the asking user's Master Calendar for a range (default this
week, at most 62 days) through the Calendar's own visibility rules (`lib/calendar`): a task of a private project
they are not in comes back masked as "Internal task" with no title, project or id, and tasks without a PIC are not
there. `nexus_list_room_bookings` (action `list_room_bookings`) reads Room Booking (bookings, free time per room and
day, and one slot's availability). Both are read only and company-workspace only; the server code is
`src/lib/gideon-calendar-tools.ts`.

`nexus_book_room` (action `book_room`) books a room as the asking user through the Room Booking page's own path
(`src/lib/room-booking.ts`, `src/lib/gideon-book-room.ts`). It follows the approval modes: a card in "Always ask" and
"Review before writing", direct only in "Don't ask" — and always a card when no single room was named, where the
person picks the room. Apply re-checks the slot; the database also refuses an overlap.

`nexus_move_room_booking` (action `move_room_booking`) and `nexus_cancel_room_booking` (action `cancel_room_booking`)
move (new time and/or room) or cancel an existing booking as the asking user, through the same code as the Room
Booking page's PATCH / DELETE (`updateRoomBooking` / `deleteRoomBooking` in `src/lib/room-booking.ts`): only a booking
that user may change there. Same approval modes as `nexus_book_room`; the card shows the booking before and after. A
move re-checks the slot on Apply (the database's exclusion constraint included) and keeps the card open with the
nearest free slots when it was taken meanwhile. A released app that does not know these cards cannot apply them.
