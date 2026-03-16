# Changelog

All notable changes to the NEXUS project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-16

### Added

#### Core Platform
- Workspace and project management with multi-tenant architecture
- Kanban board, list view, table view, and calendar view for tasks
- Drag-and-drop task ordering and status transitions
- Task creation, assignment, priority, due dates, and status tracking
- Task lists for organizing tasks within projects
- Project pages (wiki-style documentation per project)
- Dashboard with widgets (my tasks, quick actions, project stats)
- Dashboard layout persistence per user
- Global search across tasks, projects, comments, docs, goals, forms, and sprints
- Activity logs and audit trail

#### Authentication & Security
- NextAuth.js v5 with credentials and Google OAuth (@patsgroup.id)
- JWT-based session management
- Three-level Role-Based Access Control (RBAC): System → Workspace → Project
- Project roles: LEAD, MEMBER, VIEWER, GUEST
- Workspace roles: OWNER, ADMIN, MEMBER
- RBAC enforcement on all API mutations
- Password change for credential-based accounts
- Audit logging for compliance and security

#### Task Management
- Subtasks with parent-child relationships and progress rollup
- Task dependencies (blocking/waiting on)
- Task relations (related to, duplicates, etc.)
- Task followers with notification opt-in
- Task recurrence (daily, weekly, bi-weekly, monthly, quarterly, yearly)
- Task assignees (multiple per task)
- Comment threading with nested replies
- Comment reactions (emoji-based, Slack-style)
- Custom fields per project (text, number, date, dropdown, checkbox)
- Time tracking with time entries on tasks
- File attachments (10 MB max per file)
- Inline subtask creation and bulk complete

#### Sprint Management
- Sprint creation with start/end dates and status tracking
- Sprint completion flow with incomplete task handling:
  - Move to backlog
  - Move to next sprint
  - Auto-create overflow sprint
- Sprint filter in task board/list views
- Sprint velocity tracking

#### Project Features
- Project archive and unarchive (ACTIVE / ARCHIVED / COMPLETED)
- Project duplication with all task lists, tasks, sprints, automations, and docs
- Project inline edit (name, color, icon, description from header)
- Project members with invite system and role management
- Project status updates
- Project statistics and rollups (completion %, average time)
- Project icon and cover customization

#### Goals & Portfolios
- Workspace-level goals with hierarchical parent-child structure
- Goal milestones and progress tracking
- Goal status: ON_TRACK, AT_RISK, BEHIND, COMPLETED
- Link goals to projects and tasks for traceability
- Cascading progress from child goals to parent
- Portfolio management for grouping multiple projects
- Portfolio health status tracking

#### Documentation
- Wiki-style docs with parent-child hierarchy
- Rich text editor powered by TipTap
- Document templates (general, technical, process, meeting notes)
- Document duplication
- Full-text search within docs
- Doc verification status

#### Forms
- Form builder with field types: text, number, date, dropdown, checkbox, textarea
- Public form submission (no auth required)
- Auto-create tasks from form submissions
- Form management (create, edit, delete, toggle public)

#### Teams & Collaboration
- Team management with LEAD and MEMBER roles
- Teams ↔ Projects access propagation (automatic project access for team members)
- Access source tracking (direct vs. team-inherited)
- Role hierarchy enforcement to prevent escalation
- Sidebar favorites (server-persisted)
- Sidebar recents (localStorage, LRU eviction, max 8 items)
- User presence tracking

#### Automation & Webhooks
- Automation engine with triggers, conditions, and actions
- Trigger types: task status change, assignee change, due date change, priority change
- Action types: status update, assignment, notification, webhook dispatch
- Conditional logic: AND, OR, NOT, nested conditions
- Condition fields: status, priority, assignee, due date, tags, custom fields
- Project-level webhook management
- Webhook event types: task.created, task.updated, task.completed, comment.created, project.updated
- HMAC signing for webhook security
- Delivery tracking with retry logic

#### Notifications & Inbox
- In-app notification system with real-time delivery
- Email notifications via SMTP (Nodemailer)
- Slack webhook notifications
- WhatsApp webhook notifications
- Notification preferences per user (email, Slack, WhatsApp toggles)
- Due date check (cron-triggered)
- Inbox with delete, mark read/unread, and bulk actions

#### Real-time Features
- Socket.IO WebSocket server for live updates
- Real-time task create/update/delete events
- Real-time comment notifications
- Real-time sprint updates
- Room-based broadcasting (per project, per user)
- Optimistic UI updates

#### Integrations
- Google Drive: browse, upload, download files
- Synology NAS: browse, search, upload, download files (100 MB max)
- Asana import (background job)
- Notion import (background job)
- Import job status tracking

#### Export & Reporting
- CSV export of project tasks
- PDF export of project tasks
- Project reports (tasks by status/priority, completion trends)

#### AI Assistant
- GIDEON (Guided Intelligence for Digital Execution & Operations Network)
- Natural language task creation, updates, and queries
- Powered by Anthropic Claude (Sonnet/Opus model selection)

#### Settings & Administration
- User profile management (name, avatar)
- Workspace member management (invite, role change, remove — admin only)
- Notification preferences configuration
- Webhook management
- Audit log viewer (admin only)

[1.0.0]: https://github.com/patsgroup/nexus/releases/tag/v1.0.0
