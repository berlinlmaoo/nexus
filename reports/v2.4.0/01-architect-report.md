# NEXUS V2.4.0 Architect Report — Codename: D41V4

## System Overview

NEXUS is a high-performance project management platform built for PATS Group. It follows a modern, type-safe architecture using the Next.js App Router and Prisma ORM.

### Core Stack
- **Framework:** Next.js 14.2.x (App Router)
- **Database:** PostgreSQL with Prisma ORM (7.5.0)
- **Authentication:** NextAuth.js v5 (Beta) — Supports Credentials & Google OAuth
- **Real-time:** Socket.IO via Pages API (`/pages/api/socket.ts`)
- **State Management:** Zustand (Client-side) & React Query (via Next.js Fetch cache)
- **UI Components:** Radix UI (Primitives), Tailwind CSS, Framer Motion

---

## Architectural Patterns

### 1. Three-Level RBAC (Role-Based Access Control)
Access control is enforced at three distinct layers:
- **System Level:** Global roles (ADMIN, USER).
- **Workspace Level:** Controls access to global assets like Portfolios and Goals.
- **Project Level:** Context-specific roles (LEAD, MEMBER, VIEWER, GUEST).
- *Implementation:* Centralized in `src/lib/rbac.ts` and `src/lib/auth-guard.ts`.

### 2. Real-time Event Bus & Socket.IO
- **Event Bus:** Internal `EventEmitter` (`src/lib/event-bus.ts`) for server-side triggers (e.g., automation, notifications).
- **Socket.IO:** Bi-directional communication for user presence, typing indicators, and optimistic UI synchronization.
- **Socket Emitter:** Shared utility (`src/lib/socket-emitter.ts`) to broadcast events from server actions or API routes.

### 3. Automation Engine
- **Triggers:** `task.created`, `task.updated`, `comment.created`, etc.
- **Conditions:** Filtering based on task properties (Priority, Status, Assignee).
- **Actions:** Update fields, create subtasks, send notifications, or trigger webhooks.
- *Location:* `src/lib/automation-engine.ts`.

### 4. Integration Architecture
- **External Storage:** Abstracted drivers for Synology NAS and Google Drive.
- **Webhook Dispatcher:** HMAC-signed outgoing webhooks with delivery tracking and retry logic.
- **Import Services:** Parsers for Asana and Notion JSON/CSV exports.

---

## Data Model (Schema Highlights)
The Prisma schema includes 32+ models, with key relationships:
- **Workspaces** own **Projects**, **Teams**, and **Goals**.
- **Projects** contain **TaskLists**, which contain **Tasks**.
- **Tasks** support recursive **Subtasks**, **Followers**, **Dependencies**, and **Reactions**.
- **Sprints** act as time-bound containers for tasks within a project.

---

## Security & Performance
- **Rate Limiting:** Sliding window rate limiting applied to critical API routes (`src/lib/rate-limit.ts`).
- **Audit Logging:** Systematic tracking of all sensitive actions (project deletion, role changes).
- **Edge Compatibility:** Middleware handles session validation and workspace scoping on the Edge runtime.
