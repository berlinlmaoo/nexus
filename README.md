# NEXUS — Project Management & Team Operations Platform

NEXUS is the internal platform built for **PATS Group**. It started as an Asana-style project/task workspace and has grown into a full team-operations suite: project management, attendance & HR, gamification, a company feed, peer-accountability, room booking, and an AI assistant (**GIDEON**) reachable both in-app and over WhatsApp.

The repository is a monorepo with **two frontends sharing one Next.js API + PostgreSQL database**:

- **`src/`** — the Next.js 15 application: all REST API routes, auth, real-time, scheduled jobs, **and** the original server-rendered web UI.
- **`apps/nexus-lovable-ui/`** — **"Phaëthon"**, a Vite + React 19 single-page client (TanStack Router/Query) that talks to the same API.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend / API | Next.js 15 (App Router), TypeScript |
| Database | PostgreSQL + Prisma 7 (100+ models) |
| Auth | NextAuth.js v5 (Credentials + Google OAuth + email OTP) |
| Real-time | Socket.IO |
| Legacy web UI | Next.js (App Router), Tailwind CSS, Radix UI, Lucide |
| Phaëthon client | Vite 7, React 19, TanStack Router + Query, Tailwind 4, Framer Motion |
| Rich Text | TipTap |
| AI | Anthropic Claude (GIDEON assistant + WhatsApp command/agent bot) |
| Messaging | WhatsApp (Hermes/Gideon bridge), Email (Nodemailer), Slack |
| Files | Local uploads (chunked, up to 1GB), Synology NAS, Google Drive |
| Mobile | Native iOS (SwiftUI) — separate repository |

## Features

### Project & Task Management
- Workspaces, projects, and task lists
- Kanban board, list, **table**, calendar, and timeline views
- Tasks: assignment, priorities, due dates, subtasks (progress rollup), dependencies, recurrence, followers, threaded comments + reactions
- **Custom fields**: text, number, date, dropdown, checkbox, URL, files & media
- Time tracking and chunked file attachments (up to 1GB)
- **Folders** (multi-project aggregate boards/calendars) and **Team Calendars** (saved, project-sourced deadline calendars)
- Project pages (wiki docs), portfolios, archive/duplicate/inline edit

### Sprint, Goals & Docs
- Sprint planning / active / completed with incomplete-task handling and velocity tracking
- Hierarchical goals with cascading progress, milestones, and status (on track / at risk / behind)
- Wiki-style docs with TipTap rich text, templates, and full-text search

### Attendance & HR
- Selfie + GPS **geofenced** check-in/out, with a per-member geofence-exempt mode
- Per-member **flexible shifts** ("Flexi Time")
- Leave / Sick / Permit / Day-off / Red-date requests with monthly quotas (day-off quota on the **28→27 payroll period**; red-date on the calendar month)
- Crew **streak board**, admin status overrides, and offsite-checkout approvals
- Mandatory **daily reflection** to check out; WhatsApp shift reminders
- Approvals actionable in-app **or via WhatsApp commands**, with result notifications to the requester and other approvers

### Gamification & Engagement
- XP, levels, streaks, quests (including task-bundle quests), and a company leaderboard

### Company Feed — "The Wire"
- Company-wide timeline: posts, comments, mentions

### Integrity & Complaints
- **Integrity** ("Cepu") peer-reporting with anonymous reporting, due-process rebuttal, and a public hall-of-shame
- Private, categorized **Complaint & Escalation** channel (anonymous / confidential options) routed to the BoD

### Room Booking
- Studio / VIP / meeting room bookings with double-booking prevention and public **TV kiosk** display pages

### Forms, Automation & Webhooks
- Form builder with public (no-auth) submission and auto-create tasks
- Automation rules (triggers → conditions → actions) and HMAC-signed webhooks with delivery tracking

### Notifications
- In-app, email (SMTP), Slack, and **WhatsApp** (via the Gideon bridge)
- Per-user preferences, Do-Not-Disturb, and an inbox with bulk actions

### Access Control
- Three-level RBAC: **System** (One-Above-All / Admin) → **Workspace** (BoD / Manager / Staff) → **Project** (Lead / Member / Viewer / Guest)
- Workspace-scoped queries and a full audit log

### Integrations & AI
- Google Drive and Synology NAS file browsing/upload/download
- Asana and Notion import; CSV and PDF export
- **GIDEON** — natural-language task/ops actions powered by Anthropic Claude, available in-app and over WhatsApp (deterministic command bot + LLM agent)

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Google OAuth credentials (for `@patsgroup.id` SSO)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd nexus
npm install
```

The Phaëthon SPA client is a separate package:

```bash
cd apps/nexus-lovable-ui
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
- `WA_WEBHOOK_URL` / `HERMES_WA_BRIDGE_URL` / `SLACK_WEBHOOK_URL` — Messaging notifications

For local OTP email testing, Mailpit is the recommended free setup:
- `SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_FROM=NEXUS <noreply@localhost>`
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

**Next.js API + legacy web UI:**
```bash
npm run dev          # development
npm run build        # production build
pm2 start npm --name nexus -- start
```

**Phaëthon SPA client** (`apps/nexus-lovable-ui`):
```bash
npm run dev          # Vite dev server, proxies /api → the Next.js backend
npm run build        # static dist/ — serve behind nginx with /api proxied to the backend
```

Open your configured URL (default: [http://localhost:3000](http://localhost:3000)).

## Docker Deployment

### Local PostgreSQL in Docker

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
```

This local stack includes Mailpit for OTP/email testing (SMTP `localhost:1025`, inbox [http://localhost:8025](http://localhost:8025)), starts PostgreSQL, runs `prisma db push`, then launches the app on port `3000`.

### External PostgreSQL / NAS

```bash
cp .env.docker.nas.example .env.docker.nas
docker compose --env-file .env.docker.nas -f docker-compose.nas.yml up -d --build
```

Set `NEXTAUTH_URL` to the host IP or public domain users will actually open. With Synology's PostgreSQL package, double-check the exposed port (many setups listen on `5433` instead of `5432`).

### Seed Demo Users Safely

```bash
docker compose --env-file .env.docker.nas -f docker-compose.nas.yml run --rm --build bootstrap npm run db:seed:users
```

This only upserts demo login accounts + workspace membership. Do **not** run `npm run db:seed` on a live database unless you intend to wipe existing data first.

## Login

**Google OAuth:** sign in with any `@patsgroup.id` Google account.

**Credentials:** local/demo seed accounts are created by the seed script (see `prisma/seed.ts`). These are for development only — never deploy seed passwords to production.

## Architecture

```
src/                          # Next.js 15 — API, auth, real-time, crons + legacy web UI
├── app/
│   ├── (app)/                # Authenticated app pages (dashboard, projects, attendance, …)
│   ├── api/                  # REST API routes (projects, tasks, attendance, feed, gideon, …)
│   ├── f/[formId]/           # Public form submissions
│   └── room-display/         # Public TV kiosk pages (no auth)
├── components/               # Legacy UI (layout, tasks, projects, gideon, editor, ui/…)
├── lib/                      # Server utilities
│   ├── auth.ts               # NextAuth config
│   ├── prisma.ts             # Prisma client singleton
│   ├── attendance*.ts        # Attendance + absence/penalty engine
│   ├── gamification.ts       # XP / levels / quests
│   ├── notification-service.ts  # In-app + email + Slack + WA dispatch
│   ├── wa-bot.ts             # WhatsApp command bot + Gideon notifications
│   ├── automation-engine.ts  # Automation rules
│   └── webhook-dispatcher.ts # Outbound webhooks
└── generated/prisma/         # Generated Prisma client

apps/nexus-lovable-ui/        # "Phaëthon" — Vite + React 19 SPA (TanStack Router/Query)
├── src/routes/_app/          # File-based routes (projects, attendance, feed, leaderboard, …)
├── src/components/           # Board, table view, task panel, motion toolkit, …
└── src/lib/nexus-api.ts      # Typed API client against the Next.js backend

pages/api/socket.ts           # Socket.IO server (Pages API)
prisma/schema.prisma          # Database schema (100+ models)
```

## API Documentation

See [docs/API.md](docs/API.md) for a reference of the API endpoints.
