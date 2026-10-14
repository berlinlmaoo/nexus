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
