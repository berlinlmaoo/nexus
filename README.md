# NEXUS - Project Management Platform

A full-stack project management application built for **PATS Group**. An Asana-style workspace featuring task boards, sprint management, goal tracking, automation, real-time collaboration, and an AI-powered assistant (GIDEON).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Auth | NextAuth.js v5 (Credentials + Google OAuth) |
| Real-time | Socket.IO |
| UI | Tailwind CSS, Radix UI, Lucide Icons, Framer Motion |
| Rich Text | TipTap |
| State | Zustand |
| Drag & Drop | @hello-pangea/dnd |
| Charts | Recharts |
| AI | Anthropic Claude (GIDEON assistant) |
| Email | Nodemailer |
| PDF | jsPDF |

## Features

### Project Management
- Workspaces, projects, and task lists
- Kanban board, list view, table view, calendar view
- Drag-and-drop task ordering and status transitions
- Project archive, duplicate, inline edit
- Project pages (wiki-style docs per project)
- Portfolios for multi-project oversight

### Task Management
- Task creation, assignment, priorities, due dates
- Subtasks with progress rollup
- Task dependencies and relations
- Task recurrence (daily → yearly)
- Task followers and notifications
- Comment threading with emoji reactions
- Custom fields (text, number, date, dropdown, checkbox)
- Time tracking
- File attachments

### Sprint Management
- Sprint planning, active, and completed states
- Sprint completion with incomplete task handling (backlog / next sprint / overflow)
- Sprint filter in task views
- Velocity tracking

### Goals & Tracking
- Hierarchical goals (parent/child) with cascading progress
- Goal milestones and status tracking (on track, at risk, behind)
- Link goals to projects and tasks

### Documentation
- Wiki-style docs with hierarchy
- Rich text editor (TipTap)
- Document templates and duplication
- Full-text doc search

### Forms
- Form builder with multiple field types
- Public form submission (no auth)
- Auto-create tasks from submissions

### Automation & Webhooks
- Automation rules: triggers → conditions → actions
- Webhook management with HMAC signing and delivery tracking
- Event types: task.created, task.updated, task.completed, comment.created, project.updated

### Teams & Collaboration
- Team management with automatic project access propagation
- Real-time updates via Socket.IO
- Sidebar favorites and recents
- User presence

### Notifications
- In-app, email (SMTP), Slack, and WhatsApp notifications
- Per-user notification preferences
- Inbox with bulk actions

### Access Control
- Three-level RBAC: System → Workspace → Project
- Project roles: LEAD, MEMBER, VIEWER, GUEST
- Audit logging

### Integrations
- Google Drive (browse, upload, download)
- Synology NAS (browse, search, upload, download)
- Asana import
- Notion import
- CSV and PDF export

### AI Assistant (GIDEON)
- Natural language task management powered by Anthropic Claude
- Create, update, query tasks via conversational interface
- Model selection: Sonnet (fast) / Opus (capable)

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Google OAuth credentials (for @patsgroup.id SSO)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd pats-app
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your values. See `.env.example` for all required variables.

**Required:**
- `DATABASE_URL` — PostgreSQL connection string
- `AUTH_SECRET` — Generate with `openssl rand -base64 32`
- `NEXTAUTH_URL` — Application URL (e.g. `https://nexus.patsgroup.id`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth credentials

**Optional (for integrations):**
- `SMTP_*` — Email notification delivery
- `NAS_*` — Synology NAS file storage
- `GOOGLE_DRIVE_*` — Google Drive integration
- `WA_WEBHOOK_URL` / `SLACK_WEBHOOK_URL` — Messaging notifications

For local OTP email testing, Mailpit is the recommended free setup:
- `SMTP_HOST=mailpit`
- `SMTP_PORT=1025`
- `SMTP_FROM=NEXUS <noreply@localhost>`
- Mail inbox UI: [http://localhost:8025](http://localhost:8025)

### 3. Set Up Database

```bash
npx prisma generate
npx prisma db push
```

### 4. Seed Database (optional)

```bash
npx prisma db seed
```

### 5. Build and Run

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
pm2 start npm --name nexus -- start
```

Open your configured URL (default: [http://localhost:3000](http://localhost:3000)).

## Docker Deployment

### Local PostgreSQL in Docker

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
```

This local Docker stack includes Mailpit for OTP/email testing:
- SMTP: `localhost:1025`
- Inbox UI: [http://localhost:8025](http://localhost:8025)

This stack starts PostgreSQL, runs `prisma db push`, then launches the app on port `3000`.

### External PostgreSQL / NAS

```bash
cp .env.docker.nas.example .env.docker.nas
docker compose --env-file .env.docker.nas -f docker-compose.nas.yml up -d --build
```

Set `NEXTAUTH_URL` to the Mac Mini IP or public domain that users will actually open.
If you are using Synology's PostgreSQL package, double-check the exposed port first; many setups listen on `5433` instead of `5432`.

### Seed Demo Users Safely

```bash
docker compose --env-file .env.docker.nas -f docker-compose.nas.yml run --rm --build bootstrap npm run db:seed:users
```

This command only upserts the demo login accounts and workspace membership.
Do not use `npm run db:seed` on a live database unless you intentionally want to wipe existing data first.

## Login

**Google OAuth:** Sign in with any `@patsgroup.id` Google account.

**Credentials (seeded users):**

| Name | Email | Password | Role |
|------|-------|----------|------|
| Berlin Taufik | berlin@patsgroup.id | password123 | ADMIN |
| Anya Putri | anya@patsgroup.id | password123 | MEMBER |
| Rizky Pratama | rizky@patsgroup.id | password123 | MEMBER |
| Sari Dewi | sari@patsgroup.id | password123 | MEMBER |
| Fajar Nugroho | fajar@patsgroup.id | password123 | MEMBER |

## Architecture

```
src/
├── app/
│   ├── (app)/              # Authenticated app pages
│   │   ├── dashboard/      # Dashboard with widgets
│   │   ├── projects/       # Project management
│   │   ├── my-tasks/       # Personal task view
│   │   ├── goals/          # Goal tracking
│   │   ├── portfolios/     # Portfolio overview
│   │   ├── docs/           # Documentation
│   │   ├── teams/          # Team management
│   │   ├── inbox/          # Notifications inbox
│   │   ├── sprints/        # Sprint views
│   │   └── settings/       # User & workspace settings
│   ├── api/                # API routes (REST)
│   ├── f/[formId]/         # Public form submissions
│   └── login/              # Auth pages
├── components/
│   ├── layout/             # Sidebar, header, search
│   ├── projects/           # Project components
│   ├── tasks/              # Task detail, comments, board
│   ├── sprints/            # Sprint board, completion
│   ├── goals/              # Goal tree, milestones
│   ├── docs/               # Doc editor, templates
│   ├── forms/              # Form builder
│   ├── automations/        # Automation rule builder
│   ├── dashboard/          # Dashboard widgets
│   ├── gideon/             # AI assistant UI
│   ├── editor/             # TipTap rich text editor
│   └── ui/                 # Base UI components (Radix)
├── hooks/                  # Custom React hooks
│   ├── use-socket.ts       # Socket.IO client
│   ├── use-realtime-project.ts
│   └── use-presence.ts
├── lib/                    # Server utilities
│   ├── auth.ts             # NextAuth config
│   ├── prisma.ts           # Prisma client singleton
│   ├── rbac.ts             # Role-based access control
│   ├── automation-engine.ts
│   ├── webhook-dispatcher.ts
│   ├── notification-service.ts
│   ├── team-sync.ts        # Team ↔ project access sync
│   ├── event-bus.ts        # In-process event emitter
│   ├── socket-emitter.ts   # Socket.IO event helpers
│   └── email.ts            # SMTP email
├── generated/prisma/       # Generated Prisma client
pages/
└── api/socket.ts           # Socket.IO server (Pages API)
prisma/
├── schema.prisma           # Database schema (32 models)
└── seed.ts                 # Seed script
```

## API Documentation

See [docs/API.md](docs/API.md) for a complete reference of all API endpoints.
