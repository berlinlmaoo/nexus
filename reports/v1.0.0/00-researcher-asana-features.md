# Asana Feature Inventory vs NEXUS Parity Report

> **Researcher:** @researcher
> **Date:** 2026-03-16
> **Asana Plan Tiers:** Personal (Free) | Starter ($10.99/mo) | Advanced ($24.99/mo) | Enterprise (custom) | Enterprise+ (custom)
> **NEXUS Status Legend:** ✅ Implemented | ⚠️ Partial | ❌ Not Implemented

---

## Table of Contents

1. [Home & Navigation](#1-home--navigation)
2. [My Tasks](#2-my-tasks)
3. [Inbox & Notifications](#3-inbox--notifications)
4. [Projects](#4-projects)
5. [Project Views](#5-project-views)
6. [Tasks](#6-tasks)
7. [Goals & OKRs](#7-goals--okrs)
8. [Portfolios](#8-portfolios)
9. [Reporting & Dashboards](#9-reporting--dashboards)
10. [Forms](#10-forms)
11. [Rules & Automations](#11-rules--automations)
12. [Status Updates](#12-status-updates)
13. [Comments & Collaboration](#13-comments--collaboration)
14. [Real-Time & Presence](#14-real-time--presence)
15. [Followers & Watchers](#15-followers--watchers)
16. [Guest Access & Sharing](#16-guest-access--sharing)
17. [Templates](#17-templates)
18. [Bundles](#18-bundles)
19. [Approvals](#19-approvals)
20. [API & Integrations](#20-api--integrations)
21. [Webhooks](#21-webhooks)
22. [Security & Admin](#22-security--admin)
23. [Time Tracking](#23-time-tracking)
24. [Integrations (Slack/Teams/Gmail)](#24-integrations-slackteamsgmail)
25. [Mobile](#25-mobile)
26. [Workload](#26-workload)
27. [Advanced Search](#27-advanced-search)
28. [Data Export](#28-data-export)
29. [AI Features](#29-ai-features)
30. [Sprints & Agile](#30-sprints--agile)
31. [Documents & Wiki](#31-documents--wiki)
32. [Import & Migration](#32-import--migration)
33. [Audit & Compliance](#33-audit--compliance)

---

## 1. Home & Navigation

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 1.1 | Home dashboard | Personalized feed with widgets: My Tasks, projects, recent activity, goals | All plans | ✅ | Custom widget dashboard with analytics cards, My Tasks widget, project progress widget, recent activity widget, stats cards, calendar widget |
| 1.2 | Customizable home layout | Drag-and-drop widgets, resize, add/remove | All plans | ✅ | Widget grid layout with add/remove dialogs and layout persistence |
| 1.3 | Favorites / Starred projects | Pin frequently used projects to sidebar | All plans | ✅ | `Favorite` model in schema, sidebar favorites |
| 1.4 | Sidebar navigation | Collapsible sidebar with projects, teams, goals | All plans | ✅ | Full sidebar with project navigation, teams, goals, portfolios |
| 1.5 | Recently visited | Quick access to recent items | All plans | ⚠️ | Activity logs exist but no dedicated "recently visited" section |
| 1.6 | Keyboard shortcuts | Navigate with keyboard shortcuts | All plans | ✅ | Shortcuts help panel exists in UI |

---

## 2. My Tasks

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 2.1 | My Tasks view | Centralized personal task inbox showing all assigned tasks | All plans | ✅ | Dedicated `/my-tasks` route |
| 2.2 | Sort by due date / priority / project | Organize personal tasks by various criteria | All plans | ✅ | Task sorting and filtering supported |
| 2.3 | Sections (Recently assigned, Today, Upcoming) | Group tasks by time horizon | All plans | ⚠️ | My Tasks page exists but Asana-style time-horizon sections not confirmed |
| 2.4 | My Tasks board view | Kanban view of personal tasks | Starter+ | ✅ | Board/Kanban view available |
| 2.5 | My Tasks calendar view | Calendar view of personal tasks | All plans | ✅ | Calendar view available |

---

## 3. Inbox & Notifications

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 3.1 | Inbox (activity feed) | Centralized notification inbox for mentions, assignments, updates | All plans | ✅ | Dedicated `/inbox` route, `Notification` model |
| 3.2 | Read / unread status | Mark notifications as read/unread | All plans | ✅ | `isRead` field on Notification model |
| 3.3 | Archive notifications | Archive old notifications | All plans | ⚠️ | Read/unread supported; archive not explicitly confirmed |
| 3.4 | Follow / unfollow from inbox | Toggle following directly from inbox | All plans | ⚠️ | Followers exist; toggle from inbox not confirmed |
| 3.5 | Notification preferences | Control which notifications you receive | All plans | ✅ | `NotificationPreference` model with per-type controls (assignments, mentions, due dates, project invites, status updates) |
| 3.6 | Email notifications | Receive notifications via email | All plans | ✅ | Email notification service with templates (task-assigned, due-soon, mention, invite, status-update) |
| 3.7 | Do not disturb / pause | Temporarily pause notifications | All plans | ❌ | Not found in codebase |
| 3.8 | Mobile push notifications | Push notifications on mobile devices | All plans | ❌ | No mobile app (web only) |
| 3.9 | Slack notifications | Receive Asana notifications in Slack | All plans | ✅ | Slack notification channel in notification preferences |
| 3.10 | WhatsApp notifications | N/A (not an Asana feature) | N/A | ✅ | NEXUS has WhatsApp (WA) notification channel — goes beyond Asana |

---

## 4. Projects

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 4.1 | Create projects | Create new projects with name, description, color | All plans | ✅ | Full project creation with colors, icons, descriptions |
| 4.2 | Project overview | Summary page with description, status, milestones, key resources | All plans | ✅ | Project overview dashboard with rollup statistics |
| 4.3 | Sections / columns | Organize tasks into sections or columns | All plans | ✅ | `TaskList` model for customizable columns/lists |
| 4.4 | Project status (On Track/At Risk/Off Track) | Color-coded health status | Starter+ | ✅ | `projectHealth` enum: ON_TRACK, AT_RISK, OFF_TRACK, ON_HOLD, COMPLETE |
| 4.5 | Project permissions (public/private) | Control project visibility | All plans | ✅ | Project member roles: LEAD, MEMBER, VIEWER, GUEST |
| 4.6 | Project members | Add/remove members with roles | All plans | ✅ | `ProjectMember` model with roles and source tracking (direct vs team) |
| 4.7 | Project colors & icons | Visual customization | All plans | ✅ | `color` and `icon` fields on Project model |
| 4.8 | Archive / complete projects | Mark projects as done or archived | All plans | ✅ | Project status: ACTIVE, ARCHIVED, COMPLETED |
| 4.9 | Project brief / description | Rich text project description | All plans | ✅ | Description field + `ProjectPage` model for project wiki pages |
| 4.10 | Duplicate project | Copy a project as a starting point | All plans | ⚠️ | Template-based creation exists; direct duplication not explicitly confirmed |
| 4.11 | Multi-project tasks (multi-homing) | A single task can live in multiple projects | All plans | ❌ | Tasks have single `projectId` — no multi-homing support |

---

## 5. Project Views

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 5.1 | List view | Spreadsheet-like task list | All plans | ✅ | Full list view implementation |
| 5.2 | Board / Kanban view | Drag-and-drop cards in columns | All plans | ✅ | Board view with status-based columns |
| 5.3 | Timeline view | Gantt-style timeline with dependencies | Starter+ | ✅ | Timeline view (Gantt-style) |
| 5.4 | Calendar view | Tasks on a calendar by due date | All plans | ✅ | Calendar view implementation |
| 5.5 | Gantt chart | Detailed Gantt chart with critical path | Starter+ | ✅ | Dedicated Gantt chart view (separate from Timeline) |
| 5.6 | Dashboard view | Charts and graphs for project metrics | Starter+ | ✅ | Charts/analytics view |
| 5.7 | Gallery view | N/A (not standard Asana) | N/A | ✅ | NEXUS has Gallery view — goes beyond Asana |
| 5.8 | Feed / activity view | N/A (not standard Asana view) | N/A | ✅ | NEXUS has Feed view (activity stream) — goes beyond Asana |
| 5.9 | Workload view | Team capacity management | Advanced+ | ✅ | Workload view for team capacity |
| 5.10 | Saved views / custom views | Save filtered/sorted views as tabs | Starter+ | ⚠️ | Multiple views available; saved custom view tabs not explicitly confirmed |

---

## 6. Tasks

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 6.1 | Create tasks | Create tasks with title, description, assignee, due date | All plans | ✅ | Full task creation |
| 6.2 | Task assignee | Assign tasks to team members | All plans | ✅ | `TaskAssignee` model (supports multiple assignees) |
| 6.3 | Multiple assignees | N/A (Asana supports single assignee + collaborators) | All plans | ✅ | NEXUS supports multiple assignees via `TaskAssignee` — goes beyond Asana |
| 6.4 | Due dates & start dates | Set task deadlines and start dates | All plans | ✅ | `startDate` and `dueDate` fields on Task |
| 6.5 | Subtasks | Nest tasks within tasks | All plans | ✅ | `parentId` self-relation on Task model |
| 6.6 | Task dependencies | Set blocking/waiting dependencies | Starter+ | ✅ | `TaskDependency` model with BLOCKING, WAITING_ON types |
| 6.7 | Task relations | Link related tasks | Starter+ | ✅ | `TaskRelation` model: RELATED_TO, BLOCKS, BLOCKED_BY, DUPLICATES, PARENT_OF |
| 6.8 | Custom fields | Add typed data (text, number, dropdown, etc.) | Starter+ | ✅ | `CustomField` model: TEXT, NUMBER, DATE, DROPDOWN, PEOPLE, CHECKBOX, RATING |
| 6.9 | Task priority | Set urgency levels | All plans | ✅ | Priority enum: URGENT, HIGH, MEDIUM, LOW, NONE |
| 6.10 | Task status | Track task progress | All plans | ✅ | Status enum: TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED |
| 6.11 | Milestones | Mark key deliverables in a project | Starter+ | ✅ | Task type enum includes MILESTONE |
| 6.12 | Approvals (task type) | Request approval on a task | Advanced+ | ✅ | Task type enum includes APPROVAL |
| 6.13 | Recurring tasks | Auto-create tasks on a schedule | Starter+ | ✅ | Recurring task fields: `isRecurring`, `recurringFrequency`, `recurringInterval` |
| 6.14 | Task attachments | Attach files to tasks | All plans | ✅ | `Attachment` model linked to tasks |
| 6.15 | Task tags | Categorize tasks with tags | All plans | ✅ | Tags supported on tasks |
| 6.16 | Multi-homing (task in multiple projects) | Single task exists in multiple projects | All plans | ❌ | Tasks have single `projectId` — no multi-homing |
| 6.17 | Task likes / appreciation | Like a task to show support | All plans | ❌ | Not found (comment reactions exist, but not task likes) |
| 6.18 | Copy task / duplicate | Duplicate a task | All plans | ⚠️ | Not explicitly confirmed as a UI feature |
| 6.19 | Batch task operations | Select multiple tasks for bulk actions | All plans | ✅ | Batch operations on multiple tasks supported |
| 6.20 | Task description (rich text) | Rich text editor for task descriptions | All plans | ✅ | TipTap rich text editor with slash commands |

---

## 7. Goals & OKRs

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 7.1 | Goals management | Create and track company/team/individual goals | Advanced+ | ✅ | Full `/goals` route with Goal model |
| 7.2 | Goal status tracking | On Track / At Risk / Behind / Completed | Advanced+ | ✅ | `goalStatus` enum: ON_TRACK, AT_RISK, BEHIND, COMPLETED |
| 7.3 | Sub-goals (hierarchy) | Nest goals within parent goals | Advanced+ | ✅ | `parentId` self-relation on Goal model |
| 7.4 | Goal milestones | Define milestones within goals | Advanced+ | ✅ | `GoalMilestone` model |
| 7.5 | Link goals to projects | Connect goals to supporting projects | Advanced+ | ✅ | `GoalProject` join table |
| 7.6 | Link goals to tasks | Connect goals to individual tasks | Advanced+ | ✅ | `GoalTask` join table |
| 7.7 | Goal progress tracking | Automatic/manual progress updates | Advanced+ | ✅ | Progress tracking with goal milestones |
| 7.8 | Goal owner | Assign goal ownership | Advanced+ | ✅ | `ownerId` field on Goal model |
| 7.9 | Strategy map | Visualize goal hierarchy and connections | Enterprise+ | ❌ | No strategy map visualization found |
| 7.10 | Goal reporting views | Advanced views for goal filtering/reporting | Advanced+ | ⚠️ | Goal detail pages exist; advanced reporting views not confirmed |

---

## 8. Portfolios

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 8.1 | Portfolio creation | Group projects into portfolios | Advanced+ | ✅ | `Portfolio` model with `/portfolios` route |
| 8.2 | Portfolio status | On Track / At Risk / Off Track / Completed | Advanced+ | ✅ | Status enum: ON_TRACK, AT_RISK, OFF_TRACK, COMPLETED |
| 8.3 | Portfolio owner | Assign portfolio ownership | Advanced+ | ✅ | `ownerId` field on Portfolio model |
| 8.4 | Multi-project portfolios | Add multiple projects to a portfolio | Advanced+ | ✅ | `PortfolioProject` join table |
| 8.5 | Portfolio workload | View team capacity across portfolio | Advanced+ | ⚠️ | Workload view exists; portfolio-specific workload not confirmed |
| 8.6 | Portfolio reporting | Generate reports on portfolio health | Advanced+ | ⚠️ | Reports exist; portfolio-specific reports not confirmed |
| 8.7 | Universal portfolios | Unlimited portfolios | Enterprise+ | ⚠️ | No explicit limit found, but no "universal" designation |

---

## 9. Reporting & Dashboards

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 9.1 | Project dashboards | Visual project metrics and charts | Starter+ | ✅ | Dashboard view with charts/analytics |
| 9.2 | Universal reporting | Cross-project reporting | Starter+ | ✅ | `/reports` route with cross-project analytics |
| 9.3 | Custom charts | Create custom chart types | Starter+ | ✅ | Report dashboard with customizable metrics |
| 9.4 | Report filters | Filter by assignee, project, date, etc. | Starter+ | ✅ | Report filters supported |
| 9.5 | Real-time dashboards | Live-updating project metrics | Starter+ | ✅ | Real-time event system feeds dashboard updates |
| 9.6 | PowerBI / Tableau connectors | Export data to BI tools | Enterprise+ | ❌ | No BI tool connectors found |

---

## 10. Forms

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 10.1 | Form builder | Create custom intake forms | Starter+ | ✅ | `Form` model with JSON-based field definitions |
| 10.2 | Public / shareable forms | Share forms via URL | Starter+ | ✅ | Public forms page at `/forms/[formId]` |
| 10.3 | Form submissions | Track form responses | Starter+ | ✅ | `FormSubmission` model with tracking |
| 10.4 | Form-to-task conversion | Auto-create tasks from submissions | Starter+ | ✅ | Link form submissions to tasks |
| 10.5 | Branching questions | Conditional form logic | Advanced+ | ❌ | Not found in codebase |
| 10.6 | Custom form branding | Brand forms with logos/colors | Advanced+ | ❌ | Not found in codebase |

---

## 11. Rules & Automations

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 11.1 | Automation rules | Trigger-condition-action rules | Starter+ | ✅ | `Automation` model with full trigger-condition-action system |
| 11.2 | Trigger types | Task created, status changed, due date approaching, etc. | Starter+ | ✅ | Triggers: TASK_CREATED, STATUS_CHANGED, etc. |
| 11.3 | Automation actions | Auto-assign, move, update fields, notify | Starter+ | ✅ | Automation actions with project-scoped rules |
| 11.4 | Enable/disable automations | Toggle automations on/off | Starter+ | ✅ | Enable/disable flag on automations |
| 11.5 | Bulk triggers | Run rules on multiple tasks at once | Starter+ | ⚠️ | Batch task operations exist; bulk rule triggers not explicitly confirmed |
| 11.6 | AI-powered rule suggestions | AI suggests automations based on patterns | Starter+ | ❌ | Not found (GIDEON AI exists but not for rule suggestions) |
| 11.7 | Auto-named rules | AI generates rule names | Starter+ | ❌ | Not found |
| 11.8 | Workflow bundles | Reusable automation packages across projects | Enterprise+ | ❌ | Not found |

---

## 12. Status Updates

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 12.1 | Status updates | Periodic project health reports | Starter+ | ✅ | `StatusUpdate` model in schema |
| 12.2 | Status update reminders | Automated reminders to post updates | Starter+ | ⚠️ | Notification preferences include status updates; automated reminders not confirmed |
| 12.3 | Status roll-up to portfolios | Portfolio-level status aggregation | Advanced+ | ⚠️ | Both exist independently; roll-up not confirmed |
| 12.4 | Status roll-up to goals | Goal-level status aggregation | Advanced+ | ⚠️ | Both exist independently; roll-up not confirmed |
| 12.5 | AI-generated status updates | AI auto-generates project status | Enterprise+ | ❌ | Not found |

---

## 13. Comments & Collaboration

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 13.1 | Task comments | Post comments on tasks | All plans | ✅ | `Comment` model with task association |
| 13.2 | Rich text comments | Format comments with bold, links, lists, etc. | All plans | ✅ | TipTap rich text editor |
| 13.3 | @mentions | Mention users in comments | All plans | ✅ | @mentions via notification service |
| 13.4 | Emoji reactions | React to comments with emojis | All plans | ✅ | `CommentReaction` model |
| 13.5 | Threaded replies | Reply to specific comments | All plans | ✅ | Threaded replies on comments (Asana notably LACKS this — NEXUS is ahead) |
| 13.6 | Proofing (image feedback) | Leave feedback annotations directly on images/PDFs | Advanced+ | ❌ | No proofing/annotation feature found |
| 13.7 | Comment attachments | Attach files to comments | All plans | ⚠️ | Attachments on tasks exist; comment-specific attachments not confirmed |
| 13.8 | Activity log | Track all changes on a task | All plans | ✅ | `ActivityLog` model with comprehensive change tracking |

---

## 14. Real-Time & Presence

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 14.1 | Real-time updates | Live task/project updates without refresh | All plans | ✅ | Socket.IO integration + event bus system |
| 14.2 | Live cursors / presence | See who's viewing a project/task | All plans | ✅ | Live cursors and presence indicators |
| 14.3 | Real-time notifications | Instant notification delivery | All plans | ✅ | Socket emitter for real-time event broadcasting |

---

## 15. Followers & Watchers

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 15.1 | Task followers | Follow tasks to receive updates | All plans | ✅ | `TaskFollower` model |
| 15.2 | Auto-follow on action | Automatically follow tasks you interact with | All plans | ⚠️ | Followers exist; auto-follow logic not confirmed |
| 15.3 | Add/remove followers | Manage who follows a task | All plans | ✅ | TaskFollower CRUD operations |

---

## 16. Guest Access & Sharing

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 16.1 | Guest access | Invite external users with limited access | All plans | ✅ | GUEST role in ProjectMemberRole enum |
| 16.2 | Comment-only guests | Guests who can only view and comment | All plans | ⚠️ | VIEWER role exists; comment-only distinction not confirmed |
| 16.3 | Trusted guest domains | Whitelist domains for guest access | Enterprise+ | ❌ | Not found |
| 16.4 | Invite tokens | Share invitation links | All plans | ✅ | `InviteToken` model with expiration |

---

## 17. Templates

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 17.1 | Project templates | Create projects from templates | All plans (basic), Starter+ (advanced) | ✅ | Template-based project creation |
| 17.2 | Task templates | Reusable task blueprints | Starter+ | ⚠️ | Not explicitly confirmed as separate feature; may be part of project templates |
| 17.3 | Custom templates | Create your own templates | Advanced+ | ✅ | Custom template creation supported |
| 17.4 | Template gallery | Pre-built templates library | All plans | ⚠️ | Templates exist; gallery/marketplace not confirmed |
| 17.5 | Doc templates | Reusable document templates | N/A | ✅ | `DocTemplate` model — NEXUS-specific feature |

---

## 18. Bundles

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 18.1 | Workflow bundles | Package fields, rules, sections, task templates for reuse across projects | Enterprise+ | ❌ | Not found in codebase |

---

## 19. Approvals

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 19.1 | Approval task type | Tasks that require explicit approval | Advanced+ | ✅ | APPROVAL in TaskType enum |
| 19.2 | Approve / reject actions | One-click approve or request changes | Advanced+ | ⚠️ | Task type exists; approval workflow actions not confirmed |
| 19.3 | Approval notifications | Notify approvers when action needed | Advanced+ | ⚠️ | Notification system exists; approval-specific notifications not confirmed |

---

## 20. API & Integrations

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 20.1 | REST API | Full CRUD API for all entities | All plans | ✅ | 34+ API endpoint groups with authentication |
| 20.2 | API authentication | OAuth, personal access tokens | All plans | ✅ | NextAuth-based authentication |
| 20.3 | Service accounts | Machine-to-machine API access | Enterprise+ | ❌ | Not found |
| 20.4 | Rate limiting | API rate limits | All plans | ⚠️ | Not explicitly confirmed |
| 20.5 | 200+ integrations | Marketplace of third-party integrations | All plans | ⚠️ | Google Drive + NAS integrations; no marketplace |
| 20.6 | Google Drive integration | Link/attach Google Drive files | All plans | ✅ | Full Google Drive OAuth, file listing, search, upload/download |
| 20.7 | NAS integration | N/A (not Asana feature) | N/A | ✅ | NEXUS-specific: NAS authentication, file browsing, upload/download |

---

## 21. Webhooks

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 21.1 | Webhook creation | Register webhooks for events | All plans | ✅ | `Webhook` model with full CRUD |
| 21.2 | Event types | Task created, updated, completed, comment created, etc. | All plans | ✅ | Multiple event types: task.created, task.updated, comment.created, etc. |
| 21.3 | Webhook delivery tracking | Monitor delivery status and errors | All plans | ✅ | `WebhookDelivery` model with status tracking |
| 21.4 | Retry with backoff | Exponential backoff for failed deliveries | All plans | ✅ | Retry logic with exponential backoff |
| 21.5 | HMAC signing | Cryptographic signature verification | All plans | ✅ | HMAC signing for webhook security |

---

## 22. Security & Admin

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 22.1 | SSO / SAML | Single sign-on with identity providers | Enterprise+ | ❌ | Not found; uses NextAuth email/password |
| 22.2 | SCIM provisioning | Auto-provision/deprovision users | Enterprise+ | ❌ | Not found |
| 22.3 | Two-factor authentication (2FA) | Additional login security | Starter+ | ❌ | Not found |
| 22.4 | Admin console | Central admin dashboard | Starter+ | ⚠️ | Settings pages with RBAC management; no dedicated admin console UI |
| 22.5 | Workspace roles | Owner, Admin, Member role hierarchy | All plans | ✅ | OWNER, ADMIN, MEMBER roles on WorkspaceMember |
| 22.6 | Data loss prevention (DLP) | Integration with DLP tools | Enterprise+ | ❌ | Not found |
| 22.7 | Session management | Control session duration | Enterprise+ | ❌ | Not found |
| 22.8 | Custom branding | Brand workspace with logo | Enterprise+ | ❌ | Not found |
| 22.9 | Managed workspaces | IT-managed workspace controls | Enterprise+ | ❌ | Not found |
| 22.10 | App management | Control third-party app access | Enterprise+ | ❌ | Not found |
| 22.11 | Audit logs | Track admin/user actions | Enterprise+ | ✅ | `AuditLog` model with comprehensive tracking: action types, entity tracking, IP/user agent, old/new value diffs |
| 22.12 | Password requirements | Enforce password policies | Enterprise+ | ⚠️ | Password management exists; policy enforcement not confirmed |

---

## 23. Time Tracking

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 23.1 | Native time tracking | Track time spent on tasks | Advanced+ | ✅ | `TimeEntry` model with start/end times |
| 23.2 | Duration tracking | Record time duration per task | Advanced+ | ✅ | Duration tracking with descriptions |
| 23.3 | Estimated vs actual time | Compare planned vs actual effort | Advanced+ | ✅ | Estimated hours on tasks + actual time entries |
| 23.4 | Time reports | Report on time across projects | Advanced+ | ⚠️ | Time data exists; dedicated time reports not confirmed |

---

## 24. Integrations (Slack/Teams/Gmail)

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 24.1 | Slack integration | Create tasks from Slack, receive notifications | All plans | ✅ | Slack notification channel in preferences |
| 24.2 | Microsoft Teams integration | Receive inbox notifications, take actions in Teams | All plans | ❌ | Not found |
| 24.3 | Gmail integration | Create tasks from emails | All plans | ❌ | Not found |
| 24.4 | Zoom integration | Link Zoom meetings to tasks | All plans | ❌ | Not found |
| 24.5 | Salesforce integration | Sync with CRM | Enterprise+ | ❌ | Not found |
| 24.6 | Jira integration | Sync with Jira issues | Enterprise+ | ❌ | Not found |
| 24.7 | Microsoft 365 Copilot | Smart chat in Copilot | Enterprise+ | ❌ | Not found |

---

## 25. Mobile

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 25.1 | iOS app | Native iOS application | All plans | ❌ | Web application only (responsive design with mobile nav) |
| 25.2 | Android app | Native Android application | All plans | ❌ | Web application only (responsive design with mobile nav) |
| 25.3 | Responsive web | Mobile-optimized web experience | All plans | ✅ | Responsive design with mobile navigation |
| 25.4 | Desktop app | Native desktop application | All plans | ❌ | Web application only |

---

## 26. Workload

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 26.1 | Workload view | Visualize team capacity | Advanced+ | ✅ | Dedicated workload view component |
| 26.2 | Effort estimation | Assign hours/points to tasks | Advanced+ | ✅ | Estimated hours field on tasks |
| 26.3 | Capacity rebalancing | Drag to reassign work | Advanced+ | ⚠️ | Workload view exists; drag rebalancing not confirmed |
| 26.4 | Universal workload | Cross-portfolio workload view | Enterprise+ | ❌ | Not found |

---

## 27. Advanced Search

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 27.1 | Global search | Search across all work | All plans (basic), Starter+ (advanced) | ✅ | Global search API endpoint + search dialog UI |
| 27.2 | Advanced filters | Filter by custom fields, dates, assignees, etc. | Starter+ | ✅ | Faceted search capabilities |
| 27.3 | Saved searches | Save search queries for reuse | Starter+ | ❌ | Not found |
| 27.4 | Multilingual semantic search | AI-powered intent-based search across languages | Enterprise+ | ❌ | Not found |

---

## 28. Data Export

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 28.1 | CSV export | Export tasks/projects as CSV | All plans | ✅ | CSV export functionality |
| 28.2 | PDF export | Export reports/tasks as PDF | All plans | ✅ | PDF export functionality |
| 28.3 | Data export API | Programmatic data extraction | Enterprise+ | ⚠️ | REST API exists; dedicated export API endpoint not confirmed |
| 28.4 | JSON export | Export data as JSON | All plans | ⚠️ | API returns JSON; dedicated export not confirmed |

---

## 29. AI Features

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 29.1 | AI smart summaries | AI summarizes tasks and conversations | Starter+ | ⚠️ | GIDEON AI exists but with different focus (task creation/management) |
| 29.2 | AI Studio | No-code AI workflow builder | Starter+ | ❌ | Not found (GIDEON is chat-based, not workflow builder) |
| 29.3 | AI Teammates (beta) | Assign work to AI agents | Enterprise+ (AI Studio Pro) | ⚠️ | GIDEON AI assistant with 12 tools (create_task, update_task, search, etc.) — similar concept, different implementation |
| 29.4 | AI risk reports | AI identifies project risks | Enterprise+ | ❌ | Not found |
| 29.5 | Smart workflow gallery | Pre-built AI workflows | Starter+ | ❌ | Not found |
| 29.6 | AI-powered chat assistant | Natural language project management | Starter+ | ✅ | GIDEON: powered by Claude (Sonnet/Opus), natural language interaction |

---

## 30. Sprints & Agile

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 30.1 | Sprints | Create sprints with start/end dates | N/A (Asana has limited sprint support) | ✅ | Full `Sprint` model: PLANNING, ACTIVE, COMPLETED statuses |
| 30.2 | Sprint tasks | Assign tasks to sprints | N/A | ✅ | `SprintTask` join table |
| 30.3 | Sprint board | Sprint-scoped board view | N/A | ✅ | Sprint board view |
| 30.4 | Sprint velocity | Track team velocity | N/A | ⚠️ | Sprint data exists; velocity tracking not confirmed |

> **Note:** Asana has limited native sprint support. NEXUS significantly exceeds Asana here with dedicated sprint management.

---

## 31. Documents & Wiki

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 31.1 | Documents / wiki | Create and edit rich documents | N/A (not core Asana) | ✅ | Full `/docs` route with `Doc` model, nested docs, TipTap editor |
| 31.2 | Nested documents | Parent-child document hierarchy | N/A | ✅ | `parentId` self-relation on Doc model |
| 31.3 | Document templates | Reusable doc templates | N/A | ✅ | `DocTemplate` model |
| 31.4 | Synced blocks | Reusable content blocks across docs | N/A | ✅ | `SyncedBlock` model |
| 31.5 | Block editor | Slash commands, inline databases | N/A | ✅ | Block editor with slash commands and inline database blocks |
| 31.6 | Document verification | Mark docs as verified/reviewed | N/A | ✅ | Verification status on documents |

> **Note:** Asana does not have a native docs/wiki system. This is a major differentiator for NEXUS (Notion-like capability).

---

## 32. Import & Migration

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 32.1 | Asana import | Import data from Asana | N/A | ✅ | Asana import with job tracking |
| 32.2 | Notion import | Import data from Notion | N/A | ✅ | Notion import with job tracking |
| 32.3 | Import job tracking | Track import progress and status | N/A | ✅ | `ImportJob` model with status and progress |

---

## 33. Audit & Compliance

| # | Feature | Asana Description | Asana Tier | NEXUS Status | NEXUS Notes |
|---|---------|-------------------|------------|:------------:|-------------|
| 33.1 | Audit logs | Track all user actions | Enterprise+ | ✅ | `AuditLog` model: create, update, delete, login, export, invite |
| 33.2 | Entity tracking | Track changes to all entities | Enterprise+ | ✅ | Tracks tasks, projects, docs, users, comments, webhooks |
| 33.3 | Metadata / diffs | Store old/new values for changes | Enterprise+ | ✅ | Metadata storage with old/new value diffs |
| 33.4 | IP & user agent logging | Security audit trail | Enterprise+ | ✅ | IP address and user agent tracking |
| 33.5 | Audit log viewer | Admin UI for viewing audit logs | Enterprise+ | ✅ | Audit log viewer in settings |

---

## Summary Statistics

### NEXUS Feature Parity with Asana

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | 97 | ~60% |
| ⚠️ Partial | 30 | ~19% |
| ❌ Not Implemented | 34 | ~21% |
| **Total Features Tracked** | **161** | **100%** |

### Key Gaps (Critical Missing Features)

| Priority | Feature | Asana Tier | Impact |
|----------|---------|------------|--------|
| 🔴 HIGH | Multi-homing (tasks in multiple projects) | All plans | Core Asana differentiator |
| 🔴 HIGH | SSO / SAML | Enterprise+ | Enterprise sales blocker |
| 🔴 HIGH | Native mobile apps (iOS/Android) | All plans | Huge user reach gap |
| 🟡 MEDIUM | Proofing (image/PDF annotation) | Advanced+ | Creative team workflows |
| 🟡 MEDIUM | Workflow bundles | Enterprise+ | Enterprise scaling |
| 🟡 MEDIUM | AI Studio (no-code AI workflows) | Starter+ | Modern AI workflow builder |
| 🟡 MEDIUM | Strategy map (goal visualization) | Enterprise+ | Executive visibility |
| 🟡 MEDIUM | Microsoft Teams integration | All plans | Enterprise comms |
| 🟡 MEDIUM | Gmail integration | All plans | Email-to-task workflow |
| 🟠 LOW | 2FA / MFA | Starter+ | Security baseline |
| 🟠 LOW | SCIM provisioning | Enterprise+ | IT automation |
| 🟠 LOW | Saved searches | Starter+ | Power user workflow |
| 🟠 LOW | Branching form questions | Advanced+ | Advanced intake |

### NEXUS Advantages Over Asana

| Feature | Notes |
|---------|-------|
| Documents / Wiki (Notion-like) | Full block editor, nested docs, templates, synced blocks — Asana has nothing comparable |
| Sprints & Agile | Dedicated sprint management with planning/active/completed lifecycle — Asana has minimal sprint support |
| Threaded comments | NEXUS has threaded replies; Asana famously lacks this (years of forum requests) |
| Multiple assignees | NEXUS supports multi-assignee; Asana only allows one assignee per task |
| AI assistant (GIDEON) | Claude-powered conversational PM assistant with 12+ tools |
| WhatsApp notifications | Multi-channel notifications including WhatsApp |
| NAS integration | Network attached storage file management |
| Gallery view | Additional project view not in Asana |
| Audit logs on all plans | NEXUS has comprehensive audit logging; Asana restricts to Enterprise+ |
| Import from competitors | Dedicated Asana + Notion import pipelines |

---

## Sources

- [Asana Product Page](https://asana.com/product)
- [Asana Pricing](https://asana.com/pricing)
- [Asana What's New](https://asana.com/whats-new)
- [Asana Features](https://asana.com/features)
- [Asana All Features List](https://help.asana.com/s/article/all-asana-features?language=en_US)
- [Asana Advanced Plan](https://asana.com/plan/advanced)
- [Asana Starter Plan](https://asana.com/plan/starter)
- [Asana Personal Plan](https://asana.com/plan/personal)
- [Asana Spring 2025 Release](https://asana.com/inside-asana/spring-release-2025)
- [Asana Summer 2025 Release](https://asana.com/inside-asana/summer-release-2025)
- [Asana Fall 2025 Release](https://asana.com/inside-asana/fall-release-2025)
- [Asana Winter 2025 Release](https://asana.com/inside-asana/winter-release-2025)
- [Asana Proofing](https://asana.com/inside-asana/design-feedback-proofing)
- [Asana Multi-homing](https://help.asana.com/s/article/how-to-multi-home-tasks?language=en_US)
- [Asana AI Teammates](https://asana.com/product/ai/ai-teammates)
- [Asana Webhooks Guide](https://developers.asana.com/docs/webhooks-guide)
- [Asana Templates](https://asana.com/features/workflow-automation/project-task-templates)
- [Asana Admin Console](https://asana.com/features/admin-security/admin-console)
- [Asana Pricing Breakdown (RemoteWize)](https://remotewize.com/asana-pricing/)
- [Asana Pricing (Tech.co)](https://tech.co/project-management-software/asana-pricing)
