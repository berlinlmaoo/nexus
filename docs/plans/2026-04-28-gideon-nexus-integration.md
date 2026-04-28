# GIDEON ↔ NEXUS Integration Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Give GIDEON first-class, safe access to NEXUS project/task operations from CLI, WhatsApp/gateway, and Open WebUI.

Architecture: Do NOT reuse browser session cookies and do NOT let Hermes write directly to Postgres. Add a small service-token API inside NEXUS, scoped to approved GIDEON actions, then expose those actions to Hermes through a user plugin/toolset named `nexus`. This keeps auth, audit, RBAC, automations, webhook dispatch, and realtime events owned by NEXUS.

Tech Stack: Next.js App Router, Prisma/Postgres, NextAuth, Hermes plugin API, Python stdlib urllib/json.

Current facts discovered:
- NEXUS source: `/Users/jagainmacmini1/Documents/nexus`
- NEXUS local app: `http://127.0.0.1:3000`
- NEXUS public app: `https://nexus.patsgroup.id`
- NEXUS health: `/api/health` returns healthy + DB up
- Existing GIDEON route: `/src/app/api/gideon/route.ts`
- Existing GIDEON route is an in-app Anthropic chat endpoint requiring NextAuth `auth()`; it is NOT ideal as Hermes tool API.
- Existing task APIs are session-authenticated and already do audit/automation/webhook/realtime.
- Core models: `User`, `Workspace`, `WorkspaceMember`, `Project`, `ProjectMember`, `TaskList`, `Task`, `TaskAssignee`.
- Useful enums: `TaskStatus = TODO | IN_PROGRESS | IN_REVIEW | DONE | CANCELLED`; `TaskPriority = URGENT | HIGH | MEDIUM | LOW | NONE`; `ProjectStatus = ACTIVE | ARCHIVED | COMPLETED`; `ProjectRole = LEAD | MEMBER | VIEWER | GUEST`.

Non-negotiables:
- Service token must live in env only. Never hardcode.
- NEXUS writes must create audit/activity logs as GIDEON/service actor.
- Read tools can be broad for Berlin/admin; write tools need RBAC and validation.
- Start with minimal useful actions; do not build a giant API surface.
- Existing `/api/gideon` chat endpoint should be left alone initially to avoid breaking NEXUS UI.

---

## Phase 1 — NEXUS service-token API

### Task 1: Add service-token env docs

Objective: Document the env vars needed for Hermes/GIDEON to call NEXUS.

Files:
- Modify: `/Users/jagainmacmini1/Documents/nexus/.env.example`
- Modify: `/Users/jagainmacmini1/Documents/nexus/.env.production` manually only if ready to deploy

Add to `.env.example`:

```bash
# GIDEON/Hermes service API
NEXUS_GIDEON_SERVICE_TOKEN=
NEXUS_GIDEON_ACTOR_EMAIL=
```

Notes:
- `NEXUS_GIDEON_SERVICE_TOKEN` is the bearer token Hermes sends.
- `NEXUS_GIDEON_ACTOR_EMAIL` is the NEXUS user used as actor for creatorId/audit logs. Recommended: create/use a dedicated `gideon@patsgroup.id` user, or Berlin's admin user only for MVP.

Verification:
```bash
cd /Users/jagainmacmini1/Documents/nexus
npm run typecheck
```
Expected: typecheck passes or existing unrelated errors only.

Commit:
```bash
git add .env.example
git commit -m "docs: add gideon service env vars"
```

---

### Task 2: Create service auth helper

Objective: Centralize bearer-token auth and service actor lookup for GIDEON routes.

Files:
- Create: `/Users/jagainmacmini1/Documents/nexus/src/lib/gideon-service-auth.ts`
- Test: `/Users/jagainmacmini1/Documents/nexus/src/__tests__/gideon-service-auth.test.ts`

Implementation shape:

```ts
import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export async function authenticateGideonService(req: NextRequest) {
  const configured = process.env.NEXUS_GIDEON_SERVICE_TOKEN
  if (!configured) {
    return { ok: false as const, response: NextResponse.json({ error: "GIDEON service token not configured" }, { status: 503 }) }
  }

  const auth = req.headers.get("authorization") || ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (!token || !safeEqual(token, configured)) {
    return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const actorEmail = process.env.NEXUS_GIDEON_ACTOR_EMAIL
  if (!actorEmail) {
    return { ok: false as const, response: NextResponse.json({ error: "GIDEON actor not configured" }, { status: 503 }) }
  }

  const actor = await prisma.user.findUnique({ where: { email: actorEmail } })
  if (!actor) {
    return { ok: false as const, response: NextResponse.json({ error: "GIDEON actor user not found" }, { status: 503 }) }
  }

  return { ok: true as const, actor }
}
```

Testing notes:
- Mock env values.
- Test missing token => 503.
- Test wrong bearer => 401.
- Test missing actor env => 503.
- Test valid token returns `ok: true` with actor.

Verification:
```bash
cd /Users/jagainmacmini1/Documents/nexus
npm run test -- src/__tests__/gideon-service-auth.test.ts
npm run typecheck
```

Commit:
```bash
git add src/lib/gideon-service-auth.ts src/__tests__/gideon-service-auth.test.ts
git commit -m "feat: add gideon service auth helper"
```

---

### Task 3: Add read-only service route

Objective: Let Hermes safely list/search NEXUS data before any write action exists.

Files:
- Create: `/Users/jagainmacmini1/Documents/nexus/src/app/api/gideon/tools/route.ts`
- Test: `/Users/jagainmacmini1/Documents/nexus/src/__tests__/gideon-tools-route.test.ts`

Route design:
- Method: `POST /api/gideon/tools`
- Header: `Authorization: Bearer <NEXUS_GIDEON_SERVICE_TOKEN>`
- Body: `{ "action": "list_projects" | "list_members" | "list_tasks" | "search_tasks" | "get_project_summary", "input": {...} }`
- Response: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "..." }`

Read actions MVP:
1. `list_projects`
   - input: `{ workspaceId?: string, status?: ProjectStatus }`
   - output: project id, name, description, status, workspace, members, task counts, taskLists.
2. `list_members`
   - input: `{ workspaceId?: string, projectId?: string }`
   - output: user id, name, email, avatar, workspace/project role.
3. `list_tasks`
   - input: `{ projectId?: string, status?: TaskStatus, priority?: TaskPriority, assigneeId?: string, limit?: number }`
   - output: id, title, description excerpt, status, priority, dueDate, project, taskList, assignees.
4. `search_tasks`
   - input: `{ query: string, projectId?: string, limit?: number }`
   - output: same as list_tasks.
5. `get_project_summary`
   - input: `{ projectId: string }`
   - output: members, totalTasks, byStatus, byPriority, progress percentage.

Implementation rules:
- Cap all list/search results at max 100.
- Return only fields useful to GIDEON; avoid dumping full comments/attachments unless asked later.
- For MVP, because service actor is trusted, use actor's system/workspace/admin access as source of scope. If actor is system ADMIN, allow all. If actor is not admin, scope to actor memberships.

Verification:
```bash
cd /Users/jagainmacmini1/Documents/nexus
npm run test -- src/__tests__/gideon-tools-route.test.ts
npm run typecheck
```

Manual smoke after deploy:
```bash
curl -sS -X POST http://127.0.0.1:3000/api/gideon/tools \
  -H "Authorization: Bearer $NEXUS_GIDEON_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"list_projects","input":{}}'
```
Expected: JSON list of projects.

Commit:
```bash
git add src/app/api/gideon/tools/route.ts src/__tests__/gideon-tools-route.test.ts
git commit -m "feat: add read-only gideon tools API"
```

---

### Task 4: Add write actions with audit/activity

Objective: Support task creation and updates from GIDEON while preserving NEXUS side effects.

Files:
- Modify: `/Users/jagainmacmini1/Documents/nexus/src/app/api/gideon/tools/route.ts`
- Test: `/Users/jagainmacmini1/Documents/nexus/src/__tests__/gideon-tools-route.test.ts`

Write actions MVP:
1. `create_task`
   - input: `{ title, description?, projectId, taskListId?, status?, priority?, dueDate?, assigneeIds?, tags?, parentId? }`
   - if `taskListId` missing, choose first task list ordered by position in project.
   - validate project access using `checkProjectAccess(actor.id, projectId, ["MEMBER"])`.
   - create Task with `creatorId = actor.id`.
   - create ActivityLog.
   - call `seedTaskCustomFieldValues`.
   - call `executeAutomations`, `dispatchWebhookEvent`, `emitTaskCreated` non-blocking, mirroring `/api/tasks/route.ts`.
2. `update_task`
   - input: `{ taskId, title?, description?, status?, priority?, dueDate?, assigneeIds?, tags? }`
   - find existing task + project.
   - validate `MEMBER` access.
   - update task fields.
   - replace assignees only when `assigneeIds` is present.
   - create ActivityLog.
   - call `notifyTaskCompleted` when status changes to DONE, plus automation/webhook/realtime where appropriate.
3. `add_task_comment`
   - input: `{ taskId, content }`
   - validate project access.
   - create Comment as actor.
   - create ActivityLog.

Important: Don't duplicate too much logic. If feasible, extract shared task-create/update helpers from existing routes later. For MVP, some duplication is acceptable but keep side effects aligned.

Verification:
```bash
cd /Users/jagainmacmini1/Documents/nexus
npm run test -- src/__tests__/gideon-tools-route.test.ts
npm run typecheck
```

Manual smoke:
```bash
curl -sS -X POST http://127.0.0.1:3000/api/gideon/tools \
  -H "Authorization: Bearer $NEXUS_GIDEON_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"create_task","input":{"title":"GIDEON smoke test","projectId":"<PROJECT_ID>","priority":"LOW"}}'
```
Expected: task created and visible in NEXUS UI.

Commit:
```bash
git add src/app/api/gideon/tools/route.ts src/__tests__/gideon-tools-route.test.ts
git commit -m "feat: add gideon task write actions"
```

---

## Phase 2 — Hermes NEXUS plugin/toolset

### Task 5: Create Hermes user plugin skeleton

Objective: Add a local Hermes plugin named `nexus` without modifying upstream Hermes core.

Files:
- Create: `/Users/jagainmacmini1/.hermes/plugins/nexus/plugin.yaml`
- Create: `/Users/jagainmacmini1/.hermes/plugins/nexus/__init__.py`
- Create: `/Users/jagainmacmini1/.hermes/plugins/nexus/client.py`
- Create: `/Users/jagainmacmini1/.hermes/plugins/nexus/schemas.py`

`plugin.yaml`:

```yaml
name: nexus
version: 0.1.0
description: "NEXUS project/task management tools for GIDEON/PATS. Calls NEXUS service API with a dedicated bearer token."
author: PATS Group
kind: standalone
requires_env:
  - NEXUS_BASE_URL
  - NEXUS_SERVICE_TOKEN
provides_tools:
  - nexus_list_projects
  - nexus_list_members
  - nexus_list_tasks
  - nexus_search_tasks
  - nexus_get_project_summary
  - nexus_create_task
  - nexus_update_task
  - nexus_add_task_comment
```

`client.py` shape:

```py
import json, os, urllib.request, urllib.error

BASE_URL = os.getenv("NEXUS_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
TOKEN = os.getenv("NEXUS_SERVICE_TOKEN", "")

def check_available():
    return bool(BASE_URL and TOKEN)

def call_nexus(action: str, input: dict):
    data = json.dumps({"action": action, "input": input or {}}).encode()
    req = urllib.request.Request(
        BASE_URL + "/api/gideon/tools",
        data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + TOKEN},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.dumps(json.loads(resp.read().decode()), ensure_ascii=False)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        return json.dumps({"ok": False, "status": e.code, "error": body}, ensure_ascii=False)
```

`__init__.py` should call `ctx.register_tool(...)` for each schema and handler:

```py
from .client import call_nexus, check_available
from .schemas import SCHEMAS

_ACTION_BY_TOOL = {
    "nexus_list_projects": "list_projects",
    "nexus_list_members": "list_members",
    "nexus_list_tasks": "list_tasks",
    "nexus_search_tasks": "search_tasks",
    "nexus_get_project_summary": "get_project_summary",
    "nexus_create_task": "create_task",
    "nexus_update_task": "update_task",
    "nexus_add_task_comment": "add_task_comment",
}

def _make_handler(action):
    return lambda args, **kw: call_nexus(action, args or {})

def register(ctx):
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
```

Verification:
```bash
hermes plugins list
hermes plugins enable nexus
hermes plugins list
```
Expected: `nexus` appears and is enabled after command.

Commit: This is user plugin outside the NEXUS repo, so do not commit unless mirrored into a repo later.

---

### Task 6: Add Hermes env vars and enable toolset

Objective: Make the plugin available in future Hermes sessions/gateway runs.

Files:
- Modify: `/Users/jagainmacmini1/.hermes/.env`
- Modify via CLI: `/Users/jagainmacmini1/.hermes/config.yaml`

Add to `/Users/jagainmacmini1/.hermes/.env`:

```bash
NEXUS_BASE_URL=http://127.0.0.1:3000
NEXUS_SERVICE_TOKEN=<same value as NEXUS_GIDEON_SERVICE_TOKEN in NEXUS env>
```

Commands:

```bash
hermes plugins enable nexus
hermes tools enable nexus
hermes gateway restart
```

Important: Tool changes only apply to new sessions. For CLI, start a new `hermes` session or `/reset`. For gateway, restart.

Verification:
```bash
hermes tools list | grep -i nexus || true
hermes chat -q "Use nexus_list_projects and show me the first 5 NEXUS projects" --toolsets nexus
```
Expected: GIDEON can call `nexus_list_projects` and summarize results.

---

## Phase 3 — Grounding + operating rules

### Task 7: Update GIDEON context docs from Asana to NEXUS

Objective: Stop future GIDEON sessions from defaulting to Asana language.

Files:
- Modify or replace: `/Users/jagainmacmini1/.hermes/gideon/SOP_GIDEON_ASANA.md`
- Modify: `/Users/jagainmacmini1/.hermes/gideon/KNOWLEDGE.md`
- Modify: `/Users/jagainmacmini1/.hermes/gideon/AGENTS.md` if it mentions Asana as source-of-truth

Recommendation:
- Rename `SOP_GIDEON_ASANA.md` to `SOP_GIDEON_NEXUS.md` if gateway context loader references can be updated safely.
- If references are hardcoded, keep filename for compatibility but add a top banner:

```md
# Deprecated filename note

PATS Group project/task management source-of-truth is now NEXUS, not Asana. Treat historical Asana references as conceptual migration notes only.
```

Verification:
```bash
cd /Users/jagainmacmini1/.hermes/gideon
python3 scripts/audit_contact_profiles.py --pretty
```
Expected: no unrelated contact audit regression.

---

### Task 8: Add GIDEON tool-use policy for NEXUS writes

Objective: Prevent accidental destructive changes through chat.

Policy to add in GIDEON context:

```md
## NEXUS write policy

- Read/search/list NEXUS freely for authorized users.
- For Berlin/Bagas, GIDEON may create/update NEXUS tasks when intent is clear.
- For staff, only create/update tasks within their scope.
- For ambiguous project/assignee/due date, ask a clarifying question before writing.
- Never delete/archive projects/tasks from conversational instruction unless Berlin explicitly confirms.
- Every write must return the NEXUS task/project ID and a short summary of what changed.
```

Verification:
- Ask GIDEON through Open WebUI: “list NEXUS projects”. Should use NEXUS read tool.
- Ask: “create task follow up supplier besok”. Should ask for missing project/assignee if ambiguous.

---

## Phase 4 — End-to-end acceptance tests

### Task 9: Read-only acceptance

Run:
```bash
hermes chat -q "Use NEXUS tools: list active projects, then list my top TODO tasks. Keep it short." --toolsets nexus
```

Expected:
- Calls `nexus_list_projects`.
- Calls `nexus_list_tasks`.
- Returns project/task names without raw JSON dump.

---

### Task 10: Write acceptance

Run:
```bash
hermes chat -q "Use NEXUS tools: create a LOW priority task titled 'GIDEON integration smoke test' in project <PROJECT_ID>, then return the task ID." --toolsets nexus
```

Expected:
- Creates exactly one task.
- Response includes task ID.
- Task visible in NEXUS UI.
- Activity/audit log created with GIDEON actor.

Rollback:
- Mark the smoke task DONE or CANCELLED in UI.
- Do not delete unless necessary.

---

## Recommended MVP order

1. Service auth helper.
2. Read-only `/api/gideon/tools`.
3. Hermes plugin read tools.
4. Verify through CLI/Open WebUI.
5. Add write tools.
6. Update GIDEON docs/policy.
7. Enable gateway-wide.

## Risk notes

- Existing `/api/gideon` route currently spins Anthropic inside NEXUS. It may be useful for NEXUS in-app chat, but Hermes should not call it as a tool API.
- If the service actor is Berlin's account, audit logs will show Berlin as creator. Cleaner long-term: create a dedicated `GIDEON` user and give it workspace admin/member access based on desired scope.
- If `NEXUS_GIDEON_SERVICE_TOKEN` is set in `.env.production`, Docker container must be recreated/restarted with updated env.
- Since Hermes plugins are opt-in, `hermes plugins enable nexus` and a fresh session/gateway restart are required before tools appear.
