# NEXUS — Migration Plan: Full Feature Parity (lovable-ui)

> Goal: bring **every feature** of the running NEXUS app into the new frontend (`apps/nexus-lovable-ui`).
> Status legend: ✅ done · 🟡 partial/mock · ⬜ not started

## 0. The key realization — this is a FRONTEND rebuild, not a backend migration

The new app (`nexus-lovable-ui`, Vite + TanStack Start, :4178) **already talks to the same backend** as the running Next.js app (`Documents/nexus`, :3020) — `vite.config.ts` proxies `/api/*` and `/auth/*` → `127.0.0.1:3020`, and `nexusApi.apiFetch` sends session cookies (`credentials: "include"`).

**Implication:** the backend stays put — 129 API routes, Prisma (~50 models), NextAuth, AI, automations, webhooks, socket.io. We do **not** re-implement any of it. "Move all features" = **build every screen/flow in lovable-ui and wire it to the existing API**, plus grow the `nexusApi` client (currently ~25 methods → needs the full surface).

This makes the work large but mechanical and low-risk: no data-model or auth rewrite, just UI + client methods, page by page, against a known API.

---

## 1. Current state of lovable-ui

**Wired to live API:** login, `_app` auth guard, my-tasks, projects (list), projects/:id (board+sprints+docs tabs), goals (list), docs, inbox.
**Partial (live + mock fallback):** dashboard, attendance.
**Mock-only stubs:** admin, teams, portfolios, master-calendar, forms, reports, settings (mostly).
**Design system:** ✅ navy/ClickUp tokens, Plus Jakarta + Inter, radius 0.75rem, motion/press feedback, HeroUI v3 migrated.
**API client coverage:** ~25 methods (auth, user, dashboard, projects, tasks, sprints, goals, docs, notifications, attendance) ≈ 20% of backend surface.

---

## 2. Gap inventory (what the backend has that the frontend lacks)

| Area | Backend has | lovable-ui status |
|---|---|---|
| Task depth | comments+reactions, attachments, dependencies/relations, followers, likes, subtasks, custom fields, time entries, activity, duplicate | ⬜ none (only status toggle) |
| Task detail page `/tasks/[id]` | full page | ⬜ |
| Project depth | sections CRUD, members+invite, rollups, status-updates, duplicate, multi-view (list/calendar/table/gallery/feed) | 🟡 board+sprints+docs only |
| Goals detail + milestones + links | yes | 🟡 list only |
| Docs rich editor (Tiptap) + templates + hierarchy | yes | 🟡 basic |
| Sprints (board/burndown/planning UI) | yes | 🟡 minimal |
| Master calendar (events CRUD, availability) | yes | ⬜ mock |
| Attendance (history, requests/approvals, offices/geofence, record detail + proof annotations) | yes | 🟡 check-in/out only |
| Forms builder + public `/f/[id]` + submissions | yes | ⬜ mock |
| Automations builder + AI suggestions | yes | ⬜ |
| Reports/analytics | yes | ⬜ mock |
| Finance dashboard | yes | ⬜ |
| Teams (real) | yes | ⬜ mock |
| Portfolios (real) | yes | ⬜ mock |
| Admin user mgmt + RBAC + workspace members/settings | yes | ⬜ mock |
| Settings (profile, notif prefs, password, sessions, webhooks, audit, import wizard, SSO/SCIM) | yes | 🟡 stub |
| Notifications preferences + multi-channel | yes | 🟡 inbox only |
| Search (global) + saved searches + favorites | yes | ⬜ |
| Gideon AI assistant (chat + tools) | yes | ⬜ |
| Drive / NAS / attachments browser + uploads | yes | ⬜ |
| Import (Notion/Asana) + export (CSV/PDF) | yes | ⬜ |
| Custom fields library | yes | ⬜ |
| Webhooks, audit log, activity feed | yes | ⬜ |
| Time tracking | yes | ⬜ |
| Real-time (socket.io) live updates | yes | ⬜ |

---

## 2b. Decisions (locked 2026-06-01)
- **End goal: REPLACE** the Next.js frontend entirely → lovable-ui must reach **100% parity** (all features, incl. niche ones). Backend :3020 stays as the API.
- **Execution: PER-MODULE, complete each domain to 100%** before moving on (vertical slices), not horizontal phase sweeps.
- **Real-time in foundation**: wire `socket.io-client` (via proxy ws) → TanStack Query invalidation up front, so every module built after is live by default.

### Execution model (revised per decisions)
**Phase 0 (shared foundation, build first)** then **modules in order, each to 100%** (extend `nexusApi` for that domain → build all its screens/flows → hook realtime events → parity-checklist vs the Next.js page → `tsc` clean + route 200 + manual check → mark ✅ → strip its mock-data).

**Module order** (dependency + daily value):
1. **Tasks** (detail page + panel: comments/reactions, attachments, deps/relations, subtasks, followers/likes, custom-field values, time entries, activity, duplicate)
2. **Projects** (sections CRUD, members+invite, multi-view switcher, rollups, status-updates, folders, templates, duplicate)
3. **Docs/Pages** (Tiptap editor, templates, hierarchy, project pages, synced blocks)
4. **Goals** (detail, milestones, project/task links)
5. **Sprints** (board, burndown, planning)
6. **Master Calendar** (events CRUD, attendees, availability)
7. **Attendance** (history, requests/approvals, offices/geofence, record detail + proof annotations)
8. **Forms** (builder + public `/f/[id]` + submissions)
9. **Automations** (rule builder + AI suggestions)
10. **Reports + Finance dashboard**
11. **Teams + Portfolios**
12. **Admin + RBAC + Settings** (profile, notif prefs, sessions, webhooks, audit, import wizard, SSO/SCIM, members)
13. **Search/Favorites + Notification preferences**
14. **Gideon AI** (chat panel + tools)
15. **Drive / NAS / Attachments** (browser + uploads)
16. **Import/Export, Custom-fields library, Time tracking, Webhooks/Audit/Activity**
17. **Cleanup**: delete `mock-data.ts`, final parity sweep across all routes.

---

## 3. (reference) Original phase grouping

### Phase 0 — Foundation (unblocks everything)
- **Expand `nexusApi` client** into a typed module covering all endpoints we'll need (group by domain mirroring the API). Define shared TS types from API responses (or generate from Prisma).
- **Decide production integration model** (see Open Questions) — proxy/base-URL + auth cookie strategy.
- **Real-time**: wire `socket.io-client` through the proxy (ws), bridge events → TanStack Query invalidation. (Can defer to Phase 1.5 if needed.)
- **Shared UI primitives audit**: ensure HeroUI v3 Button/Card/Chip + Modal/Dropdown/Table/Tabs/DatePicker, a file-upload control, and a Tiptap rich editor are available + on-theme. Refactor the hand-rolled inline buttons to the shared `.button`/Button.
- **Auth parity**: register + OTP, password reset, logout, session expiry → re-login.

### Phase 1 — Core task management (highest daily value)
- **Task detail** (side panel + full `/tasks/[id]`): description editor, subtasks, assignees, due/priority, **comments + reactions**, **attachments**, dependencies/relations, followers/likes, custom field values, time entries, activity log.
- **Project detail depth**: sections/lists CRUD + drag reorder, members + invite dialog, rollups, status updates, duplicate, **multi-view switcher** (list, table, calendar, gallery, feed — board exists).
- **my-tasks**: real filter/sort/grouping.
- **Global search** + **favorites**.

### Phase 2 — Planning & knowledge
- **Goals**: detail, milestones, goal↔project/task links, progress rollup.
- **Docs/pages**: Tiptap block editor, templates, hierarchy/tree, project pages, synced blocks.
- **Sprints**: planning board, burndown, move-incomplete.
- **Master calendar**: events CRUD, attendees/RSVP, availability.

### Phase 3 — Operations & data collection
- **Attendance (full)**: history, leave/sick/permit requests + approvals, office/geofence admin, record detail + proof annotations, reverse-geocode.
- **Forms**: drag-drop builder, field types, public `/f/[formId]` route, submissions → task.
- **Automations**: rule builder (trigger/condition/action) + AI suggestions.
- **Reports**: real analytics/charts.
- **Finance dashboard**.

### Phase 4 — Enterprise & admin
- **Teams** (real), **Portfolios** (real).
- **Admin**: user management, disable/roles, workspace memberships.
- **RBAC enforcement** in UI (hide/disable by role: workspace OWNER/ADMIN/MEMBER, project LEAD/MEMBER/VIEWER/GUEST).
- **Settings (full)**: profile, notification preferences (email/Slack/WA/in-app), password, active sessions, webhooks, audit log, import wizard, members, SSO/SCIM config.

### Phase 5 — Integrations & extras
- **Gideon AI** chat panel + tool results.
- **Drive / NAS / attachments** browser + upload dialogs.
- **Import** (Notion/Asana) + **export** (CSV/PDF).
- **Custom fields** library + per-project config.
- **Webhooks**, **audit**, **activity feed**, **time tracking** surfaces.
- Delete `mock-data.ts` once every route is live.

---

## 4. Cross-cutting (every phase)
- Reuse the established design tokens, fonts, radius, motion; consistent loading / empty / error states (skeletons exist).
- Per-route **parity checklist** against the Next.js page before marking done.
- Verify each: `tsc --noEmit` clean + route serves 200 on :4178 + manual check logged-in.
- Mobile responsiveness + a11y (focus rings already themed).

## 5. Risks / open questions (need answers to finalize order)
1. **Production integration**: in dev we proxy to :3020. In prod, how does lovable-ui reach the backend (reverse-proxy same-origin vs `VITE_API_BASE`)? Affects auth-cookie domain. **Blocking for deploy, not for building.**
2. **End goal**: fully **replace** the Next.js frontend (lovable-ui must hit 100% parity) or run both in parallel?
3. **Scope priority**: build the full 25+ capability set, or ship the core daily-use set first (tasks/projects/docs/goals/attendance/calendar) and treat heavy/niche items (Gideon AI, NAS/Drive, SCIM/SSO, import) as a later tranche?
4. **Real-time**: required at parity, or acceptable to add after core screens?
