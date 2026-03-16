# NEXUS v0.2.0 — Phase 2 Architecture Decision Report

**Date:** 2026-03-16
**Author:** @architect (CC_GodMode System Architect)
**Status:** APPROVED FOR IMPLEMENTATION

---

## Executive Summary

Phase 1 delivered: automation engine, webhooks, RBAC, portfolios, goals linkage, my-tasks overhaul, and comment threading. Phase 2 closes the gap to Asana parity with 8 features that are primarily **wiring work** — the infrastructure exists but isn't connected. This report documents the architecture decisions for each feature, following existing codebase patterns.

---

## Codebase Pattern Summary

Before diving into features, these are the patterns every implementer must follow:

| Concern | Existing Pattern | Files |
|---------|-----------------|-------|
| **API Routes** | Next.js App Router `route.ts`, auth via `auth()`, return `NextResponse.json()` | `src/app/api/**` |
| **RBAC** | `checkProjectAccess(userId, projectId, roles[])` with role hierarchy LEAD>MEMBER>VIEWER>GUEST | `src/lib/rbac.ts` |
| **Real-time** | API route → `socket-emitter` → `event-bus` → Pages API socket server → client hooks | `src/lib/socket-emitter.ts`, `src/lib/event-bus.ts`, `pages/api/socket.ts` |
| **Audit** | `logAudit({ action, entityType, entityId, entityName, userId, request })` | `src/lib/audit.ts` |
| **Webhooks** | `dispatchWebhookEvent(event, payload, projectId)` non-blocking | `src/lib/webhook-dispatcher.ts` |
| **Client Data** | `fetch()` in client components + `router.refresh()` for server component revalidation | Throughout |
| **UI Components** | Radix UI primitives, Framer Motion animations, Tailwind CSS | `src/components/**` |
| **State** | React `useState`/`useEffect`, no global state library | Throughout |

---

## Feature 1: Real-time Socket.IO Event Wiring

### Current State

The full pipeline exists and is already wired:

```
API Routes (POST/PATCH/DELETE tasks, POST comments)
    ↓ emitTaskCreated / emitTaskUpdated / emitTaskDeleted / emitCommentAdded
Event Bus (src/lib/event-bus.ts — global EventEmitter singleton)
    ↓ eventBus.emit(EVENT, payload)
Socket.IO Server (pages/api/socket.ts — listens to event bus, broadcasts to rooms)
    ↓ io.to(`project:${projectId}`).emit('task-created', data)
Client Hooks (src/hooks/use-realtime-project.ts — joins room, listens to events)
    ↓ onTaskCreated callback or router.refresh()
React Components
```

Task CRUD and comments already emit events. The `useRealtimeProject` hook already listens. **The bridge works.**

### What's Actually Missing

1. **Notification events are emitted but never consumed on the client.** `emitNotification(userId, notification)` broadcasts to `user:{userId}` room, but no hook joins that room or listens to `new-notification`.
2. **No optimistic UI** — most consumers just call `router.refresh()`, causing full page re-render.
3. **Sprint events not emitted** — sprint status changes and task moves don't broadcast.
4. **No reconnection resilience** — if the socket disconnects mid-session, missed events are lost.

### Architecture Decision

**Approach: Extend existing event bus pattern (no Redis needed at this scale)**

Redis pub/sub would be needed for horizontal scaling (multiple server instances), but NEXUS runs a single Next.js server. The in-process `EventEmitter` on `globalThis` is sufficient.

#### 1.1 Add notification listener hook

```
src/hooks/use-realtime-notifications.ts
```

- Joins `user:{userId}` room on mount
- Listens to `new-notification` event
- Exposes `notifications[]` state and `unreadCount`
- Integrates with existing notification bell in header

#### 1.2 Add sprint socket events

Add to `src/lib/socket-emitter.ts`:
- `emitSprintUpdated(projectId, sprint)`

Add to `pages/api/socket.ts` event bus listener:
- `SPRINT_UPDATED` → broadcasts to `project:{projectId}` as `sprint-updated`

Add to `src/lib/event-bus.ts`:
- `SPRINT_UPDATED` constant

Wire in `src/app/api/sprints/route.ts` PATCH handler after sprint update.

#### 1.3 Optimistic UI for task updates

In `useRealtimeProject`, instead of defaulting to `router.refresh()`:
- Accept `onTaskUpdated(task)` callback that patches local state
- Consumers (board view, list view) update their local arrays optimistically
- Fall back to `router.refresh()` only when no callback is provided (current behavior, preserved)

#### 1.4 Reconnection strategy

Add to `useSocket`:
- On `reconnect` event, emit a `sync-request` to server
- Server responds with last 10 events for the room (stored in a small in-memory ring buffer per room in `pages/api/socket.ts`)
- This prevents missed events during brief disconnects

### Risks

| Risk | Mitigation |
|------|------------|
| Event bus is in-process only — won't work if we add a second server | Acceptable for MVP. Migration path: swap `EventEmitter` for Redis pub/sub in `event-bus.ts` (single file change) |
| Ring buffer grows memory | Cap at 50 events per room, TTL 5 minutes, evict on room empty |
| Optimistic UI conflicts with server state | Reconcile on next `router.refresh()` or explicit refetch |

### Estimated Complexity: LOW
Most of this is adding 2-3 lines in existing files. The notification hook is the only new file of substance.

---

## Feature 2: Teams ↔ Projects Access Propagation

### Current State

- `TeamProject` join table exists — links teams to projects (informational only)
- `TeamMember` join table exists — tracks team membership
- `ProjectMember` tracks project access with roles (LEAD/MEMBER/VIEWER/GUEST)
- **Gap:** Linking a project to a team does NOT grant team members access to the project. These are completely disconnected.

### Architecture Decision

**Approach: Propagation on link + sync on member change**

When a project is linked to a team, all team members should receive `ProjectMember` records. When a member is added to a team, they should get access to all the team's linked projects.

#### 2.1 Schema changes: NONE

The existing `TeamProject`, `TeamMember`, and `ProjectMember` tables are sufficient. No new tables needed.

#### 2.2 Add `teamRole` field to TeamMember

```prisma
model TeamMember {
  id     String   @id @default(cuid())
  teamId String
  userId String
  role   TeamRole @default(MEMBER)  // NEW FIELD
  team   Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([teamId, userId])
}

enum TeamRole {
  LEAD
  MEMBER
}
```

#### 2.3 Role mapping: TeamRole → ProjectRole

| TeamRole | ProjectRole on propagation |
|----------|--------------------------|
| LEAD | MEMBER |
| MEMBER | MEMBER |

Team leads get MEMBER access to projects (not LEAD — project leadership is granted explicitly). This prevents accidental admin escalation.

#### 2.4 Propagation logic

Create `src/lib/team-sync.ts`:

```typescript
async function syncTeamProjectAccess(teamId: string, projectId: string): Promise<void>
// For each TeamMember of this team, upsert ProjectMember with role MEMBER
// Skip if user already has EQUAL OR HIGHER role

async function syncTeamMemberAccess(teamId: string, userId: string): Promise<void>
// For each TeamProject of this team, upsert ProjectMember for this user
// Skip if user already has EQUAL OR HIGHER role

async function revokeTeamProjectAccess(teamId: string, projectId: string): Promise<void>
// Remove ProjectMember records for team members who have no OTHER path to access
// (i.e., not a direct member and not in another team linked to this project)
```

#### 2.5 Hook points in `/api/teams/route.ts`

| Action | Hook |
|--------|------|
| `link-project` | Call `syncTeamProjectAccess(teamId, projectId)` |
| `unlink-project` | Call `revokeTeamProjectAccess(teamId, projectId)` |
| `add-member` | Call `syncTeamMemberAccess(teamId, userId)` |
| `remove-member` | Revoke project access for removed member (if no other access path) |

#### 2.6 UI changes

In the teams page (`src/app/(app)/teams/page.tsx`):
- Show a confirmation when linking a project: "This will grant all X team members access to this project"
- Show warning when unlinking: "Team members without direct access will lose access"

### Risks

| Risk | Mitigation |
|------|------------|
| Revoking access removes manually-granted higher roles | Check access path: only revoke if the `ProjectMember` was team-propagated (add `source` field: `'direct' \| 'team'`) |
| Race conditions on concurrent link/unlink | Use Prisma transactions for all propagation operations |
| Performance on large teams | Batch upserts with `createMany` + `skipDuplicates` |

### Schema Addition (Revised)

Add `source` field to `ProjectMember`:

```prisma
model ProjectMember {
  id        String      @id @default(cuid())
  role      ProjectRole @default(MEMBER)
  source    String      @default("direct")  // "direct" | "team:{teamId}"
  joinedAt  DateTime    @default(now())
  userId    String
  projectId String
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  project   Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([userId, projectId])
}
```

### Estimated Complexity: MEDIUM
Core logic is ~100 lines in `team-sync.ts`. Main risk is the revocation edge cases.

---

## Feature 3: Sidebar Favorites & Recents

### Current State

- Sidebar (`src/components/layout/sidebar.tsx`, 802 lines) has placeholder state for favorites and recents:
  ```typescript
  const [favorites, setFavorites] = useState<Array<{ id: string; type: string; targetId: string }>>([])
  const [recents, setRecents] = useState<Array<{ id: string; name: string; color: string; icon: string }>>([])
  ```
- `/api/favorites` route exists with GET (fetch) and POST (toggle) — fully implemented
- `Favorite` model exists in Prisma schema with `userId`, `type`, `targetId`
- Favorites widget exists in dashboard (`src/components/dashboard/widgets/favorites-widget.tsx`)

### Architecture Decision

**Approach: Server-fetched favorites, localStorage recents**

#### 3.1 Favorites in sidebar

Wire the existing `/api/favorites` API into the sidebar:

```typescript
// In sidebar.tsx useEffect
const res = await fetch('/api/favorites')
const data = await res.json()
setFavorites(data.favorites)
```

Render favorites section between "Home" nav and "Projects" section:
- Star icon, collapsible section header "Favorites"
- Each item: icon based on `type` (project/task/doc), name, click to navigate
- Drag to reorder (optional Phase 2+)
- Right-click context menu: "Remove from favorites"

For toggling favorites, add a star button to:
- Project header (`project-header.tsx`)
- Task detail panel
- Document pages

All toggle via `POST /api/favorites` with `{ type, targetId }`.

#### 3.2 Recents in sidebar

**Decision: localStorage, not server.**

Rationale: Recents are per-device, low-value data that doesn't need persistence across devices. Server storage adds latency and DB load for marginal benefit. Asana uses client-side recents.

Implementation:
```typescript
// src/lib/recents.ts
const RECENTS_KEY = 'nexus-recents'
const MAX_RECENTS = 8

export function addRecent(item: { id: string; type: string; name: string; path: string; color?: string; icon?: string })
export function getRecents(): RecentItem[]
export function clearRecents(): void
```

Hook into Next.js navigation:
- In project pages, task detail opens, doc opens — call `addRecent()`
- Sidebar reads `getRecents()` on mount and renders below Favorites

#### 3.3 Sidebar section order

```
Home (Dashboard)
My Tasks
Inbox / Notifications
──────────────
★ Favorites (collapsible, server-fetched)
⏱ Recents (collapsible, localStorage)
──────────────
Projects (existing tree)
Goals
Portfolios
──────────────
Settings
```

### Risks

| Risk | Mitigation |
|------|------------|
| Favorites fetch adds latency to sidebar render | Fetch in parallel with project list, show skeleton |
| localStorage recents stale after deletion | Validate on render — if item 404s, remove from recents |
| Sidebar getting too long | Collapsible sections, max 5 favorites shown (expand to see all) |

### Estimated Complexity: LOW
API exists. UI is straightforward. ~150 lines of new code.

---

## Feature 4: Dashboard Interactivity (Task Completion + Quick Create)

### Current State

- `my-tasks-widget.tsx` in dashboard displays tasks read-only with priority/status badges
- My-tasks page (`my-tasks-client.tsx`) already has:
  - Quick-complete checkbox (PATCH `/api/tasks/{id}` with `{ status: 'DONE' }`)
  - Inline task creation with project selector
- Dashboard `quick-actions-widget.tsx` exists with buttons but they just navigate away

### Architecture Decision

**Approach: Port my-tasks-client patterns into dashboard widgets**

#### 4.1 Task completion from dashboard

Add checkbox to `my-tasks-widget.tsx` (dashboard version):

```typescript
const handleComplete = async (taskId: string) => {
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DONE' }),
  })
  // Optimistic: remove from list immediately
  setTasks(prev => prev.filter(t => t.id !== taskId))
}
```

This follows the exact pattern from `my-tasks-client.tsx:handleToggleComplete`.

Add undo toast (5 second window):
```typescript
// On complete, show toast with "Undo" button
// Undo calls PATCH with { status: previousStatus }
```

#### 4.2 Quick-create task from dashboard

Add inline creation row to bottom of `my-tasks-widget.tsx`:

```typescript
// Minimal UI: text input + project selector dropdown + Enter to create
// POST /api/tasks with { title, taskListId }
// taskListId = default task list of selected project (first list)
```

Reuse the project selector pattern from `my-tasks-client.tsx` (lines 280-330).

#### 4.3 Quick actions widget enhancement

Current `quick-actions-widget.tsx` buttons navigate away. Change to:
- "New Task" → opens inline create in my-tasks widget (scroll to it)
- "New Project" → opens project create dialog (modal, stays on dashboard)

### Risks

| Risk | Mitigation |
|------|------------|
| Completing a task from dashboard doesn't update project board | Socket events handle this — `emitTaskUpdated` already fires on PATCH |
| Quick create needs project context | Default to user's most recent project, show selector |

### Estimated Complexity: LOW
Direct port of existing patterns. ~80 lines of changes.

---

## Feature 5: Search Improvements

### Current State

- `/api/search/route.ts` searches: tasks, projects, comments, docs, members
- Uses `ILIKE` (`contains` + `mode: "insensitive"`) on Prisma
- No filters (status, priority, date range, assignee)
- Missing entity types: Goals, Forms, Sprints
- `search-dialog.tsx` (548 lines) has grouped results but no filter UI

### Architecture Decision

**Approach: Extend existing search API with filters + new entity types**

#### 5.1 Add entity types to search API

Add to `/api/search/route.ts`:

```typescript
// Goals
const goals = await prisma.goal.findMany({
  where: {
    title: { contains: query, mode: 'insensitive' },
    workspace: { members: { some: { userId: session.user.id } } },
  },
  take: 10,
  select: { id: true, title: true, status: true, progress: true },
})

// Sprints
const sprints = await prisma.sprint.findMany({
  where: {
    name: { contains: query, mode: 'insensitive' },
    project: { members: { some: { userId: session.user.id } } },
  },
  take: 10,
  select: { id: true, name: true, status: true, project: { select: { id: true, name: true } } },
})

// Forms (if public forms model exists)
const forms = await prisma.form.findMany({
  where: {
    title: { contains: query, mode: 'insensitive' },
    project: { members: { some: { userId: session.user.id } } },
  },
  take: 10,
})
```

#### 5.2 Add filter parameters

Support query params: `?q=search&status=IN_PROGRESS&priority=HIGH&assignee=userId&type=tasks`

```typescript
const searchParams = request.nextUrl.searchParams
const query = searchParams.get('q')
const statusFilter = searchParams.get('status')
const priorityFilter = searchParams.get('priority')
const assigneeFilter = searchParams.get('assignee')
const typeFilter = searchParams.get('type') // "tasks" | "projects" | "goals" | etc.
```

When `typeFilter` is set, only search that entity type (performance optimization).

Apply filters to the tasks query:
```typescript
where: {
  AND: [
    { OR: [{ title: { contains: query } }, { description: { contains: query } }] },
    ...(statusFilter ? [{ status: statusFilter }] : []),
    ...(priorityFilter ? [{ priority: priorityFilter }] : []),
    ...(assigneeFilter ? [{ assignees: { some: { userId: assigneeFilter } } }] : []),
  ]
}
```

#### 5.3 Search dialog filter UI

Add filter chips below the search input in `search-dialog.tsx`:

```
[🔍 Search...                                    ]
[Tasks ▾] [Status ▾] [Priority ▾] [Assignee ▾]   ← filter row
```

- Filter dropdowns use Radix `Select` (consistent with existing UI)
- Selecting a type filter narrows results to that type only
- Filters persist within the search session (reset on dialog close)

#### 5.4 Future: Full-text search

ILIKE is acceptable for <10k records. If performance degrades:
- **Phase 2+:** Add PostgreSQL `tsvector` columns + GIN indexes
- **Phase 3:** Consider pg_trgm extension for fuzzy matching
- Do NOT add Elasticsearch/Meilisearch — over-engineered for this scale

### Risks

| Risk | Mitigation |
|------|------------|
| Adding 3 more entity types slows search | Parallelize all Prisma queries with `Promise.all` (already the pattern) |
| Filter UI clutters search dialog | Filters hidden by default, expand on click/keyboard shortcut |
| ILIKE performance on large datasets | Acceptable for MVP. Add DB indexes on `title` columns |

### Estimated Complexity: MEDIUM
API changes are simple. Search dialog filter UI is the bulk of the work (~200 lines).

---

## Feature 6: Sprint Completion Flow

### Current State

Sprint completion logic already exists in `/api/sprints/route.ts` PATCH handler:
- Detects incomplete tasks when status → `COMPLETED`
- Returns `{ requiresAction: true, incompleteTasks }` if no directive
- Accepts `moveIncompleteTo: 'backlog' | 'next_sprint'`
- Client (`sprints-client.tsx`) has dialog state for handling incomplete tasks

**Gap:** The dialog UI is wired but minimal. Missing:
- Sprint velocity/burndown summary on completion
- Option to create a new sprint for overflow tasks
- Confirmation with task count breakdown

### Architecture Decision

**Approach: Enhance existing completion dialog + add sprint summary**

#### 6.1 Enhanced completion dialog

When user clicks "Complete Sprint", the API returns incomplete tasks. Show a dialog:

```
┌─────────────────────────────────────────┐
│ Complete Sprint: "Sprint 4"              │
│                                          │
│ ✅ 12 tasks completed                   │
│ ⚠️  5 tasks incomplete                  │
│                                          │
│ What should happen to incomplete tasks?  │
│                                          │
│ ○ Move to backlog (remove from sprint)   │
│ ○ Move to next sprint: "Sprint 5"        │
│ ○ Create new sprint and move there       │
│                                          │
│ Incomplete tasks:                        │
│ ☐ Fix login bug          HIGH           │
│ ☐ Update docs            LOW            │
│ ☐ ...                                   │
│                                          │
│           [Cancel]  [Complete Sprint]    │
└─────────────────────────────────────────┘
```

#### 6.2 API changes

Add to PATCH handler when `moveIncompleteTo === 'new_sprint'`:

```typescript
if (moveIncompleteTo === 'new_sprint') {
  const completedSprint = await prisma.sprint.findUnique({ where: { id } })
  const newSprint = await prisma.sprint.create({
    data: {
      name: `${completedSprint.name} (Overflow)`,
      projectId: existingSprint.projectId,
      startDate: completedSprint.endDate,
      endDate: new Date(completedSprint.endDate.getTime() + (completedSprint.endDate.getTime() - completedSprint.startDate.getTime())),
      status: 'PLANNING',
    },
  })
  await prisma.sprintTask.updateMany({
    where: { sprintId: id, taskId: { in: incompleteTaskIds } },
    data: { sprintId: newSprint.id },
  })
}
```

#### 6.3 Sprint summary stats

Add to the GET response for completed sprints:

```typescript
// In GET handler, for COMPLETED sprints, include:
{
  completedTaskCount: number,
  totalTaskCount: number,
  velocity: number, // story points or task count
  completedAt: Date,
}
```

#### 6.4 Socket event

Emit `emitSprintUpdated(projectId, sprint)` after completion so other viewers see the sprint status change in real-time.

### Risks

| Risk | Mitigation |
|------|------------|
| Creating overflow sprint with wrong dates | Default to same duration as completed sprint, user can edit later |
| Concurrent sprint completion | Prisma transaction wrapping the entire completion flow |

### Estimated Complexity: LOW-MEDIUM
Backend logic mostly exists. UI dialog enhancement is ~150 lines.

---

## Feature 7: Project Inline Edit (Name/Color/Icon from Header)

### Current State

`project-header.tsx` (475 lines) already supports:
- Icon selection (emoji picker + file upload)
- Color picker (12 presets)
- Cover gradient selection
- Description inline editing (click to edit, Enter to save, Escape to cancel)
- API: `PATCH /api/projects/[projectId]` accepts `{ name, description, color, icon, status }`
- RBAC: Only LEAD role can update

**Gap:** Project **name** is NOT inline editable from the header. It's displayed as static text.

### Architecture Decision

**Approach: Apply existing description inline-edit pattern to name**

#### 7.1 Name inline editing

The description already uses this pattern (lines 443-469 of `project-header.tsx`):

```typescript
const [editingDescription, setEditingDescription] = useState(false)
// Click → show input, Enter → save, Escape → cancel
```

Apply identical pattern for name:

```typescript
const [editingName, setEditingName] = useState(false)
const [nameValue, setNameValue] = useState(project.name)

// Render: editingName ? <input> : <h1 onClick={() => setEditingName(true)}>
// onBlur or Enter: PATCH /api/projects/${projectId} with { name: nameValue }
// Escape: revert to original
```

#### 7.2 Visual affordance

- On hover over project name, show a subtle pencil icon or underline
- Consistent with how Asana handles inline project name editing
- Only show edit affordance if user has LEAD role (check from project members data already available)

#### 7.3 Color and icon already work

These are already implemented in the header. No changes needed — just verify they're working correctly and accessible from the header bar (not hidden in settings).

### Risks

| Risk | Mitigation |
|------|------------|
| Empty name submission | Validate non-empty before PATCH, revert on empty |
| Long names overflow | CSS `text-overflow: ellipsis` + `max-width` on display, no limit on edit |

### Estimated Complexity: VERY LOW
~30 lines of JSX/state following an existing pattern in the same file.

---

## Feature 8: Password Change + Workspace Members Settings Tabs

### Current State

**Password Change:**
- API exists: `POST /api/user/password` — validates current password, enforces 8-char minimum, bcrypt hashing
- No UI exists in settings

**Workspace Members:**
- API exists: `/api/workspaces/members` with GET (list), POST (invite), PATCH (change role), DELETE (remove)
- RBAC built in: only OWNER/ADMIN can change roles, can't remove owners
- No UI exists in settings

**Settings page** (`settings-client.tsx`, 681 lines) has 5 tabs: Profile, Notifications, Webhooks, Import, Audit

### Architecture Decision

**Approach: Add 2 new tabs to existing settings tabbed interface**

#### 8.1 Security tab (Password Change)

Add tab `security` between Profile and Notifications:

```typescript
// Tab: "Security"
// Content:
// - Change Password section
//   - Current password (type=password)
//   - New password (type=password)
//   - Confirm new password (type=password)
//   - Client-side validation: match check, 8-char min
//   - Submit: POST /api/user/password
//   - Success: toast + clear form
//   - Error: inline error message (wrong current password, etc.)
// - Active Sessions section (Phase 3 — placeholder text for now)
```

For OAuth-only users (no password set), show:
```
"Your account uses Google/GitHub sign-in. Password login is not available."
```

The API already handles this case (returns 400: "Password login not configured").

#### 8.2 Members tab (Workspace Members)

Add tab `members` after Security (admin-only, like Audit):

```typescript
// Tab: "Members" (visible only when isAdmin === true)
// Content:
// - Invite section
//   - Email input + role selector (ADMIN/MEMBER) + "Invite" button
//   - POST /api/workspaces/members
// - Members list
//   - GET /api/workspaces/members
//   - Table: Avatar | Name | Email | Role | Actions
//   - Role: dropdown to change (PATCH /api/workspaces/members)
//   - Actions: Remove button (DELETE /api/workspaces/members)
//   - Current user row: no remove button, role shown as badge (non-editable)
//   - Owner row: role shown as badge (non-editable by non-owners)
```

#### 8.3 Updated tab order

```
Profile | Security | Notifications | Members* | Webhooks | Import | Audit*
                                    (* admin only)
```

#### 8.4 Component structure

```
src/components/settings/
├── settings-client.tsx          (add 2 tabs to existing)
├── security-settings.tsx        (NEW — ~120 lines)
├── workspace-members.tsx        (NEW — ~200 lines)
├── webhooks-manager.tsx         (existing)
├── import-wizard.tsx            (existing)
└── audit-log-viewer.tsx         (existing)
```

### Risks

| Risk | Mitigation |
|------|------------|
| Password change doesn't invalidate other sessions | Acceptable for MVP. Phase 3: session invalidation |
| Inviting non-existent email creates placeholder user | Already handled by API — creates user with email, no password |
| Role escalation | API already prevents non-owners from assigning OWNER role |

### Estimated Complexity: LOW-MEDIUM
APIs exist. UI is form-heavy but straightforward. ~320 lines across 2 new components.

---

## Implementation Priority Matrix

| # | Feature | Complexity | User Impact | Dependencies | Priority |
|---|---------|-----------|-------------|--------------|----------|
| 7 | Project Inline Edit | Very Low | Medium | None | P0 — Do first |
| 4 | Dashboard Interactivity | Low | High | None | P0 |
| 3 | Sidebar Favorites & Recents | Low | High | None | P0 |
| 8 | Password + Members Settings | Low-Medium | High | None | P1 |
| 1 | Real-time Socket Wiring | Low | Medium | None | P1 |
| 6 | Sprint Completion | Low-Medium | Medium | None | P1 |
| 5 | Search Improvements | Medium | Medium | None | P2 |
| 2 | Teams ↔ Projects | Medium | High | Schema migration | P2 |

### Recommended Implementation Order

```
Batch 1 (Quick Wins — 1 day):
  ├── Feature 7: Project Inline Edit
  ├── Feature 4: Dashboard task completion + quick create
  └── Feature 3: Sidebar favorites + recents

Batch 2 (Core Infra — 1-2 days):
  ├── Feature 8: Password + Members settings tabs
  ├── Feature 1: Socket notification hook + sprint events
  └── Feature 6: Sprint completion dialog enhancement

Batch 3 (Deep Work — 2 days):
  ├── Feature 5: Search filters + new entity types
  └── Feature 2: Teams ↔ Projects access propagation
```

---

## Migration Requirements

Only Feature 2 requires a Prisma schema migration:

```sql
-- Add source tracking to ProjectMember
ALTER TABLE "ProjectMember" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'direct';

-- Add role to TeamMember
ALTER TABLE "TeamMember" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'MEMBER';
```

All other features are pure code changes with no schema modifications.

---

## File Change Summary

| Feature | New Files | Modified Files |
|---------|-----------|---------------|
| 1. Socket | `use-realtime-notifications.ts` | `event-bus.ts`, `socket-emitter.ts`, `pages/api/socket.ts`, `sprints/route.ts`, `use-socket.ts` |
| 2. Teams | `team-sync.ts` | `schema.prisma`, `teams/route.ts`, `teams/page.tsx` |
| 3. Sidebar | `recents.ts` | `sidebar.tsx` |
| 4. Dashboard | — | `widgets/my-tasks-widget.tsx`, `quick-actions-widget.tsx` |
| 5. Search | — | `search/route.ts`, `search-dialog.tsx` |
| 6. Sprint | — | `sprints/route.ts`, `sprints-client.tsx` |
| 7. Inline Edit | — | `project-header.tsx` |
| 8. Settings | `security-settings.tsx`, `workspace-members.tsx` | `settings-client.tsx` |

**Total: 5 new files, ~18 modified files**

---

## Architectural Invariants (Do NOT Violate)

1. **No new state management library.** Use React state + fetch. The codebase has zero Redux/Zustand/Jotai — keep it that way.
2. **No new API pattern.** All routes follow: `auth()` → validate → Prisma → `NextResponse.json()`. No tRPC, no GraphQL.
3. **RBAC on every mutation.** Every POST/PATCH/DELETE must call `checkProjectAccess()` or equivalent workspace role check.
4. **Audit everything.** Every create/update/delete calls `logAudit()`.
5. **Socket events for every mutation.** Every task/sprint change emits via `socket-emitter.ts`.
6. **Pages API for Socket.IO.** Socket.IO server stays in `pages/api/socket.ts`. App Router doesn't support WebSocket upgrade. Don't try to move it.

---

*End of Architecture Report*
*Generated by @architect — CC_GodMode System Architect*
