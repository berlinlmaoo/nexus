# NEXUS API Reference

All endpoints are under `/api/`. Authentication is required unless noted otherwise. Responses are JSON.

**Auth mechanism:** NextAuth.js session cookie (JWT). Unauthorized requests return `401`.

---

## Auth

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET, POST | `/auth/[...nextauth]` | NextAuth handler (login, callback, session) | No |
| POST | `/auth/register` | Register new user (email, password, name) | No |
| GET | `/auth/providers` | List available auth providers (Google) | No |

## User

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/user/profile` | Get current user profile | Yes |
| PATCH | `/user/profile` | Update profile (name, avatar) | Yes |
| POST | `/user/password` | Change password (current + new) | Yes |

## Tasks

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/tasks` | List tasks (filters: project, status, assignee, sprint, priority) | Yes |
| POST | `/tasks` | Create task (title, taskListId, priority, dueDate, etc.) | Yes |
| GET | `/tasks/[taskId]` | Get task with full details (assignees, comments, subtasks) | Yes |
| PATCH | `/tasks/[taskId]` | Update task fields | Yes |
| DELETE | `/tasks/[taskId]` | Delete task | Yes |

### Task Assignees

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/tasks/[taskId]/assignees` | Add assignee to task | Yes |
| DELETE | `/tasks/[taskId]/assignees` | Remove assignee from task | Yes |

### Task Comments

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/tasks/[taskId]/comments` | List comments (threaded) | Yes |
| POST | `/tasks/[taskId]/comments` | Create comment (supports parentId for replies) | Yes |
| PATCH | `/tasks/[taskId]/comments/[commentId]` | Edit comment | Yes |
| DELETE | `/tasks/[taskId]/comments/[commentId]` | Delete comment | Yes |

### Comment Reactions

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/tasks/[taskId]/comments/[commentId]/reactions` | Toggle emoji reaction on comment | Yes |

### Task Dependencies

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/tasks/[taskId]/dependencies` | List task dependencies | Yes |
| POST | `/tasks/[taskId]/dependencies` | Create dependency (blocking/waiting on) | Yes |
| DELETE | `/tasks/[taskId]/dependencies` | Remove dependency | Yes |

### Task Relations

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/tasks/[taskId]/relations` | List task relations | Yes |
| POST | `/tasks/[taskId]/relations` | Create relation (related to, duplicates, etc.) | Yes |
| DELETE | `/tasks/[taskId]/relations/[relationId]` | Delete relation | Yes |

### Task Followers

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/tasks/[taskId]/followers` | List task followers | Yes |
| POST | `/tasks/[taskId]/followers` | Toggle follow/unfollow | Yes |

## Projects

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/projects` | List user's projects | Yes |
| POST | `/projects` | Create project | Yes |
| GET | `/projects/[projectId]` | Get project details | Yes |
| PATCH | `/projects/[projectId]` | Update project (name, color, icon, status, description) | Yes |
| DELETE | `/projects/[projectId]` | Delete project | Yes |

### Project Members

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/projects/[projectId]/members` | List project members | Yes |
| POST | `/projects/[projectId]/members` | Add member with role | Yes |
| DELETE | `/projects/[projectId]/members` | Remove member | Yes |

### Project Invites

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/projects/[projectId]/invite` | List pending invites | Yes |
| POST | `/projects/[projectId]/invite` | Invite user by email | Yes |
| DELETE | `/projects/[projectId]/invite` | Cancel invite | Yes |

### Project Pages

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/projects/[projectId]/pages` | List project pages | Yes |
| POST | `/projects/[projectId]/pages` | Create page | Yes |
| GET | `/projects/[projectId]/pages/[pageId]` | Get page content | Yes |
| PATCH | `/projects/[projectId]/pages/[pageId]` | Update page | Yes |
| DELETE | `/projects/[projectId]/pages/[pageId]` | Delete page | Yes |

### Project Operations

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/projects/[projectId]/rollups` | Get project stats (completion %, avg time) | Yes |
| POST | `/projects/[projectId]/duplicate` | Duplicate project with all contents | Yes |

## Goals

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/goals` | List goals (supports hierarchy) | Yes |
| POST | `/goals` | Create goal (title, status, parentId, etc.) | Yes |
| GET | `/goals/[goalId]` | Get goal with milestones, linked projects/tasks | Yes |
| PATCH | `/goals/[goalId]` | Update goal, link/unlink projects and tasks | Yes |
| DELETE | `/goals/[goalId]` | Delete goal | Yes |

## Portfolios

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/portfolios` | List portfolios | Yes |
| POST | `/portfolios` | Create portfolio with projects | Yes |
| GET | `/portfolios/[portfolioId]` | Get portfolio with project stats | Yes |
| PATCH | `/portfolios/[portfolioId]` | Update portfolio | Yes |
| DELETE | `/portfolios/[portfolioId]` | Delete portfolio | Yes |

## Teams

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/teams` | List teams with members and projects | Yes |
| POST | `/teams` | Create team, add/remove member, link/unlink project | Yes |

## Sprints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/sprints` | List sprints for project | Yes |
| POST | `/sprints` | Create sprint | Yes |
| PATCH | `/sprints` | Update/complete sprint (handles incomplete tasks) | Yes |

## Docs

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/docs` | List docs (filter by project) | Yes |
| POST | `/docs` | Create document | Yes |
| GET | `/docs/[docId]` | Get document content | Yes |
| PATCH | `/docs/[docId]` | Update document | Yes |
| DELETE | `/docs/[docId]` | Delete document | Yes |
| POST | `/docs/[docId]/duplicate` | Duplicate document | Yes |
| GET | `/docs/templates` | List document templates | Yes |

## Forms

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/forms` | List forms for project | Yes |
| POST | `/forms` | Create form | Yes |
| GET | `/forms/[formId]` | Get form details | Yes |
| PATCH | `/forms/[formId]` | Update form | Yes |
| DELETE | `/forms/[formId]` | Delete form | Yes |
| GET | `/forms/[formId]/public` | Get public form (if enabled) | **No** |
| POST | `/forms/[formId]/submit` | Submit form (creates task) | **No** |

## Search

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/search` | Global search (query: `q`, filters: `projectId`, `assigneeId`, `status`, `startDate`, `endDate`) | Yes |

## Notifications

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/notifications` | List user notifications | Yes |
| PATCH | `/notifications` | Mark as read / mark all read | Yes |
| DELETE | `/notifications` | Delete notifications | Yes |
| GET | `/notifications/preferences` | Get notification preferences | Yes |
| PUT | `/notifications/preferences` | Update notification preferences | Yes |
| POST | `/notifications/due-check` | Trigger due-date check (cron) | Yes |
| POST | `/notifications/email` | Send email notification | Yes |
| POST | `/notifications/slack` | Send Slack webhook message | Yes |
| POST | `/notifications/wa` | Send WhatsApp webhook message | Yes |

## Settings

### Workspaces

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/workspaces` | List user's workspaces | Yes |
| POST | `/workspaces` | Create workspace | Yes |

### Workspace Members

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/workspaces/members` | List workspace members | Yes |
| POST | `/workspaces/members` | Invite member (email + role) | Yes (Admin) |
| PATCH | `/workspaces/members` | Change member role | Yes (Admin) |
| DELETE | `/workspaces/members` | Remove member | Yes (Admin) |

## Webhooks

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/webhooks` | List webhooks for project | Yes |
| POST | `/webhooks` | Create webhook (URL, events) | Yes |
| PATCH | `/webhooks/[webhookId]` | Update webhook | Yes |
| DELETE | `/webhooks/[webhookId]` | Delete webhook | Yes |

## Automations

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/automations` | List automations for project | Yes |
| POST | `/automations` | Create automation rule | Yes |
| PATCH | `/automations` | Update automation rule | Yes |
| DELETE | `/automations` | Delete automation rule | Yes |

## Custom Fields

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/custom-fields` | List custom fields for project | Yes |
| POST | `/custom-fields` | Create custom field | Yes |
| PATCH | `/custom-fields` | Update custom field | Yes |
| DELETE | `/custom-fields` | Delete custom field | Yes |

## Import / Export

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/import/asana` | Start Asana import job | Yes |
| POST | `/import/notion` | Start Notion import job | Yes |
| GET | `/import/status` | Check import job status | Yes |
| GET | `/export/csv` | Export project tasks as CSV | Yes |
| GET | `/export/pdf` | Export project tasks as PDF | Yes |

## Attachments

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/attachments` | List attachments for task | Yes |
| POST | `/attachments` | Upload attachment (10 MB max) | Yes |
| DELETE | `/attachments/[attachmentId]` | Delete attachment | Yes |

## Upload

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/upload/avatar` | Upload user avatar (5 MB max) | Yes |
| DELETE | `/upload/avatar` | Delete user avatar | Yes |
| POST | `/upload/project-icon` | Upload project icon (5 MB max) | Yes |

## Google Drive

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/drive/auth` | Get OAuth URL / check connection status | Yes |
| GET | `/drive/list` | List files from Google Drive | Yes |
| GET | `/drive/download` | Download file from Google Drive | Yes |
| POST | `/drive/upload` | Upload file to Google Drive | Yes |

## NAS (Synology File Station)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/nas/auth` | Login/logout NAS session | Yes |
| GET | `/nas/list` | List NAS files (cached) | Yes |
| GET | `/nas/download` | Download file from NAS | Yes |
| GET | `/nas/search` | Search NAS files | Yes |
| POST | `/nas/upload` | Upload file to NAS (100 MB max) | Yes |

## Dashboard

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/dashboard` | Get dashboard stats (tasks, sprints, goals, activities) | Yes |
| GET | `/dashboard/layout` | Get saved dashboard layout | Yes |
| POST | `/dashboard/layout` | Save dashboard layout | Yes |

## Other

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/activity` | Get activity logs (filter by project/task) | Yes |
| GET | `/audit` | Get audit logs (admin/owner only) | Yes (Admin) |
| GET | `/favorites` | List user's favorites | Yes |
| POST | `/favorites` | Toggle favorite (project, doc, etc.) | Yes |
| GET | `/members` | List workspace members | Yes |
| GET | `/reports` | Generate project reports | Yes |
| GET, POST, PATCH | `/time-entries` | List/create/update time entries | Yes |
| GET, POST | `/status-updates` | List/create project status updates | Yes |
| POST | `/gideon` | GIDEON AI assistant (Claude API) | Yes |
| GET | `/files/[...path]` | Serve uploaded files from disk | Yes |

---

## Real-time Events (Socket.IO)

The WebSocket server runs at `pages/api/socket.ts` (Next.js Pages API).

**Rooms:**
- `project:{projectId}` — project-scoped events
- `user:{userId}` — user-scoped notifications

**Events emitted:**
| Event | Payload | Room |
|-------|---------|------|
| `task-created` | Task object | `project:{projectId}` |
| `task-updated` | Task object | `project:{projectId}` |
| `task-deleted` | `{ taskId }` | `project:{projectId}` |
| `comment-added` | Comment object | `project:{projectId}` |
| `sprint-updated` | Sprint object | `project:{projectId}` |
| `new-notification` | Notification object | `user:{userId}` |
