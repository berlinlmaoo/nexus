# Phase 3 Builder Report — v0.3.0

## Overview

Phase 3 delivers 8 high-value features focused on notifications, collaboration, project management, and content organization. All features follow existing codebase patterns and conventions.

---

## Features Implemented

### 1. Broader Notification Types + Link Field + Inbox Grouping

**Schema Changes:**
- Added `link String?` to `Notification` model

**Backend:**
- `notifyTaskCompleted()` — notifies all assignees + followers when a task is marked DONE
- `notifyCommentAdded()` — notifies all assignees + followers when a comment is added (not just @mentions)
- All existing notification functions now set the `link` field with navigable URLs (e.g., `/projects/{projectId}/tasks/{taskId}`)
- Wired `notifyTaskCompleted` into `PATCH /api/tasks/[taskId]` on status→DONE
- Wired `notifyCommentAdded` into `POST /api/tasks/[taskId]/comments`

**Frontend (Inbox):**
- Three view tabs: **All**, **By Project**, **By Type**
- Collapsible groups when viewing by project or type
- Read/Unread filter with counts
- Delete notification button per notification
- `DELETE /api/notifications` endpoint with single/batch/clear-read support
- Inbox page fetches project names for grouping labels

**Files Modified:**
- `prisma/schema.prisma` — Notification.link
- `src/lib/notification-service.ts` — new functions + link field on all
- `src/app/api/tasks/[taskId]/route.ts` — task_completed trigger
- `src/app/api/tasks/[taskId]/comments/route.ts` — comment_added trigger
- `src/app/api/notifications/route.ts` — DELETE handler
- `src/app/(app)/inbox/page.tsx` — project map fetch
- `src/app/(app)/inbox/inbox-client.tsx` — full rewrite with tabs/grouping/delete

---

### 2. Comment Reactions/Emoji

**Schema Changes:**
- New `CommentReaction` model: `id`, `commentId`, `userId`, `emoji`, `createdAt` with `@@unique([commentId, userId, emoji])`

**Backend:**
- `POST /api/tasks/[taskId]/comments/[commentId]/reactions` — toggle reaction (add if not exists, remove if exists)
- Comments GET includes `reactions` with user info at all nesting levels

**Frontend:**
- Reaction chips below each comment showing emoji + count
- Click to toggle own reaction (highlighted when user has reacted)
- Hover tooltip shows who reacted
- Quick emoji picker (8 common emojis: thumbs up, heart, smile, party, thinking, eyes, rocket, clap)

**Files Created:**
- `src/app/api/tasks/[taskId]/comments/[commentId]/reactions/route.ts`

**Files Modified:**
- `prisma/schema.prisma` — CommentReaction model + relations
- `src/app/api/tasks/[taskId]/comments/route.ts` — include reactions in GET
- `src/components/tasks/task-comments.tsx` — reaction UI + toggle logic

---

### 3. Subtask Enhancements

**Backend:**
- Task GET now includes subtask assignees with user details

**Frontend:**
- Subtasks show assignee avatars inline
- Inline date picker for subtask due dates (saves directly via PATCH)
- Overdue subtasks highlighted in red
- Click checkbox to toggle subtask completion status

**Files Modified:**
- `src/app/api/tasks/[taskId]/route.ts` — subtask includes assignees
- `src/components/tasks/task-detail-panel.tsx` — enhanced subtask row UI

---

### 4. Project Archiving + Duplication

**Archive/Unarchive:**
- Uses existing `PATCH /api/projects/[projectId]` with `{ status: 'ARCHIVED' }` / `{ status: 'ACTIVE' }`
- Sidebar context menu: Archive/Unarchive toggle
- Sidebar: "Show/Hide archived" filter toggle
- Archived projects shown with dimmed name + archive icon

**Duplication:**
- Pre-existing `POST /api/projects/[projectId]/duplicate` — copies project + task lists + tasks + assignees
- Added "Duplicate" option to sidebar project context menu
- New project added to sidebar immediately after duplication

**Files Modified:**
- `src/components/layout/sidebar.tsx` — context menu (archive/duplicate/delete), archived filter, status field

---

### 5. Task Followers/Subscribers

**Schema Changes:**
- New `TaskFollower` model: `id`, `taskId`, `userId`, `createdAt` with `@@unique([taskId, userId])`

**Backend:**
- `GET /api/tasks/[taskId]/followers` — list followers + `isFollowing` for current user
- `POST /api/tasks/[taskId]/followers` — toggle follow/unfollow
- **Auto-follow on comment:** commenter auto-follows the task
- **Auto-follow on assignment:** assigned users auto-follow the task
- **Notifications:** `notifyTaskCompleted` and `notifyCommentAdded` both notify followers

**Frontend:**
- Follow/Unfollow button (eye icon) in task detail panel header
- Visual state: filled eye when following, outline when not

**Files Created:**
- `src/app/api/tasks/[taskId]/followers/route.ts`

**Files Modified:**
- `prisma/schema.prisma` — TaskFollower model + relations
- `src/app/api/tasks/[taskId]/route.ts` — auto-follow on assignment
- `src/app/api/tasks/[taskId]/comments/route.ts` — auto-follow on comment
- `src/lib/notification-service.ts` — followers included in notification recipients
- `src/components/tasks/task-detail-panel.tsx` — follow button UI

---

### 6. Sprint Filter on Project Board

**Frontend:**
- Sprint filter dropdown added to project detail filter bar
- Options: All, No Sprint, + each sprint (active sprint labeled)
- Filters applied to both `filteredTasks` and `filteredSections` (all view modes)
- Sprint data fetched from `/api/sprints?projectId=` on mount
- Included in active filter count and clear button

**Files Modified:**
- `src/components/projects/project-detail-client.tsx` — sprint state, fetch, filter logic, dropdown UI

---

### 7. Doc Templates

**Schema Changes:**
- New `DocTemplate` model: `id`, `title`, `content (Json)`, `category`, `workspaceId`, timestamps

**Backend:**
- `GET /api/docs/templates?workspaceId=` — returns templates, auto-seeds 5 defaults if workspace has none
- `POST /api/docs` — accepts optional `templateId`, uses template content when creating doc
- **Seed Templates:** Meeting Notes, Project Brief, Technical Spec, Weekly Update, Decision Log

**Frontend:**
- Template picker grid in "Create Document" dialog
- "Blank Document" option + 5 template cards showing title + category
- Selected template highlighted; templateId passed to API on create

**Files Created:**
- `src/app/api/docs/templates/route.ts`

**Files Modified:**
- `prisma/schema.prisma` — DocTemplate model + Workspace relation
- `src/app/api/docs/route.ts` — templateId support in POST
- `src/app/(app)/docs/docs-client.tsx` — template picker UI

---

### 8. Goal Hierarchy (Sub-goals)

**Schema Changes:**
- Added `parentId String?` + self-relation `parent`/`children` on `Goal` model

**Backend:**
- Goals GET includes nested children (2 levels deep)
- Goals POST accepts `parentId`
- Goals PATCH: when a child goal's progress changes, parent's progress = average of children
- `parentId` settable via PATCH

**Frontend:**
- Top-level goals displayed with expand/collapse for children
- Sub-goals indented with visual hierarchy (ChevronDown/Right, CornerDownRight)
- "Sub-goal" count badge on parent goals
- "+ Sub-goal" button on each goal card
- Create dialog shows "Create Sub-Goal" with parent name when adding to a parent
- Progress rollup: parent goal progress = average of child goal progress

**Files Modified:**
- `prisma/schema.prisma` — Goal.parentId + self-relation
- `src/app/api/goals/route.ts` — children include + parentId in POST
- `src/app/api/goals/[goalId]/route.ts` — parentId in PATCH + parent progress recalc
- `src/app/(app)/goals/page.tsx` — include children in query
- `src/app/(app)/goals/goals-client.tsx` — GoalCard component, hierarchy UI, sub-goal creation

---

## Database Migration Required

New models and fields added to `prisma/schema.prisma`:
- `Notification.link` — nullable string
- `CommentReaction` — new model
- `TaskFollower` — new model
- `DocTemplate` — new model
- `Goal.parentId` — nullable self-relation

Run `npx prisma migrate dev` or `npx prisma db push` to apply.

---

## Summary

| Feature | Schema | API | UI | Status |
|---------|--------|-----|-----|--------|
| Notifications + Inbox | link field | 2 new notifiers + DELETE | Tabs, grouping, delete | Done |
| Comment Reactions | CommentReaction | Toggle endpoint | Chips + picker | Done |
| Subtask Enhancements | — | Include assignees | Inline dates + avatars | Done |
| Project Archive + Dup | — | Existing endpoints | Context menu + filter | Done |
| Task Followers | TaskFollower | GET/POST toggle | Follow button + auto-follow | Done |
| Sprint Filter | — | — | Filter dropdown | Done |
| Doc Templates | DocTemplate | Templates API | Template picker | Done |
| Goal Hierarchy | Goal.parentId | Tree + parentId | Nested cards + sub-goal creation | Done |
